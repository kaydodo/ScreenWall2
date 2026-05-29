@echo off
REM Alist Watchdog - Single file version
REM Copy this file to D:\alist directory

cd /d "D:\alist"

echo Starting Alist watchdog...
echo Log file: %TEMP%\alist_watchdog.log

powershell -WindowStyle Hidden -ExecutionPolicy Bypass -Command ^
"& { ^
   $Log = Join-Path $env:TEMP 'alist_watchdog.log'; ^
   '=========================================' | Out-File $Log -Force; ^
   '[$(Get-Date -Format \"yyyy/MM/dd HH:mm:ss\")] Watchdog started' | Out-File $Log -Append; ^
   while ($true) { ^
     $alist = Get-Process -Name alist -ErrorAction SilentlyContinue; ^
     if (-not $alist) { ^
       '[$(Get-Date -Format \"yyyy/MM/dd HH:mm:ss\")] alist not running, starting...' | Out-File $Log -Append; ^
       Start-Process -FilePath 'alist.exe' -ArgumentList 'server' -WorkingDirectory 'D:\alist' -WindowStyle Minimized; ^
       Start-Sleep 3; ^
       $check = Get-Process -Name alist -ErrorAction SilentlyContinue; ^
       if ($check) { '[$(Get-Date -Format \"yyyy/MM/dd HH:mm:ss\")] alist started OK' | Out-File $Log -Append } ^
       else { '[$(Get-Date -Format \"yyyy/MM/dd HH:mm:ss\")] alist start FAILED' | Out-File $Log -Append } ^
     }; ^
     Start-Sleep 5 ^
   } ^
}"

exit