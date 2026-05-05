# LoreVista

AI 小说创作 + 漫画插画生成工具。通过对话引导 AI 创作小说，自动拆分分镜脚本，并生成漫画图片。

## 功能

- **AI 小说创作**：基于 DeepSeek API，通过对话交互引导创作。
- **自动分镜**：AI 将小说内容拆分为漫画分镜脚本，支持手动编辑。
- **漫画生成**：基于 Image2 API 生成漫画图片，支持逐张重新生成。
- **角色卡系统**：固定角色外貌描述，帮助保持人物形象一致。
- **多张垫图**：支持上传多张参考图，让生成结果更稳定。
- **实时进度**：对话、分镜、漫画生成都有进度反馈。

## 技术栈

- **后端**：Python / FastAPI / SQLAlchemy / SQLite
- **前端**：React / TypeScript / Vite / TailwindCSS
- **AI**：DeepSeek API + Image2 API

## 使用教程（SQLite 版）

### 1. 拉取项目代码

先打开终端，执行：

```bash
git clone -b sqlite https://github.com/libohan-ha/-LoreVista.git
cd -LoreVista
```

### 2. 安装后端依赖

进入后端目录：

```bash
cd backend
pip install -r requirements.txt
```

安装完成后，回到项目根目录：

```bash
cd ..
```

### 3. 安装前端依赖

进入前端目录：

```bash
cd frontend
npm install
```

安装完成后，回到项目根目录：

```bash
cd ..
```

### 4. 启动项目

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

### 5. 配置 API Key

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
https://api.duojie.games/console/log
```

购买后，把两个 API Key 分别填入网页里的 API Key 设置窗口，然后点击保存。

### 6. 开始测试

配置完成后，就可以开始测试：

1. 点击“新建小说”
2. 进入小说
3. 和 AI 对话，生成小说内容
4. 生成分镜
5. 生成漫画图片

SQLite 版默认会把数据保存在本地，不需要安装 PostgreSQL。

## 效果

<img width="1437" height="1325" alt="image" src="https://github.com/user-attachments/assets/292cd965-1bbe-4ac2-be2c-e577d1c1b545" />
<img width="2477" height="1474" alt="8225c4cd8b1ac53ee97418cc6646db8c" src="https://github.com/user-attachments/assets/2e394e4c-f0c0-4af6-ae8d-63713d111cde" />
<img width="2478" height="1479" alt="image" src="https://github.com/user-attachments/assets/5e4a6aa5-9f7f-49a2-8e47-65a5c2ad9dec" />

## License

MIT
