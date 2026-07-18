import ipaddress
import json
import os
import re
from dataclasses import dataclass
from typing import AsyncGenerator
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv

load_dotenv()

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
ALLOW_PRIVATE_OPENAI_URLS = os.getenv("ALLOW_PRIVATE_OPENAI_URLS", "false").strip().lower() in {"1", "true", "yes"}

SUPPORTED_LLM_PROVIDERS = {"deepseek", "openai_compat"}

NOVEL_SYSTEM_PROMPT = """你是一位才华横溢、文笔细腻的网络小说家。用户会和你讨论小说的主题、风格、角色等。

当用户要求你创作小说时，请遵循以下要求：

## ★★★ 字数要求（最高优先级）★★★
- 每一话必须 4000-6000 中文字。这是硬性要求，不可商量。
- 绝对禁止低于 3500 字。如果你感觉写完了但字数不够，必须回去扩写场景、增加对话、深化心理描写，直到达到 4000 字以上。
- 宁可 5000-6000 字，也不要只写 2000 字就结束。

## 结构指导（确保内容充实）
一话内容应包含 3-5 个完整场景，每个场景至少 800-1500 字，包含：
- 场景转换时的环境描写（视觉、听觉、嗅觉、触觉），至少 150 字
- 人物之间的对话（自然生动，有潜台词，每段对话至少 5-8 个来回）
- 角色的心理活动和内心独白（每个场景至少一段）
- 微表情、小动作、肢体语言的细节描写

## 写作风格
- 描写要细腻丰富，注重氛围营造
- 节奏有张有弛，关键情感节点放慢节奏
- 人物描写立体鲜活，注重微表情、小动作、心理独白
- 避免流水账，避免大段无意义的抽象拒述

请直接输出小说正文，不要加额外说明或字数统计。"""


@dataclass(frozen=True)
class LLMSettings:
    """Resolved chat/completions settings for DeepSeek or any OpenAI-compatible gateway."""

    api_key: str
    base_url: str
    model: str
    provider: str
    label: str

    @property
    def chat_completions_url(self) -> str:
        return f"{self.base_url}/chat/completions"

    @property
    def models_url(self) -> str:
        return f"{self.base_url}/models"


def normalize_llm_provider(provider: str | None) -> str:
    value = (provider or "deepseek").strip().lower()
    return value if value in SUPPORTED_LLM_PROVIDERS else "deepseek"


