# LoreVista

AI 小说创作 + 漫画插画生成工具。通过对话引导 AI 创作小说，自动拆分分镜脚本，并生成漫画图片。

> 小白用户建议使用 SQLite 版，不需要安装 PostgreSQL：  
> https://github.com/libohan-ha/-LoreVista/tree/sqlite

## 功能

- **AI 小说创作**：基于 DeepSeek API，通过对话交互引导创作。
- **自动分镜**：AI 将小说内容拆分为漫画分镜脚本，支持手动编辑。
- **漫画生成**：基于 Image2 API 生成漫画图片，支持逐张重新生成。
- **角色卡系统**：固定角色外貌描述，帮助保持人物形象一致。
- **多张垫图**：支持上传多张参考图，让生成结果更稳定。
- **实时进度**：对话、分镜、漫画生成都有进度反馈。

## 技术栈

- **后端**：Python / FastAPI / SQLAlchemy / PostgreSQL
- **前端**：React / TypeScript / Vite / TailwindCSS
- **AI**：DeepSeek API + Image2 API

## 使用教程（PostgreSQL 版）

### 1. 拉取项目代码

```bash
git clone https://github.com/libohan-ha/-LoreVista.git
cd -LoreVista
```

### 2. 准备 PostgreSQL 数据库

请先安装并启动 PostgreSQL，然后创建数据库：

```sql
CREATE DATABASE manga_novel;
```

默认连接地址是：

```text
postgresql://postgres:postgres@localhost:5432/manga_novel
```

如果你的 PostgreSQL 用户名、密码、端口或数据库名不同，需要在后面的 `.env` 中修改 `DATABASE_URL`。

### 3. 配置后端环境变量

进入后端目录：

```bash
cd backend
```

复制环境变量示例文件：

```bash
copy .env.example .env
```

然后打开 `backend/.env`，确认或修改数据库配置：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/manga_novel
IMAGE_API_BASE_URL=https://api.duojie.games/v1
HOST=127.0.0.1
PORT=8000
```

DeepSeek 和 Image2 的 API Key 可以不写在 `.env` 里，后面可以直接在网页里填写。

### 4. 安装依赖

你可以选择下面任意一种方式安装前后端依赖。

#### 方式一（推荐，小白友好）：双击 `install.bat`

进入项目根目录，双击：

```text
install.bat
```

脚本会自动检查 Python / Node.js，并依次安装后端 (`pip install`) 和前端 (`npm install`) 依赖。看到 `Install completed successfully!` 即成功。

> 前置条件：已安装 Python 3.10+ 和 Node.js 18+。如果脚本提示找不到 Python 或 Node，请先去官网安装：  
> Python: https://www.python.org/downloads/（安装时勾选 *Add Python to PATH*）  
> Node.js: https://nodejs.org/

#### 方式二：手动安装

先安装后端依赖：

```bash
cd backend
pip install -r requirements.txt
cd ..
```

再安装前端依赖：

```bash
cd frontend
npm install
cd ..
```

### 5. 启动项目

你可以选择下面任意一种启动方式。

#### 方式一：分别启动后端和前端

先打开一个终端，启动后端：

```bash
cd backend
python main.py
```

再打开另一个终端，启动前端：

```bash
cd frontend
npm run dev
```

然后在浏览器访问：

```text
http://localhost:5173
```

#### 方式二：双击 start.bat 启动

进入项目所在的桌面文件夹，双击项目根目录里的：

```text
start.bat
```

它会自动启动后端、前端，并打开浏览器页面。

如果浏览器没有自动打开，可以手动访问：

```text
http://localhost:5173
```

### 6. 配置 API Key

打开网页后，点击页面上的 **API Key** 按钮。

你需要配置两个 Key：

#### DeepSeek API Key

用于 AI 对话、生成小说、生成分镜。

购买 / 查看用量：

```text
https://platform.deepseek.com/usage
```

#### Image2 API Key

用于生成漫画图片。

充值入口：

```text
https://api.duojie.games/console/token
```

购买后，把两个 API Key 分别填入网页里的 API Key 设置窗口，然后点击保存。

### 7. 开始测试

配置完成后，就可以开始测试：

1. 点击“新建小说”
2. 进入小说
3. 和 AI 对话，生成小说内容
4. 生成分镜
5. 生成漫画图片

## 效果

<img width="1437" height="1325" alt="image" src="https://github.com/user-attachments/assets/292cd965-1bbe-4ac2-be2c-e577d1c1b545" />
<img width="2477" height="1474" alt="8225c4cd8b1ac53ee97418cc6646db8c" src="https://github.com/user-attachments/assets/2e394e4c-f0c0-4af6-ae8d-63713d111cde" />
<img width="2478" height="1479" alt="image" src="https://github.com/user-attachments/assets/5e4a6aa5-9f7f-49a2-8e47-65a5c2ad9dec" />

## License

MIT
