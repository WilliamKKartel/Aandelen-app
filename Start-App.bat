@echo off
title Mijn Beleggingen
cd /d "%~dp0"
echo ============================================
echo   Mijn Beleggingen wordt gestart...
echo   Je browser opent zo automatisch.
echo.
echo   Laat dit venster open staan zolang je de
echo   app gebruikt. Sluiten? Sluit dit venster.
echo ============================================
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python "app\server.py"
) else (
  py "app\server.py"
)
echo.
echo De app is gestopt. Dit venster mag dicht.
pause >nul
