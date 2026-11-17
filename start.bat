@echo off
setlocal
chcp 65001 >nul
title ISAKU
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

set "PY="
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  python -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo Python blev ikke fundet. Installer Python 3 fra https://www.python.org/downloads/
  echo Husk at saette flueben ved "Add python.exe to PATH".
  pause
  exit /b 1
)

%PY% -m pip install -r "%~dp0requirements.txt" --disable-pip-version-check -q
if errorlevel 1 (
  echo Kunne ikke installere pakken requests.
  pause
  exit /b 1
)

%PY% "%~dp0isaku.py"
echo.
pause
