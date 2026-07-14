import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import time
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from PIL import Image

logger = logging.getLogger("image2")
logger.setLevel(logging.INFO)

load_dotenv()

DEFAULT_IMAGE_API_BASE_URL = "https://api.duojie.games/v1"
DEFAULT_NEWAPI_IMAGE_BASE_URL = "https://st.qinnaonao.com/v1"
SUPPORTED_IMAGE_PROVIDERS = {"image2", "newapi"}


def normalize_image_api_base_url(base_url: str | None, default: str = DEFAULT_IMAGE_API_BASE_URL) -> str:
    base = (base_url or default).strip().rstrip("/")
    return re.sub(r"(?i)(/v1)+$", "/v1", base)


def normalize_image_provider(provider: str | None) -> str:
    value = (provider or "image2").strip().lower()
    return value if value in SUPPORTED_IMAGE_PROVIDERS else "image2"


IMAGE_API_BASE_URL = normalize_image_api_base_url(os.getenv("IMAGE_API_BASE_URL"))
IMAGE_API_KEY = os.getenv("IMAGE_API_KEY", "")
IMAGE_MODEL = "gpt-image-2"
NEWAPI_IMAGE_BASE_URL = normalize_image_api_base_url(
    os.getenv("NEWAPI_IMAGE_BASE_URL"), DEFAULT_NEWAPI_IMAGE_BASE_URL
)
NEWAPI_IMAGE_API_KEY = os.getenv("NEWAPI_IMAGE_API_KEY", "")
NEWAPI_IMAGE_MODEL = os.getenv("NEWAPI_IMAGE_MODEL", "vidu-image-gpt2").strip() or "vidu-image-gpt2"
IMAGE_SIZE = os.getenv("IMAGE_SIZE", "1024x1536").strip() or "1024x1536"
IMAGE_QUALITY = os.getenv("IMAGE_QUALITY", "low").strip().lower()
IMAGE_RESPONSE_FORMAT = os.getenv("IMAGE_RESPONSE_FORMAT", "url").strip().lower()
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "manga_outputs"


# Image generation POSTs are not idempotent: once the upstream server receives
# the request it may charge and finish the image even if our client never gets
# the response. Keep automatic retries disabled unless explicitly opted in.
MAX_RETRIES = max(1, int(os.getenv("IMAGE_API_MAX_RETRIES", "1")))
RETRY_DELAY = 5  # seconds
IMAGE_DOWNLOAD_RETRIES = 3


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


NEWAPI_CONTEXT_RADIUS = _env_int("NEWAPI_IMAGE_CONTEXT_RADIUS", 1, 0)
NEWAPI_CONTEXT_SCENE_MAX_CHARS = _env_int("NEWAPI_IMAGE_CONTEXT_SCENE_MAX_CHARS", 180, 80)
ERROR_BODY_LOG_CHARS = _env_int("IMAGE_API_ERROR_BODY_LOG_CHARS", 1200, 200)


class ImageResponseLostError(RuntimeError):
    """Raised when Image2 may have succeeded upstream but no image reached us."""


def _response_lost_message(exc: Exception, provider_name: str = "Image2") -> str:
    return (
        f"{provider_name} 后台可能已经生成并扣费，但本地没有收到最终图片响应。"
        f"为避免重复扣费，应用已停止自动重试。请先到 {provider_name} 后台确认，"
        f"再决定是否重新生成。上游/网络错误: {exc}"
    )


def _response_request_id(resp: httpx.Response | None) -> str:
    if resp is None:
        return ""
    for header in ("X-Oneapi-Request-Id", "X-Request-Id", "x-oneapi-request-id", "x-request-id"):
        value = resp.headers.get(header)
        if value:
            return value
    return ""


def summarize_http_status_error(
    provider_name: str,
    status_code: int,
    request_id: str = "",
    body: str = "",
) -> str:
    """Return a compact provider error summary without dropping the response body."""
    body = (body or "").strip()
    message = body
    if body:
        try:
            parsed = json.loads(body)
            err = parsed.get("error") if isinstance(parsed, dict) else None
            if isinstance(err, dict):
                message = str(err.get("message") or err.get("code") or body)
        except json.JSONDecodeError:
            message = body
    if len(message) > ERROR_BODY_LOG_CHARS:
        message = f"{message[:ERROR_BODY_LOG_CHARS].rstrip()}..."
    request_part = f" request_id={request_id}" if request_id else ""
    return f"{provider_name} HTTP {status_code}{request_part}: {message or 'empty response body'}"


