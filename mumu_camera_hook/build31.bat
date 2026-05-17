@echo off
set "SDK_VER=10.0.26100.0"
set "WIN_KIT=C:\Program Files (x86)\Windows Kits\10"
set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"
set "MSVC_VER=14.44.35207"

set "INCLUDE=C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\um;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.26100.0\ucrt;C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\include;D:\ScreenWall2\mumu_camera_hook\minhook\include;D:\ScreenWall2\mumu_camera_hook"
set "LIB=C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\um\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.26100.0\ucrt\x64;C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\lib\x64;D:\ScreenWall2\mumu_camera_hook\minhook\lib\native\lib;D:\ScreenWall2\mumu_camera_hook"
set "PATH=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64;%PATH%"

cd /d "D:\ScreenWall2\mumu_camera_hook"

echo Building camera_hook31.dll...
cl.exe /EHsc /O2 /MD /LD camera_hook31.cpp /Fe:camera_hook31.dll /link user32.lib shell32.lib advapi32.lib ole32.lib libMinHook-x64-v141-md.lib hid.lib
if exist camera_hook31.dll (
    echo DLL build successful!
) else (
    echo DLL build failed!
    exit /b 1
)

echo.
echo Building injector31.exe...
cl.exe /EHsc /O2 /MD injector.cpp /Fe:injector31.exe /link
if exist injector31.exe (
    echo Injector build successful!
) else (
    echo Injector build failed!
    exit /b 1
)

echo.
del /q *.obj *.exp *.lib 2>nul

echo Done.
dir camera_hook31.dll injector31.exe