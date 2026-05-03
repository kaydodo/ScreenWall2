# ============================================================
# Inject-ScanWall2.ps1
# 功能：将 ScanWall2Startup.bat 注入 Windows 镜像（WIM/ESD）
# 用法：以管理员身份运行 powershell -File Inject-ScanWall2.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$SOURCE_BAT = "D:\ScreenWall2\ScanWall2Startup.bat"
$IMAGE_DIR = "D:\备份\WIM"
$WIM_FILE = "$IMAGE_DIR\install.wim"
$MOUNT_DIR = "D:\备份\wim_mount"

if (-not (Test-Path $SOURCE_BAT)) {
    Write-Host "[错误] 源文件不存在: $SOURCE_BAT" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $IMAGE_DIR)) {
    New-Item -ItemType Directory -Path $IMAGE_DIR -Force | Out-Null
}
if (-not (Test-Path $MOUNT_DIR)) {
    New-Item -ItemType Directory -Path $MOUNT_DIR -Force | Out-Null
}

# 1. 检查 ESD 是否已导出为 WIM
if (-not (Test-Path $WIM_FILE)) {
    $ESD_FILES = Get-ChildItem "D:\备份" -Filter "*.esd" -File
    if ($ESD_FILES.Count -eq 0) {
        Write-Host "[错误] 未找到 ESD 文件，请先执行 Export-EscapeFromTarkov.ps1" -ForegroundColor Red
        exit 1
    }
    $ESD_PATH = $ESD_FILES[0].FullName
    Write-Host "[1/6] 导出 ESD → WIM (可能需要5~10分钟)..." -ForegroundColor Cyan
    Write-Host "      ESD: $ESD_PATH"
    dism /Export-Image /SourceImageFile:"$ESD_PATH" /SourceIndex:1 /DestinationImageFile:"$WIM_FILE" /CompressionMethod:max | Out-Null
    Write-Host "[完成] WIM 已导出: $WIM_FILE" -ForegroundColor Green
}

# 2. 挂载 WIM
Write-Host "[2/6] 挂载 WIM (只读检查中)..." -ForegroundColor Cyan
$MOUNT_CHECK = dism /Get-MountedWimInfo 2>&1 | Select-String "Mount Dir.*$([regex]::Escape($MOUNT_DIR))"
if ($MOUNT_CHECK) {
    Write-Host "      WIM 已挂载，跳过挂载步骤" -ForegroundColor Yellow
} else {
    dism /Mount-Wim /WimFile:"$WIM_FILE" /Index:1 /MountDir:"$MOUNT_DIR" /ReadOnly | Out-Null
    Write-Host "[完成] WIM 已挂载到: $MOUNT_DIR" -ForegroundColor Green
}

# 3. 注入 ScreenWall 目录和 BAT 文件
$SETUP_DIR = "$MOUNT_DIR\Windows\Setup\ScreenWall"
if (-not (Test-Path $SETUP_DIR)) {
    New-Item -ItemType Directory -Path $SETUP_DIR -Force | Out-Null
}
Copy-Item "$SOURCE_BAT" "$SETUP_DIR\ScanWall2Startup.bat" -Force
Write-Host "[3/6] BAT 已注入: $SETUP_DIR\ScanWall2Startup.bat" -ForegroundColor Green

# 4. 追加 SetupComplete.cmd（如果不存在则新建）
$SETUP_SCRIPTS = "$MOUNT_DIR\Windows\Setup\Scripts"
if (-not (Test-Path $SETUP_SCRIPTS)) {
    New-Item -ItemType Directory -Path $SETUP_SCRIPTS -Force | Out-Null
}

$SETUPCMD = "$SETUP_SCRIPTS\SetupComplete.cmd"
$BAT_CALL = "call C:\Windows\Setup\ScreenWall\ScanWall2Startup.bat >nul 2>&1"
if (Test-Path $SETUPCMD) {
    $EXISTING = Get-Content $SETUPCMD -Raw -Encoding ASCII
    if ($EXISTING -notmatch "ScanWall2Startup") {
        $EXISTING + "`r`n" + $BAT_CALL | Out-File -FilePath $SETUPCMD -Encoding ASCII -NoNewline
        Write-Host "[4/6] SetupComplete.cmd 已追加调用语句" -ForegroundColor Green
    } else {
        Write-Host "[4/6] SetupComplete.cmd 已有调用语句，跳过" -ForegroundColor Yellow
    }
} else {
    $BAT_CALL | Out-File -FilePath $SETUPCMD -Encoding ASCII -NoNewline
    Write-Host "[4/6] SetupComplete.cmd 已创建" -ForegroundColor Green
}

# 5. 卸载 WIM（提交更改）
Write-Host "[5/6] 卸载 WIM 并提交更改..." -ForegroundColor Cyan
dism /Unmount-Wim /MountDir:"$MOUNT_DIR" /Commit | Out-Null
Write-Host "[完成] WIM 已卸载并保存" -ForegroundColor Green

# 6. 完成
Write-Host ""
Write-Host "========== 注入完成 ==========" -ForegroundColor Green
Write-Host "镜像文件: $WIM_FILE"
Write-Host "注入路径: C:\Windows\Setup\ScreenWall\ScanWall2Startup.bat"
Write-Host "调用方式: Windows 安装完成后自动通过 SetupComplete.cmd 执行"
Write-Host "================================" -ForegroundColor Green