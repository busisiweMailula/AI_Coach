import unittest
import json
import threading
import urllib.error
import urllib.request
from types import SimpleNamespace
from http.server import ThreadingHTTPServer
from unittest.mock import Mock, patch

from presidio_analyzer import RecognizerResult
from presidio_anonymizer.entities import OperatorConfig

from app import (
    ALLOWED_PLACEHOLDERS,
    PERSON_ALLOW_LIST,
    PII_ENTITIES,
    PLACEHOLDER_PATTERN,
    anonymize_text,
    build_engines,
    configure_logging,
    create_handler,
)


class AnonymizeTextTests(unittest.TestCase):
    def test_analyzes_before_anonymizing_and_returns_the_transformed_text(self) -> None:
        analyzer = Mock()
        finding = RecognizerResult(entity_type="PERSON", start=0, end=8, score=0.85)
        analyzer.analyze.return_value = [finding]
        anonymizer = Mock()
        anonymizer.anonymize.return_value = SimpleNamespace(text="<PERSON> works here")

        result = anonymize_text("Jane Doe works here", analyzer, anonymizer)

        self.assertEqual(result, "<PERSON> works here")
        analyzer.analyze.assert_called_once_with(
            text="Jane Doe works here",
            language="en",
            entities=PII_ENTITIES,
            allow_list=PERSON_ALLOW_LIST,
            allow_list_match="regex",
        )
        anonymizer.anonymize.assert_called_once_with(
            text="Jane Doe works here",
            analyzer_results=[finding],
            operators={
                entity: OperatorConfig("replace", {"new_value": f"<{entity}>"})
                for entity in PII_ENTITIES
            },
        )

    def test_masks_only_selected_sensitive_data_and_preserves_cv_terms(self) -> None:
        analyzer, anonymizer = build_engines()
        text = (
            "Jane Doe | jane.doe@example.com | +27 82 123 4567 | "
            "SA ID 8001015009087. LangGraph, SQL, TypeScript, isiZulu, "
            "Karoo Insight Labs, Johannesburg, Embeddings, Chroma, "
            "Jupyter Notebook, JSON, Docker, and OpenAI."
        )

        result = anonymize_text(text, analyzer, anonymizer)

        self.assertIn("<PERSON>", result)
        self.assertIn("<EMAIL_ADDRESS>", result)
        self.assertIn("<PHONE_NUMBER>", result)
        self.assertIn("<ZA_ID_NUMBER>", result)
        for value in [
            "LangGraph",
            "SQL",
            "TypeScript",
            "isiZulu",
            "Karoo Insight Labs",
            "Johannesburg",
            "Embeddings",
            "Chroma",
            "Jupyter Notebook",
            "JSON",
            "Docker",
            "OpenAI",
        ]:
            self.assertIn(value, result)
        self.assertLessEqual(set(PLACEHOLDER_PATTERN.findall(result)), ALLOWED_PLACEHOLDERS)

    def test_rejects_placeholders_outside_the_allowed_set(self) -> None:
        analyzer = Mock()
        analyzer.analyze.return_value = []
        anonymizer = Mock()
        anonymizer.anonymize.return_value = SimpleNamespace(text="CV mentions <ORGANIZATION>")

        with self.assertRaisesRegex(ValueError, "disallowed placeholder"):
            anonymize_text("CV text", analyzer, anonymizer)

    def test_logging_level_is_case_insensitive_and_ignores_surrounding_whitespace(self) -> None:
        with patch.dict("os.environ", {"LOG_LEVEL": " info "}):
            with patch("app.logging.basicConfig") as basic_config:
                configure_logging()

        basic_config.assert_called_once_with(level="INFO")

    def test_http_endpoint_requires_token_and_returns_anonymized_text(self) -> None:
        analyzer = Mock()
        analyzer.analyze.return_value = [
            RecognizerResult(entity_type="PERSON", start=0, end=8, score=0.85)
        ]
        anonymizer = Mock()
        anonymizer.anonymize.return_value = SimpleNamespace(text="<PERSON> works here")
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            create_handler(analyzer, anonymizer, "a-valid-test-token-with-at-least-32-chars", "dev-test"),
        )
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        endpoint = f"http://127.0.0.1:{server.server_port}/anonymize"
        request_body = json.dumps({"text": "Jane Doe works here"}).encode("utf-8")

        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/health") as response:
                self.assertEqual(
                    json.loads(response.read()),
                    {"status": "ok", "version": "dev-test"},
                )

            unauthorized = urllib.request.Request(
                endpoint,
                data=request_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(unauthorized)
            self.assertEqual(error.exception.code, 401)

            authorized = urllib.request.Request(
                endpoint,
                data=request_body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer a-valid-test-token-with-at-least-32-chars",
                },
                method="POST",
            )
            with urllib.request.urlopen(authorized) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(
                    json.loads(response.read()),
                    {"anonymizedText": "<PERSON> works here"},
                )
        finally:
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
