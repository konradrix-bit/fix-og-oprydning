@echo off
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Installer Python fra https://www.python.org/downloads/ og saet flueben i "Add python.exe to PATH".
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)
".venv\Scripts\python.exe" main.py
if errorlevel 1 pause
