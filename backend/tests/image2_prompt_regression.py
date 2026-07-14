"""Regression tests for provider-specific image prompt construction."""

import unittest

from services.image2 import build_manga_image_prompt, summarize_http_status_error


class BuildMangaImagePromptTests(unittest.TestCase):
    def test_newapi_prompt_uses_compact_context_and_does_not_repeat_current_page(self):
        scenes = [
            f"PAGE-{idx}: " + ("scene detail " * 80)
            for idx in range(1, 11)
        ]

        prompt = build_manga_image_prompt(
            prompt=scenes[4],
            image_number=5,
            all_scenes=scenes,
            character_profiles="角色设定：浅灰绿色长发，暖金黄色眼睛。",
            ref_block="",
            color_mode="color",
            provider="newapi",
            use_ref=False,
        )

        self.assertIn("【当前页分镜】", prompt)
        self.assertIn(scenes[4], prompt)
        self.assertEqual(prompt.count(scenes[4]), 1)
        self.assertIn("第4页", prompt)
        self.assertIn("第6页", prompt)
        self.assertNotIn("PAGE-1:", prompt)
        self.assertNotIn("PAGE-10:", prompt)
        self.assertNotIn("以下是完整的10页的分镜脚本", prompt)

    def test_image2_prompt_preserves_existing_full_script_context(self):
        scenes = [f"PAGE-{idx}: scene" for idx in range(1, 4)]

        prompt = build_manga_image_prompt(
            prompt=scenes[1],
            image_number=2,
            all_scenes=scenes,
            character_profiles="角色设定",
            ref_block="",
            color_mode="bw",
            provider="image2",
            use_ref=False,
        )

        self.assertIn("以下是完整的3页的分镜脚本", prompt)
        self.assertIn("第1页：PAGE-1: scene", prompt)
        self.assertIn("第3页：PAGE-3: scene", prompt)
        self.assertEqual(prompt.count(scenes[1]), 2)


class HttpStatusErrorSummaryTests(unittest.TestCase):
    def test_summarizes_json_error_body_without_losing_request_id(self):
        message = summarize_http_status_error(
            provider_name="NewAPI",
            status_code=502,
            request_id="req-123",
            body='{"error":{"message":"image task req_x failed: upstream image task failed","type":"bad_response"}}',
        )

        self.assertIn("NewAPI HTTP 502", message)
        self.assertIn("req-123", message)
        self.assertIn("upstream image task failed", message)


if __name__ == "__main__":
    unittest.main()
