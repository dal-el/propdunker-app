@echo off
REM Kill anything holding port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1

cd /d C:\DEV\PROPDUNKER\propdunker_mvp\frontend
npm run dev -- -H 0.0.0.0 -p 3000
pause
