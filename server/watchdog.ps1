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
        
        if ($failCount >= $FailThreshold) {
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] KILLING SERVICE..." | Out-File $Log -Append
            
            $proc = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | 
                    Where-Object { $_.State -eq "Listen" } | 
                    Select-Object -ExpandProperty OwningProcess -Unique
            
            if ($proc) {
                foreach ($p in $proc) {
                    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                    "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Killed PID $p" | Out-File $Log -Append
                }
            } else {
                "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] No process on port $Port, killing all node..." | Out-File $Log -Append
                Stop-Process -Name node -Force -ErrorAction SilentlyContinue
            }
            
            Start-Sleep 2
            
            "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] STARTING SERVICE..." | Out-File $Log -Append
            $newProc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $ServerDir -PassThru
            
            Start-Sleep 3
            
            # 启动后最小化窗口（等待3秒让用户看到启动日志）
            if ($newProc) {
                try {
                    Add-Type @"
                        using System;
                        using System.Runtime.InteropServices;
                        public class Win32 {
                            [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                            [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
                        }
"@
                    # SW_MINIMIZE = 6
                    $hwnd = $newProc.MainWindowHandle
                    if ($hwnd -ne 0) {
                        [Win32]::ShowWindow($hwnd, 6)
                        "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] Window minimized" | Out-File $Log -Append
                    }
                } catch {
                    # 最小化失败不影响服务运行
                }
            }
            
            Start-Sleep 2
            
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