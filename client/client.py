"""
Screen Wall Client - System Tray Edition
- System tray icon for easy exit
- Auto screenshot with mss+PIL dual fallback
- Config hot-reload
- UU Remote via uuycmgr.exe -d (gets numeric connection ID)
- Connection idle kill (5min)
- Auto-start on Windows boot (default: ON)
"""
import asyncio
import getpass
import json
import os
import re
import sys
import uuid
import time
import webbrowser

# 客户端版本号（每次功能更新时手动递增）
CLIENT_VERSION = "1.3.15"


def has_key_client():
    """检测 KeyClient.exe 是否存在于 exe 同目录下"""
    exe_dir = os.path.dirname(sys.argv[0]) or '.'
    # 检查同目录下（旧模式）、KeyClient 子目录下（旧目录模式）、_internal 子目录下（新模式）
    path1 = os.path.join(exe_dir, 'KeyClient.exe')
    path2 = os.path.join(exe_dir, 'KeyClient', 'KeyClient.exe')
    path3 = os.path.join(exe_dir, '_internal', 'KeyClient.exe')
    return os.path.exists(path1) or os.path.exists(path2) or os.path.exists(path3)


def _get_all_monitors():
    """返回所有物理显示器列表 [(index, left, top, width, height), ...]"""
    try:
        import mss
        sct = mss.mss()
        monitors = sct.monitors
        sct.close()
        # monitors[0] 是虚拟全屏(合并所有显示器)，跳过它
        return [
            (i + 1, m["left"], m["top"], m["width"], m["height"])
            for i, m in enumerate(monitors[1:])
        ]
    except Exception:
        return [(1, 0, 0, 1920, 1080)]


def _get_current_monitor_offset():
    """返回当前选中显示器的偏移量 (offset_x, offset_y, width, height)"""
    try:
        import mss
        sct = mss.mss()
        monitors = sct.monitors
        sct.close()
        idx = min(_current_monitor_index, len(monitors) - 1)
        if idx < 1:
            idx = 1
        m = monitors[idx]
        return m["left"], m["top"], m["width"], m["height"]
    except Exception:
        return 0, 0, 1920, 1080


# 当前选中的显示器索引（1-based，1=主显示器）
_current_monitor_index = 1


def _switch_monitor(idx):
    """切换到指定显示器（1-based），持久化并广播"""
    global _current_monitor_index
    try:
        monitors = _get_all_monitors()
        if idx < 1 or idx > len(monitors):
            idx = 1
        _current_monitor_index = idx
        cfg = load_config()
        cfg["monitorIndex"] = idx
        save_config(cfg)
    except Exception as e:
        pass
    try:
        client = getattr(sys, '_client_instance', None)
        if client:
            client._on_monitor_switch(idx)
    except Exception as e:
        pass
    try:
        _rebuild_tray_icon()
    except Exception as e:
        pass


def _roundrect(canvas, x1, y1, x2, y2, r, **kwargs):
    """兼容旧版 tkinter 的圆角矩形（在 tk 8.7+ 可用 canvas.create_roundrect）"""
    def _arc(x, y, reverse=False):
        canvas.create_arc(x, y, x + 2*r, y + 2*r, start=0 if not reverse else 90,
                         extent=90, style="arc", **kwargs)
    def _line(x1, y1, x2, y2):
        canvas.create_line(x1, y1, x2, y2, **kwargs)
    _arc(x1, y1)
    _arc(x2 - 2*r, y2 - 2*r, reverse=True)
    _arc(x2 - 2*r, y1, reverse=True)
    _arc(x1, y2 - 2*r)
    _line(x1 + r, y1, x2 - r, y1)
    _line(x2, y1 + r, x2, y2 - r)
    _line(x2 - r, y2, x1 + r, y2)
    _line(x1, y2 - r, x1, y1 + r)
import hashlib
import base64
import subprocess
import threading
import winreg
import tempfile
import shutil
from pathlib import Path
from io import BytesIO
try:
    from pystray import Icon, MenuItem, Menu
    from PIL import Image as PILImage, ImageDraw
except ImportError:
    PILImage = None
    Icon = None
    MenuItem = None
    Menu = None
try:
    import tkinter as tk
    from tkinter import font as tkfont
    _TK_AVAILABLE = True
except Exception:
    _TK_AVAILABLE = False

# ── Single Instance Lock ─────────────────────────────────
# 使用 Windows mutex 确保只有一个实例在运行
try:
    import win32event
    import win32api
    _instance_mutex = win32event.CreateMutex(None, False, "ScreenWallClient_SingleInstance_Mutex")
    if win32api.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        sys.exit(0)
except Exception:
    _instance_mutex = None

# 获取程序所在目录（exe运行时从exe路径获取，源码运行时从脚本路径获取）
# 这个必须放在最前面，因为LOG_FILE和CONFIG_PATH都需要用到
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 当前登录用户名（多用户区分用，deviceId/deviceName 加后缀）
_CURRENT_USER = getpass.getuser().strip() or "default"

# 配置文件路径（每个部署目录独立，不做用户维度隔离）
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

# KeyClient 端口（固定端口，所有客户端共用）
_KEYCLIENT_PORT = 19876

# ── Config ──────────────────────────────────────────────
def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                return cfg
        except Exception as e:
            pass
    return {}


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)


def read_ini_section(filepath):
    """读取INI文件，返回 {section: {key: value}}"""
    result = {}
    current_section = "General"
    if not os.path.exists(filepath):
        return result
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith(";"):
                    continue
                if line.startswith("[") and line.endswith("]"):
                    current_section = line[1:-1]
                    result[current_section] = {}
                elif "=" in line:
                    key, _, val = line.partition("=")
                    result.setdefault(current_section, {})[key.strip()] = val.strip()
    except Exception:
        pass
    return result


# ── Auto-Start Management ────────────────────────────────
APP_NAME = "ScreenWallClient"
EXE_PATH = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)

def is_auto_start_enabled():
    """检查是否已开启开机自启"""
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_READ)
        try:
            winreg.QueryValueEx(key, APP_NAME)
            winreg.CloseKey(key)
            return True
        except FileNotFoundError:
            winreg.CloseKey(key)
            return False
    except Exception:
        return False


def set_auto_start(enable):
    """设置开机自启"""
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0, winreg.KEY_WRITE)
        if enable:
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{EXE_PATH}" --minimized')
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except FileNotFoundError:
                pass
        winreg.CloseKey(key)
        return True
    except Exception:
        return False


def _get_keyboard_enabled():
    """从注册表读取"启动键盘"状态，默认 False"""
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\ScreenWallClient", 0, winreg.KEY_READ)
        try:
            val, _ = winreg.QueryValueEx(key, "KeyboardEnabled")
            winreg.CloseKey(key)
            return bool(val)
        except FileNotFoundError:
            winreg.CloseKey(key)
            return False
    except Exception:
        return False


def _set_keyboard_enabled(enabled):
    """保存"启动键盘"状态到注册表"""
    try:
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\ScreenWallClient")
        winreg.SetValueEx(key, "KeyboardEnabled", 0, winreg.REG_DWORD, 1 if enabled else 0)
        winreg.CloseKey(key)
        return True
    except Exception:
        return False


# ── Task Bubble Windows ──────────────────────────────────
# 管理当前显示的任务泡泡弹窗列表
_task_bubbles = {}           # task_id -> Toplevel
_task_bubble_heights = {}    # task_id -> height in px（动态高度）
_task_bubbles_lock = threading.Lock()
_BUBBLE_WIDTH = 280          # 窗口宽度（缩小便于缩进）
_BUBBLE_H_PADDING = 20       # 水平内边距
_BUBBLE_BASE_HEIGHT = 82    # 基准高度（frame 内内容+底部行+pad: 40+30+12）
_BUBBLE_LINE_HEIGHT = 22    # 每行内容增加的像素
_BUBBLE_MAX_HEIGHT = 180    # 最大高度（内容最多5行）
_BUBBLE_WIN_PAD = 2         # 窗口外层 padding（制造描边+圆角）
_BUBBLE_MARGIN = 50         # 与屏幕右边距（避免挡住任务栏）
_BUBBLE_BOTTOM = 200        # 与屏幕底部边距（整体向上500px）
_BUBBLE_GAP = 8             # 泡泡之间的间距
_BUBBLE_CONTENT_H = 100     # 内容区高度（足够显示约5行不滚动）
_tk_root = None             # 隐藏主窗口（用于 after() 调度）
_tk_lock = threading.Lock()

def _get_tk_root():
    """获取或创建隐藏的 Tk 主窗口（线程安全）"""
    global _tk_root
    if _tk_root is not None:
        try:
            _tk_root.winfo_exists()
            return _tk_root
        except Exception:
            _tk_root = None
    try:
        root = tk.Tk()
        root.withdraw()           # 隐藏主窗口
        root.attributes("-alpha", 0)  # 完全透明
        root.attributes("-topmost", True)  # 置顶
        root.overrideredirect(True)
        # 移到屏幕外
        root.geometry(f"1x1+0-{1}")
        _tk_root = root
        return root
    except Exception:
        return None

