Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class DisplaySettings
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int ChangeDisplaySettingsEx(string deviceName, ref DEVMODE devMode, IntPtr hwnd, uint flags, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public short dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    public const int ENUM_CURRENT_SETTINGS = -1;
    public const int ENUM_REGISTRY_SETTINGS = -2;
    public const int DM_PELSWIDTH = 0x00080000;
    public const int DM_PELSHEIGHT = 0x00100000;
    public const int DM_DISPLAYFREQUENCY = 0x00400000;
    public const int DM_BITSPERPEL = 0x00040000;
    public const int CDS_UPDATEREGISTRY = 0x01;
    public const int CDS_TEST = 0x04;
    public const int CDS_RESET = 0x40000000;
    public const int CDS_FULLSCREEN = 0x04;
    public const int DISP_CHANGE_SUCCESSFUL = 0;
    public const int DISP_CHANGE_RESTART = 1;
    public const int DISP_CHANGE_FAILED = -1;
    public const int DISP_CHANGE_BADMODE = -2;
    public const int DISP_CHANGE_NOTUPDATED = -3;
    public const int DISP_CHANGE_BADFLAGS = -4;
    public const int DISP_CHANGE_BADPARAM = -5;
    public const int DISP_CHANGE_BADDUALVIEW = -6;
}
"@

Write-Host "=================================================="
Write-Host "  Windows Display Settings Tool"
Write-Host "=================================================="
Write-Host "  Target: 1920x1080 @ 60Hz"
Write-Host "=================================================="
Write-Host ""

$devMode = New-Object DisplaySettings+DEVMODE
$devMode.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($devMode)

Write-Host "Step 1/3: Reading current settings..."
$result = [DisplaySettings]::EnumDisplaySettings($null, [DisplaySettings]::ENUM_CURRENT_SETTINGS, [ref]$devMode)
if (-not $result) {
    Write-Host "FAILED to read current settings!"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  Current: $($devMode.dmPelsWidth)x$($devMode.dmPelsHeight) @ $($devMode.dmDisplayFrequency)Hz"
Write-Host ""

if ($devMode.dmPelsWidth -eq 1920 -and $devMode.dmPelsHeight -eq 1080 -and $devMode.dmDisplayFrequency -eq 60) {
    Write-Host "Already at target resolution!"
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 0
}

$devMode.dmPelsWidth = 1920
$devMode.dmPelsHeight = 1080
$devMode.dmDisplayFrequency = 60
$devMode.dmFields = [DisplaySettings]::DM_PELSWIDTH -bor [DisplaySettings]::DM_PELSHEIGHT -bor [DisplaySettings]::DM_DISPLAYFREQUENCY

Write-Host "Step 2/3: Testing display mode..."
$testResult = [DisplaySettings]::ChangeDisplaySettingsEx($null, [ref]$devMode, [IntPtr]::Zero, [DisplaySettings]::CDS_TEST, [IntPtr]::Zero)
if ($testResult -ne [DisplaySettings]::DISP_CHANGE_SUCCESSFUL) {
    Write-Host "FAILED! Test result: $testResult"
    if ($testResult -eq [DisplaySettings]::DISP_CHANGE_BADMODE) {
        Write-Host "  Error: This display mode is not supported!"
    }
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  OK"
Write-Host ""

Write-Host "Step 3/3: Applying changes..."
$applyResult = [DisplaySettings]::ChangeDisplaySettingsEx($null, [ref]$devMode, [IntPtr]::Zero, [DisplaySettings]::CDS_UPDATEREGISTRY -bor [DisplaySettings]::CDS_RESET, [IntPtr]::Zero)
Write-Host "  Apply result: $applyResult"

if ($applyResult -eq [DisplaySettings]::DISP_CHANGE_SUCCESSFUL) {
    Write-Host ""
    Write-Host "SUCCESS! Display changed to 1920x1080 @ 60Hz"
} elseif ($applyResult -eq [DisplaySettings]::DISP_CHANGE_RESTART) {
    Write-Host ""
    Write-Host "SUCCESS! Changes will take effect after restart."
} else {
    Write-Host ""
    Write-Host "FAILED! Error code: $applyResult"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Read-Host "Press Enter to exit"
