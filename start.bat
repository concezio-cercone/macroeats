@echo off
REM ===========================================================================
REM  MacroEats - one-click launcher (Windows)
REM  Double-click this file. First run installs what's needed, then starts
REM  the app and opens it in your browser. Later runs just start it.
REM ===========================================================================

cd /d "%~dp0"

echo ==========================================
echo   Starting MacroEats
echo ==========================================
echo.

REM 1) Make sure Node.js is installed - the only prerequisite.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed yet - it's the one thing this needs.
  echo.
  echo   1. Go to https://nodejs.org
  echo   2. Download the button that says "LTS" and run the installer
  echo   3. Double-click this file again
  echo.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo Node.js found: %%v

REM 2) Install dependencies the first time only.
if not exist node_modules (
  echo First run - installing, about 30 seconds, needs internet...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
  echo Done installing.
) else (
  echo Already set up.
)

REM 3) Open the browser, then start the server in this window.
echo.
echo Opening http://localhost:3000 ...
start "" "http://localhost:3000"
echo Leave this window open while you use the app.
echo To stop it: close this window, or press Ctrl-C.
echo ------------------------------------------------------------
echo.
node server.js

pause
