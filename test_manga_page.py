"""
测试单页多格漫画生成效果。
选用第8页（突然拥抱）作为测试——情绪张力最强的一页。
"""

import base64
import os
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "backend" / ".env")

API_KEY = os.getenv("IMAGE_API_KEY", "")
API_BASE = os.getenv("IMAGE_API_BASE_URL", "https://api.duojie.games/v1").rstrip("/")

MANGA_STYLE = (
    "日式黑白漫画页，竖向多格分镜布局，每页包含3-4个分镜格，"
    "格子高度不等（动作场景用宽格，对话特写用窄格），"
    "每个分镜格之间有清晰的黑色边框分隔，"
    "包含圆形/椭圆形白色对话气泡和中文台词，"
    "包含漫画音效字（如'唷''铿！''嗡—'），"
    "黑白高对比度，戏剧性光影，精细的线条和网点，"
    "人物绘制精美，表情生动，动作有力度感"
)

# 角色卡（简化版）
CHARACTER_PROFILES = """角色1 - 塞蕾娜（Serena）：
银灰色长发，紫罗兰色瞳孔，黑色哥特风女仆战斗装，腰间佩细剑，气质冷静优雅。

角色2 - 艾莉西娅（Alicia）：
金色波浪长发，琥珀金色瞳孔，白色与淡紫色相间的公主长裙，气质温柔明亮。"""

# 第8页分镜脚本 - 突然拥抱场景
PAGE_8_SCRIPT = (
    "第8页：【第1格（中景）】艾莉西娅突然站起来，合身的睡衣被动作带起涟漪。"
    "塞蕾娜手还拿着布巾，抬头注视。"
    "【第2格（大幅动作特写）】艾莉西娅上前一步，伸手环抱住塞蕾娜的腰，"
    "将脸埋在她还带着薰衣草香气的颈窝。水汽从艾莉西娅半干的发梢逸散。"
    "塞蕾娜双手僵在半空，布巾悬垂。"
    "【第3格（窄格）】塞蕾娜的面部特写，她愣住，瞳孔微张，随即恢复。"
    "对话框：「……又怎么了？」"
    "【第4格（中景）】艾莉西娅闷闷的声音从颈间传来，"
    "对话气泡：「没什么。就是想抱一下。」"
)

full_prompt = (
    f"【角色外貌设定（每张图必须严格遵守）】\n{CHARACTER_PROFILES}\n\n"
    f"{MANGA_STYLE}\n{PAGE_8_SCRIPT}"
)


def main():
    if not API_KEY:
        print("❌ 缺少 IMAGE_API_KEY")
        return

    print(f"🎨 API: {API_BASE}")
    print(f"📐 尺寸: 1024x1536 (竖版)")
    print(f"📝 Prompt 长度: {len(full_prompt)} 字符")
    print(f"⏳ 开始生成...\n")

    payload = {
        "model": "gpt-image-2",
        "prompt": full_prompt,
        "size": "1024x1536",
    }

    t0 = time.time()
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=30, read=300, write=30, pool=30)) as client:
            resp = client.post(
                f"{API_BASE}/images/generations",
                json=payload,
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
    except Exception as e:
        print(f"❌ 请求失败: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   响应: {e.response.text[:500]}")
        return

    elapsed = time.time() - t0
    data = resp.json()

    # 解析图片
    img_data = data["data"][0]
    out_path = Path(__file__).parent / "test_manga_page8.png"

    if "b64_json" in img_data:
        img_bytes = base64.b64decode(img_data["b64_json"])
        out_path.write_bytes(img_bytes)
    elif "url" in img_data:
        print(f"📎 URL: {img_data['url']}")
        img_resp = httpx.get(img_data["url"], timeout=60)
        out_path.write_bytes(img_resp.content)
    else:
        print(f"❌ 未知响应格式: {list(img_data.keys())}")
        return

    size_kb = out_path.stat().st_size / 1024
    print(f"✅ 生成成功！")
    print(f"⏱️  耗时: {elapsed:.1f}s")
    print(f"💾 保存到: {out_path}")
    print(f"📦 文件大小: {size_kb:.0f} KB")


if __name__ == "__main__":
    main()
