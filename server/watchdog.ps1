# ScreenWall Watchdog (Enhanced)
# Checks HTTP health endpoint instead of just port

$ErrorActionPreference = "SilentlyContinue"
$Log = "$env:TEMP\sw_server_watchdog.log"
$StopFile = "$env:TEMP\sw_server.stop"
$PIDFile = "$env:TEMP\sw_watchdog.pid"
$ServerDir = "D:\ScreenWall2\server"
$Port = 3000
$HealthUrl = "http://localhost:$Port/_health"
$HealthTimeout = 5
$FailThreshold = 2

$MyPID = $PID
$MyPID | Out-File -FilePath $PIDFile -Encoding ASCII

$null > $Log
"=========================================" | Out-File $Log -Append
"[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] WATCHDOG START (PID $MyPID)" | Out-File $Log -Append
"[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Health URL: $HealthUrl" | Out-File $Log -Append

$failCount = 0

while ($true) {
    if (Test-Path $StopFile) {
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] STOP signal, exiting" | Out-File $Log -Append
        Remove-Item $StopFile -Force -ErrorAction SilentlyContinue
        Remove-Item $PIDFile -Force -ErrorAction SilentlyContinue
        break
    }

    # 先检查端口是否监听（快速判断服务是否运行）
    $portInUse = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
    
    if (-not $portInUse) {
        # 服务完全没有运行，立即启动（不需要等待2次失败）
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER DOWN, starting..." | Out-File $Log -Append
        $newProc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ServerDir -PassThru -WindowStyle Minimized
        
        Start-Sleep 3
        
        try {
            $verify = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec $HealthTimeout -UseBasicParsing -ErrorAction Stop
            if ($verify.StatusCode -eq 200) {
                "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER OK (PID $($newProc.Id))" | Out-File $Log -Append
            } else {
                "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER START FAILED (status $($verify.StatusCode))" | Out-File $Log -Append
            }
        } catch {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVER START FAILED (no response)" | Out-File $Log -Append
        }
        
        $failCount = 0
        Start-Sleep 5
        continue
    }

    # 端口监听中，检查健康状态（检测假死）
    $healthOk = $false
    $statusCode = 0
    
    try {
        $response = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec $HealthTimeout -UseBasicParsing -ErrorAction Stop
        $statusCode = $response.StatusCode
        if ($statusCode -eq 200) {
            $healthOk = $true
            $failCount = 0
        } elseif ($statusCode -eq 503) {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] HEALTH 503 - event loop blocked" | Out-File $Log -Append
        }
    } catch {
        $errorMsg = $_.Exception.Message
        if ($errorMsg -match "timed out") {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] HEALTH TIMEOUT - service frozen" | Out-File $Log -Append
        } else {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] HEALTH FAILED - $errorMsg" | Out-File $Log -Append
        }
    }

    if (-not $healthOk) {
        $failCount++
        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Fail count: $failCount/$FailThreshold" | Out-File $Log -Append
        
        if ($failCount -ge $FailThreshold) {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] KILLING SERVICE (frozen)..." | Out-File $Log -Append
            
            $proc = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | 
                    Where-Object { $_.State -eq "Listen" } | 
                    Select-Object -ExpandProperty OwningProcess -Unique
            
            if ($proc) {
                foreach ($p in $proc) {
                    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                    "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Killed PID $p" | Out-File $Log -Append
                }
            } else {
                Stop-Process -Name node -Force -ErrorAction SilentlyContinue
            }
            
            Start-Sleep 2
            
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] STARTING SERVICE..." | Out-File $Log -Append
            $newProc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ServerDir -PassThru -WindowStyle Minimized
            
            Start-Sleep 3
            
            try {
                $verify = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec $HealthTimeout -UseBasicParsing -ErrorAction Stop
                if ($verify.StatusCode -eq 200) {
                    "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVICE OK (PID $($newProc.Id))" | Out-File $Log -Append
                } else {
                    "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVICE START FAILED (status $($verify.StatusCode))" | Out-File $Log -Append
                }
            } catch {
                "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] SERVICE START FAILED (no response)" | Out-File $Log -Append
            }
            
            $failCount = 0
        }
    }

    Start-Sleep 5
}

Remove-Item $PIDFile -Force -ErrorAction SilentlyContinue
"[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] WATCHDOG EXIT" | Out-File $Log -Append