@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo    LoreVista - 启动前后端 + 自动打开浏览器
echo ==========================================
echo.

echo [1/3] 启动后端 (Python FastAPI) ...
start "Backend - LoreVista" /MIN cmd /c "cd backend && python main.py"

echo [2/3] 等待后端初始化 (2秒) ...
timeout /t 2 /nobreak >nul

echo [3/3] 启动前端 (Vite) ...
start "Frontend - LoreVista" /MIN cmd /c "cd frontend && npm run dev"

echo 等待前端启动 (3秒) ...
timeout /t 3 /nobreak >nul

echo 打开浏览器 ...
start http://localhost:5173

echo.
echo ==========================================
echo    前后端已启动！浏览器已打开
echo    后端: http://localhost:8000
echo    前端: http://localhost:5173
echo ==========================================
pause
