@echo off
tasklist | findstr /i "ScreenWallClient.exe" >nul
if %errorlevel% equ 0 (
    powershell -Command "Start-Sleep -Seconds 1; Remove-Item -Path '%~f0' -Force"
    exit
)

for %%D in (D E F) do (
    if exist "%%D:\ScreenWallClient\ScreenWallClient.exe" (
        start "" "%%D:\ScreenWallClient\ScreenWallClient.exe"
        exit
    )
)
