@echo off
setlocal

set VC_VARS="C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

if not exist %VC_VARS% (
    echo ERROR: vcvars64.bat not found
    pause
    exit /b 1
)

call %VC_VARS%

echo.
echo Compiling camera_hook38.dll...
cl.exe /EHsc /O2 /MD /LD camera_hook38.cpp /Fe:camera_hook38.dll /link user32.lib shell32.lib
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook38.dll
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.

pause
