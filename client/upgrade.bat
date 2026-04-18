@echo off
if defined UPGRADE_RUNNING goto :eof
set UPGRADE_RUNNING=1
start "" /B cmd /c "
  echo [1] kill > "%~dp0upgrade.log" ^&^
  echo [2] wait >> "%~dp0upgrade.log" ^&^
  echo [3] copy >> "%~dp0upgrade.log" ^&^
  echo [4] launch >> "%~dp0upgrade.log" ^&^
  echo [5] cleanup >> "%~dp0upgrade.log" ^&^
  taskkill /F /IM ScreenWallClient.exe /T >> "%~dp0upgrade.log" 2^>^&1 ^&^
  ping 127.0.0.1 -n 4 >nul ^&^
  copy /Y "%~dp0ScreenWallClient_new.exe" "%~dp0ScreenWallClient.exe" >> "%~dp0upgrade.log" 2^>^&1 ^&^
  if exist "%~dp0ScreenWallClient.exe" (echo OK >> "%~dp0upgrade.log") else (echo FAIL >> "%~dp0upgrade.log") ^&^
  del "%~dp0ScreenWallClient_new.exe" >> "%~dp0upgrade.log" 2^>^&1 ^&^
  start "" "%~dp0ScreenWallClient.exe" ^&^
  ping 127.0.0.1 -n 2 >nul ^&^
  del "%~dp0upgrade.log" ^&^
  del "%~dp0upgrade.bat"
"
exit
