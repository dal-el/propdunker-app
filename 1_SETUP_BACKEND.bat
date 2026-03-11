@echo off
setlocal
cd /d %~dp0backend
python -m venv .venv
call .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
echo.
echo Backend setup OK.
pause
