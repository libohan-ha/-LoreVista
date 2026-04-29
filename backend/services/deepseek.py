import json
import os
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
- 每一页必须包含3-4个分镜格，用【第1格】【第2格】【第3格】标记
- 绝对禁止一页只有一个画面！每页必须有多个格子！

## 每页必须包含的内容
- 【第1格（宽格/窄格）】构图+人物+动作
- 【第2格（宽格/窄格）】构图+人物+动作
- 【第3格（宽格/窄格）】构图+人物+动作
- 对话气泡：「角色的台词」
- 音效字：唰—、铿！、嗡——、咔嚓（动作场景必须有）

## 格式示例（必须严格遵守此格式）
"第1页：【第1格（宽格）】远景，森林中的马车穿行，车轮碾过泥路。音效：咕隆咕隆。【第2格（窄格）】特写，塞蕾娜眉头微蹙，手按在剑柄上。对话气泡：「殿下，前方有异常气息。」【第3格（宽格）】中景，艾莉西娅掀开车帘探头，金色长发被风吹起。对话气泡：「什么情况？」【第4格（大宽格）】动态场景，五名山贼从树丛冲出，黑影遮天。音效：唰——！塞蕾娜已拔剑在手，银光一闪。"

风格：日式黑白漫画，高对比度，戏剧性光影，精细线条和网点。

请输出JSON数组，不要输出其他任何内容：
[
  "第1页：【第1格（宽格）】...【第2格（窄格）】...【第3格（宽格）】...",
  "第2页：【第1格（窄格）】...【第2格（大宽格）】...【第3格（窄格）】...",
  ...
  "第10页：【第1格...】...【第2格...】...【第3格...】..."
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
            {"role": "system", "content": "你是漫画分镜专家。输出JSON数组，每个元素是一页漫画（包含3-4个分镜格），不是单个格子。绝对不要把一个格子作为一个数组元素。"},
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

    # Extract JSON array from response
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    scenes: list[str] = json.loads(raw)
    if len(scenes) != 10:
        raise ValueError(f"Expected 10 scenes, got {len(scenes)}")
    return scenes
