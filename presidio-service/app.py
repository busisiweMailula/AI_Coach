from __future__ import annotations

import datetime
import hmac
import json
import logging
import os
import re
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any, Iterable

# Keep numerical libraries from creating a thread per reported CPU core.
for _thread_limit_variable in (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
    "BLIS_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
):
    os.environ[_thread_limit_variable] = "1"

from presidio_analyzer import AnalyzerEngine, Pattern, PatternRecognizer
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

logger = logging.getLogger("presidio_service")
MAX_TEXT_CHARS = 200_000
MAX_REQUEST_BYTES = 1_000_000
SERVICE_VERSION = "1.0.0"
PLACEHOLDER_BY_ENTITY = {
    "PERSON": "<PERSON>",
    "EMAIL_ADDRESS": "<EMAIL_ADDRESS>",
    "PHONE_NUMBER": "<PHONE_NUMBER>",
    "ZA_ID_NUMBER": "<ZA_ID_NUMBER>",
}
PLACEHOLDER_PATTERN = re.compile(r"<[^<>]{1,256}>")
SA_MOBILE_PATTERN = (
    r"(?<!\w)(?:\(?0[\s.-]*[6-8]\)?(?:[\s().-]*[0-9]){8}"
    r"|\+[\s().-]*2[\s().-]*7[\s().-]*[6-8](?:[\s().-]*[0-9]){8})(?!\w)"
)
ZA_ID_PATTERN = r"(?<!\w)[0-9]{13}(?!\w)"


