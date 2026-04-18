@echo off
chcp 65001 >nul 2>&1
title UU Device Scanner
echo.
echo  =======================================================
echo    UU Remote Device Scanner  v4
echo  =======================================================
echo.
python "%~dp0scan_uu.py"
echo.
pause
