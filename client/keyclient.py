"""
ScreenWall KeyClient - 键盘/鼠标模拟客户端
支持键盘按键、左键、右键、滚轮、Shift组合键
"""
import os
import sys
import json
import ctypes
import socket
import threading
import time
import signal

# Base dir (PyInstaller 打包后 sys.executable 指向 exe)
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.argv[0]) or os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(sys.argv[0]) or '.'

# 端口隔离：根据部署目录 hash 生成独立端口
_KEYCLIENT_PORT = 19876 + hash(BASE_DIR) % 1000

# 全局退出标记
_running = True

def _handle_signal(signum, frame):
    global _running
    _running = False

# 注册信号处理（Ctrl+C / 关闭事件）
signal.signal(signal.SIGINT, _handle_signal)
signal.signal(signal.SIGTERM, _handle_signal)

# Windows API
SendInput = ctypes.windll.user32.SendInput
VkKeyScanW = ctypes.windll.user32.VkKeyScanW

# VK码映射（字母键始终填小写，Shift组合键时会正确转换）
VK_CODES = {
    # 字母（SendInput发小写VK=大写值，配合普通按下即可）
    'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46,
    'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
    'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50, 'q': 0x51, 'r': 0x52,
    's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
    'y': 0x59, 'z': 0x5A,
    # 功能键
    'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73,
    'F5': 0x74, 'F6': 0x75, 'F7': 0x76, 'F8': 0x77,
    'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
    # Numpad数字
    'NUMPAD0': 0x60, 'NUMPAD1': 0x61, 'NUMPAD2': 0x62, 'NUMPAD3': 0x63,
    'NUMPAD4': 0x64, 'NUMPAD5': 0x65, 'NUMPAD6': 0x66, 'NUMPAD7': 0x67,
    'NUMPAD8': 0x68, 'NUMPAD9': 0x69,
    # Numpad符号
    'MULTIPLY': 0x6A, 'ADD': 0x6B, 'SUBTRACT': 0x6D, 'DECIMAL': 0x6E, 'DIVIDE': 0x6F,
    # 控制键
    'SHIFT': 0x10, 'CTRL': 0x11, 'ALT': 0x12,
    'BACKSPACE': 0x08, 'TAB': 0x09, 'ENTER': 0x0D, 'ESCAPE': 0x1B,
    'SPACE': 0x20, 'PAGEUP': 0x21, 'PAGEDOWN': 0x22, 'END': 0x23,
    'HOME': 0x24, 'LEFT': 0x25, 'UP': 0x26, 'RIGHT': 0x27, 'DOWN': 0x28,
    'INSERT': 0x2D, 'DELETE': 0x2E, 'CAPITAL': 0x14,  # CapsLock
    'NUMLOCK': 0x90, 'SCROLL': 0x91,
    'PAUSE': 0x13, 'BREAK': 0x13,
}

# 结构体
class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.c_ushort),
        ("wScan", ctypes.c_ushort),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulonglong))
    ]

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", ctypes.c_long),
        ("dy", ctypes.c_long),
        ("mouseData", ctypes.c_ulong),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulonglong))
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", ctypes.c_ulong),
        ("wParamL", ctypes.c_short),
        ("wParamH", ctypes.c_ushort)
    ]

class INPUT_UNION(ctypes.Union):
    _fields_ = [
        ("ki", KEYBDINPUT),
        ("mi", MOUSEINPUT),
        ("hi", HARDWAREINPUT)
    ]

class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_ulong),
        ("ii", INPUT_UNION)
    ]

# 常量
INPUT_KEYBOARD = 1
INPUT_MOUSE = 0
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
# 鼠标常量
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040

SCREEN_W = ctypes.windll.user32.GetSystemMetrics(0)
SCREEN_H = ctypes.windll.user32.GetSystemMetrics(1)


def _abs_xy(x, y):
    """将物理坐标转为绝对坐标 (0~65535)"""
    return (
        int(x * 65535 / SCREEN_W),
        int(y * 65535 / SCREEN_H)
    )


def _send_input(inp):
    SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
    time.sleep(0.01)


def key_press(key):
    """发送普通按键（字母/符号/功能键）"""
    key = key.upper()

    if key in VK_CODES:
        vk = VK_CODES[key]
        scan = 0
        flags = 0
    else:
        # Unicode字符
        vk = 0
        scan = ord(key.upper()) if len(key) == 1 else ord(key)
        flags = KEYEVENTF_UNICODE

    # 按下
    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ii.ki.wVk = vk
    inp.ii.ki.wScan = scan
    inp.ii.ki.dwFlags = flags
    inp.ii.ki.time = 0
    inp.ii.ki.dwExtraInfo = None
    _send_input(inp)

    # 释放
    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ii.ki.wVk = vk
    inp.ii.ki.wScan = scan
    inp.ii.ki.dwFlags = flags | KEYEVENTF_KEYUP
    inp.ii.ki.time = 0
    inp.ii.ki.dwExtraInfo = None
    _send_input(inp)


