@echo off
echo ===============================
echo NEXT ROUND AUTO GENERATOR
echo ===============================
echo.

REM Paths
set BASE=C:\DEV\PROPDUNKER\NEXT_ROUND
set SCRIPT=%BASE%\SCRIPTS\NEXT_ROUND_SCRIPT\generate_next_round.py

echo Using script:
echo %SCRIPT%
echo.

REM Check python
py --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Install Python first.
    pause
    exit /b
)

REM Install dependency
py -m pip install pdfplumber >nul

REM Run script
py "%SCRIPT%"

echo.
echo ===============================
echo DONE
echo JSON generated in:
echo %BASE%\UPCOMMING_MATCHES
echo ===============================
pause
