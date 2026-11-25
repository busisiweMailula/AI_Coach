from __future__ import annotations

import hmac
import hashlib
import json
import logging
import os
import re
import subprocess
from collections import Counter
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_analyzer.predefined_recognizers import PhoneRecognizer
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

logger = logging.getLogger("presidio_service")
MAX_TEXT_CHARS = 200_000
MAX_REQUEST_BYTES = 1_000_000
PII_ENTITIES = ["EMAIL_ADDRESS", "PHONE_NUMBER", "PERSON", "ZA_ID_NUMBER"]
SA_MOBILE_NUMBER = re.compile(
    r"(?:\(?0[6-8]\d\)?[\s().-]*\d{3}[\s().-]*\d{4}"
    r"|\+27[\s().-]*\(?[6-8]\d\)?[\s().-]*\d{3}[\s().-]*\d{4})"
)
PLACEHOLDER_PATTERN = re.compile(r"<[^<>]+>")
ALLOWED_PLACEHOLDERS = {f"<{entity}>" for entity in PII_ENTITIES}


def load_person_allow_list() -> list[str]:
    configured_path = os.environ.get("PRESIDIO_PERSON_ALLOWLIST_PATH")
    path = Path(configured_path) if configured_path else Path(__file__).with_name("person_allowlist.json")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Could not load the Presidio person allow-list") from error

    terms = payload.get("terms") if isinstance(payload, dict) else None
    if not isinstance(terms, list) or not all(isinstance(term, str) and term.strip() for term in terms):
        raise RuntimeError("The Presidio person allow-list must contain a terms array of non-empty strings")
    return [rf"(?i)(?<!\w){re.escape(term.strip())}(?!\w)" for term in terms]


PERSON_ALLOW_LIST = load_person_allow_list()

try:
    PERSON_SCORE_THRESHOLD = float(os.environ.get("PRESIDIO_PERSON_SCORE_THRESHOLD", "0.6"))
except ValueError as error:
    raise RuntimeError("PRESIDIO_PERSON_SCORE_THRESHOLD must be a number from 0 to 1") from error
if not 0 <= PERSON_SCORE_THRESHOLD <= 1:
    raise RuntimeError("PRESIDIO_PERSON_SCORE_THRESHOLD must be a number from 0 to 1")


def service_version() -> str:
    configured_version = os.environ.get("PRESIDIO_SERVICE_VERSION")
    if configured_version:
        return configured_version

    source_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).parent,
            capture_output=True,
            check=True,
            text=True,
            timeout=2,
        )
        commit = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        commit = "unknown"
    return f"{commit}+{source_hash}"


SERVICE_VERSION = service_version()


def build_engines() -> tuple[AnalyzerEngine, AnonymizerEngine]:
    model_name = os.environ.get("PRESIDIO_SPACY_MODEL", "en_core_web_sm")
    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": model_name}],
        }
    )
    analyzer = AnalyzerEngine(
        nlp_engine=provider.create_engine(),
        supported_languages=["en"],
    )
    analyzer.registry.add_recognizer(PhoneRecognizer(supported_regions=["ZA"], leniency=1))
    analyzer.registry.add_recognizer(
        PatternRecognizer(
            supported_entity="ZA_ID_NUMBER",
            patterns=[
                Pattern(
                    name="south_african_id_number",
                    regex=r"\b\d{13}\b",
                    score=0.85,
                )
            ],
        )
    )
    return analyzer, AnonymizerEngine()


def is_valid_sa_id_number(value: str) -> bool:
    if not re.fullmatch(r"\d{13}", value):
        return False

    year, month, day = int(value[:2]), int(value[2:4]), int(value[4:6])
    try:
        date(2000 + year, month, day)
    except ValueError:
        return False
    if value[10] not in {"0", "1"}:
        return False

    digits = [int(character) for character in value]
    doubled_odd_positions = str(int(value[1:12:2]) * 2)
    checksum_total = sum(digits[:12:2]) + sum(int(character) for character in doubled_odd_positions)
    return (10 - checksum_total % 10) % 10 == digits[12]


def is_valid_person_span(value: str, score: float) -> bool:
    if score < PERSON_SCORE_THRESHOLD or any(not character.isalpha() and not character.isspace() for character in value):
        return False
    return not (len(value.split()) == 1 and value.islower())


