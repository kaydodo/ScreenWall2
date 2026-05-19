@echo off
setlocal

set "SDK_VER=10.0.26100.0"
set "WIN_KIT=C:\Program Files (x86)\Windows Kits\10"
set "VS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community"
set "MSVC_VER=14.44.35207"

set "INCLUDE=%WIN_KIT%\Include\%SDK_VER%\um;%WIN_KIT%\Include\%SDK_VER%\shared;%WIN_KIT%\Include\%SDK_VER%\ucrt;%VS_PATH%\VC\Tools\MSVC\%MSVC_VER%\include"
set "LIB=%WIN_KIT%\Lib\%SDK_VER%\um\x64;%WIN_KIT%\Lib\%SDK_VER%\ucrt\x64;%VS_PATH%\VC\Tools\MSVC\%MSVC_VER%\lib\x64"
set "PATH=%VS_PATH%\VC\Tools\MSVC\%MSVC_VER%\bin\Hostx64\x64;%PATH%"

cd /d "D:\ScreenWall2\mumu_camera_hook"

cl.exe /EHsc /O2 /MD injector49.cpp /Fe:injector49.exe /link user32.lib psapi.lib
if exist injector49.exe echo Injector OK
del /q *.obj *.exp *.lib 2>nul
endlocal
