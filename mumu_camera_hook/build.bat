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
echo Compiling injector.exe...
cl.exe /EHsc /O2 /MD injector.cpp /Fe:injector.exe
if %ERRORLEVEL% neq 0 (
    echo Failed to compile injector.exe
    pause
    exit /b 1
)

echo.
echo Compiling camera_hook.dll...
cl.exe /EHsc /O2 /MD /LD camera_hook.cpp /Fe:camera_hook.dll /link user32.lib shell32.lib
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook.dll
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.
echo Files created:
if exist injector.exe echo   injector.exe
if exist camera_hook.dll echo   camera_hook.dll
echo   camera_config.txt
echo.
echo Usage:
echo   1. Edit camera_config.txt with your camera name
echo   2. Run injector.exe while MuMu is running
echo.

del /q *.obj *.exp *.lib 2>nul

pause
