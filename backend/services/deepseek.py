import json
import os
import re
from typing import AsyncGenerator

import httpx
from dotenv import load_dotenv

load_dotenv()

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_MODEL = "deepseek-v4-flash"

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

SCENE_SPLIT_PROMPT = """你是一位专业漫画分镜师。请将小说内容拆分为恰好10页漫画。

## ★★★ 最重要的规则 ★★★
- 输出JSON数组，恰好10个元素，每个元素代表一"页"（不是一"格"）
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
  "第10页：【第1格...】...【第2格...】...【第3格...】...【第4格...】..."
]"""


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Stream chat response from DeepSeek."""
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [{"role": "system", "content": NOVEL_SYSTEM_PROMPT}] + messages,
        "stream": True,
        "max_tokens": 16384,
    }

    async with httpx.AsyncClient(timeout=600) as client:
        async with client.stream(
            "POST",
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
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


async def generate_novel(messages: list[dict]) -> str:
    """Generate a full novel chapter (non-streaming)."""
    full_messages = [{"role": "system", "content": NOVEL_SYSTEM_PROMPT}] + messages
    full_messages.append({
        "role": "user",
        "content": "请根据我们的讨论，创作这一话的完整小说内容。请直接输出小说正文。",
    })

    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": full_messages,
        "stream": False,
        "max_tokens": 16384,
    }

    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def split_scenes(chat_messages: list[dict], character_profiles: str = "") -> list[str]:
    """Use DeepSeek to split chat novel content into 10 manga page descriptions."""
    scene_prompt = SCENE_SPLIT_PROMPT
    if character_profiles:
        scene_prompt += f"\n\n以下是角色外貌设定，分镜描述中必须严格匹配这些外貌特征：\n{character_profiles}"
    messages = chat_messages + [
        {"role": "user", "content": scene_prompt},
    ]
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": "你是漫画分镜专家。输出JSON数组，每个元素是一页漫画（包含4-6个分镜格，最少4格），不是单个格子。绝对不要把一个格子作为一个数组元素，也不要每页只给3个或更少的格子。"},
        ] + messages,
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{DEEPSEEK_BASE_URL}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json()
        raw = data["choices"][0]["message"]["content"]

    # Extract JSON array from response. LLMs sometimes wrap valid JSON in prose
    # or fenced code blocks despite the instruction to output JSON only.
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        scenes = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", raw)
        if not match:
            raise
        scenes = json.loads(match.group(0))
    if not isinstance(scenes, list) or not all(isinstance(scene, str) for scene in scenes):
        raise ValueError("Scene split response must be a JSON array of strings")
    if len(scenes) != 10:
        raise ValueError(f"Expected 10 scenes, got {len(scenes)}")
    return scenes
