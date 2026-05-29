$ErrorActionPreference = "SilentlyContinue"
$Log = Join-Path $env:TEMP "alist_watchdog.log"
$PIDFile = Join-Path $env:TEMP "alist_watchdog.pid"
$StopFile = Join-Path $env:TEMP "alist.stop"
$AlistDir = "D:\alist"

$PID | Out-File $PIDFile -Force
"=========================================" | Out-File $Log -Force
"[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Watchdog started (PID $PID)" | Out-File $Log -Append

while ($true) {
    if (Test-Path $StopFile) {
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Stop signal received, exiting" | Out-File $Log -Append
        Remove-Item $StopFile -Force -ErrorAction SilentlyContinue
        Remove-Item $PIDFile -Force -ErrorAction SilentlyContinue
        break
    }
    
    $alist = Get-Process -Name alist -ErrorAction SilentlyContinue
    
    if (-not $alist) {
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] alist not running, starting..." | Out-File $Log -Append
        Start-Process -FilePath "alist.exe" -ArgumentList "server" -WorkingDirectory $AlistDir -WindowStyle Minimized
        Start-Sleep 3
        
        $check = Get-Process -Name alist -ErrorAction SilentlyContinue
        if ($check) {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] alist started OK (PID $($check.Id))" | Out-File $Log -Append
        } else {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] alist start FAILED" | Out-File $Log -Append
        }
    }
    
    Start-Sleep 5
}