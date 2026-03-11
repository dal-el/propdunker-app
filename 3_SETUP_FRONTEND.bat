@echo off
setlocal
cd /d %~dp0frontend
if not exist node_modules (
  npm install
)
echo.
echo Frontend setup OK.
pause
