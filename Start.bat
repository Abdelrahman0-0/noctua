@echo off
setlocal
cd /d "%~dp0"
title Noctua
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. The download page will open.
  echo Install the LTS version, then double-click this file again.
  start https://nodejs.org
  pause
  exit /b 1
)
if not exist ".setup-done" (
  echo First time setup. This takes a minute or two, please wait...
  call npm install
  if errorlevel 1 goto fail
  call npx playwright install chromium
  if errorlevel 1 goto fail
  echo done> .setup-done
)
node app.mjs
if errorlevel 1 pause
exit /b 0
:fail
echo.
echo Setup failed. Check your internet connection and double-click this file again.
pause
exit /b 1
