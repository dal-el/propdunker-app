@echo off
setlocal EnableExtensions

echo ===============================
echo  BasketStories LIVE Export
echo ===============================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: python not found in PATH.
  pause
  exit /b 1
)

if not exist "bs_links.json" (
  echo ERROR: bs_links.json missing in this folder.
  pause
  exit /b 2
)

python export_bs_live_to_excel_json.py --links "bs_links.json" --xlsx "basketstories_oppdef.xlsx" --json "opp_def_cache.json"

echo.
echo DONE: basketstories_oppdef.xlsx + opp_def_cache.json

