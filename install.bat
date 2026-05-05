@echo off
chcp 65001 >nul
title LoreVista Installer
cd /d "%~dp0"

echo ==========================================
echo    LoreVista - One-Click Installer
echo ==========================================
echo.

REM ----- Check Python -----
echo [1/4] Checking Python ...
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.10+ from https://www.python.org/downloads/
    echo         Make sure to check "Add Python to PATH" during install.
    pause
    exit /b 1
)
python --version

REM ----- Check Node.js -----
echo.
echo [2/4] Checking Node.js ...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)
node --version
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found. Please reinstall Node.js.
    pause
    exit /b 1
)

REM ----- Backend deps -----
echo.
echo [3/4] Installing backend dependencies (pip) ...
echo This may take a few minutes the first time.
pushd "%~dp0backend"
python -m pip install --upgrade pip
if errorlevel 1 (
    echo [ERROR] Failed to upgrade pip.
    popd
    pause
    exit /b 1
)
python -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install backend dependencies.
    popd
    pause
    exit /b 1
)

REM ----- Create .env if missing -----
if not exist ".env" (
    if exist ".env.example" (
        echo Creating backend\.env from .env.example ...
        copy /Y ".env.example" ".env" >nul
    )
)
popd

REM ----- Frontend deps -----
echo.
echo [4/4] Installing frontend dependencies (npm) ...
pushd "%~dp0frontend"
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install frontend dependencies.
    popd
    pause
    exit /b 1
)
popd

echo.
echo ==========================================
echo    Install completed successfully!
echo ==========================================
echo.
echo Next steps:
echo   1. (PostgreSQL version only) Make sure PostgreSQL is running and database exists.
echo      Edit backend\.env if your DB credentials differ from defaults.
echo   2. Double-click start.bat to launch the app.
echo   3. Open http://localhost:5173 and configure API Keys in the UI.
echo.
pause
