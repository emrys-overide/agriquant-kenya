import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class SecurityRegressionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.temp_file = tempfile.NamedTemporaryFile(delete=False)
        self.temp_file.close()
        self.comments_path_patch = patch.object(main, "COMMENTS_FILE", self.temp_file.name)
        self.comments_path_patch.start()
        self.token_patch = patch.object(main, "ADMIN_TOKEN", "test-only-high-entropy-token")
        self.token_patch.start()

    def tearDown(self):
        self.token_patch.stop()
        self.comments_path_patch.stop()
        Path(self.temp_file.name).unlink(missing_ok=True)

    def test_feedback_admin_requires_bearer_token_not_query_password(self):
        self.assertEqual(self.client.get("/api/comments").status_code, 401)
        self.assertEqual(
            self.client.get("/api/comments", params={"password": "test-only-high-entropy-token"}).status_code,
            401,
        )
        response = self.client.get(
            "/api/comments",
            headers={"Authorization": "Bearer test-only-high-entropy-token"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authorized"])

    def test_feedback_validation_rejects_long_and_wrong_type_fields(self):
        too_long = self.client.post("/api/comments", json={"name": "n" * 101, "message": "hello"})
        wrong_type = self.client.post("/api/comments", json={"name": 12, "message": "hello"})
        bad_rating = self.client.post("/api/comments", json={"name": "Ada", "message": "hello", "rating": 6})
        self.assertEqual(too_long.status_code, 400)
        self.assertEqual(wrong_type.status_code, 400)
        self.assertEqual(bad_rating.status_code, 400)

    def test_feedback_accepts_valid_bounded_fields(self):
        response = self.client.post(
            "/api/comments",
            json={"name": "Ada", "email": "ada@example.test", "message": "Useful", "rating": 5},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["success"])
        rows = self.client.get(
            "/api/comments", headers={"Authorization": "Bearer test-only-high-entropy-token"}
        ).json()["comments"]
        self.assertEqual(rows[0]["rating"], 5)

    def test_request_body_size_limit(self):
        response = self.client.post(
            "/api/comments",
            content=b" " * 32_769,
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 413)

    def test_cors_allows_expected_origin_only(self):
        allowed = self.client.options(
            "/api/comments",
            headers={"Origin": "https://agriquant-kenya.pages.dev", "Access-Control-Request-Method": "GET"},
        )
        denied = self.client.options(
            "/api/comments",
            headers={"Origin": "https://attacker.example", "Access-Control-Request-Method": "GET"},
        )
        self.assertEqual(allowed.headers.get("access-control-allow-origin"), "https://agriquant-kenya.pages.dev")
        self.assertNotEqual(denied.headers.get("access-control-allow-origin"), "https://attacker.example")
        self.assertNotIn("access-control-allow-credentials", allowed.headers)

    def test_worker_and_deployment_config_have_no_known_secret_defaults(self):
        worker = Path("api-worker/src/index.py").read_text()
        config = Path("api-worker/wrangler.toml").read_text()
        self.assertNotIn("7bb7778e1e2b4ec5a7050654260506", worker + config)
        self.assertNotIn("agriquant2026", worker + config)
        self.assertNotIn('"Access-Control-Allow-Origin", "*"', worker)
        self.assertIn("env.WEATHER_API_KEY", worker)
        self.assertIn("env.ADMIN_TOKEN", worker)
        self.assertNotIn("ADMIN_PASSWORD", config)


if __name__ == "__main__":
    unittest.main()
