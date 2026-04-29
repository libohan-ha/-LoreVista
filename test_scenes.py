"""
测试 DeepSeek 多格分镜脚本生成效果。
用 ds.md 的小说内容作为输入，输出10页漫画分镜。
"""

import json
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "backend" / ".env")

API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
BASE_URL = "https://api.deepseek.com"
MODEL = "deepseek-v4-flash"

SCENE_SPLIT_PROMPT = """你是一位专业漫画分镜师。请阅读以下对话中的小说内容，将其拆分为恰好10页漫画。

每一页是一张完整的漫画页，包含3-4个分镜格。每页的描述必须包含：

1. **分镜布局**：明确描述每个格子的内容（第1格/第2格/第3格...）
   - 每格的构图（远景/中景/特写/俯视/仰视）
   - 格子大小提示（动作场景用宽大格，对话特写用窄格）
2. **人物描写**：每格中人物的表情、动作、姿态
3. **对话台词**：每格中的角色对话（写在对话气泡里的中文台词）
4. **音效字**：动作场景的漫画音效（如"唰—""铿！""嗡——""咔嚓"）
5. **场景环境**：光影氛围、背景细节

风格要求：日式黑白漫画，高对比度，戏剧性光影，精细线条和网点，每页包含多格分镜。

示例格式：
"第1页：【第1格（宽格）】远景，森林中的马车穿行...【第2格（窄格）】特写，塞蕾娜眉头微蹙...对话气泡：「殿下，有危险。」【第3格（宽格）】动作场景，山贼从树丛中冲出...音效：唰—"

请严格按以下JSON格式输出，不要输出其他内容：
[
  "第1页：（多格分镜描述）",
  "第2页：（多格分镜描述）",
  ...
  "第10页：（多格分镜描述）"
]"""


def main():
    if not API_KEY:
        print("❌ 缺少 DEEPSEEK_API_KEY")
        return 1

    # 读取小说内容
    novel_path = Path(__file__).parent / "ds.md"
    novel_text = novel_path.read_text(encoding="utf-8").strip()
    print(f"📖 小说内容: {len(novel_text)} 字")
    print(f"📝 Model: {MODEL}")
    print(f"⏳ 开始生成分镜...\n")

    messages = [
        {"role": "system", "content": "你是漫画分镜专家，只输出JSON数组，不要输出其他内容。"},
        {"role": "assistant", "content": novel_text},
        {"role": "user", "content": SCENE_SPLIT_PROMPT},
    ]

    payload = {
        "model": MODEL,
        "messages": messages,
        "stream": False,
    }

    t0 = time.time()
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=30, read=120, write=30, pool=30)) as client:
            resp = client.post(
                f"{BASE_URL}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
    except Exception as e:
        print(f"❌ 请求失败: {e}")
        return 1

    elapsed = time.time() - t0
    data = resp.json()
    raw = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})

    print(f"⏱️  耗时: {elapsed:.1f}s")
    print(f"🔢 Tokens: {usage.get('prompt_tokens', '?')} in / {usage.get('completion_tokens', '?')} out")
    print()

    # 解析 JSON
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        scenes = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"❌ JSON解析失败: {e}")
        print(f"原始输出:\n{raw[:500]}")
        return 1

    print(f"✅ 成功生成 {len(scenes)} 页分镜\n")
    print("=" * 70)

    for i, scene in enumerate(scenes, 1):
        print(f"\n📄 第{i}页")
        print("-" * 70)
        print(scene)
        print()

    # 保存
    out = Path(__file__).parent / "test_scenes_output.txt"
    with open(out, "w", encoding="utf-8") as f:
        for i, scene in enumerate(scenes, 1):
            f.write(f"=== 第{i}页 ===\n{scene}\n\n")
    print(f"\n💾 已保存到: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
