@echo off
REM ============================================================
REM ScanWall2Startup.bat
REM 功能：扫描 D/E/F/G 盘找到 ScreenWallClient.exe 并创建启动快捷方式
REM 自动在 Windows 安装完成后由 SetupComplete.cmd 调用
REM ============================================================

setlocal enabledelayedexpansion

set "EXE_NAME=ScreenWallClient.exe"
set "FOUND_PATH="
for %%D in (D E F G) do (
    if exist "%%D:\" (
        for /r "%%D:\" %%F in (!EXE_NAME!) do (
            if exist "%%F" (
                set "FOUND_PATH=%%F"
                goto MAKE_SHORTCUT
            )
        )
    )
)
if not defined FOUND_PATH exit /b 0

:MAKE_SHORTCUT
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ScreenWallClient.lnk"
for %%P in (!FOUND_PATH!) do set "WORKDIR=%%~dpP"
powershell -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%LNK%'); $s.TargetPath='!FOUND_PATH!'; $s.WorkingDirectory='!WORKDIR!'; $s.WindowStyle=1; $s.Save()" >nul 2>&1
exit /b 0