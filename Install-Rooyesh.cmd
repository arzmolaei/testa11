@echo off
setlocal
title Roshdimo - Cloudflare Installer
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Rooyesh.ps1" -FromLocalSource %*
set "ROOYESH_RESULT=%ERRORLEVEL%"
echo.
if not "%ROOYESH_RESULT%"=="0" echo Installation stopped. Fix the reported problem and open this installer again.
pause
exit /b %ROOYESH_RESULT%