def _manga_style_prompt(color_mode: str) -> str:
    if color_mode == "color":
        return (
            "日式彩色漫画插画页，竖向多格分镜布局，每页包含4-6个分镜格，"
            "格子高度不等（动作场景用宽格，对话特写用窄格），"
            "每个分镜格之间有清晰的边框分隔，"
            "包含圆形/椭圆形对话气泡和中文台词，"
            "包含漫画音效字（如“唷”“铿！”“嗡—”），"
            "全彩高饱和度配色，日系动漫赛璐珞上色风格，"
            "柔和光影与高光，细腻的色彩渐变，"
            "人物绘制精美，表情生动，动作有力度感"
        )
    return (
        "日式黑白漫画页，竖向多格分镜布局，每页包含4-6个分镜格，"
        "格子高度不等（动作场景用宽格，对话特写用窄格），"
        "每个分镜格之间有清晰的黑色边框分隔，"
        "包含圆形/椭圆形白色对话气泡和中文台词，"
        "包含漫画音效字（如“唷”“铿！”“嗡—”），"
        "黑白高对比度，戏剧性光影，精细的线条和网点，"
        "人物绘制精美，表情生动，动作有力度感"
    )


def _compact_scene_context(scene: str, max_chars: int = NEWAPI_CONTEXT_SCENE_MAX_CHARS) -> str:
    compact = " ".join((scene or "").strip().split())
    if len(compact) <= max_chars:
        return compact
    return f"{compact[:max_chars].rstrip()}..."


def build_manga_image_prompt(
    prompt: str,
    image_number: int,
    all_scenes: list[str] | None = None,
    character_profiles: str = "",
    ref_block: str = "",
    color_mode: str = "bw",
    provider: str = "image2",
    use_ref: bool = False,
) -> str:
    """Build the provider-specific prompt sent to the image API."""
    provider = normalize_image_provider(provider)
    total_pages = len(all_scenes) if all_scenes else 1
    manga_style = _manga_style_prompt(color_mode)

    # When ref image is provided, skip textual character profiles; they can
    # fight the visual reference and cause the model to invent a new cast.
    char_block = ""
    if character_profiles and not use_ref:
        char_block = f"【角色外貌设定（每张图必须严格遵守）】\n{character_profiles}\n\n"

    if all_scenes and provider == "newapi":
        context_lines: list[str] = []
        if total_pages > 1 and NEWAPI_CONTEXT_RADIUS > 0:
            start = max(1, image_number - NEWAPI_CONTEXT_RADIUS)
            end = min(total_pages, image_number + NEWAPI_CONTEXT_RADIUS)
            for page_no in range(start, end + 1):
                if page_no == image_number:
                    continue
                scene = all_scenes[page_no - 1]
                context_lines.append(f"第{page_no}页：{_compact_scene_context(scene)}")
        continuity_block = ""
        if context_lines:
            continuity_block = (
                "【前后页连续性参考（不要绘制成额外分镜）】\n"
                + "\n".join(context_lines)
                + "\n\n"
            )
        return (
            f"{ref_block}"
            f"{char_block}"
            f"你正在绘制一部日式漫画的第{image_number}页（共{total_pages}页）。\n"
            "只绘制当前页，不要绘制人物资料卡，不要总结设定。\n"
            "请保持人物外貌、服装、场景氛围和画风一致；前后页信息只作为连续性参考。\n\n"
            f"{continuity_block}"
            "【当前页分镜】\n"
            f"{prompt}\n\n"
            "【画面风格】\n"
            f"{manga_style}"
        )

    if all_scenes:
        script_context = "\n".join(f"第{i+1}页：{s}" for i, s in enumerate(all_scenes))
        return (
            f"{ref_block}"
            f"{char_block}"
            f"你正在绘制一部日式漫画的第{image_number}页（共{total_pages}页）。\n"
            f"以下是完整的{total_pages}页的分镜脚本，请保持人物外貌、服装、风格的一致性：\n\n"
            f"{script_context}\n\n"
            f"现在请绘制第{image_number}页：\n"
            f"{manga_style}\n{prompt}"
        )

    return f"{ref_block}{char_block}{manga_style}\n{prompt}"


