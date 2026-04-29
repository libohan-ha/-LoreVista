# LoreVista

AI 驱动的小说创作 + 漫画插画生成工具。通过对话引导 AI 创作奇幻小说，自动拆分分镜脚本，生成精美日式轻小说风格彩色插画。

## ✨ 功能

- **AI 小说创作** — 基于 DeepSeek API，通过对话交互引导创作，单话 4000-6000 字
- **自动分镜** — AI 将小说内容拆分为 10 格漫画分镜脚本，支持手动编辑
- **插画生成** — 基于 GPT-Image-2 API 生成精美彩色插画，支持逐张重新生成
- **角色卡系统** — 固定角色外貌描述嵌入每张图片 prompt，保证人物形象一致性
- **实时流式输出** — 小说创作和图片生成均支持 SSE 流式进度展示

## 🛠️ 技术栈

- **后端**: Python / FastAPI / SQLAlchemy / SQLite
- **前端**: React / TypeScript / Vite / TailwindCSS
- **AI**: DeepSeek API (小说 & 分镜) + GPT-Image-2 API (插画生成)

## 🚀 快速开始

### 1. 后端

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 填入你的 API Key
python main.py
```

### 2. 前端

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

## License

MIT
