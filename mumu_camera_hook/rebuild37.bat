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
echo Compiling injector37.exe...
cl.exe /EHsc /O2 /MD injector.cpp /Fe:injector37.exe
if %ERRORLEVEL% neq 0 (
    echo Failed to compile injector37.exe
    pause
    exit /b 1
)

echo.
echo Compiling camera_hook37.dll...
cl.exe /EHsc /O2 /MD /LD camera_hook37.cpp /Fe:camera_hook37.dll /link user32.lib shell32.lib
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook37.dll
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.
echo Files created:
if exist injector37.exe echo   injector37.exe
if exist camera_hook37.dll echo   camera_hook37.dll
echo.

pause
