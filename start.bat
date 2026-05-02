@echo off
chcp 65001 >nul
title LoreVista Launcher
cd /d "%~dp0"

echo ==========================================
echo    LoreVista - Starting Backend + Frontend
echo ==========================================
echo.

echo [1/3] Starting backend (FastAPI) ...
start "LoreVista Backend" /MIN cmd /c "cd /d %~dp0backend && python main.py"

echo [2/3] Waiting for backend (2s) ...
timeout /t 2 /nobreak >nul

echo [3/3] Starting frontend (Vite) ...
start "LoreVista Frontend" /MIN cmd /c "cd /d %~dp0frontend && npm run dev"

echo Waiting for frontend (4s) ...
timeout /t 4 /nobreak >nul

echo Opening browser ...
start "" "http://localhost:5173"

echo.
echo ==========================================
echo    Running!
echo    Backend : http://localhost:8000
echo    Frontend: http://localhost:5173
echo ==========================================
echo.
echo Press any key to close this launcher window.
echo (Backend/Frontend windows will keep running)
pause >nul
