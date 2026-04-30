import asyncio
import base64
import io
import logging
import os
import time
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from PIL import Image

logger = logging.getLogger("image2")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")

load_dotenv()

IMAGE_API_BASE_URL = os.getenv("IMAGE_API_BASE_URL", "https://api.duojie.games/v1").rstrip("/")
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "")
IMAGE_MODEL = "gpt-image-2"
IMAGE_SIZE = "1024x1536"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "manga_outputs"


MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds


async def generate_manga_image(prompt: str, chapter_id: int, image_number: int, all_scenes: list[str] | None = None, character_profiles: str = "", ref_image_path: str | None = None, color_mode: str = "bw") -> str:
    """Generate a single manga image and save it. Returns the relative file path."""
    # Detect if we'll use ref image (file must exist)
    use_ref = bool(ref_image_path) and Path(ref_image_path).exists()

    # Build prompt with character profiles and full script context.
    # IMPORTANT: When ref image is provided, skip the textual character profile
    # (it conflicts with the visual reference and confuses the model — model
    # would invent new characters from the text instead of using the image).
    char_block = ""
    if character_profiles and not use_ref:
        char_block = f"【角色外貌设定（每张图必须严格遵守）】\n{character_profiles}\n\n"

    ref_block = ""
    if use_ref:
        ref_block = (
            "【最重要：人物一致性】\n"
            "本次提供了一张参考图，**必须严格保持参考图中主角的外貌特征**："
            "包括发型、发色、瞳色、脸型、五官比例、服装风格——所有分镜格中的人物都必须是参考图中的同一批人物。\n"
            "禁止凭空创造新的人物外貌。\n\n"
        )

    if color_mode == "color":
        MANGA_STYLE = (
            "日式彩色漫画插画页，竖向多格分镜布局，每页包含4-6个分镜格，"
            "格子高度不等（动作场景用宽格，对话特写用窄格），"
            "每个分镜格之间有清晰的边框分隔，"
            "包含圆形/椭圆形对话气泡和中文台词，"
            "包含漫画音效字（如“唷”“铿！”“嗡—”），"
            "全彩高饱和度配色，日系动漫赛璐珞上色风格，"
            "柔和光影与高光，细腻的色彩渐变，"
            "人物绘制精美，表情生动，动作有力度感"
        )
    else:
        MANGA_STYLE = (
            "日式黑白漫画页，竖向多格分镜布局，每页包含4-6个分镜格，"
            "格子高度不等（动作场景用宽格，对话特写用窄格），"
            "每个分镜格之间有清晰的黑色边框分隔，"
            "包含圆形/椭圆形白色对话气泡和中文台词，"
            "包含漫画音效字（如“唷”“铿！”“嗡—”），"
            "黑白高对比度，戏剧性光影，精细的线条和网点，"
            "人物绘制精美，表情生动，动作有力度感"
        )

    if all_scenes:
        script_context = "\n".join(f"第{i+1}页：{s}" for i, s in enumerate(all_scenes))
        full_prompt = (
            f"{ref_block}"
            f"{char_block}"
            f"你正在绘制一部日式漫画的第{image_number}页（共10页）。\n"
            f"以下是完整的10页的分镜脚本，请保持人物外貌、服装、风格的一致性：\n\n"
            f"{script_context}\n\n"
            f"现在请绘制第{image_number}页：\n"
            f"{MANGA_STYLE}\n{prompt}"
        )
    else:
        full_prompt = f"{ref_block}{char_block}{MANGA_STYLE}\n{prompt}"

    # Prepare reference image bytes if provided
    ref_image_bytes: bytes | None = None
    if ref_image_path:
        ref_path = Path(ref_image_path)
        if ref_path.exists():
            img = Image.open(ref_path)
            max_side = 1024
            ratio = min(max_side / img.width, max_side / img.height)
            if ratio < 1:
                img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            ref_image_bytes = buf.getvalue()
            logger.info(f"[{image_number}/10] 参考图已加载: {ref_path.name}, 压缩后 {len(ref_image_bytes) / 1024:.0f} KB")
        else:
            logger.warning(f"[{image_number}/10] 参考图不存在: {ref_path}")

    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            mode = "edits(垫图)" if ref_image_bytes else "generations"
            logger.info(f"[{image_number}/10] 开始调用 Image2 API [{mode}]（尝试 {attempt}/{MAX_RETRIES}）")
            t0 = time.time()
            timeout = httpx.Timeout(connect=30, read=600, write=120, pool=30)
            # NOTE: Avoid custom socket_options — they use Linux TCP constants which
            # silently break on Windows and cause the 2nd multipart request to hang.
            limits = httpx.Limits(max_connections=1, max_keepalive_connections=0)
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                if ref_image_bytes:
                    # Use /images/edits multipart for reference image
                    resp = await client.post(
                        f"{IMAGE_API_BASE_URL}/images/edits",
                        files={"image": ("ref.png", io.BytesIO(ref_image_bytes), "image/png")},
                        data={
                            "model": IMAGE_MODEL,
                            "prompt": full_prompt,
                            "size": IMAGE_SIZE,
                        },
                        headers={"Authorization": f"Bearer {IMAGE_API_KEY}"},
                    )
                else:
                    # Normal generation without reference
                    resp = await client.post(
                        f"{IMAGE_API_BASE_URL}/images/generations",
                        json={
                            "model": IMAGE_MODEL,
                            "prompt": full_prompt,
                            "size": IMAGE_SIZE,
                        },
                        headers={
                            "Authorization": f"Bearer {IMAGE_API_KEY}",
                            "Content-Type": "application/json",
                        },
                    )
                resp.raise_for_status()
                data = resp.json()
            elapsed = time.time() - t0
            logger.info(f"[{image_number}/10] API 返回成功，耗时 {elapsed:.1f}s")

            image_entry = data["data"][0]

            if image_entry.get("b64_json"):
                image_bytes = base64.b64decode(image_entry["b64_json"])
                logger.info(f"[{image_number}/10] 收到 b64_json，大小 {len(image_bytes)} bytes")
            elif image_entry.get("url"):
                logger.info(f"[{image_number}/10] 收到 URL，正在下载...")
                async with httpx.AsyncClient(timeout=120) as client:
                    img_resp = await client.get(image_entry["url"])
                    img_resp.raise_for_status()
                    image_bytes = img_resp.content
                logger.info(f"[{image_number}/10] 下载完成，大小 {len(image_bytes)} bytes")
            else:
                raise RuntimeError("No b64_json or url in image response")

            # Save image
            chapter_dir = OUTPUT_DIR / f"chapter_{chapter_id}"
            chapter_dir.mkdir(parents=True, exist_ok=True)
            filename = f"panel_{image_number:02d}_{uuid.uuid4().hex[:8]}.png"
            filepath = chapter_dir / filename
            filepath.write_bytes(image_bytes)
            logger.info(f"[{image_number}/10] 已保存到 {filepath}")

            return f"manga_outputs/chapter_{chapter_id}/{filename}"

        except Exception as e:
            last_err = e
            logger.error(f"[{image_number}/10] 尝试 {attempt} 失败: {e}")
            if attempt < MAX_RETRIES:
                logger.info(f"[{image_number}/10] {RETRY_DELAY}秒后重试...")
                await asyncio.sleep(RETRY_DELAY)

    raise RuntimeError(f"第{image_number}张图片生成失败（已重试{MAX_RETRIES}次）: {last_err}")
