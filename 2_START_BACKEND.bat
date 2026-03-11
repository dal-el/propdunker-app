@echo off
setlocal
cd /d %~dp0backend
if not exist .venv\Scripts\activate.bat (
  echo ERROR: Backend not set up. Run 1_SETUP_BACKEND.bat first.
  pause
  exit /b 1
)
for /f "usebackq delims=" %%A in ("%~dp0DATA_DIR.txt") do set PROPDUNKER_DATA_DIR=%%A
if "%PROPDUNKER_DATA_DIR%"=="" (
  echo ERROR: DATA_DIR.txt is empty.
  pause
  exit /b 1
)
call .venv\Scripts\activate
set PROPDUNKER_DATA_DIR=%PROPDUNKER_DATA_DIR%
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
