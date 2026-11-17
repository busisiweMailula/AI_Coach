import unittest
import json
import threading
import urllib.error
import urllib.request
from types import SimpleNamespace
from http.server import ThreadingHTTPServer
from unittest.mock import Mock

from app import anonymize_text, create_handler


class AnonymizeTextTests(unittest.TestCase):
    def test_analyzes_before_anonymizing_and_returns_the_transformed_text(self) -> None:
        analyzer = Mock()
        analyzer.analyze.return_value = ["detected entity"]
        anonymizer = Mock()
        anonymizer.anonymize.return_value = SimpleNamespace(text="<PERSON> works here")

        result = anonymize_text("Jane Doe works here", analyzer, anonymizer)

        self.assertEqual(result, "<PERSON> works here")
        analyzer.analyze.assert_called_once_with(text="Jane Doe works here", language="en")
        anonymizer.anonymize.assert_called_once_with(
            text="Jane Doe works here",
            analyzer_results=["detected entity"],
        )

    def test_http_endpoint_requires_token_and_returns_anonymized_text(self) -> None:
        analyzer = Mock()
        analyzer.analyze.return_value = ["detected entity"]
        anonymizer = Mock()
        anonymizer.anonymize.return_value = SimpleNamespace(text="<PERSON> works here")
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            create_handler(analyzer, anonymizer, "a-valid-test-token-with-at-least-32-chars"),
        )
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        endpoint = f"http://127.0.0.1:{server.server_port}/anonymize"
        request_body = json.dumps({"text": "Jane Doe works here"}).encode("utf-8")

        try:
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
