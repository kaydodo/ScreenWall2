import pyautogui
import time
import win32gui
import win32con
import win32process
import psutil

def find_mumu_window():
    def callback(hwnd, windows):
        if win32gui.IsWindowVisible(hwnd):
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            try:
                proc = psutil.Process(pid)
                if 'MuMu' in proc.name():
                    title = win32gui.GetWindowText(hwnd)
                    if title:
                        windows.append((hwnd, title, pid))
            except:
                pass
        return True
    
    windows = []
    win32gui.EnumWindows(callback, windows)
    return windows

def get_window_screenshot(hwnd):
    import win32ui
    import win32con
    from PIL import Image
    
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bottom - top
    
    hwndDC = win32gui.GetWindowDC(hwnd)
    mfcDC = win32ui.CreateDCFromHandle(hwndDC)
    saveDC = mfcDC.CreateCompatibleDC()
    
    saveBitMap = win32ui.CreateBitmap()
    saveBitMap.CreateCompatibleBitmap(mfcDC, width, height)
    saveDC.SelectObject(saveBitMap)
    
    result = saveDC.BitBlt((0, 0), (width, height), mfcDC, (0, 0), win32con.SRCCOPY)
    
    bmpinfo = saveBitMap.GetInfo()
    bmpstr = saveBitMap.GetBitmapBits(True)
    
    im = Image.frombuffer(
        'RGB',
        (bmpinfo['bmWidth'], bmpinfo['bmHeight']),
        bmpstr, 'raw', 'BGRX', 0, 1
    )
    
    win32gui.DeleteObject(saveBitMap.GetHandle())
    saveDC.DeleteDC()
    mfcDC.DeleteDC()
    win32gui.ReleaseDC(hwnd, hwndDC)
    
    return im

def find_camera_dialog():
    windows = find_mumu_window()
    for hwnd, title, pid in windows:
        if 'camera' in title.lower() or '摄像头' in title or '选择' in title:
            return hwnd
    return None

def click_camera_option(hwnd, option_index=0):
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    width = right - left
    height = bottom - top
    
    click_x = left + width // 2
    click_y = top + height // 3 + option_index * 30
    
    pyautogui.click(click_x, click_y)
    print(f"Clicked at ({click_x}, {click_y})")
    
    time.sleep(0.5)
    
    confirm_y = top + height - 50
    pyautogui.click(click_x, confirm_y)
    print(f"Clicked confirm at ({click_x}, {confirm_y})")

def main():
    print("MuMu Camera Auto-Clicker")
    print("Waiting for camera dialog...")
    
    while True:
        hwnd = find_camera_dialog()
        if hwnd:
            print(f"Found camera dialog: {win32gui.GetWindowText(hwnd)}")
            click_camera_option(hwnd)
            print("Clicked camera option")
        
        time.sleep(1)

if __name__ == "__main__":
    main()