def key_press_with_shift(key):
    """Shift+按键（如大写字母、符号）"""
    # 按下 Shift
    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ii.ki.wVk = VK_CODES['SHIFT']
    inp.ii.ki.wScan = 0
    inp.ii.ki.dwFlags = 0
    inp.ii.ki.time = 0
    inp.ii.ki.dwExtraInfo = None
    _send_input(inp)

    time.sleep(0.02)

    # 按下目标键
    key_press(key)

    # 释放 Shift
    inp = INPUT()
    inp.type = INPUT_KEYBOARD
    inp.ii.ki.wVk = VK_CODES['SHIFT']
    inp.ii.ki.wScan = 0
    inp.ii.ki.dwFlags = KEYEVENTF_KEYUP
    inp.ii.ki.time = 0
    inp.ii.ki.dwExtraInfo = None
    _send_input(inp)


def mouse_move_abs(x, y):
    """移动鼠标到绝对坐标（物理像素）"""
    ax, ay = _abs_xy(x, y)
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.ii.mi.dx = ax
    inp.ii.mi.dy = ay
    inp.ii.mi.mouseData = 0
    inp.ii.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE
    inp.ii.mi.time = 0
    inp.ii.mi.dwExtraInfo = None
    _send_input(inp)


def mouse_left(x, y):
    """左键点击（移动 + 按下 + 释放）"""
    mouse_move_abs(x, y)
    time.sleep(0.02)

    # 左键按下
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.ii.mi.dx = 0
    inp.ii.mi.dy = 0
    inp.ii.mi.mouseData = 0
    inp.ii.mi.dwFlags = MOUSEEVENTF_LEFTDOWN
    inp.ii.mi.time = 0
    inp.ii.mi.dwExtraInfo = None
    _send_input(inp)

    time.sleep(0.01)

    # 左键释放
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.ii.mi.dx = 0
    inp.ii.mi.dy = 0
    inp.ii.mi.mouseData = 0
    inp.ii.mi.dwFlags = MOUSEEVENTF_LEFTUP
    inp.ii.mi.time = 0
    inp.ii.mi.dwExtraInfo = None
    _send_input(inp)


def mouse_right(x, y):
    """右键点击（移动 + 按下 + 释放）"""
    mouse_move_abs(x, y)
    time.sleep(0.02)

    # 右键按下
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.ii.mi.dx = 0
    inp.ii.mi.dy = 0
    inp.ii.mi.mouseData = 0
    inp.ii.mi.dwFlags = MOUSEEVENTF_RIGHTDOWN
    inp.ii.mi.time = 0
    inp.ii.mi.dwExtraInfo = None
    _send_input(inp)

    time.sleep(0.01)

    # 右键释放
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.ii.mi.dx = 0
    inp.ii.mi.dy = 0
    inp.ii.mi.mouseData = 0
    inp.ii.mi.dwFlags = MOUSEEVENTF_RIGHTUP
    inp.ii.mi.time = 0
    inp.ii.mi.dwExtraInfo = None
    _send_input(inp)


def mouse_scroll(delta):
    """滚轮滚动 delta > 0 上, delta < 0 下（单位：120 = 一格）"""
    inp = INPUT()
    inp.type = INPUT_MOUSE
    inp.ii.mi.dx = 0
    inp.ii.mi.dy = 0
    inp.ii.mi.mouseData = int(delta)  # 正数上，负数下
    inp.ii.mi.dwFlags = MOUSEEVENTF_WHEEL
    inp.ii.mi.time = 0
    inp.ii.mi.dwExtraInfo = None
    _send_input(inp)


# 通信端口
KEYCLIENT_PORT = _KEYCLIENT_PORT


def handle_client(conn, addr):
    """处理客户端连接"""
    try:
        while True:
            data = conn.recv(4096)
            if not data:
                break

            msg = json.loads(data.decode('utf-8'))
            msg_type = msg.get('type')

            if msg_type == 'keyClick':
                key = msg.get('key', '')
                if key:
                    key_press(key)
                    conn.send(b'{"ok": true}')

            elif msg_type == 'mouseClick':
                x = msg.get('x', 0)
                y = msg.get('y', 0)
                mouse_left(x, y)
                conn.send(b'{"ok": true}')

            elif msg_type == 'mouseRight':
                x = msg.get('x', 0)
                y = msg.get('y', 0)
                mouse_right(x, y)
                conn.send(b'{"ok": true}')

            elif msg_type == 'mouseScroll':
                delta = msg.get('delta', 120)  # 默认向上滚一格
                mouse_scroll(delta)
                conn.send(b'{"ok": true}')

            elif msg_type == 'ping':
                conn.send(b'{"ok": true}')

            elif msg_type == 'exit':
                conn.send(b'{"ok": true}')
                global _running
                _running = False

    except Exception as e:
        pass
    finally:
        conn.close()


def start_server():
    """启动TCP服务器"""
    global _running
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('127.0.0.1', KEYCLIENT_PORT))
    sock.listen(5)
    sock.settimeout(1.0)  # 每秒检查一次退出标记

    while _running:
        try:
            conn, addr = sock.accept()
            threading.Thread(target=handle_client, args=(conn, addr), daemon=True).start()
        except socket.timeout:
            continue
        except Exception:
            break

    sock.close()
    sys.exit(0)


if __name__ == '__main__':
    print(f"KeyClient started on port {KEYCLIENT_PORT}")
    start_server()