def _image_auth_headers(
    api_key: str | None = None,
    json_content: bool = False,
    provider: str = "image2",
) -> dict[str, str]:
    provider = normalize_image_provider(provider)
    fallback_key = NEWAPI_IMAGE_API_KEY if provider == "newapi" else IMAGE_API_KEY
    key = (api_key or fallback_key or "").strip()
    if not key:
        from .errors import MissingApiKeyError
        raise MissingApiKeyError("NewAPI" if provider == "newapi" else "Image2")
    headers = {"Authorization": f"Bearer {key}"}
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


def _image_response_format_payload() -> dict[str, str]:
    if IMAGE_RESPONSE_FORMAT in {"url", "b64_json"}:
        return {"response_format": IMAGE_RESPONSE_FORMAT}
    return {}


def _image_quality_payload() -> dict[str, str]:
    if IMAGE_QUALITY in {"low", "medium", "high", "standard", "hd"}:
        return {"quality": IMAGE_QUALITY}
    return {}


async def _download_image_url(url: str, progress_label: str) -> bytes:
    last_err: Exception | None = None
    timeout = httpx.Timeout(connect=30, read=180, write=30, pool=30)
    for attempt in range(1, IMAGE_DOWNLOAD_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                img_resp = await client.get(url)
                img_resp.raise_for_status()
                return img_resp.content
        except Exception as exc:
            last_err = exc
            logger.warning(
                "[%s] Image URL download failed (attempt %s/%s): %s",
                progress_label,
                attempt,
                IMAGE_DOWNLOAD_RETRIES,
                exc,
            )
            if attempt < IMAGE_DOWNLOAD_RETRIES:
                await asyncio.sleep(2 * attempt)
    raise RuntimeError(f"Image URL download failed after {IMAGE_DOWNLOAD_RETRIES} attempts: {last_err}")


def normalize_image_bytes(image_bytes: bytes) -> bytes:
    """Validate image bytes and return normalized PNG bytes."""
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            img.verify()
        with Image.open(io.BytesIO(image_bytes)) as img:
            output = io.BytesIO()
            img.convert("RGBA").save(output, format="PNG", optimize=True)
            return output.getvalue()
    except Exception as exc:
        raise RuntimeError("Generated image response is not a valid image") from exc


async def generate_manga_image(
    prompt: str,
    chapter_id: int,
    image_number: int,
    all_scenes: list[str] | None = None,
    character_profiles: str = "",
    ref_image_paths: list[str] | None = None,
    color_mode: str = "bw",
    api_key: str | None = None,
    provider: str = "image2",
) -> str:
    """Generate a single manga image and save it. Returns the relative file path.

    `ref_image_paths` can contain multiple reference images; they will be sent
    as `image[]` multipart parts (verified to work with duojie API).
    """
    provider = normalize_image_provider(provider)
    provider_name = "NewAPI" if provider == "newapi" else "Image2"
    base_url = NEWAPI_IMAGE_BASE_URL if provider == "newapi" else IMAGE_API_BASE_URL
    model = NEWAPI_IMAGE_MODEL if provider == "newapi" else IMAGE_MODEL
    total_pages = len(all_scenes) if all_scenes else 1
    progress_label = f"{image_number}/{total_pages}"
    # NewAPI currently exposes generations only. Keep uploaded references on disk,
    # but exclude them from requests so switching providers never deletes user assets.
    valid_refs = [] if provider == "newapi" else [
        Path(p) for p in (ref_image_paths or []) if p and Path(p).exists()
    ]
    use_ref = bool(valid_refs)

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
            f"你正在绘制一部日式漫画的第{image_number}页（共{total_pages}页）。\n"
            f"以下是完整的{total_pages}页的分镜脚本，请保持人物外貌、服装、风格的一致性：\n\n"
            f"{script_context}\n\n"
            f"现在请绘制第{image_number}页：\n"
            f"{MANGA_STYLE}\n{prompt}"
        )
    else:
        full_prompt = f"{ref_block}{char_block}{MANGA_STYLE}\n{prompt}"

    ref_block = ""
    if use_ref:
        ref_block = (
            "【最重要：人物一致性】\n"
            "本次提供了一张参考图，**必须严格保持参考图中主角的外貌特征**："
            "包括发型、发色、瞳色、脸型、五官比例、服装风格——所有分镜格中的人物都必须是参考图中的同一批人物。\n"
            "禁止凭空创造新的人物外貌。\n\n"
        )

    full_prompt = build_manga_image_prompt(
        prompt=prompt,
        image_number=image_number,
        all_scenes=all_scenes,
        character_profiles=character_profiles,
        ref_block=ref_block,
        color_mode=color_mode,
        provider=provider,
        use_ref=use_ref,
    )
    prompt_bytes = full_prompt.encode("utf-8")
    prompt_hash = hashlib.sha256(prompt_bytes).hexdigest()[:16]
    current_scene_occurrences = full_prompt.count(prompt.strip()) if prompt.strip() else 0
    logger.info(
        "[%s] %s prompt stats: chars=%s bytes=%s sha256=%s current_scene_occurrences=%s",
        progress_label,
        provider_name,
        len(full_prompt),
        len(prompt_bytes),
        prompt_hash,
        current_scene_occurrences,
    )

    # Prepare reference image bytes (one or multiple)
    ref_blobs: list[tuple[str, bytes]] = []  # list of (filename, bytes)
    for idx, ref_path in enumerate(valid_refs, start=1):
        try:
            img = Image.open(ref_path)
            max_side = 1024
            ratio = min(max_side / img.width, max_side / img.height)
            if ratio < 1:
                img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            img.convert("RGBA").save(buf, format="PNG", optimize=True)
            blob = buf.getvalue()
            ref_blobs.append((f"ref{idx}.png", blob))
            logger.info(f"[{progress_label}] 参考图 {idx} 已加载: {ref_path.name} → {len(blob) / 1024:.0f} KB")
        except Exception as exc:
            logger.warning(f"[{progress_label}] 参考图 {ref_path} 加载失败: {exc}")

    last_err: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        heartbeat_task: asyncio.Task | None = None
        try:
            mode = f"edits({len(ref_blobs)}图垫图)" if ref_blobs else "generations"
            logger.info(f"[{progress_label}] 开始调用 {provider_name} API [{mode}]（尝试 {attempt}/{MAX_RETRIES}）")
            logger.info(
                "[%s] %s request config: model=%s mode=%s attempt=%s/%s size=%s refs=%s",
                progress_label,
                provider_name,
                model,
                mode,
                attempt,
                MAX_RETRIES,
                IMAGE_SIZE,
                len(ref_blobs),
            )
            t0 = time.time()

            async def _heartbeat(label: str, start_ts: float) -> None:
                """Log every 30s while the API call is in flight."""
                try:
                    while True:
                        await asyncio.sleep(30)
                        waited = int(time.time() - start_ts)
                        logger.info("[%s] Still waiting for %s response after %ss", label, provider_name, waited)
                        logger.info(f"[{label}] 等待中... 已等待 {waited}s（上游可能排队，继续等）")
                except asyncio.CancelledError:
                    return

            heartbeat_task = asyncio.create_task(_heartbeat(progress_label, t0))
            timeout = httpx.Timeout(connect=30, read=600, write=120, pool=30)
            # NOTE: Avoid custom socket_options — they use Linux TCP constants which
            # silently break on Windows and cause the 2nd multipart request to hang.
            limits = httpx.Limits(max_connections=1, max_keepalive_connections=0)
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                if ref_blobs:
                    # Use /images/edits multipart for reference image(s).
                    # Single ref → "image" key (legacy compat). Multiple → "image[]" array.
                    if len(ref_blobs) == 1:
                        files = [("image", (ref_blobs[0][0], io.BytesIO(ref_blobs[0][1]), "image/png"))]
                    else:
                        files = [
                            ("image[]", (name, io.BytesIO(blob), "image/png"))
                            for name, blob in ref_blobs
                        ]
                    resp = await client.post(
                        f"{base_url}/images/edits",
                        files=files,
                        data={
                            "model": model,
                            "prompt": full_prompt,
                            "size": IMAGE_SIZE,
                            **_image_response_format_payload(),
                            **_image_quality_payload(),
                        },
                        headers=_image_auth_headers(api_key, provider=provider),
                    )
                else:
                    # Normal generation without reference
                    payload = {
                        "model": model,
                        "prompt": full_prompt,
                        "n": 1,
                    }
                    if provider == "image2":
                        payload.update({
                            "size": IMAGE_SIZE,
                            **_image_response_format_payload(),
                            **_image_quality_payload(),
                        })
                    resp = await client.post(
                        f"{base_url}/images/generations",
                        json=payload,
                        headers=_image_auth_headers(api_key, json_content=True, provider=provider),
                    )
                response_elapsed = time.time() - t0
                request_id = _response_request_id(resp)
                logger.info(
                    "[%s] %s response status=%s request_id=%s elapsed=%.1fs",
                    progress_label,
                    provider_name,
                    resp.status_code,
                    request_id or "-",
                    response_elapsed,
                )
                if resp.status_code >= 400:
                    body = resp.text[:ERROR_BODY_LOG_CHARS]
                    logger.error(
                        "[%s] %s",
                        progress_label,
                        summarize_http_status_error(
                            provider_name,
                            resp.status_code,
                            request_id=request_id,
                            body=body,
                        ),
                    )
                resp.raise_for_status()
                data = resp.json()
            heartbeat_task.cancel()
            elapsed = time.time() - t0
            logger.info(f"[{progress_label}] API 返回成功，耗时 {elapsed:.1f}s")

            image_entry = data["data"][0]

            if image_entry.get("b64_json"):
                image_bytes = base64.b64decode(image_entry["b64_json"])
                logger.info(f"[{progress_label}] 收到 b64_json，大小 {len(image_bytes)} bytes")
            elif image_entry.get("url"):
                logger.info(f"[{progress_label}] 收到 URL，正在下载...")
                image_bytes = await _download_image_url(image_entry["url"], progress_label)
                logger.info(f"[{progress_label}] 下载完成，大小 {len(image_bytes)} bytes")
            else:
                raise RuntimeError("No b64_json or url in image response")

            image_bytes = normalize_image_bytes(image_bytes)
            logger.info(f"[{progress_label}] 图片验证通过，PNG 大小 {len(image_bytes)} bytes")

            # Save image
            chapter_dir = OUTPUT_DIR / f"chapter_{chapter_id}"
            chapter_dir.mkdir(parents=True, exist_ok=True)
            filename = f"panel_{image_number:02d}_{uuid.uuid4().hex[:8]}.png"
            filepath = chapter_dir / filename
            filepath.write_bytes(image_bytes)
            logger.info(f"[{progress_label}] 已保存到 {filepath}")

            return f"manga_outputs/chapter_{chapter_id}/{filename}"

        except asyncio.CancelledError:
            if heartbeat_task:
                heartbeat_task.cancel()
            logger.info(f"[{progress_label}] {provider_name} API call cancelled")
            raise
        except httpx.HTTPStatusError as e:
            last_err = e
            if heartbeat_task:
                heartbeat_task.cancel()
            resp = e.response
            message = summarize_http_status_error(
                provider_name,
                resp.status_code,
                request_id=_response_request_id(resp),
                body=resp.text[:ERROR_BODY_LOG_CHARS],
            )
            logger.error(
                "[%s] %s request failed; not retrying non-idempotent generation request",
                progress_label,
                message,
            )
            raise RuntimeError(
                f"{provider_name} 生图请求失败。为避免重复扣费，应用没有自动重试。"
                f"错误: {message}"
            ) from e
        except (httpx.RemoteProtocolError, httpx.ReadTimeout, httpx.ReadError, httpx.WriteError, httpx.ProtocolError) as e:
            if heartbeat_task:
                heartbeat_task.cancel()
            logger.error(f"[{progress_label}] {provider_name} response was lost after the request may have been processed; not retrying: {e}")
            raise ImageResponseLostError(_response_lost_message(e, provider_name)) from e
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as e:
            last_err = e
            if heartbeat_task:
                heartbeat_task.cancel()
            logger.error(f"[{progress_label}] Failed to connect to {provider_name} before sending request (attempt {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                logger.info(f"[{progress_label}] Retrying connection in {RETRY_DELAY}s...")
                await asyncio.sleep(RETRY_DELAY)
        except Exception as e:
            last_err = e
            if heartbeat_task:
                heartbeat_task.cancel()
            logger.error(f"[{progress_label}] {provider_name} request failed; not retrying non-idempotent generation request: {e}")
            raise RuntimeError(
                f"{provider_name} 生图请求失败。为避免重复扣费，应用没有自动重试。"
                f"错误: {e}"
            ) from e

    raise RuntimeError(f"第{image_number}张图片生成失败（已尝试{MAX_RETRIES}次）: {last_err}")
