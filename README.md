# LoreVista

AI 驱动的小说创作 + 漫画插画生成工具。通过对话引导 AI 创作奇幻小说，自动拆分分镜脚本，生成精美日式轻小说风格彩色插画。

## ✨ 功能

- **AI 小说创作** — 基于 DeepSeek API，通过对话交互引导创作，单话 4000-6000 字
- **自动分镜** — AI 将小说内容拆分为 10 格漫画分镜脚本，支持手动编辑
- **插画生成** — 基于 GPT-Image-2 API 生成精美彩色插画，支持逐张重新生成
- **角色卡系统** — 固定角色外貌描述嵌入每张图片 prompt，保证人物形象一致性
- **实时流式输出** — 小说创作和图片生成均支持 SSE 流式进度展示

## 🛠️ 技术栈

- **后端**: Python / FastAPI / SQLAlchemy / SQLite (零配置)
- **前端**: React / TypeScript / Vite / TailwindCSS
- **AI**: DeepSeek API (小说 & 分镜) + GPT-Image-2 API (插画生成)

## 🚀 快速开始

### 一键启动 (Windows)

双击项目根目录的 **`start.bat`**，自动启动后端 + 前端 + 打开浏览器。

### 手动启动

1. 编辑 `backend/.env.example` 填入你的 API Key，然后重命名为 `.env`
2. 启动后端：

```bash
cd backend
pip install -r requirements.txt
python main.py
```

3. 启动前端：

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173` 即可使用。

## ⚙️ 环境变量

在 `backend/.env` 中配置：

```
DEEPSEEK_API_KEY=你的DeepSeek密钥
IMAGE_API_KEY=你的图片生成API密钥

# 数据库默认使用 SQLite（零配置，开箱即用）
# 如需 PostgreSQL，取消下方注释：
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/manga_novel

HOST=127.0.0.1
PORT=8000
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
MAX_UPLOAD_BYTES=10485760
# 可选：设置后前端也要配置相同的 VITE_API_TOKEN
API_TOKEN=
```

**密钥获取指南：**

- **DeepSeek API Key**: [https://platform.deepseek.com](https://platform.deepseek.com) 注册并充值，在 API Keys 页面创建并填入
- **Image2 API Key**: [https://api.duojie.games/console](https://api.duojie.games/console) 注册后充值额度，在「令牌管理」中创建 API Key 填入

如果后端设置了 `API_TOKEN`，前端需要在 `frontend/.env` 中设置相同令牌：

```
VITE_API_TOKEN=同一个令牌
```

## 📁 项目结构

```
├── backend/
│   ├── main.py              # FastAPI 主应用
│   ├── database.py          # 数据库模型
│   ├── services/
│   │   ├── deepseek.py      # DeepSeek 小说/分镜服务
│   │   └── image2.py        # 图片生成服务
│   └── manga_outputs/       # 生成的图片输出目录
├── frontend/
│   ├── src/
│   │   ├── components/      # React 组件
│   │   └── api.ts           # API 调用封装
│   └── ...
└── README.md
```

## 效果
<img width="1437" height="1325" alt="image" src="https://github.com/user-attachments/assets/292cd965-1bbe-4ac2-be2c-e577d1c1b545" />
<img width="2477" height="1474" alt="8225c4cd8b1ac53ee97418cc6646db8c" src="https://github.com/user-attachments/assets/2e394e4c-f0c0-4af6-ae8d-63713d111cde" />
<img width="2478" height="1479" alt="image" src="https://github.com/user-attachments/assets/5e4a6aa5-9f7f-49a2-8e47-65a5c2ad9dec" />


MIT
