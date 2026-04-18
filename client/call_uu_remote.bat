@echo off
chcp 65001 >nul 2>&1
:: ScreenWall - UU远程 调用脚本
:: 用法: call_uu_remote.bat <deviceId>
:: 示例: call_uu_remote.bat aeawtmgwtiau3yfl

set DEVICE_ID=%~1
set VERIFY_CODE=qqww5566

if "%DEVICE_ID%"=="" (
    echo [ERROR] Device ID is empty
    echo Usage: call_uu_remote.bat deviceId
    pause
    exit /b 1
)

set UUYCMGR=C:\Program Files\Netease\GameViewer\bin\uuycmgr.exe

if exist "%UUYCMGR%" (
    start "" "%UUYCMGR%" --connect %DEVICE_ID% %VERIFY_CODE%
    echo [OK] Launched UU Remote for device: %DEVICE_ID% with code: %VERIFY_CODE%
    exit /b 0
)

echo [ERROR] uuycmgr.exe not found at: %UUYCMGR%
pause
exit /b 1
