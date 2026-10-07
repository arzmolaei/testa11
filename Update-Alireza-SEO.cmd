@echo off
setlocal
title Alireza SEO Studio - Install or Update
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'Alireza-SEO-Setup.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/arzmolaei/testa11/main/Install-Rooyesh.ps1' -OutFile $p; & $p -SourceRef main"
set "SEO_INSTALL_RESULT=%ERRORLEVEL%"
echo.
if not "%SEO_INSTALL_RESULT%"=="0" echo Installation stopped. Fix the reported problem and run this updater again.
pause
exit /b %SEO_INSTALL_RESULT%
