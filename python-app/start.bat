@echo off
rem O-Jester — one-click start on Windows. First run installs everything automatically.
cd /d "%~dp0"
if not exist .venv (
  echo Installing O-Jester (first run only)...
  python -m venv .venv || goto :error
  .venv\Scripts\python -m pip install --upgrade pip >nul
  .venv\Scripts\pip install -r requirements.txt || goto :error
)
if not exist .env (
  copy .env.example .env >nul
  for /f %%k in ('.venv\Scripts\python -c "import secrets;print(secrets.token_hex(32))"') do powershell -NoProfile -Command "(Get-Content .env) -replace '^SECRET_KEY=$','SECRET_KEY=%%k' | Set-Content .env"
  echo.
  echo A .env file was created. Open it, add your football data API key, then run start.bat again.
  notepad .env
  goto :eof
)
.venv\Scripts\python run.py
goto :eof
:error
echo Installation failed. Make sure Python 3.10+ is installed from https://www.python.org/downloads/
pause
