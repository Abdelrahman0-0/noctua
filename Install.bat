@echo off
setlocal
cd /d "%~dp0"
title Install Noctua
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. The download page will open.
  echo Install the LTS version, then double-click Install.bat again.
  start https://nodejs.org
  pause
  exit /b 1
)
set "DEST=%LOCALAPPDATA%\Noctua"
echo Installing Noctua to %DEST%
if not exist "%DEST%" mkdir "%DEST%"
rem Copy everything; keep the user's data, settings and reports when updating.
robocopy "%~dp0." "%DEST%" /E /NFL /NDL /NJH /NJS /XD data reports node_modules /XF settings.json Install.bat Uninstall.bat >nul
if errorlevel 8 ( echo Copy failed. & pause & exit /b 1 )
cd /d "%DEST%"
if not exist ".setup-done" (
  echo First time setup. This takes a minute or two, please wait...
  call npm install
  if errorlevel 1 goto fail
  call npx playwright install chromium
  if errorlevel 1 goto fail
  echo done> .setup-done
)
rem Shortcuts: Desktop and Start Menu
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($p in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){ $s=$w.CreateShortcut((Join-Path $p 'Noctua.lnk')); $s.TargetPath='wscript.exe'; $s.Arguments='\"%DEST%\Noctua.vbs\"'; $s.WorkingDirectory='%DEST%'; $s.IconLocation='shell32.dll,13'; $s.Description='Noctua'; $s.Save() }"
echo.
set /p AUTO=Start Noctua automatically when Windows starts, so monitoring keeps running? (Y/N): 
if /i "%AUTO%"=="Y" (
  powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Noctua.lnk')); $s.TargetPath='wscript.exe'; $s.Arguments='\"%DEST%\Noctua.vbs\" --hidden'; $s.WorkingDirectory='%DEST%'; $s.Save()"
  echo Auto-start is on.
)
echo.
echo Done. Use the Noctua icon on your Desktop or Start Menu.
start "" wscript.exe "%DEST%\Noctua.vbs"
pause
exit /b 0
:fail
echo.
echo Setup failed. Check your internet connection and run Install.bat again.
pause
exit /b 1
