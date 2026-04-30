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

## 格式示例（必须严格遵守此格式，至少4格）
"第1页：【第1格（大宽格）】远景，森林中的马车穿行，车轮碾过泥路，月光斜照。音效：咕隆咕隆。【第2格（窄格）】特写，塞蕾娜眉头微蹙，手按在剑柄上，冰灰蓝瞳孔锐利。对话气泡：「殿下，前方有异常气息。」【第3格（窄格）】特写，艾莉西娅掀开车帘探头，金色长发被风吹起，琥珀色眼眸困惑。对话气泡：「什么情况？」【第4格（中景）】塞蕾娜跃下马车，黑色披风翻飞，银剑半出鞘。音效：唰——！【第5格（大宽格）】动态场景，五名山贼从树丛冲出，黑影遮天，刀光森冷。对话气泡：「把车里的女人交出来！」音效：哇啊——！"

风格：日式黑白漫画，高对比度，戏剧性光影，精细线条和网点。

请输出JSON数组，不要输出其他任何内容：
[
  "第1页：【第1格...】...【第2格...】...【第3格...】...【第4格...】...（可选第5格）",
  "第2页：【第1格...】...【第2格...】...【第3格...】...【第4格...】...",
  ...
  "第10页：【第1格...】...【第2格...】...【第3格...】...【第4格...】..."
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
        {"role": "system", "content": "你是漫画分镜专家。输出JSON数组，每个元素是一页漫画（包含4-6个分镜格，最少4格），不是单个格子。绝对不要把一个格子作为一个数组元素，也不要每页只给3个或更少的格子。"},
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

    # 统计每页格数
    import re
    panel_counts = []
    for scene in scenes:
        count = len(re.findall(r'【第\d+格', scene))
        panel_counts.append(count)
    print(f"📊 每页格数: {panel_counts}")
    print(f"   最少: {min(panel_counts)} 格 | 最多: {max(panel_counts)} 格 | 平均: {sum(panel_counts)/len(panel_counts):.1f} 格")
    print("=" * 70)

    for i, scene in enumerate(scenes, 1):
        print(f"\n📄 第{i}页 ({panel_counts[i-1]}格)")
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
