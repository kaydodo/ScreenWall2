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
echo Compiling injector17.exe...
cl.exe /EHsc /O2 /MD injector.cpp /Fe:injector17.exe
if %ERRORLEVEL% neq 0 (
    echo Failed to compile injector17.exe
    pause
    exit /b 1
)

echo.
echo Compiling camera_hook17.dll...
cl.exe /EHsc /O2 /MD /LD camera_hook17.cpp /Fe:camera_hook17.dll /link ole32.lib user32.lib advapi32.lib
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook17.dll
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.
echo Files created:
if exist injector17.exe echo   injector17.exe
if exist camera_hook17.dll echo   camera_hook17.dll
echo.
echo Usage:
echo   1. Make sure MuMu is running
echo   2. Run injector17.exe
echo   3. Open camera in MuMu
echo   4. Check D:\mumu_camera_hook.log
echo.

del /q *.obj *.exp *.lib 2>nul

pause
