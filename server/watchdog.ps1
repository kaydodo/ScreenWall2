# ScreenWall Watchdog
# Keeps node server.js running automatically

$ErrorActionPreference = "SilentlyContinue"
$Log = "$env:TEMP\sw_server_watchdog.log"
$StopFile = "$env:TEMP\sw_server.stop"
$PIDFile = "$env:TEMP\sw_watchdog.pid"
$ServerDir = "D:\ScreenWall\server"
$Port = 3000

# Record this watchdog PID so stop.bat can kill us
$MyPID = $PID
$MyPID | Out-File -FilePath $PIDFile -Encoding ASCII

$null > $Log
"=========================================" | Out-File $Log -Append
"[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] WATCHDOG START (PID $MyPID)" | Out-File $Log -Append

while ($true) {
    if (Test-Path $StopFile) {
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] STOP signal, exiting" | Out-File $Log -Append
        Remove-Item $StopFile -Force -ErrorAction SilentlyContinue
        Remove-Item $PIDFile -Force -ErrorAction SilentlyContinue
        break
    }

    $portInUse = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }

    if (-not $portInUse) {
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER DOWN, starting..." | Out-File $Log -Append
        $proc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ServerDir -PassThru -WindowStyle Minimized
        Start-Sleep 2

        $verify = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
        if ($verify) {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER OK (PID $($proc.Id))" | Out-File $Log -Append
        } else {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER START FAILED" | Out-File $Log -Append
        }
    }

    Start-Sleep 5
}