def anonymize_text(text: str, analyzer: Any, anonymizer: Any) -> str:
    detected = analyzer.analyze(
        text=text,
        language="en",
        entities=PII_ENTITIES,
        allow_list=PERSON_ALLOW_LIST,
        allow_list_match="regex",
    )
    findings = [
        finding
        for finding in detected
        if (
            finding.entity_type == "PERSON"
            and is_valid_person_span(text[finding.start:finding.end], finding.score)
        )
        or (
            finding.entity_type == "PHONE_NUMBER"
            and SA_MOBILE_NUMBER.fullmatch(text[finding.start:finding.end].strip())
        )
        or (
            finding.entity_type == "ZA_ID_NUMBER"
            and is_valid_sa_id_number(text[finding.start:finding.end])
        )
        or finding.entity_type == "EMAIL_ADDRESS"
    ]
    entity_counts = Counter(finding.entity_type for finding in findings)
    logger.info("Presidio detected entities: %s", dict(sorted(entity_counts.items())))
    operators = {
        entity: OperatorConfig("replace", {"new_value": f"<{entity}>"})
        for entity in PII_ENTITIES
    }
    result = anonymizer.anonymize(text=text, analyzer_results=findings, operators=operators)
    original_placeholders = set(PLACEHOLDER_PATTERN.findall(text))
    unexpected_placeholders = {
        placeholder
        for placeholder in PLACEHOLDER_PATTERN.findall(result.text)
        if placeholder not in ALLOWED_PLACEHOLDERS and placeholder not in original_placeholders
    }
    if unexpected_placeholders:
        logger.error(
            "Presidio produced disallowed placeholders: count=%d entity_types=%s",
            len(unexpected_placeholders),
            sorted(entity_counts),
        )
        raise ValueError("Anonymization produced a disallowed placeholder")
    return result.text


def configure_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    logging.basicConfig(level=level)


def create_handler(
    analyzer: AnalyzerEngine,
    anonymizer: AnonymizerEngine,
    api_token: str,
    version: str = SERVICE_VERSION,
) -> type[BaseHTTPRequestHandler]:
    processing_lock = Lock()

    class PresidioHandler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: object) -> None:
            return

        def send_json(self, status: int, payload: dict[str, str]) -> None:
            response = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_json(200, {"status": "ok", "version": version})
                return
            self.send_json(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if self.path != "/anonymize":
                self.send_json(404, {"error": "Not found"})
                return

            if api_token and not hmac.compare_digest(
                self.headers.get("Authorization", ""),
                f"Bearer {api_token}",
            ):
                self.send_json(401, {"error": "Unauthorized"})
                return

            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                self.send_json(415, {"error": "Content-Type must be application/json"})
                return

            try:
                content_length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                self.send_json(400, {"error": "Invalid Content-Length"})
                return

            if content_length <= 0:
                self.send_json(400, {"error": "Request body is required"})
                return
            if content_length > MAX_REQUEST_BYTES:
                self.send_json(413, {"error": "Request body is too large"})
                return

            try:
                payload = json.loads(self.rfile.read(content_length))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_json(400, {"error": "Request body must be valid JSON"})
                return

            if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
                self.send_json(400, {"error": "A text string is required"})
                return

            text = payload["text"]
            if not text.strip():
                self.send_json(400, {"error": "Text must not be empty"})
                return
            if len(text) > MAX_TEXT_CHARS:
                self.send_json(413, {"error": "Text exceeds the configured size limit"})
                return

            try:
                with processing_lock:
                    anonymized_text = anonymize_text(text, analyzer, anonymizer)
            except Exception as error:
                logger.error("Anonymization failed (%s)", type(error).__name__)
                self.send_json(502, {"error": "Anonymization failed"})
                return

            if not anonymized_text.strip():
                logger.error("Anonymization returned an empty result")
                self.send_json(502, {"error": "Anonymization failed"})
                return

            self.send_json(200, {"anonymizedText": anonymized_text})

    return PresidioHandler


def main() -> None:
    configure_logging()
    host = os.environ.get("PRESIDIO_HOST", "127.0.0.1")
    port = int(os.environ.get("PRESIDIO_PORT", "5002"))
    api_token = os.environ.get("PRESIDIO_API_TOKEN", "")

    if api_token and len(api_token) < 32:
        raise RuntimeError("PRESIDIO_API_TOKEN must contain at least 32 characters")
    if host not in {"127.0.0.1", "localhost", "::1"} and not api_token:
        raise RuntimeError("PRESIDIO_API_TOKEN is required when the service is not loopback-only")

    analyzer, anonymizer = build_engines()
    server = ThreadingHTTPServer(
        (host, port),
        create_handler(analyzer, anonymizer, api_token, SERVICE_VERSION),
    )
    logger.info("Presidio service listening on %s:%s version=%s", host, port, SERVICE_VERSION)
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
