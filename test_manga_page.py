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
    "日式黑白漫画页，竖向多格分镜布局，每页包含4-6个分镜格，"
    "格子高度不等（动作场景用宽格，对话特写用窄格），"
    "每个分镜格之间有清晰的黑色边框分隔，"
    "包含圆形/椭圆形白色对话气泡和中文台词，"
    "包含漫画音效字（如'唷''铿！''嗡—'），"
    "黑白高对比度，戏剧性光影，精细的线条和网点，"
    "人物绘制精美，表情生动，动作有力度感"
)

CHARACTER_PROFILES = """角色名：塞蕾娜（Serena）
性别：女 | 青年 | 约170cm
外貌：银灰色过腰长发（冷白光泽），冰灰蓝色瞳孔，瓜子脸冷感轮廓，鼻梁挺直，嘴唇偏薄
服装：黑白主色高阶战斗女仆装，黑色收腰束身长袖上衣，胸前白色荷叶边+黑色丝带领结，短前长后裙，黑色过膝袜+银黑高跟战斗短靴
配饰：白色女仆头饰，腰间银黑色长剑，银蓝色术式纹路
气质：冷静、克制、锋利、忠诚

角色名：艾莉西娅（Alicia）
性别：女 | 少女 | 约165cm
外貌：金色过腰长发（蜂蜜金色泽，发尾微卷），浅金琥珀色瞳孔，小巧鹅蛋脸，眼睛大而明亮，睫毛纤长
服装：白金与淡紫主色王女礼裙，收腰露肩宫廷式胸衣+金线刺绣，多层轻纱长裙，垂坠薄纱长袖
配饰：王女发冠，紫晶与白蔷薇发饰，金色淡紫宝石耳坠
气质：高贵、温柔、明亮"""

# 第1页分镜脚本 - 4格深夜警觉场景
PAGE_SCRIPT = (
    "第1页：【第1格（大宽格）】远景，深夜港都的旅店房间，月光透过窗棂洒在地板上，"
    "塞蕾娜躺在床上的侧影，突然睁开眼睛，瞳孔锐利。音效：嗡——。"
    "【第2格（窄格）】特写，塞蕾娜右手按住胸口，眉头紧锁，额头沁出细汗，"
    "银色眼眸聚焦在下方。对话气泡：「阿尔法，解析震动来源与性质。」"
    "【第3格（中景）】半透明的对话框浮现，字母闪烁。"
    "对话气泡：「震动源地下约二百七十尺，与旧祭祀场地脉中心高度重合。——非自然震荡，疑似人为触发的地脉共鸣。」"
    "【第4格（宽格）】塞蕾娜翻身坐起，动作利落，床单发出窸窣声。"
    "艾莉西娅在隔壁床上揉眼抬头，金色长发凌乱，表情困惑。"
    "对话气泡：「怎么了？」音效：沙沙。"
)

full_prompt = (
    f"【角色外貌设定（每张图必须严格遵守）】\n{CHARACTER_PROFILES}\n\n"
    f"{MANGA_STYLE}\n{PAGE_SCRIPT}"
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
    out_path = Path(__file__).parent / "test_manga_page1_4panel.png"

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
