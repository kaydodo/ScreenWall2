@echo off
REM Alist Stop Script

echo Stopping Alist...

taskkill /IM "alist.exe" /F >nul 2>&1

powershell -Command "Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Stop-Process -Force -ErrorAction SilentlyContinue"

echo Alist stopped.
pause