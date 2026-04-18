@echo off
chcp 65001 >nul
echo.
echo  ╔═══════════════════════════════════════════════════╗
echo  ║     Screen Wall 客户端 — 一键打包工具            ║
echo  ╚═══════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo [1/4] 检查 Python 环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Python，请先安装 Python 3.9+
    echo         下载: https://www.python.org/downloads/
    pause
    exit /b 1
)
echo        Python OK

echo.
echo [2/4] 安装依赖（首次约1分钟）...
pip install websockets mss Pillow pywin32 -q
if errorlevel 1 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)
echo        依赖 OK

echo.
echo [3/4] PyInstaller 打包中（首次约1-3分钟）...
if exist "dist" (
    echo        清理旧构建...
    rd /s /q "dist" 2>nul
)
pyinstaller client.spec --clean
if errorlevel 1 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo [4/4] 准备分发包...
:: 复制配置文件模板到分发目录
copy /Y "config.json" "dist\ScreenWallClient\config.json" >nul
echo        config.json 已复制

echo.
echo ════════════════════════════════════════════════════
if exist "dist\ScreenWallClient\ScreenWallClient.exe" (
    echo.
    echo   打包完成！分发包位于：
    echo.
    echo   dist\ScreenWallClient\
    echo.
    echo   文件说明：
    echo     ScreenWallClient.exe  — 客户端主程序
    echo     config.json           — 配置文件（可随时编辑）
    echo.
    echo   使用方法：
    echo   1. 编辑 config.json 中的 server.host 为服务端IP
    echo   2. deviceName 可留空（自动使用计算机名）
    echo   3. 双击 ScreenWallClient.exe 运行
    echo   4. 首次运行会自动引导配置
    echo.
    echo   若要扫描UU设备信息，双击 scan_uu.bat
    echo.
) else (
    echo   打包失败，请检查上方错误信息
)
echo ════════════════════════════════════════════════════
pause
