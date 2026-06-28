@echo off
title Smart Outreach Mailer - Local Server
cd /d "%~dp0"

echo ==========================================
echo Starting Smart Outreach Mailer...
echo ==========================================

:: Check if .env exists, if not copy from example
if not exist .env (
    echo [INFO] Creating .env file from .env.example...
    copy .env.example .env
)

:: Check if node_modules exists, if not run npm install
if not exist node_modules (
    echo [INFO] node_modules not found. Installing dependencies...
    call npm install
)

:: Start browser to app URL after a brief delay
echo [INFO] Launching browser at http://localhost:5173/ ...
start http://localhost:5173/

:: Start the application in dev mode
echo [INFO] Starting servers (Concurrent Vite + Express Backend)...
call npm run dev

pause
