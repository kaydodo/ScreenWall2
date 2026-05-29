# Alist Watchdog
# Keeps alist.exe running automatically

$ErrorActionPreference = "SilentlyContinue"
$Log = "$env:TEMP\alist_watchdog.log"
$StopFile = "$env:TEMP\alist.stop"
$PIDFile = "$env:TEMP\alist_watchdog.pid"
$AlistDir = "D:\alist"
$Port = 5244

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
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] ALIST DOWN, starting..." | Out-File $Log -Append
        $proc = Start-Process -FilePath "alist.exe" -ArgumentList "server" -WorkingDirectory $AlistDir -PassThru -WindowStyle Minimized
        Start-Sleep 2

        $verify = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
        if ($verify) {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] ALIST OK (PID $($proc.Id))" | Out-File $Log -Append
        } else {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] ALIST START FAILED" | Out-File $Log -Append
        }
    }

    Start-Sleep 5
}