from __future__ import annotations

import hmac
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any

from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine

logger = logging.getLogger("presidio_service")
MAX_TEXT_CHARS = 200_000
MAX_REQUEST_BYTES = 1_000_000


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
    return analyzer, AnonymizerEngine()


def anonymize_text(text: str, analyzer: Any, anonymizer: Any) -> str:
    findings = analyzer.analyze(text=text, language="en")
    result = anonymizer.anonymize(text=text, analyzer_results=findings)
    return result.text


def configure_logging() -> None:
    level = os.environ.get("LOG_LEVEL", "INFO").strip().upper()
    logging.basicConfig(level=level)


def create_handler(
    analyzer: AnalyzerEngine,
    anonymizer: AnonymizerEngine,
    api_token: str,
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
                self.send_json(200, {"status": "ok"})
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
        create_handler(analyzer, anonymizer, api_token),
    )
    logger.info("Presidio service listening on %s:%s", host, port)
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
