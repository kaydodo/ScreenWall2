@echo off
cd /d "C:\Program Files\Netease\GameViewer\bin"
set "id=%~1"
set "id=%id:uuycmgr://=%
set "id=%id:/=%
uuycmgr.exe -n %id% qqww5566
