import ctypes
from ctypes import wintypes

# Windows API structures and constants
class DEVMODE(ctypes.Structure):
    _fields_ = [
        ("dmDeviceName", wintypes.WCHAR * 32),
        ("dmSpecVersion", wintypes.WORD),
        ("dmDriverVersion", wintypes.WORD),
        ("dmSize", wintypes.WORD),
        ("dmDriverExtra", wintypes.WORD),
        ("dmFields", wintypes.DWORD),
        ("dmPositionX", ctypes.c_long),
        ("dmPositionY", ctypes.c_long),
        ("dmDisplayOrientation", wintypes.DWORD),
        ("dmDisplayFixedOutput", wintypes.DWORD),
        ("dmColor", wintypes.SHORT),
        ("dmDuplex", wintypes.SHORT),
        ("dmYResolution", wintypes.SHORT),
        ("dmTTOption", wintypes.SHORT),
        ("dmCollate", wintypes.SHORT),
        ("dmFormName", wintypes.WCHAR * 32),
        ("dmLogPixels", wintypes.SHORT),
        ("dmBitsPerPel", wintypes.DWORD),
        ("dmPelsWidth", wintypes.DWORD),
        ("dmPelsHeight", wintypes.DWORD),
        ("dmDisplayFlags", wintypes.DWORD),
        ("dmDisplayFrequency", wintypes.DWORD),
        ("dmICMMethod", wintypes.DWORD),
        ("dmICMIntent", wintypes.DWORD),
        ("dmMediaType", wintypes.DWORD),
        ("dmDitherType", wintypes.DWORD),
        ("dmReserved1", wintypes.DWORD),
        ("dmReserved2", wintypes.DWORD),
        ("dmPanningWidth", wintypes.DWORD),
        ("dmPanningHeight", wintypes.DWORD),
    ]

# Constants
ENUM_CURRENT_SETTINGS = -1
CDS_UPDATEREGISTRY = 0x01
CDS_RESET = 0x40000000
DISP_CHANGE_SUCCESSFUL = 0

# Load user32.dll
user32 = ctypes.windll.user32

def enum_display_settings(device_name, mode_num, dev_mode):
    return user32.EnumDisplaySettingsW(device_name, mode_num, ctypes.byref(dev_mode))

def change_display_settings(dev_mode, flags):
    return user32.ChangeDisplaySettingsW(ctypes.byref(dev_mode), flags)

def main():
    print("=" * 50)
    print("  Python Display Settings Tool")
    print("=" * 50)
    print("  Target: 1920x1080 @ 60Hz")
    print("=" * 50)
    print()

    # Get current settings
    current = DEVMODE()
    current.dmSize = ctypes.sizeof(DEVMODE)
    if enum_display_settings(None, ENUM_CURRENT_SETTINGS, current):
        print(f"Current: {current.dmPelsWidth}x{current.dmPelsHeight} @ {current.dmDisplayFrequency}Hz")
        print()

        if (current.dmPelsWidth == 1920 and 
            current.dmPelsHeight == 1080 and 
            current.dmDisplayFrequency == 60):
            print("Already at target resolution!")
            print()
            input("Press Enter to exit...")
            return

    # Find the target mode
    print("Looking for 1920x1080 @ 60Hz...")
    print()

    target_mode = None
    mode_num = 0
    while True:
        dm = DEVMODE()
        dm.dmSize = ctypes.sizeof(DEVMODE)
        if not enum_display_settings(None, mode_num, dm):
            break

        if (dm.dmPelsWidth == 1920 and 
            dm.dmPelsHeight == 1080 and 
            dm.dmDisplayFrequency == 60):
            print(f"FOUND! Mode found at index {mode_num}")
            print(f"  Bits: {dm.dmBitsPerPel}, Flags: {dm.dmDisplayFlags}")
            target_mode = dm
            break

        mode_num += 1

    if target_mode is None:
        print("ERROR: Mode 1920x1080 @ 60Hz not found!")
        print()
        print("Available modes:")
        mode_num = 0
        while True:
            dm = DEVMODE()
            dm.dmSize = ctypes.sizeof(DEVMODE)
            if not enum_display_settings(None, mode_num, dm):
                break
            print(f"  {dm.dmPelsWidth}x{dm.dmPelsHeight} @ {dm.dmDisplayFrequency}Hz")
            mode_num += 1
        print()
        input("Press Enter to exit...")
        return

    # Apply the changes
    print()
    print("Applying changes... ", end="", flush=True)

    result = change_display_settings(target_mode, CDS_UPDATEREGISTRY | CDS_RESET)

    if result == DISP_CHANGE_SUCCESSFUL:
        print("SUCCESS!")
        print()
        print("Display changed to 1920x1080 @ 60Hz!")
    else:
        print(f"FAILED! Code: {result}")

    print()
    input("Press Enter to exit...")

if __name__ == "__main__":
    main()