def _validate_openai_target(parsed) -> None:
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if not hostname:
        raise ValueError("Base URL must contain a hostname")
    if parsed.username or parsed.password:
        raise ValueError("Base URL must not contain username or password")
    if not ALLOW_PRIVATE_OPENAI_URLS and (hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost")):
        raise ValueError("Base URL must not target localhost")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return
    if not ALLOW_PRIVATE_OPENAI_URLS and (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    ):
        raise ValueError("Base URL must not target a private or reserved network address")


def normalize_openai_base_url(base_url: str) -> str:
    """Normalize user-provided OpenAI-compatible base URL.

    Accepts common paste styles:
    - https://api.example.com
    - https://api.example.com/
    - https://api.example.com/v1
    - https://api.example.com/v1/
    - https://api.example.com/v1/chat/completions  (trimmed back to /v1)
    """
    raw = (base_url or "").strip()
    if not raw:
        raise ValueError("Base URL is required for OpenAI-compatible provider")

    if not re.match(r"^https?://", raw, re.IGNORECASE):
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Base URL must be a valid http(s) URL")
    _validate_openai_target(parsed)

    path = (parsed.path or "").rstrip("/")
    # Users sometimes paste the full chat endpoint.
    for suffix in ("/chat/completions", "/completions", "/models"):
        if path.endswith(suffix):
            path = path[: -len(suffix)].rstrip("/")
            break

    if not path:
        path = "/v1"
    elif not path.endswith("/v1") and not re.search(r"/v\d+$", path):
        # Most OpenAI-compatible gateways expose /v1/* endpoints.
        path = f"{path}/v1"

    return f"{parsed.scheme}://{parsed.netloc}{path}"


def resolve_llm_settings(
    *,
    provider: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> LLMSettings:
    """Resolve runtime LLM settings from request headers / env fallbacks."""
    provider_name = normalize_llm_provider(provider)

    if provider_name == "openai_compat":
        key = (api_key or "").strip()
        if not key:
            from .errors import MissingApiKeyError
            raise MissingApiKeyError("OpenAI 兼容中转")
        try:
            resolved_base = normalize_openai_base_url(base_url or "")
        except ValueError as exc:
            raise ValueError(str(exc)) from exc
        resolved_model = (model or "").strip()
        if not resolved_model:
            raise ValueError("Model is required for OpenAI-compatible provider")
        return LLMSettings(
            api_key=key,
            base_url=resolved_base,
            model=resolved_model,
            provider="openai_compat",
            label="OpenAI 兼容中转",
        )

    # Default: DeepSeek official API (env fallback for local/dev).
    key = (api_key or DEEPSEEK_API_KEY or "").strip()
    if not key:
        from .errors import MissingApiKeyError
        raise MissingApiKeyError("DeepSeek")
    resolved_base = (base_url or DEEPSEEK_BASE_URL).rstrip("/")
    resolved_model = (model or DEEPSEEK_MODEL).strip() or DEEPSEEK_MODEL
    return LLMSettings(
        api_key=key,
        base_url=resolved_base,
        model=resolved_model,
        provider="deepseek",
        label="DeepSeek",
    )


def _auth_headers(settings: LLMSettings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
    }


def _loads_json_lenient(text: str):
    # Some models occasionally return literal newlines/control chars inside quoted
    # strings. strict=False accepts those without treating the whole response as
    # invalid JSON.
    return json.loads(text, strict=False)


def _extract_json_array(raw: str) -> list:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        return _loads_json_lenient(raw)
    except json.JSONDecodeError as first_error:
        match = re.search(r"\[[\s\S]*\]", raw)
        if not match:
            raise ValueError("Scene split response did not contain a JSON array") from first_error
        try:
            return _loads_json_lenient(match.group(0))
        except json.JSONDecodeError as second_error:
            raise ValueError("Scene split response was not valid JSON") from second_error


def _scene_split_prompt(page_count: int = 10) -> str:
    return f"""你是一位专业漫画分镜师。请将小说内容拆分为恰好{page_count}页漫画。

## ★★★ 最重要的规则 ★★★
- 输出JSON数组，恰好{page_count}个元素，每个元素代表一"页"（不是一"格"）
- 每一页必须包含 **4-6 个分镜格**（最少4格，推荐5格），用【第1格】【第2格】【第3格】【第4格】…标记
- 绝对禁止一页只有3个或更少的画面！信息量不足！

## 每页必须包含的内容
- 至少4个【第N格（宽格/窄格/大宽格）】，每格描述：构图+人物+动作+表情
- 多条对话气泡：「角色的台词」（推荐2-4条/页）
- 音效字：唰—、铿！、嗡——、咔嚓、轰隆、噗通（动作或情绪转折场景必须有）
- 节奏变化：远景→中景→特写交替，避免每格景别相同

## 格式示例（必须严格遵守此格式，至少4格。注意：示例中的角色名仅作格式参考，你必须使用小说中实际出现的角色名和剧情）
"第1页：【第1格（大宽格）】远景，某场景的环境全貌，光影氛围。音效：环境音。【第2格（窄格）】特写，角色A的表情和动作细节。对话气泡：「角色A的台词。」【第3格（窄格）】特写，角色B的反应。对话气泡：「角色B的台词。」【第4格（中景）】两人互动的中景画面，肢体语言和情绪表达。音效：动作音效。【第5格（大宽格）】场景转换或高潮画面，动态构图。对话气泡：「关键台词。」音效：氛围音效。"

风格：日式黑白漫画，高对比度，戏剧性光影，精细线条和网点。

请输出JSON数组，不要输出其他任何内容：
[
  "第1页：【第1格...】...【第2格...】...【第3格...】...【第4格...】...（可选第5格）",
  "第2页：【第1格...】...【第2格...】...【第3格...】...【第4格...】...",
  ...
  "第{page_count}页：【第1格...】...【第2格...】...【第3格...】...【第4格...】..."
]"""


def _llm_kwargs(
    api_key: str | None = None,
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    settings: LLMSettings | None = None,
) -> LLMSettings:
    if settings is not None:
        return settings
    return resolve_llm_settings(provider=provider, api_key=api_key, base_url=base_url, model=model)


async def list_models(base_url: str, api_key: str) -> list[str]:
    """Fetch model ids from an OpenAI-compatible /models endpoint."""
    settings = resolve_llm_settings(
        provider="openai_compat",
        api_key=api_key,
        base_url=base_url,
        model="placeholder",  # not used for /models
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(settings.models_url, headers=_auth_headers(settings))
        resp.raise_for_status()
        data = resp.json()

    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("Models response did not contain a data array")

    models: list[str] = []
    seen: set[str] = set()
    for item in items:
        model_id = None
        if isinstance(item, str):
            model_id = item.strip()
        elif isinstance(item, dict):
            raw_id = item.get("id") or item.get("model") or item.get("name")
            if isinstance(raw_id, str):
                model_id = raw_id.strip()
        if model_id and model_id not in seen:
            seen.add(model_id)
            models.append(model_id)

    models.sort(key=str.lower)
    return models


async def chat_stream(
    messages: list[dict],
    api_key: str | None = None,
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    settings: LLMSettings | None = None,
) -> AsyncGenerator[str, None]:
    """Stream chat response from the configured LLM."""
    llm = _llm_kwargs(api_key, provider=provider, base_url=base_url, model=model, settings=settings)
    payload = {
        "model": llm.model,
        "messages": [{"role": "system", "content": NOVEL_SYSTEM_PROMPT}] + messages,
        "stream": True,
        "max_tokens": 16384,
    }

    async with httpx.AsyncClient(timeout=600) as client:
        async with client.stream(
            "POST",
            llm.chat_completions_url,
            json=payload,
            headers=_auth_headers(llm),
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                    delta = data["choices"][0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


async def generate_novel(
    messages: list[dict],
    api_key: str | None = None,
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    settings: LLMSettings | None = None,
) -> str:
    """Generate a full novel chapter (non-streaming)."""
    llm = _llm_kwargs(api_key, provider=provider, base_url=base_url, model=model, settings=settings)
    full_messages = [{"role": "system", "content": NOVEL_SYSTEM_PROMPT}] + messages
    full_messages.append({
        "role": "user",
        "content": "请根据我们的讨论，创作这一话的完整小说内容。请直接输出小说正文。",
    })

    payload = {
        "model": llm.model,
        "messages": full_messages,
        "stream": False,
        "max_tokens": 16384,
    }

    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            llm.chat_completions_url,
            json=payload,
            headers=_auth_headers(llm),
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def refine_single_scene(
    chat_messages: list[dict],
    all_scenes: list[str],
    target_scene: str,
    scene_number: int,
    instruction: str,
    original_scenes: list[str] | None = None,
    history: list[dict] | None = None,
    character_profiles: str = "",
    api_key: str | None = None,
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    settings: LLMSettings | None = None,
) -> str:
    """Ask the LLM to revise one manga page scene while preserving the rest."""
    llm = _llm_kwargs(api_key, provider=provider, base_url=base_url, model=model, settings=settings)
    history = history or []
    original_scenes = original_scenes or all_scenes
    context = {
        "scene_number": scene_number,
        "target_scene": target_scene,
        "all_current_scenes": all_scenes,
        "original_scenes": original_scenes,
        "revision_history": history,
        "new_instruction": instruction,
    }
    prompt = f"""你是一位专业漫画分镜师。请只重写第 {scene_number} 页漫画分镜。

硬性规则：
- 只输出一个字符串，不要输出 JSON 数组、Markdown 或解释。
- 这个字符串仍然代表一页漫画，必须包含 4-6 个分镜格。
- 必须参考整章当前分镜，保持前后剧情连续，但不要改写其他页。
- 综合原始分镜、当前目标分镜、历史修改记录，以及本轮修改要求。

角色外貌设定：
{character_profiles or '无'}

以下是单页修改上下文 JSON：
{json.dumps(context, ensure_ascii=False, indent=2)}
"""
    payload = {
        "model": llm.model,
        "messages": [
            {"role": "system", "content": "你是漫画分镜专家。只输出重写后的单页分镜字符串。"},
        ] + chat_messages + [
            {"role": "user", "content": prompt},
        ],
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            llm.chat_completions_url,
            json=payload,
            headers=_auth_headers(llm),
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"].strip()

    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    try:
        parsed = _loads_json_lenient(raw)
        if isinstance(parsed, str):
            raw = parsed.strip()
    except json.JSONDecodeError:
        pass
    if not raw:
        raise ValueError("Scene refinement response was empty")
    return raw


async def refine_scenes(
    chat_messages: list[dict],
    original_scenes: list[str],
    current_scenes: list[str],
    instruction: str,
    history: list[dict] | None = None,
    character_profiles: str = "",
    page_count: int = 10,
    api_key: str | None = None,
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    settings: LLMSettings | None = None,
) -> list[str]:
    """Ask the LLM to revise existing manga page scenes with full iteration context."""
    llm = _llm_kwargs(api_key, provider=provider, base_url=base_url, model=model, settings=settings)
    history = history or []
    context = {
        "original_scenes": original_scenes,
        "current_scenes": current_scenes,
        "revision_history": history,
        "new_instruction": instruction,
    }
    refine_prompt = f"""你是一位专业漫画分镜师。请根据用户的新修改要求，重写现有漫画分镜脚本。

硬性规则：
- 输出 JSON 数组，恰好 {page_count} 个字符串元素。
- 每个元素代表一页漫画，不是一格；每页仍需包含 4-6 个分镜格。
- 必须综合原始小说内容、初版分镜、当前分镜、全部历史修改记录，以及本轮修改要求。
- 保留剧情连续性、角色关系、页数和主要事件顺序，只调整用户要求修改的表现方式。
- 不要输出解释、Markdown 或额外文本，只输出 JSON 数组。

角色外貌设定：
{character_profiles or '无'}

以下是分镜迭代上下文 JSON：
{json.dumps(context, ensure_ascii=False, indent=2)}
"""
    payload = {
        "model": llm.model,
        "messages": [
            {"role": "system", "content": f"你是漫画分镜专家。输出 JSON 数组，恰好 {page_count} 个元素，每个元素是一页漫画。"},
        ] + chat_messages + [
            {"role": "user", "content": refine_prompt},
        ],
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            llm.chat_completions_url,
            json=payload,
            headers=_auth_headers(llm),
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"]

    scenes = _extract_json_array(raw)
    if not isinstance(scenes, list) or not all(isinstance(scene, str) for scene in scenes):
        raise ValueError("Scene refinement response must be a JSON array of strings")
    if len(scenes) != page_count:
        raise ValueError(f"Expected {page_count} scenes, got {len(scenes)}")
    return scenes


async def split_scenes(
    chat_messages: list[dict],
    character_profiles: str = "",
    page_count: int = 10,
    api_key: str | None = None,
    *,
    provider: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    settings: LLMSettings | None = None,
) -> list[str]:
    """Use the LLM to split chat novel content into manga page descriptions."""
    llm = _llm_kwargs(api_key, provider=provider, base_url=base_url, model=model, settings=settings)
    scene_prompt = _scene_split_prompt(page_count)
    if character_profiles:
        scene_prompt += f"\n\n以下是角色外貌设定，分镜描述中必须严格匹配这些外貌特征：\n{character_profiles}"
    messages = chat_messages + [
        {"role": "user", "content": scene_prompt},
    ]
    payload = {
        "model": llm.model,
        "messages": [
            {"role": "system", "content": f"你是漫画分镜专家。输出JSON数组，恰好{page_count}个元素，每个元素是一页漫画（包含4-6个分镜格，最少4格），不是单个格子。绝对不要把一个格子作为一个数组元素，也不要每页只给3个或更少的格子。"},
        ] + messages,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            llm.chat_completions_url,
            json=payload,
            headers=_auth_headers(llm),
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"]

    # Extract JSON array from response. LLMs sometimes wrap valid JSON in prose,
    # fenced code blocks, or include literal newlines inside quoted strings.
    scenes = _extract_json_array(raw)
    if not isinstance(scenes, list) or not all(isinstance(scene, str) for scene in scenes):
        raise ValueError("Scene split response must be a JSON array of strings")
    if len(scenes) != page_count:
        raise ValueError(f"Expected {page_count} scenes, got {len(scenes)}")
    return scenes
