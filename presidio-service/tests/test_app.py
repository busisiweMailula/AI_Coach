import json
import re
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app import (
    MAX_REQUEST_BYTES,
    MAX_TEXT_CHARS,
    PLACEHOLDER_BY_ENTITY,
    SA_MOBILE_PATTERN,
    anonymize_text,
    anonymize_with_counts,
    configure_logging,
    create_handler,
    filter_findings,
    is_valid_za_id,
    load_person_allowlist,
)


def finding(text, entity_type, value, score=0.99):
    start = text.index(value)
    return SimpleNamespace(
        entity_type=entity_type,
        start=start,
        end=start + len(value),
        score=score,
    )


class ReplacingAnonymizer:
    def anonymize(self, text, analyzer_results, **_kwargs):
        for item in sorted(analyzer_results, key=lambda result: result.start, reverse=True):
            text = (
                text[:item.start]
                + PLACEHOLDER_BY_ENTITY[item.entity_type]
                + text[item.end:]
            )
        return SimpleNamespace(text=text)


class DetectionFilteringTests(unittest.TestCase):
    def test_replaces_only_supported_pii_and_preserves_other_cv_text(self):
        text = (
            "Jane Doe | jane@example.com | 082 123 4567 | 8001015009087 | "
            "Python, Acme University, Cape Town, 2024, 85%"
        )
        findings = [
            finding(text, "PERSON", "Jane Doe"),
            finding(text, "EMAIL_ADDRESS", "jane@example.com"),
            finding(text, "PHONE_NUMBER", "082 123 4567"),
            finding(text, "ZA_ID_NUMBER", "8001015009087"),
        ]
        analyzer = Mock()
        analyzer.analyze.return_value = findings

        result = anonymize_text(text, analyzer, ReplacingAnonymizer(), allowlist=[])

        self.assertEqual(
            result,
            "<PERSON> | <EMAIL_ADDRESS> | <PHONE_NUMBER> | <ZA_ID_NUMBER> | "
            "Python, Acme University, Cape Town, 2024, 85%",
        )

    def test_south_african_mobile_formats_match_but_landlines_and_other_countries_do_not(self):
        valid_numbers = [
            "0821234567",
            "082 123 4567",
            "(082) 123-4567",
            "082.123.4567",
            "+27821234567",
            "+27 82 123 4567",
            "+27 (82) 123-4567",
            "061-234-5678",
            "071 234 5678",
        ]
        invalid_numbers = [
            "011 123 4567",
            "021-123-4567",
            "+1 202 555 0134",
            "+44 7700 900123",
            "082123456",
            "08212345678",
            "0921234567",
            "ABC0821234567",
            "0821234567A",
        ]

        for value in valid_numbers:
            matches = list(re.finditer(SA_MOBILE_PATTERN, value))
            self.assertEqual([match.group() for match in matches], [value], value)
        for value in invalid_numbers:
            self.assertEqual(list(re.finditer(SA_MOBILE_PATTERN, value)), [], value)

    def test_masks_only_valid_south_african_ids(self):
        self.assertTrue(is_valid_za_id("8001015009087"))
        self.assertFalse(is_valid_za_id("8013325009087"))  # Invalid month/day.
        self.assertFalse(is_valid_za_id("8001015009088"))  # Invalid checksum.
        self.assertFalse(is_valid_za_id("8001015009287"))  # Invalid citizenship digit.
        self.assertFalse(is_valid_za_id("800101500908"))

    def test_person_confidence_symbols_digits_lowercase_and_allowlist_are_filtered(self):
        text = "Jane Doe python PYTHON JavaScript Java Doe2 O'Neil"
        findings = [
            finding(text, "PERSON", "Jane Doe", 0.6),
            finding(text, "PERSON", "python", 0.99),
            finding(text, "PERSON", "PYTHON", 0.99),
            finding(text, "PERSON", "JavaScript", 0.99),
            finding(text, "PERSON", "Java", 0.99),
            finding(text, "PERSON", "Doe2", 0.99),
            finding(text, "PERSON", "O'Neil", 0.99),
            finding(text, "PERSON", "Jane Doe", 0.59),
        ]

        accepted = filter_findings(
            text,
            findings,
            allowlist=["PyThOn", "Java"],
            confidence_threshold=0.6,
        )

        self.assertEqual(
            [(text[item.start:item.end], item.score) for item in accepted],
            [("Jane Doe", 0.6), ("JavaScript", 0.99)],
        )

    def test_preserves_existing_placeholders_and_does_not_mask_invalid_ids(self):
        text = "Existing <PERSON> reference 8013325009087"
        findings = [
            finding(text, "PERSON", "PERSON"),
            finding(text, "ZA_ID_NUMBER", "8013325009087"),
        ]

        self.assertEqual(filter_findings(text, findings), [])

    def test_rejects_new_unsupported_placeholders_from_anonymizer(self):
        analyzer = Mock()
        analyzer.analyze.return_value = []
        anonymizer = Mock()
        anonymizer.anonymize.return_value = SimpleNamespace(text="plain <UNSUPPORTED>")

        with self.assertRaises(ValueError):
            anonymize_with_counts("plain text", analyzer, anonymizer, allowlist=[])

    def test_allowlist_requires_a_valid_json_array(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "allowlist.json"
            path.write_text('{"term": "Python"}', encoding="utf-8")
            with self.assertRaises(RuntimeError):
                load_person_allowlist(path)


class PresidioEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = "a-valid-test-token-with-at-least-32-chars"
        cls.analyzer = Mock()
        cls.analyzer.analyze.return_value = []
        cls.anonymizer = ReplacingAnonymizer()
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            create_handler(cls.analyzer, cls.anonymizer, cls.token, allowlist=[]),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def request(self, path, method="POST", body=None, headers=None):
        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers=headers or {},
            method=method,
        )
        try:
            return urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            return error

    def test_health_is_public_and_includes_service_version(self):
        response = self.request("/health", method="GET")
        self.assertEqual(response.status, 200)
        payload = json.loads(response.read())
        self.assertEqual(payload["status"], "ok")
        self.assertTrue(payload["version"])

    def test_anonymize_requires_authorization(self):
        body = json.dumps({"text": "ordinary text"}).encode()
        for authorization in ("", "Bearer invalid-token"):
            response = self.request(
                "/anonymize",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    **({"Authorization": authorization} if authorization else {}),
                },
            )
            self.assertEqual(response.code, 401)

    def test_endpoint_returns_anonymized_text(self):
        body = json.dumps({"text": "ordinary text"}).encode()
        response = self.request(
            "/anonymize",
            body=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.read()), {"anonymizedText": "ordinary text"})

    def test_malformed_content_type_and_missing_text_are_explicit_errors(self):
        auth = {"Authorization": f"Bearer {self.token}"}
        malformed = self.request(
            "/anonymize",
            body=b"{",
            headers={**auth, "Content-Type": "application/json"},
        )
        self.assertEqual(malformed.code, 400)
        unsupported = self.request(
            "/anonymize",
            body=b'{"text":"hello"}',
            headers={**auth, "Content-Type": "text/plain"},
        )
        self.assertEqual(unsupported.code, 415)
        missing = self.request(
            "/anonymize",
            body=b'{"text":""}',
            headers={**auth, "Content-Type": "application/json"},
        )
        self.assertEqual(missing.code, 400)
        wrong_type = self.request(
            "/anonymize",
            body=b'{"text":4}',
            headers={**auth, "Content-Type": "application/json"},
        )
        self.assertEqual(wrong_type.code, 400)

    def test_body_and_text_size_limits_are_enforced(self):
        oversized_body = b'{"text":"' + b"x" * MAX_REQUEST_BYTES + b'"}'
        body_response = self.request(
            "/anonymize",
            body=oversized_body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        self.assertEqual(body_response.code, 413)

        oversized_text = json.dumps({"text": "x" * (MAX_TEXT_CHARS + 1)}).encode()
        text_response = self.request(
            "/anonymize",
            body=oversized_text,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        self.assertEqual(text_response.code, 413)

    def test_unknown_routes_and_unsupported_methods_return_json_errors(self):
        unknown = self.request("/unknown", method="GET")
        self.assertEqual(unknown.code, 404)
        self.assertEqual(json.loads(unknown.read()), {"error": "Not found"})
        wrong_method = self.request("/anonymize", method="GET")
        self.assertEqual(wrong_method.code, 405)


class LoggingConfigurationTests(unittest.TestCase):
    def test_logging_level_is_case_insensitive_and_ignores_surrounding_whitespace(self):
        with patch.dict("os.environ", {"LOG_LEVEL": " info "}):
            with patch("app.logging.basicConfig") as basic_config:
                configure_logging()

        basic_config.assert_called_once_with(level="INFO")


if __name__ == "__main__":
    unittest.main()
