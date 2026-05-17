@echo off
echo MuMu Camera Hook v38 - MinGW Build Script
echo.

where g++ >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: MinGW g++ not found in PATH
    pause
    exit /b 1
)

echo Compiling camera_hook38.dll...
g++ -O2 -shared -o camera_hook38.dll camera_hook38.cpp -static -luser32 -lshell32 -ladvapi32 -lole32 -lwinmm -Wl,--allow-multiple-definition
if %ERRORLEVEL% neq 0 (
    echo Failed to compile camera_hook38.dll
    pause
    exit /b 1
)

echo.
echo Compiling injector38.exe...
g++ -O2 -o injector38.exe injector.cpp -lpsapi
if %ERRORLEVEL% neq 0 (
    echo Failed to compile injector38.exe
    pause
    exit /b 1
)

echo.
echo ========================================
echo Build successful!
echo ========================================
echo.
dir /b camera_hook38.dll injector38.exe 2>nul
echo.

pause