def load_person_allowlist(path: str | Path | None = None) -> list[str]:
    allowlist_path = Path(path or os.environ.get(
        "PRESIDIO_PERSON_ALLOWLIST_PATH",
        Path(__file__).with_name("person_allowlist.json"),
    ))
    try:
        contents = json.loads(allowlist_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("The Presidio person allow-list could not be loaded") from error
    if (
        not isinstance(contents, list)
        or len(contents) > 2_000
        or any(
            not isinstance(term, str)
            or not term.strip()
            or len(term) > 100
            for term in contents
        )
    ):
        raise RuntimeError("The Presidio person allow-list must be a JSON array of non-empty strings")
    normalized = [term.strip() for term in contents]
    if len({term.casefold() for term in normalized}) != len(normalized):
        raise RuntimeError("The Presidio person allow-list must not contain duplicates")
    return normalized


def build_engines() -> tuple[AnalyzerEngine, AnonymizerEngine]:
    model_name = os.environ.get("PRESIDIO_SPACY_MODEL", "en_core_web_sm")
    try:
        confidence_threshold = float(os.environ.get("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD", "0.6"))
    except ValueError as error:
        raise RuntimeError("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD must be between 0 and 1") from error
    if not 0 <= confidence_threshold <= 1:
        raise RuntimeError("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD must be between 0 and 1")
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
    for recognizer in list(analyzer.registry.recognizers):
        if "PHONE_NUMBER" in recognizer.supported_entities:
            analyzer.registry.remove_recognizer(recognizer.name)
    analyzer.registry.add_recognizer(
        PatternRecognizer(
            supported_entity="PHONE_NUMBER",
            patterns=[Pattern("South African mobile", SA_MOBILE_PATTERN, 1.0)],
            supported_language="en",
        )
    )
    analyzer.registry.add_recognizer(
        PatternRecognizer(
            supported_entity="ZA_ID_NUMBER",
            patterns=[Pattern("South African ID", ZA_ID_PATTERN, 1.0)],
            supported_language="en",
        )
    )
    # Validate the file during startup, rather than silently running without exclusions.
    load_person_allowlist()
    return analyzer, AnonymizerEngine()


def is_valid_za_id(value: str) -> bool:
    if not re.fullmatch(r"[0-9]{13}", value):
        return False
    year, month, day = int(value[:2]), int(value[2:4]), int(value[4:6])
    if value[10] not in {"0", "1"}:
        return False
    if not any(_valid_calendar_date(century + year, month, day) for century in (1900, 2000)):
        return False
    checksum = 0
    for offset, character in enumerate(reversed(value)):
        digit = int(character)
        if offset % 2:
            doubled = digit * 2
            digit = doubled // 10 + doubled % 10
        checksum += digit
    return checksum % 10 == 0


def _valid_calendar_date(year: int, month: int, day: int) -> bool:
    try:
        datetime.date(year, month, day)
        return True
    except ValueError:
        return False


def _matches_allowlist(span: str, allowlist: Iterable[str]) -> bool:
    return any(
        re.search(rf"(?<!\w){re.escape(term)}(?!\w)", span, flags=re.IGNORECASE)
        for term in allowlist
    )


def filter_findings(
    text: str,
    findings: Iterable[Any],
    allowlist: Iterable[str] = (),
    confidence_threshold: float = 0.6,
) -> list[Any]:
    allowed = list(allowlist)
    existing_placeholders = [
        match.span() for match in PLACEHOLDER_PATTERN.finditer(text)
    ]
    filtered: list[Any] = []
    for finding in findings:
        entity_type = finding.entity_type
        if entity_type not in PLACEHOLDER_BY_ENTITY:
            continue
        start, end = finding.start, finding.end
        if any(start < placeholder_end and end > placeholder_start
               for placeholder_start, placeholder_end in existing_placeholders):
            continue
        span = text[start:end]
        if entity_type == "PERSON":
            if finding.score < confidence_threshold:
                continue
            if not span or not all(character.isalpha() or character.isspace() for character in span):
                continue
            if len(span.split()) == 1 and span.islower():
                continue
            if _matches_allowlist(span, allowed):
                continue
        elif entity_type == "PHONE_NUMBER":
            if not re.fullmatch(SA_MOBILE_PATTERN, span):
                continue
        elif entity_type == "ZA_ID_NUMBER" and not is_valid_za_id(span):
            continue
        filtered.append(finding)
    return filtered


def anonymize_with_counts(
    text: str,
    analyzer: Any,
    anonymizer: Any,
    allowlist: Iterable[str] | None = None,
    confidence_threshold: float | None = None,
) -> tuple[str, dict[str, int]]:
    threshold = confidence_threshold
    if threshold is None:
        threshold = float(os.environ.get("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD", "0.6"))
    allowed = list(allowlist) if allowlist is not None else load_person_allowlist()
    findings = analyzer.analyze(
        text=text,
        language="en",
        entities=list(PLACEHOLDER_BY_ENTITY),
    )
    accepted = filter_findings(text, findings, allowed, threshold)
    counts = {entity: 0 for entity in PLACEHOLDER_BY_ENTITY}
    for finding in accepted:
        counts[finding.entity_type] += 1
    result = anonymizer.anonymize(
        text=text,
        analyzer_results=accepted,
        operators={
            entity: OperatorConfig("replace", {"new_value": placeholder})
            for entity, placeholder in PLACEHOLDER_BY_ENTITY.items()
        },
    ).text
    input_placeholders = Counter(PLACEHOLDER_PATTERN.findall(text))
    output_placeholders = Counter(PLACEHOLDER_PATTERN.findall(result))
    for placeholder, count in output_placeholders.items():
        if (
            placeholder not in PLACEHOLDER_BY_ENTITY.values()
            and count > input_placeholders[placeholder]
        ):
            raise ValueError("An unsupported placeholder was produced")
    return result, counts


def anonymize_text(
    text: str,
    analyzer: Any,
    anonymizer: Any,
    allowlist: Iterable[str] | None = None,
    confidence_threshold: float | None = None,
) -> str:
    return anonymize_with_counts(
        text, analyzer, anonymizer, allowlist, confidence_threshold
    )[0]


def configure_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    logging.basicConfig(level=level)


def create_handler(
    analyzer: AnalyzerEngine,
    anonymizer: AnonymizerEngine,
    api_token: str,
    allowlist: Iterable[str] | None = None,
    confidence_threshold: float | None = None,
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

        def send_error(self, code: int, _message: str | None = None, _explain: str | None = None) -> None:
            status = 405 if code == 501 else code
            self.send_json(status, {"error": "Method not allowed" if status == 405 else "Request failed"})

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_json(200, {"status": "ok", "version": SERVICE_VERSION})
                return
            if self.path == "/anonymize":
                self.send_json(405, {"error": "Method not allowed"})
                return
            self.send_json(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if self.path != "/anonymize":
                if self.path == "/health":
                    self.send_json(405, {"error": "Method not allowed"})
                else:
                    self.send_json(404, {"error": "Not found"})
                return

            if api_token and not hmac.compare_digest(
                self.headers.get("Authorization", "").encode("utf-8"),
                f"Bearer {api_token}".encode("utf-8"),
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
                    anonymized_text, entity_counts = anonymize_with_counts(
                        text,
                        analyzer,
                        anonymizer,
                        allowlist,
                        confidence_threshold,
                    )
            except Exception as error:
                logger.error("Anonymization failed (%s)", type(error).__name__)
                self.send_json(502, {"error": "Anonymization failed"})
                return

            if not anonymized_text.strip():
                logger.error("Anonymization returned an empty result")
                self.send_json(502, {"error": "Anonymization failed"})
                return

            logger.info("Anonymization completed; entity_counts=%s", entity_counts)
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
    try:
        confidence_threshold = float(os.environ.get("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD", "0.6"))
    except ValueError as error:
        raise RuntimeError("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD must be between 0 and 1") from error
    if not 0 <= confidence_threshold <= 1:
        raise RuntimeError("PRESIDIO_PERSON_CONFIDENCE_THRESHOLD must be between 0 and 1")

    allowlist = load_person_allowlist()
    analyzer, anonymizer = build_engines()
    server = ThreadingHTTPServer(
        (host, port),
        create_handler(analyzer, anonymizer, api_token, allowlist, confidence_threshold),
    )
    logger.info("Presidio service listening on %s:%s", host, port)
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