def _calc_bubble_height(content):
    """根据内容长度计算泡泡高度（无标题：内容+底部固定行+padding）"""
    WL = _BUBBLE_WIDTH - _BUBBLE_H_PADDING * 2
    chars_per_line = WL // 11  # wraplength / 约11px per char
    lines = max(1, (len(content) + chars_per_line - 1) // chars_per_line)
    # _BUBBLE_BASE_HEIGHT=82 包含: 内容40px + 底部行30px + pady 12px
    h = _BUBBLE_BASE_HEIGHT + lines * _BUBBLE_LINE_HEIGHT
    return min(h, _BUBBLE_MAX_HEIGHT)

def _get_bubble_y(task_id, index):
    """计算第 index 个泡泡的 y 坐标（从底部往上堆叠，第一个泡泡在最下方）"""
    try:
        screen_h = _tk_root.winfo_screenheight() if _tk_root else 1080
    except Exception:
        screen_h = 1080
    # 从底部往上累计
    total = _BUBBLE_BOTTOM
    with _task_bubbles_lock:
        keys = list(_task_bubbles.keys())
    # 找到当前 task_id 的索引
    actual_idx = -1
    for i, k in enumerate(keys):
        if k == task_id:
            actual_idx = i
            break
    # 累计在当前泡泡之前的所有泡泡高度（它们在当前泡泡上方）
    # actual_idx=0 时表示第一个泡泡（最下方），total = _BUBBLE_BOTTOM
    # actual_idx=1 时表示第二个泡泡，需要加上第一个的高度
    for i in range(actual_idx):
        k = keys[i]
        total += _task_bubble_heights.get(k, _BUBBLE_BASE_HEIGHT) + _BUBBLE_GAP
    return screen_h - total

def _reposition_bubbles():
    """重新排列所有泡泡位置"""
    if not _TK_AVAILABLE:
        return
    with _task_bubbles_lock:
        items = list(_task_bubbles.items())
    for i, (task_id, win) in enumerate(items):
        try:
            h = _task_bubble_heights.get(task_id, _BUBBLE_BASE_HEIGHT)
            y = _get_bubble_y(task_id, i)
            try:
                screen_w = _tk_root.winfo_screenwidth() if _tk_root else 1920
            except Exception:
                screen_w = 1920
            x = screen_w - _BUBBLE_WIDTH - _BUBBLE_MARGIN
            win.geometry(f"{_BUBBLE_WIDTH}x{h}+{x}+{y}")
        except Exception:
            pass

def show_task_bubble(task_id, content, timestamp, ws, device_id):
    if not _TK_AVAILABLE:
        return
    # 避免重复创建
    with _task_bubbles_lock:
        if task_id in _task_bubbles:
            return

    # 时间戳格式化
    try:
        from datetime import datetime
        dt = datetime.fromtimestamp(timestamp / 1000) if timestamp > 1e10 else datetime.fromtimestamp(timestamp)
        time_str = dt.strftime("%m/%d %H:%M")
    except Exception:
        time_str = ""

    # 内容区宽度
    WL = _BUBBLE_WIDTH - _BUBBLE_H_PADDING * 2
    line_count = 1

    # 内容区高度固定（约3行）
    canvas_h = 72  # 约3行
    win_h = canvas_h + 14 + 40  # 内容区 + padding + 底部行
    win_w = _BUBBLE_WIDTH

    root = _get_tk_root()
    if root is None:
        return

    win = tk.Toplevel(root)
    win.overrideredirect(True)
    win.attributes("-topmost", True)
    win.attributes("-alpha", 0.97)
    win.resizable(False, False)

    # 避免超出屏幕
    sw = root.winfo_screenwidth()
    sh = root.winfo_screenheight()
    idx = len([w for w in _task_bubbles.values() if w.winfo_exists()])
    x = sw - win_w - _BUBBLE_MARGIN
    y = sh - _BUBBLE_BOTTOM - (idx + 1) * (win_h + _BUBBLE_GAP)
    x = max(0, min(x, sw - win_w))
    y = max(0, y)
    win.geometry(f"{win_w}x{win_h}+{x}+{y}")

    # 浅色背景 + 绿色边框
    win.configure(bg="#e8e8e8", bd=2, highlightbackground="#2ea043", highlightthickness=2)

    # place 填满
    frame = tk.Frame(win, bg="#e8e8e8")
    frame.place(x=0, y=0, relwidth=1.0, relheight=1.0)

    # 内容器
    inner = tk.Frame(frame, bg="#e8e8e8")
    inner.pack(fill="both", expand=True)

    # Text 小部件（固定高度，不滚动）
    txt_w = WL + 36
    content_text = tk.Text(inner, fg="#000000", bg="#e8e8e8",
                            font=("Microsoft YaHei", 9), wrap="word",
                            relief="flat", bd=0, highlightthickness=0,
                            width=int(txt_w / 9), height=4,
                            cursor="arrow", padx=3)
    content_text.insert("1.0", content)
    content_text.bind("<Key>", lambda e: "break")
    content_text.bind("<Button-1>", lambda e: "break")
    content_text.pack(fill="x", padx=_BUBBLE_H_PADDING, pady=(10, 4))

    # 底部行（时间戳左 + 按钮右，固定在底部）
    bottom_frame = tk.Frame(inner, bg="#e8e8e8")
    bottom_frame.pack(side="bottom", fill="x", padx=_BUBBLE_H_PADDING, pady=(4, 6))

    tk.Label(bottom_frame, text=time_str, fg="#666666", bg="#e8e8e8",
             font=("Microsoft YaHei", 8)).pack(side="left")

    # 按钮（绿色，靠右，无左边白条）
    btn_frame = tk.Frame(bottom_frame, bg="#2ea043", cursor="hand2", relief="flat", bd=0)
    btn_frame.pack(side="right")

    def accept():
        loop = getattr(sys, "_client_loop", None)
        if loop and ws:
            async def _send():
                try:
                    await ws.send(json.dumps({
                        "type":     "acceptTask",
                        "taskId":   task_id,
                        "deviceId": device_id,
                    }))
                except Exception:
                    pass
            asyncio.run_coroutine_threadsafe(_send(), loop)
        close_task_bubble(task_id)

    btn_label = tk.Label(btn_frame, text="✓ 接受任务", fg="#ffffff", bg="#2ea043", relief="flat", bd=0,
                          font=("Microsoft YaHei", 9), cursor="hand2")
    btn_label.pack(padx=10, pady=4)
    
    # 按钮点击和悬停效果
    def _on_btn_enter(e):
        btn_frame.configure(bg="#258039")
        btn_label.configure(bg="#258039")
    def _on_btn_leave(e):
        btn_frame.configure(bg="#2ea043")
        btn_label.configure(bg="#2ea043")
    def _on_btn_click(e):
        accept()
    
    btn_label.bind("<Enter>", _on_btn_enter)
    btn_label.bind("<Leave>", _on_btn_leave)
    btn_label.bind("<Button-1>", _on_btn_click)
    btn_frame.bind("<Button-1>", _on_btn_click)

    # 记录并刷新位置（新消息插到 keys 末尾，最新在最上面）
    with _task_bubbles_lock:
        # 把新消息放到字典末尾（Python 3.7+ 保持插入顺序）
        if task_id not in _task_bubbles:
            _task_bubbles[task_id] = win
            _task_bubble_heights[task_id] = win_h
        else:
            # 已存在则更新高度并移到末尾
            existing = _task_bubbles.pop(task_id)
            _task_bubbles[task_id] = win
            _task_bubble_heights[task_id] = win_h
    _reposition_bubbles()

    # 新消息从下方弹入动画
    def _slide_up():
        try:
            cur_y = win.winfo_y()
            # 计算目标位置（最新在最上面，需要计算它之前所有泡泡的高度）
            with _task_bubbles_lock:
                keys = list(_task_bubbles.keys())
            idx = keys.index(task_id) if task_id in keys else len(keys) - 1
            target_y = _get_bubble_y(task_id, idx)
            sh = _tk_root.winfo_screenheight() if _tk_root else 1080
            if target_y + win_h < 0:
                win.withdraw()
            else:
                # 从下方移入
                steps = 8
                step_y = (target_y - cur_y) / steps
                for i in range(1, steps + 1):
                    win.geometry(f"{win_w}x{win_h}+{x}+{int(cur_y + step_y * i)}")
                    win.update()
                    time.sleep(0.015)
                # 重新调整位置（可能其他泡泡被顶上去）
                _reposition_bubbles()
        except Exception:
            pass
    threading.Thread(target=_slide_up, daemon=True).start()

    # 确保 Tk 事件循环调度
    root = _get_tk_root()
    if root:
        _schedule_tk_loop(root)




def close_task_bubble(task_id):
    """关闭并移除指定任务泡泡"""
    with _task_bubbles_lock:
        win = _task_bubbles.pop(task_id, None)
        _task_bubble_heights.pop(task_id, None)
    if win:
        try:
            win.destroy()
        except Exception:
            pass
    # 重新排列剩余泡泡
    root = _get_tk_root()
    if root:
        root.after(50, _reposition_bubbles)


_tk_loop_running = False

def _schedule_tk_loop(root):
    """定期让 tkinter 处理事件（每 50ms 更新一次）"""
    global _tk_loop_running
    if _tk_loop_running:
        return
    _tk_loop_running = True

    def _loop():
        try:
            root.update()
        except Exception:
            pass
        if _tk_loop_running:
            try:
                root.after(50, _loop)
            except Exception:
                pass

    try:
        root.after(50, _loop)
    except Exception:
        pass


def start_tk_loop():
    """在独立线程中初始化 tkinter 并运行事件循环"""
    if not _TK_AVAILABLE:
        return
    root = _get_tk_root()
    if root is None:
        return
    # 持续运行 mainloop（阻塞，因此在独立线程）
    try:
        root.mainloop()
    except Exception:
        pass


# ── System Tray ─────────────────────────────────────────
_tray_icon = None
_on_quit_callback = None

def _do_exit():
    """统一退出：先关闭 KeyClient，再隐藏托盘图标，再退出进程"""
    global _tray_icon
    # # info
    
    # 关闭 KeyClient
    client = getattr(sys, '_client_instance', None)
    if client:
        client._close_keyclient()
    
    if _tray_icon:
        try:
            _tray_icon.visible = False
            _tray_icon.stop()
        except Exception:
            pass
    os._exit(0)
_alarm_enabled = True   # 游戏掉线报警开关（心跳合并后不再需要独立线程）
_keyboard_enabled = False  # 启动键盘状态（由托盘菜单控制）

# ── Screen Capturer (DXGI + WebP) ───────────────────────

def _rgb_from_dxgi_surface(dxgiSurf, width, height, pitch):
    """从 DXGI 表面复制像素数据到 numpy RGB array。"""
    import ctypes, numpy as np
    try:
        # IDXGIResource.QueryInterface(IID_ID3D11Texture2D)
        IID_ID3D11Texture2D = ctypes.c_char * 16
        iid_d3d11 = IID_ID3D11Texture2D(
            0x73, 0x21, 0x6D, 0x27, 0x63, 0x3D, 0x5F, 0x48,
            0x8B, 0x5B, 0x18, 0xF5, 0x57, 0x8A, 0xC5, 0x32
        )
        d3d11Surf = ctypes.c_void_p()
        hr = dxgiSurf[0].QueryInterface(dxgiSurf, iid_d3d11, ctypes.byref(d3d11Surf))
        if hr != 0:
            return None
        try:
            # D3D11_TEXTURE2D_DESC { UINT Width, Height, BindFlags, CPUAccessFlags, MiscFlags, Format, SampleDesc, ArraySize, MipLevels }
            D3D11_MAPPED_TEXTURE2D = ctypes.c_uint * 6
            D3D11_TEXTURE2D_DESC = (ctypes.c_uint * 9)
            desc = D3D11_TEXTURE2D_DESC()
            d3d11Surf_u = ctypes.c_void_p(d3d11Surf)
            # C/call style: we need a context — too complex, just read raw bytes
            # Use GetDC on surface instead
            # 直接读取 mapped row bytes
            mapped = ctypes.c_void_p()
            result = ctypes.windll.dxgi.DXGIGetSurfaceData(dxgiSurf, None, None)  # no, not this
            # Use GDI-like approach: CreateCompatibleDC + BitBlt
        except Exception:
            pass
        return None
    except Exception:
        return None






def _capture_dxgi(width, height):
    """
    使用 DXGI Desktop Duplication API 截取全屏，返回 numpy array (RGB) 或 None。
    速度比 mss 快 ~3-5x，直接走 GPU。
    """
    import ctypes, numpy as np
    from ctypes import wintypes as w

    # ── GUID / IID ──────────────────────────────────────
    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", ctypes.c_uint32),
            ("Data2", ctypes.c_uint16),
            ("Data3", ctypes.c_uint16),
            ("Data4", ctypes.c_ubyte * 8),
        ]
    def iid(a,b,c,d0,d1,d2,d3,d4,d5,d6,d7):
        return GUID(a,b,c,d0,d1,d2,d3,d4,d5,d6,d7,d7)

    IID_IDXGIFactory    = iid(0x7B72,0x3545,0x4781,0x82,0xE9,0x12,0xF9,0x3A,0xB3,0x51,0x5E)
    IID_IDXGIDevice     = iid(0x54,0xEE,0x1A,0x8C,0xCC,0x89,0x34,0xFB,0xD1,0x0C,0xFE)
    IID_IDXGIAdapter    = iid(0x2411,0xE7,0xA5,0x9B,0xAD,0xCF,0x75,0x7F,0x49,0xD8,0xFA)
    IID_IDXGIOutput     = iid(0xAE,0x02,0xEA,0x4F,0x37,0x86,0x7A,0x4A,0xD2,0x84,0x0F)
    IID_IDXGIOutputDuplication = iid(0xA,0x9A2,0xD4,0xF8,0xE9,0x2C,0x9F,0x3F,0xB5,0xC2,0x1F)
    IID_ID3D11Device    = iid(0x72,0x49B2,0x40D5,0x9A,0x5C,0x2C,0x50,0x07,0x2F,0xAF,0x7A)
    IID_ID3D11Texture2D = iid(0x73,0x216D,0x5F,0x3D,0x8B,0x5B,0x18,0xF5,0x57,0x8A,0xC5)
    IID_IDXGISurface    = iid(0x4,0x34,0x2C,0xCA,0xA2,0xB2,0x1C,0x40,0x79,0x5C,0xB3)

    # ── ctypes types ─────────────────────────────────────
    PVOID   = ctypes.c_void_p
    BOOL    = ctypes.c_int
    UINT    = ctypes.c_uint
    DWORD   = ctypes.c_uint32
    HRESULT = ctypes.c_long
    LPVOID  = ctypes.c_void_p
    LPCWSTR = ctypes.c_wchar_p

    DXGI_OUTDUPL_FRAME_INFO = ctypes.Structure
    class _DXGI_OUTDUPL_FRAME_INFO(DXGI_OUTDUPL_FRAME_INFO):
        _fields_ = [
            ("AccumulatedFrames", UINT),
            ("PresentCount", UINT),
            ("PresentDuration", ctypes.c_ulonglong),
            ("LastMouseUpdateTime", ctypes.c_ulonglong),
            ("TotalMetadataBufferSize", UINT),
            ("MetadataBufferSize", UINT),
            ("OrientationPresent", DWORD),
        ]

    DXGI_MODE_ROTATION = UINT
    DXGI_SWAP_CHAIN_DESC = ctypes.Structure
    class _DXGI_SWAP_CHAIN_DESC(DXGI_SWAP_CHAIN_DESC):
        _fields_ = [
            ("Width", UINT),
            ("Height", UINT),
            ("RefreshRate", ctypes.c_ulonglong),
            ("Format", ctypes.c_int),
            ("ScanlineOrdering", ctypes.c_int),
            ("Scaling", ctypes.c_int),
            ("BufferCount", UINT),
            ("BufferUsage", DWORD),
            ("OutputWindow", PVOID),
            ("SampleDesc", ctypes.c_uint * 2),
            ("Windowed", BOOL),
            ("SwapEffect", DWORD),
            ("Flags", DWORD),
        ]

    # ── COM interface definitions ────────────────────────
    class IDXGIFactory(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGIDevice(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGIDevice1(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGIAdapter(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGIOutput(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGIOutput1(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGIOutputDuplication(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class ID3D11Device(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class ID3D11Texture2D(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]
    class IDXGISurface(ctypes.Structure):
        _fields_ = [
            ("lpVtbl", PVOID),
        ]

    # ── DXGI.dll ─────────────────────────────────────────
    dxgi = ctypes.windll.dxgi
    DXGICreateFactory = dxgi.DXGIGetFactory
    DXGICreateFactory.argtypes = [GUID, PVOID]
    DXGICreateFactories = getattr(dxgi, 'DXGIGetFactory', None)
    if not DXGICreateFactories:
        try:
            DXGICreateFactories = dxgi.CreateDXGIFactory2
        except AttributeError:
            return None

    DXGIGetFactory = getattr(ctypes.windll.dxgi, 'CreateDXGIFactory2', None)
    if not DXGIGetFactory:
        try:
            DXGIGetFactory = ctypes.windll.dxgi.DXGIGetFactory
        except AttributeError:
            return None

    def com_call(obj, vtbl_idx, *args, restype=HRESULT):
        """通用 COM vtable 调用。obj.lpVtbl[vtbl_idx] 是函数指针。"""
        try:
            vtbl = ctypes.cast(obj.lpVtbl, ctypes.POINTER(ctypes.c_void_p))
            fn = vtbl[vtbl_idx]
            fn_ptr = ctypes.cast(fn, ctypes.CFUNCTYPE(restype, PVOID, *([PVOID] * len(args))))
            return fn_ptr(fn, *args)
        except Exception:
            return -1

    # ── CoInitializeEx ───────────────────────────────────
    try:
        ctypes.windll.ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
    except Exception:
        pass

    # ── Create DXGIFactory ───────────────────────────────
    ppFactory = ctypes.c_void_p()
    hr = DXGIGetFactory(0, ctypes.byref(ppFactory))
    if hr != 0:
        return None
    pFactory = ctypes.cast(ppFactory, ctypes.POINTER(IDXGIFactory))

    # ── Enum adapters → find GPU → get device ───────────
    for adapter_idx in range(8):
        ppAdapter = ctypes.c_void_p()
        hr = com_call(pFactory, 4, ctypes.byref(ppAdapter), adapter_idx)  # EnumAdapters
        if hr != 0 or not ppAdapter.value:
            break
        pAdapter = ctypes.cast(ppAdapter, ctypes.POINTER(IDXGIDevice))

        # Get IDXGIDevice from adapter
        ppDevice = ctypes.c_void_p()
        hr = com_call(pAdapter, 0, IID_IDXGIDevice, ctypes.byref(ppDevice))  # QueryInterface
        if hr != 0 or not ppDevice.value:
            continue
        pDevice = ctypes.cast(ppDevice, ctypes.POINTER(IDXGIDevice))

        # Create D3D11 device (D3D_DRIVER_TYPE_HARDWARE = 0)
        # Try with NULL since adapter is already set
        ppD3DDevice = ctypes.c_void_p()
        D3D11CreateDevice = getattr(ctypes.windll.d3d11, 'D3D11CreateDevice', None)
        if D3D11CreateDevice:
            hr = D3D11CreateDevice(
                pAdapter, 0, None, 0x200,  # D3D11_CREATE_DEVICE_BGRA_SUPPORT
                None, 0, 7,  # D3D11_SDK_VERSION
                ctypes.byref(ppD3DDevice), None, None
            )
        if not D3D11CreateDevice or hr != 0:
            # Try software fallback
            hr = D3D11CreateDevice(
                None, 1, None, 0x200,
                None, 0, 7,
                ctypes.byref(ppD3DDevice), None, None
            )
        if hr != 0 or not ppD3DDevice.value:
            continue
        pD3DDevice = ctypes.cast(ppD3DDevice, ctypes.POINTER(ID3D11Device))

        # Get output (desktop)
        ppOutput = ctypes.c_void_p()
        hr = com_call(pAdapter, 5, 0, ctypes.byref(ppOutput))  # EnumOutputs
        if hr != 0 or not ppOutput.value:
            continue
        pOutput = ctypes.cast(ppOutput, ctypes.POINTER(IDXGIOutput))

        # Query IDXGIOutput1 for DuplicateOutput
        ppOutput1 = ctypes.c_void_p()
        IID_IDXGIOutput1 = iid(0x00,0x79E,0x5C,0xA7,0xC6,0xA2,0xF9,0x3F,0x60,0x06,0xC8)
        hr = com_call(pOutput, 0, IID_IDXGIOutput1, ctypes.byref(ppOutput1))
        if hr != 0 or not ppOutput1.value:
            continue
        pOutput1 = ctypes.cast(ppOutput1, ctypes.POINTER(IDXGIOutput1))

        # DuplicateOutput
        ppDup = ctypes.c_void_p()
        hr = com_call(pOutput1, 15, pDevice, ctypes.byref(ppDup))  # DuplicateOutput
        if hr != 0 or not ppDup.value:
            continue
        pDup = ctypes.cast(ppDup, ctypes.POINTER(IDXGIOutputDuplication))

        # ── Acquire frame ────────────────────────────────
        frame_info = _DXGI_OUTDUPL_FRAME_INFO()
        ppDesktop = ctypes.c_void_p()
        hr = com_call(pDup, 0, ctypes.byref(frame_info), ctypes.byref(ppDesktop))  # AcquireNextFrame
        if hr != 0 or not ppDesktop.value:
            # 可能需要先 ReleaseFrame
            com_call(pDup, 1)  # ReleaseFrame
            hr = com_call(pDup, 0, 100, ctypes.byref(frame_info), ctypes.byref(ppDesktop))
            if hr != 0 or not ppDesktop.value:
                com_call(pDup, 1)
                continue

        pSurf = ctypes.cast(ppDesktop, ctypes.POINTER(IDXGISurface))

        # Map surface → get raw BGRA bytes
        subresource = ctypes.c_uint(0)
        mapped_rect = (ctypes.c_long * 5)()  # pBits, RowPitch, ...
        hr = com_call(pSurf, 5, subresource, 1, ctypes.byref(mapped_rect))  # Map
        if hr != 0:
            com_call(pDup, 1)
            continue

        try:
            row_pitch = mapped_rect[1]
            bits = mapped_rect[0]
            if not bits:
                com_call(pDup, 1)
                continue

            # Build BGRA numpy array
            class _D3D11_MAPPED_TEX2D(ctypes.Structure):
                _fields_ = [("pData", PVOID), ("RowPitch", UINT), ("DepthPitch", UINT)]

            src = ctypes.cast(bits, ctypes.POINTER(ctypes.c_ubyte))
            total_rows = height
            total_cols = width
            arr = np.empty((total_rows, total_cols, 3), dtype=np.uint8)
            for r in range(total_rows):
                row = np.ctypeslib.as_array(src, shape=(total_cols, 4))
                arr[r, :, 0] = row[:, 2]   # R (from BGRA)
                arr[r, :, 1] = row[:, 1]   # G
                arr[r, :, 2] = row[:, 0]   # B
                src = ctypes.cast(
                    ctypes.addressof(src.contents) + row_pitch,
                    ctypes.POINTER(ctypes.c_ubyte)
                )
            com_call(pSurf, 6)  # Unmap
            com_call(pDup, 1)   # ReleaseFrame
            return arr
        finally:
            try:
                com_call(pSurf, 6)  # Unmap
            except Exception:
                pass
            com_call(pDup, 1)   # ReleaseFrame
        break

    return None


class ScreenCapturer:
    def __init__(self, quality=30, resize_w=480, resize_h=270, monitor_index=1):
        self.quality = quality
        self.resize_w = resize_w
        self.resize_h = resize_h
        self._monitor_index = monitor_index  # 1-based
        self._sct = None
        self._mss_ok = False
        self._dxgi_ok = False
        self._dxgi_cached = None  # (width, height, rgb_ndarray)
        self._dxgi_offset = (0, 0)  # (offset_x, offset_y) for this monitor

        try:
            import mss
            self._sct = mss.mss()
            self._monitors = self._sct.monitors
            self._mss_ok = True
        except Exception:
            self._sct = None

    def _get_monitor_geometry(self):
        """返回当前选中显示器的几何信息 (left, top, width, height)"""
        idx = self._monitor_index
        if self._mss_ok and self._sct and idx < len(self._monitors):
            m = self._monitors[idx]
            return m["left"], m["top"], m["width"], m["height"]
        return 0, 0, 1920, 1080

    def capture(self, hq=False, lossless=False, hq_limit=720, hq_quality=30):
        # hq_limit: HQ 模式分辨率上限，默认 720p（普通预览），可设为 1080（高清预览）
        img_bytes = None
        use_dxgi = False

        # ── DXGI Desktop Duplication (仅主显示器) ─────────
        # 多显示器切换时，非主显示器走 MSS 路径
        if self._monitor_index != 1:
            self._dxgi_init_done = False  # 强制重初始化切回主显示器时重新探测
        else:
            try:
                if not hasattr(self, '_dxgi_init_done'):
                    self._dxgi_init_done = True
                    w, h = self._get_screen_res()
                    self._dxgi_w = w
                    self._dxgi_h = h

                if hasattr(self, '_dxgi_w'):
                    rgb = _capture_dxgi(self._dxgi_w, self._dxgi_h)
                    if rgb is not None:
                        from PIL import Image
                        pic = Image.fromarray(rgb, "RGB")
                        use_dxgi = True
                        if not hq:
                            pic.thumbnail((self.resize_w, self.resize_h), Image.LANCZOS)
                        if hq and (pic.width > hq_limit * 1.5 or pic.height > hq_limit):
                            pic.thumbnail((int(hq_limit * 1.5), hq_limit), Image.LANCZOS)
                        buf = BytesIO()
                        if lossless:
                            pic.save(buf, format="WEBP", lossless=True)
                            img_bytes = buf.getvalue()
                        else:
                            pic.save(buf, format="WEBP", quality=self.quality if not hq else hq_quality, method=6)
                            img_bytes = buf.getvalue()
                        if len(img_bytes) < 1000:
                            img_bytes = None
            except Exception:
                use_dxgi = False

        # ── MSS 回退（也用于多显示器切换）──────────────────
        if img_bytes is None:
            try:
                if self._mss_ok and self._sct:
                    # monitors 索引：0=虚拟全屏, 1+=物理显示器
                    mon_idx = min(self._monitor_index, len(self._monitors) - 1)
                    if mon_idx < 1:
                        mon_idx = 1
                    monitor = self._monitors[mon_idx]
                    frame = self._sct.grab(monitor)
                    from PIL import Image
                    pic = Image.frombytes("RGB", frame.size, frame.bgra, "raw", "BGRX").convert("RGB")
                    if not hq:
                        pic.thumbnail((self.resize_w, self.resize_h), Image.LANCZOS)
                    # HQ 模式限制分辨率上限为 hq_limit（默认 720p，可设 1080p）
                    if hq and (pic.width > hq_limit * 1.5 or pic.height > hq_limit):
                        pic.thumbnail((int(hq_limit * 1.5), hq_limit), Image.LANCZOS)
                    buf = BytesIO()
                    if lossless:
                        pic.save(buf, format="WEBP", lossless=True)
                        img_bytes = buf.getvalue()
                    else:
                        pic.save(buf, format="WEBP", quality=self.quality if not hq else hq_quality, method=6)
                        img_bytes = buf.getvalue()
                    if len(img_bytes) < 1000:
                        self._mss_ok = False
                        img_bytes = None
            except Exception:
                self._mss_ok = False

        # ── PIL ImageGrab 最后回退 ───────────────────────
        if img_bytes is None:
            try:
                from PIL import ImageGrab
                pic = ImageGrab.grab()
                pic = pic.convert("RGB")
                if not hq:
                    pic.thumbnail((self.resize_w, self.resize_h), Image.LANCZOS)
                # HQ 模式限制分辨率上限为 hq_limit（默认 720p，可设 1080p）
                if hq and (pic.width > hq_limit * 1.5 or pic.height > hq_limit):
                    pic.thumbnail((int(hq_limit * 1.5), hq_limit), Image.LANCZOS)
                buf = BytesIO()
                if lossless:
                    pic.save(buf, format="WEBP", lossless=True)
                    img_bytes = buf.getvalue()
                else:
                    pic.save(buf, format="WEBP", quality=self.quality if not hq else hq_quality, method=6)
                    img_bytes = buf.getvalue()
            except Exception:
                pass

        return img_bytes

    def _get_screen_res(self):
        """获取当前选中显示器的分辨率。"""
        try:
            if self._mss_ok and self._sct:
                mon_idx = min(self._monitor_index, len(self._monitors) - 1)
                if mon_idx < 1:
                    mon_idx = 1
                m = self._monitors[mon_idx]
                return m["width"], m["height"]
            import ctypes
            user32 = ctypes.windll.user32
            w = user32.GetSystemMetrics(0)
            h = user32.GetSystemMetrics(1)
            return w, h
        except Exception:
            return 1920, 1080

    def close(self):
        if self._sct:
            try:
                self._sct.close()
            except Exception:
                pass


# ── 托盘菜单（模块级别，所有函数可互相调用） ─────────────────

def _tray_on_open_screenwall(icon, item):
    """点击"打开屏幕墙"，读取服务端配置并用默认浏览器打开"""
    cfg = load_config()
    srv = cfg.get("server", {})
    host = srv.get("host", "localhost").replace("http://", "").replace("https://", "").rstrip("/")
    port = srv.get("port", 3000)
    url = f"http://{host}:{port}/main.html?from=client"
    webbrowser.open(url)

def _build_menu():
    if Menu is None:
        return None
    return Menu(
        MenuItem(f"ScreenWall v{CLIENT_VERSION}", lambda i, t: None, enabled=False),
        MenuItem("打开屏幕墙", _tray_on_open_screenwall),
        MenuItem("启动远控", _tray_on_toggle_keyboard,
                 checked=lambda item: _keyboard_enabled),
        MenuItem("游戏掉线报警", _tray_on_toggle_alarm,
                 checked=lambda item: _alarm_enabled),
        MenuItem("开机自启", _tray_on_toggle_auto_start,
                 checked=lambda item: is_auto_start_enabled()),
        MenuItem("退出", _tray_on_quit),
    )


def _tray_on_switch_monitor(icon, item):
    """点击托盘菜单中的显示器项时触发（pystray MenuItem callback）"""
    # 从 item.text 提取显示器编号，或者从 check state 确定
    # checked=True 的 item 会被 pystray 自动标记
    # 这里我们取所有项中当前选中的那个
    monitors = _get_all_monitors()
    # 遍历 menu 找到被选中的那个 monitor 项
    for sub in icon.menu.items:
        text = getattr(sub, 'text', '') or ''
        if text.startswith('显示器 '):
            # 从文本解析编号: "显示器 1  (1920×1080)"
            parts = text.split()
            if len(parts) >= 2:
                try:
                    idx = int(parts[1])
                    if _current_monitor_index != idx:
                        _switch_monitor(idx)
                        icon.menu = _build_menu()
                    return
                except ValueError:
                    pass

def _tray_on_quit(icon, item):
    _do_exit()

def _tray_on_toggle_auto_start(icon, item):
    new_state = not is_auto_start_enabled()
    set_auto_start(new_state)
    icon.menu = _build_menu()

def _tray_on_toggle_alarm(icon, item):
    global _alarm_enabled
    _alarm_enabled = not _alarm_enabled
    cfg = load_config()
    cfg.setdefault("alarm", {})["enabled"] = _alarm_enabled
    save_config(cfg)
    icon.menu = _build_menu()

def _tray_on_toggle_keyboard(icon, item):
    global _keyboard_enabled
    _keyboard_enabled = not _keyboard_enabled
    _set_keyboard_enabled(_keyboard_enabled)
    client = getattr(sys, '_client_instance', None)
    if client:
        if _keyboard_enabled:
            client._start_keyclient()
        else:
            client._close_keyclient()
        # 刷新托盘菜单勾选状态
        _rebuild_tray_icon()
        # 强制断开重连，让服务端重走 register 流程，广播最新 supportsKeyClient 状态
        client._reconnect_async()
    else:
        _rebuild_tray_icon()

def _create_tray_img():
    """创建托盘图标图片（绿色圆形 + SW 文字，透明背景）"""
    if PILImage is None:
        return None
    img = PILImage.new("RGBA", (64, 64), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, 60, 60], fill=(34, 197, 94, 255))
    draw.text((16, 18), "SW", fill=(255, 255, 255, 255))
    return img



def _rebuild_tray_icon():
    """刷新托盘图标菜单勾选状态"""
    if _tray_icon:
        try:
            _tray_icon.title = "ScreenWall"
            _tray_icon.menu = _build_menu()
            _tray_icon.update_menu()
        except Exception:
            pass

def start_tray(on_quit_callback=None):
    """启动系统托盘图标"""
    global _tray_icon, _on_quit_callback
    _on_quit_callback = on_quit_callback

    try:
        img = _create_tray_img()
        # 位置参数：name, icon, title, menu（与备份版本一致）
        _tray_icon = Icon("ScreenWall", img, "ScreenWall", _build_menu())

        t = threading.Thread(target=_tray_icon.run, daemon=True)
        t.start()
        return _tray_icon
    except Exception as e:
        # console=False 时 logger 不可见，写文件以便调试
        import tempfile
        try:
            with open(os.path.join(tempfile.gettempdir(), "sw_tray_err.txt"), "w", encoding="utf-8") as f:
                import traceback as tb
                tb.print_exc(file=f)
                f.write(f"\nException: {e}\n")
        except Exception:
            pass
        return None


# ── WebSocket Client ─────────────────────────────────────
class ScreenWallClient:
    def __init__(self):
        self.ws = None
        self.running = True
        self.registered = False
        self.hq_mode = False
        self.hq_streaming = False
        self.hq_interval = None  # 服务器指定的 HQ 截图间隔（秒）
        self.hq_1080 = False  # 1080p 预览模式（临时开启，不受 720p 上限限制）
        self._tasks = []
        self._last_cfg_hash = ""
        self._migrating = False  # 收到 serverMigrate 后标记，run() 检测到后重新连接
        # UU 设备信息获取状态
        self._uu_device_id = None  # 获取成功后的值
        self._uu_fetch_success = False  # 是否已成功获取
        self._uu_last_fetch_time = 0  # 上次尝试获取的时间戳
        self._uu_fetch_interval = 30  # 失败后重试间隔（秒）
        # KeyClient（键盘模拟）- 根据注册表状态决定是否启动
        global _keyboard_enabled
        _keyboard_enabled = _get_keyboard_enabled()
        self._keyclient_socket = None
        self._keyclient_process = None
        self._upgrade_notified = False  # 升级通知只弹一次
        self._upgrade_triggered = False  # 升级任务只触发一次
        self._heartbeat_tick = 0        # 截图计数，用于定时发送心跳
        self._uu_version = None         # UU远程版本缓存
        self._uu_version_time = 0       # UU版本缓存时间
        self._uu_install_triggered = False  # UU安装只触发一次
        # 刷新托盘菜单，确保显示正确的键盘状态
        _rebuild_tray_icon()
        if _keyboard_enabled:
            self._start_keyclient()

    # ── 自动升级 ───────────────────────────────────────────
    def _ensure_upgrade_script(self, latest_version="?"):
        """生成 upgrade.bat（静默升级版）。每次调用都覆盖写，保证内容最新。"""
        exe_path = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)
        exe_dir = os.path.dirname(exe_path) or '.'
        bat_path = os.path.join(exe_dir, 'upgrade.bat')
        # 静默升级脚本：等待进程退出后复制新版本
        bat_content = (
            '@echo off\r\n'
            'title 客户端升级中，请稍后\r\n'
            'setlocal enabledelayedexpansion\r\n'
            ':wait\r\n'
            'powershell -NoProfile -Command "if (Get-Process ScreenWallClient -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"\r\n'
            'if not errorlevel 1 (\r\n'
            '    timeout /t 1 /nobreak >nul\r\n'
            '    goto wait\r\n'
            ')\r\n'
            'timeout /t 2 /nobreak >nul\r\n'
            'copy /Y "%~dp0ScreenWallClient_new.exe" "%~dp0ScreenWallClient.exe" >nul 2>&1\r\n'
            'del "%~dp0ScreenWallClient_new.exe" >nul 2>&1\r\n'
            'start "" "%~dp0ScreenWallClient.exe"\r\n'
            'timeout /t 2 /nobreak >nul\r\n'
            'del "%~dp0upgrade.bat"\r\n'
            'exit\r\n'
        )
        try:
            with open(bat_path, 'wb') as f:
                f.write(bat_content.encode('gbk'))
        except Exception:
            # bat 生成失败，重置标志，让下次心跳重试
            self._upgrade_triggered = False
            self._upgrade_notified = False
            return  # 提前退出，不继续下载

    async def _upgrade_keyclient_async(self, host, port, internal_dir):
        """升级 KeyClient.exe：无论是否下载成功，先查杀所有旧进程"""
        import urllib.request, tempfile

        # 先查杀所有 KeyClient 进程（避免旧进程残留）
        self._close_keyclient()
        time.sleep(0.2)

        try:
            subprocess.run(['taskkill', '/F', '/IM', 'KeyClient.exe'], capture_output=True)
        except Exception:
            pass

        time.sleep(0.5)  # 等待进程完全退出

        # 尝试下载新版本
        keyclient_url = f"http://{host}:{port}/KeyClient.exe"
        keyclient_tmp = os.path.join(tempfile.gettempdir(), 'KeyClient_new.exe')

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: urllib.request.urlretrieve(keyclient_url, keyclient_tmp)
            )
        except Exception:
            return  # 下载失败，只杀进程，不复制不启动

        if not os.path.exists(keyclient_tmp):
            return

        # 下载成功，复制到 _internal 目录
        try:
            os.makedirs(internal_dir, exist_ok=True)
            keyclient_dest = os.path.join(internal_dir, 'KeyClient.exe')
            shutil.copy(keyclient_tmp, keyclient_dest)
        except Exception:
            pass
        finally:
            try:
                os.remove(keyclient_tmp)
            except Exception:
                pass

        # 不启动 KeyClient，客户端重启后会自行启动


    async def _do_install_uu(self, cfg, uu_download_url, uu_file_name="", is_startup=False):
        """下载并静默安装UU远程，is_startup=True表示启动时触发（不需要等60秒）"""
        try:
            if self._uu_install_triggered:
                return
            self._uu_install_triggered = True

            # 构建下载URL（uu_download_url 可能是相对路径 /xxx.exe，需要拼接服务端地址）
            if uu_download_url and uu_download_url.startswith('/'):
                uri = cfg.get("uri", "")
                from urllib.parse import urlparse
                parsed = urlparse(uri)
                host = parsed.hostname or "localhost"
                port = parsed.port or 3000
                uu_download_url = f"http://{host}:{port}{uu_download_url}"
            if not uu_file_name:
                # 从URL中提取文件名
                uu_file_name = uu_download_url.split("/")[-1]

            # 下载到临时目录
            import tempfile, urllib.request
            tmp_dir = tempfile.gettempdir()
            tmp_path = os.path.join(tmp_dir, uu_file_name)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: urllib.request.urlretrieve(uu_download_url, tmp_path))

            if not os.path.exists(tmp_path):
                self._uu_install_triggered = False
                return

            # 静默安装：/S /mode=7 /bgstartup=yes /launchapp=no /autorun=yes
            install_cmd = [
                tmp_path,
                "/S",
                "/mode=7",
                "/bgstartup=yes",
                "/launchapp=no",
                "/autorun=yes",
                r'/D=C:\Program Files\Netease\GameViewer',
            ]
            subprocess.Popen(
                install_cmd,
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_BREAKAWAY_FROM_JOB
            )
            # 安装完成后清除版本缓存
            self._uu_version = None
            self._uu_version_time = 0
            # 等安装完成
            await asyncio.sleep(10)
            # 安装完成后重置标志，下次心跳再次比对（确认是否成功）
            self._uu_install_triggered = False
            # 心跳升级时：重新执行初始化（设置密码 + 获取ID）
            if not is_startup:
                self._uu_init_and_register()
        except Exception as e:
            import traceback
            traceback.print_exc()
            self._uu_install_triggered = False

    def _uu_init_and_register(self):
        """重新初始化UU（设置密码 + 获取ID），成功后触发重连"""
        _uu_init_dir = self._get_uu_install_dir()
        _uuycmgr = os.path.join(_uu_init_dir, "bin", "uuycmgr.exe") if _uu_init_dir else ""
        if _uuycmgr and os.path.exists(_uuycmgr):
            try:
                subprocess.run(
                    [_uuycmgr, "-c", "qqww5566"],
                    capture_output=True, text=True, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
            except Exception:
                pass
            try:
                result = subprocess.run(
                    [_uuycmgr, "-d"],
                    capture_output=True, text=True, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                if result.returncode == 0:
                    output = result.stdout.strip()
                    if output.isdigit():
                        self._uu_device_id = output
                        self._uu_fetch_success = True
            except Exception:
                pass
        # 强制重连，让服务端通过 register 拿到最新的 uuDeviceId
        self._reconnect_async()

    async def _do_upgrade_async(self, cfg, latest_version="?"):
        """下载新版本 exe 并触发升级"""
        try:
            if self._upgrade_triggered:
                return  # 已触发过，跳过
            self._upgrade_triggered = True

            # cfg 是 load_config() 返回的完整配置，直接用
            uri = cfg.get("uri", "")
            from urllib.parse import urlparse
            parsed = urlparse(uri)
            host = parsed.hostname or "localhost"
            port = parsed.port or 3000

            exe_dir = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)) or '.'
            internal_dir = os.path.join(exe_dir, '_internal')

            # ── 升级 KeyClient ───────────────────────────────────
            await self._upgrade_keyclient_async(host, port, internal_dir)

            # ── 升级 ScreenWallClient ───────────────────────────
            download_url = f"http://{host}:{port}/ScreenWallClient.exe"
            new_exe = os.path.join(exe_dir, 'ScreenWallClient_new.exe')
            bat_path = os.path.join(exe_dir, 'upgrade.bat')

            # 先确保 bat 是最新内容
            self._ensure_upgrade_script(latest_version)

            # 下载新版本
            try:
                import urllib.request
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: urllib.request.urlretrieve(download_url, new_exe))
            except Exception:
                self._upgrade_triggered = False
                self._upgrade_notified = False
                return

            # 启动 upgrade.bat 替换自身
            if not os.path.exists(bat_path):
                self._upgrade_triggered = False
                self._upgrade_notified = False
                return

            subprocess.Popen(
                ['cmd', '/c', bat_path],
                cwd=exe_dir,
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_BREAKAWAY_FROM_JOB
            )
            self._upgrade_notified = True
            
            # 升级前隐藏托盘图标，避免升级完成后出现两个图标
            if _tray_icon:
                try:
                    _tray_icon.visible = False
                except Exception:
                    pass
            
            time.sleep(1)  # 等待托盘图标隐藏后再退出
            os._exit(0)
        except Exception as e:
            # error
            import traceback
            # error}")
            self._upgrade_triggered = False
            self._upgrade_notified = False

    async def _immediate_version_check(self, ws, cfg):
        """注册后立即发一次心跳检查版本，不等 30 秒心跳周期"""
        await asyncio.sleep(0.5)  # 等 _listen 跑起来
        try:
            off_x, off_y, off_w, off_h = _get_current_monitor_offset()
            all_monitors = _get_all_monitors()
            payload = {
                "type":               "heartbeat",
                "deviceId":           cfg["deviceId"],
                "supportsKeyClient":  _keyboard_enabled,
                "version":            CLIENT_VERSION,
                "monitorIndex":       _current_monitor_index,
                "monitorCount":       len(all_monitors),
                "screenWidth":        off_w,
                "screenHeight":       off_h,
                "monitorOffsetX":     off_x,
                "monitorOffsetY":     off_y,
                "uuVersion":          self._get_uu_version(),
                "uuInstalled":        self._is_uu_installed(),
            }
            await ws.send(json.dumps(payload))
        except Exception:
            pass

    def _get_screen_res(self):
        """获取当前选中显示器的分辨率。"""
        try:
            import mss
            sct = mss.mss()
            monitors = sct.monitors
            sct.close()
            mon_idx = min(_current_monitor_index, len(monitors) - 1)
            if mon_idx < 1:
                mon_idx = 1
            m = monitors[mon_idx]
            return m["width"], m["height"]
        except Exception:
            try:
                import ctypes
                user32 = ctypes.windll.user32
                w = user32.GetSystemMetrics(0)
                h = user32.GetSystemMetrics(1)
                return w, h
            except Exception:
                return 1920, 1080

    def _on_monitor_switch(self, idx):
        """显示器切换回调：触发重连，让服务端通过 register 拿到新偏移量"""
        # info 开始")
        self._reconnect_async()
        # info _reconnect_async 已调度")

    def _get_uu_device_id_async(self):
        """
        异步获取 UU 设备 ID：
        - 获取成功：记录值，不再获取
        - 获取失败：30秒后重试，不阻塞当前任务
        """
        now = time.time()

        # 已获取成功，直接返回
        if self._uu_fetch_success and self._uu_device_id:
            return self._uu_device_id

        # 检查是否到了重试时间
        if now - self._uu_last_fetch_time < self._uu_fetch_interval:
            return self._uu_device_id or ""  # 返回已有值（可能是空）

        # 更新时间戳，尝试获取
        self._uu_last_fetch_time = now

    def _close_keyclient(self):
        """关闭 KeyClient：先发退出信号，再关 socket，最后杀进程"""
        # 先发 exit 消息让 KeyClient 优雅退出
        if self._keyclient_socket:
            try:
                self._keyclient_socket.send(json.dumps({"type": "exit"}).encode('utf-8'))
                self._keyclient_socket.settimeout(1)
                try:
                    self._keyclient_socket.recv(1024)
                except Exception:
                    pass
            except Exception:
                pass

        # 关闭 socket
        if self._keyclient_socket:
            try:
                self._keyclient_socket.close()
            except Exception:
                pass
            self._keyclient_socket = None

        # 终止进程
        if self._keyclient_process:
            try:
                self._keyclient_process.terminate()
                self._keyclient_process.wait(timeout=2)
            except Exception:
                try:
                    self._keyclient_process.kill()
                except Exception:
                    pass
            self._keyclient_process = None

    def _start_keyclient(self):
        """启动 KeyClient（键盘模拟服务）"""
        import socket

        # 已启动则跳过
        if self._keyclient_socket or self._keyclient_process:
            return

        # 尝试连接已有的 KeyClient（固定端口）
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            sock.connect(('127.0.0.1', 19876))
            sock.settimeout(None)
            self._keyclient_socket = sock
            return
        except Exception:
            pass

        # 启动 KeyClient.exe（单文件模式下在 exe 同目录）
        try:
            keyclient_exe = os.path.join(BASE_DIR, "_internal", "KeyClient.exe")
            if os.path.exists(keyclient_exe):
                proc = subprocess.Popen(
                    [keyclient_exe],
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                self._keyclient_process = proc
                time.sleep(0.5)
                # 再次尝试连接
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.settimeout(3)
                    sock.connect(('127.0.0.1', 19876))
                    sock.settimeout(None)
                    self._keyclient_socket = sock
                except Exception:
                    pass
        except Exception:
            pass

    def _send_key_to_keyclient(self, key):
        """发送按键到 KeyClient（仅在键盘已启用时才操作）"""
        if not _keyboard_enabled:
            return
        if not self._keyclient_socket:
            self._start_keyclient()
        
        if self._keyclient_socket:
            try:
                self._keyclient_socket.send(json.dumps({
                    "type": "keyClick",
                    "key": key
                }).encode('utf-8'))
                self._keyclient_socket.settimeout(0.1)
                try:
                    self._keyclient_socket.recv(1024)
                except Exception:
                    pass
                self._keyclient_socket.settimeout(None)
            except Exception:
                self._close_keyclient()

    def _send_mouse_to_keyclient(self, x, y, action='left', delta=120):
        """发送鼠标动作到 KeyClient（仅在键盘已启用时才操作）"""
        if not _keyboard_enabled:
            return
        if not self._keyclient_socket:
            self._start_keyclient()

        if self._keyclient_socket:
            try:
                if action == 'scroll':
                    payload = {"type": "mouseScroll", "delta": delta}
                else:
                    payload = {"type": "mouseRight" if action == 'right' else "mouseClick", "x": x, "y": y}
                self._keyclient_socket.send(json.dumps(payload).encode('utf-8'))
                self._keyclient_socket.settimeout(0.1)
                try:
                    self._keyclient_socket.recv(1024)
                except Exception:
                    pass
                self._keyclient_socket.settimeout(None)
            except Exception:
                self._close_keyclient()

    def _get_uu_device_id_async(self):
        """
        异步获取 UU 设备 ID：
        - 获取成功：记录值，不再获取
        - 获取失败：30秒后重试，不阻塞当前任务
        """
        now = time.time()

        # 已获取成功，直接返回
        if self._uu_fetch_success and self._uu_device_id:
            return self._uu_device_id

        # 检查是否到了重试时间
        if now - self._uu_last_fetch_time < self._uu_fetch_interval:
            return self._uu_device_id or ""  # 返回已有值（可能是空）

        # 更新时间戳，尝试获取
        self._uu_last_fetch_time = now

        install_dir = self._get_uu_install_dir()
        if not install_dir:
            return self._uu_device_id or ""

        uuycmgr = os.path.join(install_dir, "bin", "uuycmgr.exe")
        if not os.path.exists(uuycmgr):
            return self._uu_device_id or ""

        try:
            result = subprocess.run(
                [uuycmgr, "-d"],
                capture_output=True, text=True, timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                output = result.stdout.strip()
                if output.isdigit():
                    self._uu_device_id = output
                    self._uu_fetch_success = True
                    return output
        except Exception as e:
            pass

        return self._uu_device_id or ""

    def _get_uu_install_dir(self):
        """从注册表获取UU远程安装目录"""
        try:
            # 优先用 GameViewerSetup\InstDir（直接定位安装目录）
            result = subprocess.run(
                ["reg", "query", r"HKLM\SOFTWARE\Netease\GameViewerSetup", "/v", "InstDir"],
                capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                # 解析输出：InstDir    REG_SZ    C:\Program Files\Netease\GameViewer
                for line in result.stdout.split('\n'):
                    if 'InstDir' in line:
                        parts = line.strip().split(None, 2)
                        if len(parts) >= 3:
                            return parts[2].rstrip('\\')
        except Exception:
            pass
        return ""

    def _get_uu_version(self):
        """获取UU远程版本号，缓存5分钟"""
        now = time.time()
        # 缓存5分钟
        if self._uu_version is not None and (now - self._uu_version_time) < 300:
            return self._uu_version

        # 先从注册表获取安装目录
        install_dir = self._get_uu_install_dir()
        if not install_dir:
            self._uu_version = ""
            self._uu_version_time = now
            return ""

        uuycmgr = os.path.join(install_dir, "bin", "uuycmgr.exe")
        if not os.path.exists(uuycmgr):
            self._uu_version = ""
            self._uu_version_time = now
            return ""

        try:
            result = subprocess.run(
                [uuycmgr, "-v"],
                capture_output=True, text=True, timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                version = result.stdout.strip()
                # 格式如 "uuycmgr 4.20.903.7641" 或 "4.20.903.7641"
                if " " in version:
                    version = version.split(" ")[-1]
                self._uu_version = version
                self._uu_version_time = now
                return version
        except Exception:
            pass

        self._uu_version = ""
        self._uu_version_time = now
        return ""

    def _is_uu_installed(self):
        """检查UU远程是否已安装（通过注册表检测）"""
        return bool(self._get_uu_install_dir())

    def _get_config(self):
        cfg = load_config()
        dev = cfg.get("device", {})
        srv = cfg.get("server", {})
        cap = cfg.get("capture", {})

        # deviceId：优先从 user_info.ini 读取，其次从配置读，最后才用 MAC+计算机名 生成
        ini_path = Path("C:/ProgramData/Netease/GameViewer/user_info.ini")
        ini_device_id = ""
        if ini_path.exists():
            user_info = read_ini_section(ini_path)
            if "General" in user_info:
                ini_device_id = user_info["General"].get("deviceId", "").strip()

        device_id = dev.get("deviceId", "").strip() or ini_device_id

        # deviceId 加用户名后缀（副用户区分），仅 Administrator 保持原样
        if _CURRENT_USER.lower() not in ("administrator", ""):
            device_id = f"{device_id}-{_CURRENT_USER}"

        # uuDeviceId：从配置读取，或动态获取
        uu_device_id = dev.get("uuDeviceId", "").strip()
        if not uu_device_id:
            uu_device_id = self._get_uu_device_id_async()

        device_name = dev.get("deviceName", "").strip()
        # deviceName 也加上用户名标识，格子上能区分是谁
        base_name = device_name or os.environ.get("COMPUTERNAME", "UnknownPC")
        if _CURRENT_USER.lower() not in ("administrator", ""):
            device_name = f"{base_name}-{_CURRENT_USER}"
        else:
            device_name = base_name

        host = srv.get("host", "localhost").replace("http://", "").replace("https://", "")
        return {
            "uri":          f"ws://{host}:{srv.get('port', 3000)}/ws/client",
            "deviceId":     device_id,
            "deviceName":   device_name,
            "computerName": os.environ.get("COMPUTERNAME", ""),
            "uuDeviceId":   uu_device_id,
            "interval":     0.333,   # 3fps 写死
            "quality":      30,      # 写死
            "resizeW":      480,     # 写死
            "resizeH":      270,     # 写死
        }

    def _cfg_hash(self, cfg):
        return f"{cfg.get('uri','')}|{cfg.get('deviceName','')}|{cfg.get('uuDeviceId','')}"

    async def connect(self):
        cfg = self._get_config()
        self._last_cfg_hash = self._cfg_hash(cfg)
        self._last_msg_time = time.time()

        for t in self._tasks:
            try:
                t.cancel()
            except Exception:
                pass
        self._tasks.clear()
        self.registered = False
        self.ws = None

        import websockets
        try:
            ws = await websockets.connect(cfg["uri"], ping_interval=30, ping_timeout=10)
        except Exception:
            raise

        self.ws = ws
        sys._client_ws = ws

        try:
            has_kb = _keyboard_enabled  # 用实际运行状态，不用文件存在性
            sw, sh = self._get_screen_res()
            all_monitors = _get_all_monitors()
            off_x, off_y, off_w, off_h = _get_current_monitor_offset()
            payload = {
                "type":            "register",
                "deviceId":        cfg["deviceId"],
                "deviceName":      cfg["deviceName"],
                "uuDeviceId":      cfg["uuDeviceId"],
                "localDeviceName": cfg["deviceName"],
                "supportsKeyClient": has_kb,
                "version":         CLIENT_VERSION,
                "monitorIndex":    _current_monitor_index,
                "monitorCount":    len(all_monitors),
                "screenWidth":     off_w,
                "screenHeight":    off_h,
                "monitorOffsetX":  off_x,
                "monitorOffsetY":  off_y,
                "uuInstalled":     self._is_uu_installed(),
                "uuVersion":       self._get_uu_version(),
            }
            await ws.send(json.dumps(payload))
            self.registered = True
        except Exception:
            await ws.close()
            raise

        listen_task = asyncio.create_task(self._listen(ws, cfg))
        self._tasks.append(listen_task)

        # 注册后立即发一次心跳检查版本（不等 30 秒心跳周期）
        # TODO: 测试完心跳机制后可以取消注释
        # asyncio.create_task(self._immediate_version_check(ws, cfg))
        # self._tasks.append(self._tasks[-1])

        while self.running:
            # 热更新配置
            new_cfg = self._get_config()
            if self._cfg_hash(new_cfg) != self._last_cfg_hash:
                # info
                try:
                    has_kb = _keyboard_enabled
                    sw, sh = self._get_screen_res()
                    all_monitors = _get_all_monitors()
                    off_x, off_y, off_w, off_h = _get_current_monitor_offset()
                    payload = {
                        "type":            "register",
                        "deviceId":        new_cfg["deviceId"],
                        "deviceName":      new_cfg["deviceName"],
                        "uuDeviceId":      new_cfg["uuDeviceId"],
                        "localDeviceName": new_cfg["deviceName"],
                        "supportsKeyClient": has_kb,
                        "version":         CLIENT_VERSION,
                        "monitorIndex":    _current_monitor_index,
                        "monitorCount":    len(all_monitors),
                        "screenWidth":     off_w,
                        "screenHeight":    off_h,
                        "monitorOffsetX":  off_x,
                        "monitorOffsetY":  off_y,
                        "uuVersion":       self._get_uu_version(),
                    }
                    await ws.send(json.dumps(payload))
                except Exception:
                    pass
                cfg = new_cfg
                self._last_cfg_hash = self._cfg_hash(cfg)

            # 心跳计数：每 90 帧（约 30 秒 @ 3fps）主动发一次心跳
            # 心跳用于接收服务端的升级通知，不依赖截图失败才触发
            self._heartbeat_tick += 1
            heartbeat_interval = 90  # 可配置，每 N 帧发一次心跳（约30秒 @ 3fps）
            if self._heartbeat_tick >= heartbeat_interval:
                self._heartbeat_tick = 0
                try:
                    has_kb = _keyboard_enabled
                    off_x, off_y, off_w, off_h = _get_current_monitor_offset()
                    all_monitors = _get_all_monitors()
                    payload = {
                        "type":               "heartbeat",
                        "deviceId":           cfg["deviceId"],
                        "supportsKeyClient":  has_kb,
                        "version":            CLIENT_VERSION,
                        "monitorIndex":       _current_monitor_index,
                        "monitorCount":       len(all_monitors),
                        "screenWidth":        off_w,
                        "screenHeight":       off_h,
                        "monitorOffsetX":     off_x,
                        "monitorOffsetY":     off_y,
                        "uuVersion":          self._get_uu_version(),
                        "uuInstalled":        self._is_uu_installed(),
                    }
                    # 报警开启时：心跳包合并报警截图，二合一节省资源
                    # 固定截取屏幕中心 640×360 区域，用于报警检测
                    if _alarm_enabled:
                        try:
                            # 计算中心区域坐标
                            crop_x = (off_w - 640) // 2
                            crop_y = (off_h - 360) // 2
                            
                            # 用 MSS 截取中心区域
                            import mss
                            with mss.mss() as sct:
                                monitors = sct.monitors
                                # 确保索引不越界
                                mon_idx = min(_current_monitor_index, len(monitors) - 2)  # -2 因为 index 0 是总区域
                                monitor = monitors[mon_idx + 1]
                                # 截取中心 640×360 区域
                                region = {
                                    "left": monitor["left"] + crop_x,
                                    "top": monitor["top"] + crop_y,
                                    "width": 640,
                                    "height": 360
                                }
                                sct_img = sct.grab(region)
                                
                                # 转 webp
                                from PIL import Image
                                import io
                                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                                out = io.BytesIO()
                                img.save(out, format='WEBP', quality=30)
                                payload["alarmScreenshot"] = "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode("ascii")
                        except Exception as e:
                            pass
                            pass
                    await ws.send(json.dumps(payload))
                except Exception:
                    break
                interval = self.hq_interval if (self.hq_mode and self.hq_interval) else cfg["interval"]
                await asyncio.sleep(interval)
                continue  # 跳过本次截图，进入下一轮

            # 根据模式确定截图参数
            if self.hq_1080:
                hq = True
                hq_limit = 1080
            elif self.hq_mode:
                hq = True
                hq_limit = 720
            else:
                # 默认低清模式：hq=False，走 resizeW×H 路径（480×270），比例固定
                hq = False
                hq_limit = 720  # 不影响 hq=False 的情况
            capt = ScreenCapturer(cfg["quality"], cfg["resizeW"], cfg["resizeH"], monitor_index=_current_monitor_index)
            try:
                img_bytes = capt.capture(hq=hq, hq_limit=hq_limit, hq_quality=30)
            finally:
                capt.close()

            if img_bytes:
                try:
                    # 获取当前分辨率（实时同步到服务端，用于鼠标点击坐标映射）
                    off_x, off_y, off_w, off_h = _get_current_monitor_offset()
                    payload = {
                        "type":       "screenshot",
                        "deviceId":   cfg["deviceId"],
                        "image":      "data:image/webp;base64," + base64.b64encode(img_bytes).decode("ascii"),
                        "hq":         self.hq_mode,
                        "clientTime": int(time.time() * 1000),
                        "screenWidth": off_w,
                        "screenHeight": off_h,
                    }
                    await ws.send(json.dumps(payload))
                except Exception:
                    break

            # HQ 模式使用服务器指定的间隔，LQ 使用配置的间隔
            interval = self.hq_interval if (self.hq_mode and self.hq_interval) else cfg["interval"]
            await asyncio.sleep(interval)

        await self._cleanup_ws()

    async def _listen(self, ws, cfg):
        try:
            async for msg in ws:
                self._last_msg_time = time.time()
                try:
                    data = json.loads(msg)
                    msg_type = data.get("type")
                    global _keyboard_enabled

                    if msg_type == "registered":
                        # deviceId 为空时服务端会发 installUU 指令
                        if data.get("installUU") and not self._uu_install_triggered:
                            print(f"[注册响应] 收到installUU=true, uuDownloadUrl={data.get('uuDownloadUrl')}")
                            uu_download_url = data.get("uuDownloadUrl", "")
                            asyncio.create_task(self._do_install_uu(cfg, uu_download_url))
                    elif msg_type == "startHQ":
                        self.hq_mode = True
                        self.hq_streaming = True
                        # 接收服务器指定的 HQ 截图间隔（毫秒→秒）
                        hq_interval_ms = data.get("interval")
                        if hq_interval_ms and hq_interval_ms > 0:
                            self.hq_interval = hq_interval_ms / 1000.0
                        else:
                            self.hq_interval = None
                    elif msg_type == "stopHQ":
                        capt = ScreenCapturer(cfg["quality"], cfg["resizeW"], cfg["resizeH"], monitor_index=_current_monitor_index)
                        try:
                            img_bytes = capt.capture(hq=True)
                        finally:
                            capt.close()
                        if img_bytes:
                            await ws.send(json.dumps({
                                "type":     "screenshot",
                                "deviceId": cfg["deviceId"],
                                "image":    "data:image/webp;base64," + base64.b64encode(img_bytes).decode("ascii"),
                                "hq":       True,
                            }))
                        # 关闭 HQ 模式
                        self.hq_mode = False
                        self.hq_streaming = False
                        self.hq_interval = None
                        self.hq_1080 = False  # 同时关闭 1080p 模式
                        self._last_msg_time = time.time()

                    elif msg_type == "hq1080On":
                        self.hq_1080 = True

                    elif msg_type == "hq1080Off":
                        self.hq_1080 = False
                        # 降级到 720p 高质量，不停止 HQ 模式，让截图循环继续发送 HQ 帧
                        # 下次截图时会自动用 hq_limit=720

                    elif msg_type == "requestCollectionScreenshot":
                        device_ids = data.get("deviceIds", [])
                        timestamp = data.get("timestamp")
                        if cfg["deviceId"] in device_ids and timestamp:
                            capt = ScreenCapturer(quality=30, resize_w=1920, resize_h=1080, monitor_index=_current_monitor_index)
                            try:
                                img_bytes = capt.capture(hq=False, lossless=False)
                            finally:
                                capt.close()
                            if img_bytes:
                                await ws.send(json.dumps({
                                    "type": "screenshot",
                                    "deviceId": cfg["deviceId"],
                                    "image": "data:image/webp;base64," + base64.b64encode(img_bytes).decode("ascii"),
                                    "hq": True,
                                    "collectionTimestamp": timestamp,
                                }))

                    elif msg_type == "serverMigrate":
                        new_host = data.get("host", "")
                        new_port = data.get("port", 3000)
                        if not new_host:
                            continue
                        cfg_obj = load_config()
                        cfg_obj["server"] = cfg_obj.get("server", {})
                        cfg_obj["server"]["host"] = new_host
                        cfg_obj["server"]["port"] = int(new_port)
                        save_config(cfg_obj)
                        exe_path = sys.executable
                        subprocess.Popen([exe_path], creationflags=subprocess.CREATE_NO_WINDOW)
                        _do_exit()

                    elif msg_type == "newTask":
                        # 收到新任务，显示泡泡弹窗
                        task_info = data.get("task", {})
                        task_id = task_info.get("id", "")
                        task_content = task_info.get("content", "")
                        task_ts = task_info.get("timestamp", 0)
                        if task_id and task_content:
                            # 使用线程安全方式在主线程弹出
                            threading.Thread(
                                target=show_task_bubble,
                                args=(task_id, task_content, task_ts, ws, cfg["deviceId"]),
                                daemon=True
                            ).start()

                    elif msg_type == "switchMonitor":
                        # 服务端要求切换显示器
                        idx = int(data.get("monitorIndex", 1))
                        _switch_monitor(idx)

                    elif msg_type == "pendingTasks":
                        # 初始化时收到待接受任务列表（按顺序创建泡泡）
                        task_list = data.get("tasks", [])
                        def _restore_bubbles():
                            for t in task_list:
                                task_id = t.get("id", "")
                                task_content = t.get("content", "")
                                task_ts = t.get("timestamp", 0)
                                if task_id and task_content:
                                    show_task_bubble(task_id, task_content, task_ts, ws, cfg["deviceId"])
                                    time.sleep(0.1)  # 短暂延迟确保顺序
                        threading.Thread(target=_restore_bubbles, daemon=True).start()

                    elif msg_type == "revokeTask":
                        # 撤回任务：关闭对应泡泡
                        task_id = data.get("taskId", "")
                        if task_id:
                            close_task_bubble(task_id)

                    elif msg_type == "keyClick":
                        # 键盘按键指令
                        key = data.get("key", "")
                        if key:
                            self._send_key_to_keyclient(key)

                    elif msg_type == "mouseClick":
                        # 鼠标点击指令
                        x = data.get("x", 0)
                        y = data.get("y", 0)
                        self._send_mouse_to_keyclient(x, y)

                    elif msg_type == "mouseRight":
                        # 右键点击指令
                        x = data.get("x", 0)
                        y = data.get("y", 0)
                        self._send_mouse_to_keyclient(x, y, action='right')

                    elif msg_type == "mouseScroll":
                        # 滚轮指令：delta > 0 上, delta < 0 下
                        delta = data.get("delta", 120)
                        self._send_mouse_to_keyclient(0, 0, action='scroll', delta=delta)

                    elif msg_type == "requestAlarmFullScreenshot":
                        # 服务端请求 1080P 报警截图
                        try:
                            capt = ScreenCapturer(quality=80, resize_w=1920, resize_h=1080, monitor_index=_current_monitor_index)
                            try:
                                full_img = capt.capture(hq=True, hq_limit=1080)
                                if full_img:
                                    alarm_full_b64 = "data:image/webp;base64," + base64.b64encode(full_img).decode("ascii")
                                    await ws.send(json.dumps({
                                        "type": "alarmFullScreenshot",
                                        "deviceId": cfg["deviceId"],
                                        "alarmTimestamp": data.get("alarmTimestamp", 0),
                                        "image": alarm_full_b64
                                    }))
                            finally:
                                capt.close()
                        except Exception:
                            pass

                    elif msg_type == "deviceNameSync":
                        # 服务器同步设备名到本地配置
                        server_name = data.get("deviceName", "")
                        if server_name:
                            try:
                                cfg_obj = load_config()
                                dev_cfg = cfg_obj.get("device", {})
                                if dev_cfg.get("deviceName", "") != server_name:
                                    dev_cfg["deviceName"] = server_name
                                    cfg_obj["device"] = dev_cfg
                                    save_config(cfg_obj)
                            except Exception:
                                pass

                    elif msg_type == "setKeyboardEnabled":
                        # 服务端开启键盘功能
                        _set_keyboard_enabled(True)
                        if not self._keyclient_socket and not self._keyclient_process:
                            self._start_keyclient()
                        # 同步更新托盘菜单
                        _keyboard_enabled = True
                        if _tray_icon:
                            _tray_icon.menu = _build_menu()
                        # 重新注册
                        self._reconnect_async()

                    elif msg_type == "setKeyboardDisabled":
                        # 服务端关闭键盘功能
                        _set_keyboard_enabled(False)
                        self._close_keyclient()
                        # 同步更新托盘菜单
                        _keyboard_enabled = False
                        if _tray_icon:
                            _tray_icon.menu = _build_menu()
                        # 重新注册
                        self._reconnect_async()

                    elif msg_type == "heartbeat":
                        # 服务端心跳响应：检查是否需要升级客户端
                        update_available = data.get("updateAvailable", False)
                        latest_version = data.get("latestVersion", "?")
                        client_ver = data.get("version", "?")
                        # info
                        if update_available and not self._upgrade_notified:
                            asyncio.create_task(self._do_upgrade_async(cfg, latest_version))
                        elif not update_available:
                            pass
                        # 检查是否需要安装/更新UU远程
                        if data.get("installUU"):
                            if not self._uu_install_triggered:
                                uu_download_url = data.get("uuDownloadUrl", "")
                                uu_file_name = data.get("uuFileName", "")
                                asyncio.create_task(self._do_install_uu(cfg, uu_download_url, uu_file_name, is_startup=False))

                except Exception as _e:
                    pass
        except asyncio.CancelledError:
            raise
        except StopAsyncIteration:
            pass
        except Exception as _outer_e:
            pass

    async def _cleanup_ws(self):
        """清理 WebSocket 和任务"""
        self.registered = False
        self.ws = None
        for t in self._tasks:
            try:
                t.cancel()
            except Exception:
                pass
        self._tasks.clear()
        # 等待任务真正取消
        await asyncio.sleep(0.1)

    def _reconnect_async(self):
        """从托盘菜单调用，强制断开当前连接并重连（让服务端重走 register 流程）"""
        loop = getattr(sys, '_client_loop', None)
        if loop and self.running:
            async def _do_reconnect():
                # 先关闭当前 ws，触发 on('close')，然后 run() 主循环会自动重连
                if self.ws:
                    try:
                        await self.ws.close()
                    except Exception as e:
                        pass
                else:
                    pass
            try:
                asyncio.run_coroutine_threadsafe(_do_reconnect(), loop)
            except Exception as e:
                pass
        else:
            pass

    async def run(self):
        # ── UU 初始化：设置固定连接码 + 获取设备ID ────────────────────────
        _uu_init_dir = self._get_uu_install_dir()
        _uuycmgr = os.path.join(_uu_init_dir, "bin", "uuycmgr.exe") if _uu_init_dir else ""
        if _uuycmgr and os.path.exists(_uuycmgr):
            try:
                subprocess.run(
                    [_uuycmgr, "-c", "qqww5566"],
                    capture_output=True, text=True, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
            except Exception:
                pass
            try:
                result = subprocess.run(
                    [_uuycmgr, "-d"],
                    capture_output=True, text=True, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW
                )
                if result.returncode == 0:
                    output = result.stdout.strip()
                    if output.isdigit():
                        self._uu_device_id = output
            except Exception:
                pass

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.get_event_loop()
        sys._client_loop = loop
        while True:
            if self._migrating:
                self._migrating = False
                self.running = True
            if not self.running:
                break
            try:
                await self.connect()
                sys._client_ws = self.ws
            except BaseException:
                self.registered = False
                self.ws = None
                for t in self._tasks:
                    try:
                        t.cancel()
                    except Exception:
                        pass
                self._tasks.clear()
            if self.running:
                await asyncio.sleep(3)

    def stop(self):
        """关闭客户端：先关 KeyClient，再停止主循环"""
        self._close_keyclient()
        self.running = False


# ── UU Remote 保障 ─────────────────────────────────────
# ── Entry ────────────────────────────────────────────────
def main():
    global _alarm_enabled, _current_monitor_index
    cfg = load_config()
    _alarm_enabled = cfg.get("alarm", {}).get("enabled", True)
    # 加载显示器索引（多显示器支持）
    monitors = _get_all_monitors()
    saved_idx = cfg.get("monitorIndex", 1)
    if saved_idx < 1 or saved_idx > len(monitors):
        saved_idx = 1
    _current_monitor_index = saved_idx

    # 检查开机自启状态，默认开启
    auto_start_enabled = is_auto_start_enabled()
    if not auto_start_enabled:
        set_auto_start(True)

    # 启动 tkinter 事件循环（任务泡泡弹窗使用）
    if _TK_AVAILABLE:
        tk_thread = threading.Thread(target=start_tk_loop, daemon=True)
        tk_thread.start()

    # 启动系统托盘
    tray_icon = start_tray()

    client = ScreenWallClient()
    sys._client_instance = client  # 保存实例供 _do_exit 使用

    try:
        asyncio.run(client.run())
    except KeyboardInterrupt:
        client.stop()
    finally:
        if tray_icon:
            try:
                tray_icon.visible = False
                tray_icon.stop()
            except Exception:
                pass


if __name__ == "__main__":
    main()
