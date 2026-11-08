@echo off
title Uninstall Noctua
set "DEST=%LOCALAPPDATA%\Noctua"
echo This removes Noctua, its shortcuts and auto-start. Your monitoring history in %DEST%\data is deleted too.
set /p OK=Continue? (Y/N): 
if /i not "%OK%"=="Y" exit /b 0
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*Noctua*app.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
del "%USERPROFILE%\Desktop\Noctua.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Noctua.lnk" 2>nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Noctua.lnk" 2>nul
cd /d "%TEMP%"
rmdir /s /q "%DEST%"
echo Removed.
pause
