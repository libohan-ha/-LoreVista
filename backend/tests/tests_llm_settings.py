import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.deepseek import normalize_openai_base_url


class NormalizeOpenAIBaseUrlTests(unittest.TestCase):
    def test_rejects_private_network_targets(self):
        for url in (
            "http://127.0.0.1:8000/v1",
            "http://169.254.169.254/latest",
            "http://10.0.0.5/v1",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    normalize_openai_base_url(url)

    def test_keeps_public_https_base_url(self):
        self.assertEqual(
            normalize_openai_base_url("https://api.example.com/v1/"),
            "https://api.example.com/v1",
        )


if __name__ == "__main__":
    unittest.main()
