@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ====================================
echo  UU远程 协议 & 包装脚本一键配置
echo ====================================
echo.

:: ── 1. 从注册表读取 UU 安装路径 ──────────────────────────────────────
set "REG_KEY=HKEY_LOCAL_MACHINE\SOFTWARE\Classes\uuremote\shell\open\command"
for /f "tokens=2*" %%A in ('reg query "%REG_KEY%" /ve 2^>nul') do (
    set "REG_VAL=%%B"
)

if not defined REG_VAL (
    echo [错误] 未在注册表找到 uuremote 协议键，请先安装 UU远程。
    echo.
    pause
    exit /b 1
)

:: 从注册表值中提取可执行文件路径（去掉引号和参数）
:: 格式示例："C:\Program Files\Netease\GameViewer\GameViewer.exe" "%1"
set "EXE_PATH=%REG_VAL:"=%"
for %%F in ("%EXE_PATH: =?%") do set "INSTALL_DIR=%%~dpF"
:: 还原空格
set "INSTALL_DIR=%INSTALL_DIR:?= %"
:: 去掉末尾反斜杠
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"

set "UUYCMGR_EXE=%INSTALL_DIR%\bin\uuycmgr.exe"

echo [INFO] 检测到安装目录: %INSTALL_DIR%
echo [INFO] 运维工具路径: %UUYCMGR_EXE%
echo.

if not exist "%UUYCMGR_EXE%" (
    echo [错误] 未找到 uuycmgr.exe，请确认 UU远程 已正常安装。
    echo.
    pause
    exit /b 1
)

:: ── 2. 写入 uuycmgr_wrapper.bat 到 D:\ ──────────────────────────────
set "WRAPPER=D:\uuycmgr_wrapper.bat"
(
    echo @echo off
    echo cd /d "%INSTALL_DIR%\bin"
    echo set "id=%%~1"
    echo set "id=%%id:uuycmgr://=%%"
    echo set "id=%%id:/=%%"
    echo uuycmgr.exe -n %%id%% qqww5566
) > "%WRAPPER%"

if not exist "%WRAPPER%" (
    echo [错误] 写入 %WRAPPER% 失败，请检查 D 盘权限。
    pause
    exit /b 1
)
echo [OK] 已生成 %WRAPPER%

:: ── 3. 写入注册表（动态路径）────────────────────────────────────────
:: 用 reg add 逐条写入，避免 .reg 文件路径转义问题

:: uuycmgr 协议根键
reg add "HKEY_CLASSES_ROOT\uuycmgr" /ve /d "URL:UU远程控制协议" /f >nul
reg add "HKEY_CLASSES_ROOT\uuycmgr" /v "URL Protocol" /d "" /f >nul

:: DefaultIcon（uuycmgr.exe 图标）
reg add "HKEY_CLASSES_ROOT\uuycmgr\DefaultIcon" /ve /d "%INSTALL_DIR%\bin\uuycmgr.exe,0" /f >nul

:: shell\open\command → 调用刚生成的 wrapper
reg add "HKEY_CLASSES_ROOT\uuycmgr\shell\open\command" /ve /d "\"%WRAPPER%\" \"%%1\"" /f >nul

echo [OK] 注册表写入完成

echo.
echo ====================================
echo  配置完成！关闭此窗口即可。
echo ====================================
echo.
pause
