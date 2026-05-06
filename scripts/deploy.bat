@echo off
echo Deploying to Netlify...
cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
