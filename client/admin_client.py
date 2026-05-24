"""
ScreenWall Admin Client - 管理员专用客户端
功能：
- 系统托盘图标
- 打开屏幕墙（自动登录，免验证）
- 自助登号（自动登录，免验证）
- 设置服务器IP:端口
- 开机自启
- 退出
"""
import os
import sys
import json
import threading
import time
import webbrowser
import urllib.parse
import ctypes
import winreg
from pathlib import Path
import base64

# 管理员客户端版本
ADMIN_VERSION = "1.0.0"
# 管理员固定信息
ADMIN_DEVICE_ID = "ADMN"
ADMIN_DEVICE_NAME = "屏幕墙管理员"
# 开机自启配置
APP_NAME = "ScreenWallAdmin"
EXE_PATH = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)

# 全局变量
_tray_icon = None
_config = None
_config_path = None


def get_config_dir():
    """获取配置文件存储目录（用户目录下的 ScreenWallAdmin）"""
    app_data = os.environ.get('APPDATA')
    if not app_data:
        app_data = os.path.expanduser('~')
    config_dir = os.path.join(app_data, 'ScreenWallAdmin')
    os.makedirs(config_dir, exist_ok=True)
    return config_dir


def get_config_path():
    """获取配置文件完整路径"""
    return os.path.join(get_config_dir(), 'config.json')


def load_config():
    """加载配置文件"""
    global _config, _config_path
    if _config_path is None:
        _config_path = get_config_path()
    
    default_config = {
        "server": {
            "host": "localhost",
            "port": 3000
        }
    }
    
    if os.path.exists(_config_path):
        try:
            with open(_config_path, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                # 合并默认配置
                for key, value in default_config.items():
                    if key not in loaded:
                        loaded[key] = value
                _config = loaded
                return _config
        except Exception:
            pass
    
    _config = default_config
    save_config(_config)
    return _config


def save_config(cfg):
    """保存配置文件"""
    global _config, _config_path
    if _config_path is None:
        _config_path = get_config_path()
    _config = cfg
    try:
        with open(_config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


def is_auto_start_enabled():
    """检查是否已开启开机自启"""
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                             r"Software\Microsoft\Windows\CurrentVersion\Run",
                             0, winreg.KEY_READ)
        try:
            winreg.QueryValueEx(key, APP_NAME)
            winreg.CloseKey(key)
            return True
        except FileNotFoundError:
            winreg.CloseKey(key)
            return False
    except Exception:
        return False


def set_auto_start(enabled):
    """设置开机自启"""
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                             r"Software\Microsoft\Windows\CurrentVersion\Run",
                             0, winreg.KEY_SET_VALUE)
        if enabled:
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


def generate_admin_token():
    """生成管理员自动登录 token（不过期，免验证）"""
    timestamp = str(int(time.time()))
    token_str = f"{ADMIN_DEVICE_ID}:{timestamp}:admin"
    token = base64.b64encode(token_str.encode('utf-8')).decode('utf-8')
    return token


def get_chromium_browser_path():
    """获取 Chrome 或 Edge 浏览器路径"""
    common_paths = [
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for path in common_paths:
        if os.path.exists(path):
            return path
    return None


def open_self_service_page(url):
    """用特殊模式打开自助登号页面（APP模式）"""
    browser_path = get_chromium_browser_path()
    if browser_path:
        exe_name = os.path.basename(browser_path).lower()
        if exe_name in ("chrome.exe", "msedge.exe"):
            import subprocess
            import tempfile
            import atexit
            
            temp_dir = tempfile.mkdtemp(prefix="screenwall_admin_")
            
            def cleanup_temp():
                try:
                    import shutil
                    shutil.rmtree(temp_dir, ignore_errors=True)
                except:
                    pass
            atexit.register(cleanup_temp)
            
            # 计算窗口位置居中
            try:
                user32 = ctypes.windll.user32
                screen_w = user32.GetSystemMetrics(0)
                screen_h = user32.GetSystemMetrics(1)
                
                base_w = 510
                base_h = 960
                
                if screen_h <= 1080:
                    win_w = base_w
                    win_h = base_h
                else:
                    screen_ratio = 0.7
                    win_h = int(screen_h * screen_ratio)
                    win_w = int(win_h * base_w / base_h)
                
                pos_x = (screen_w - win_w) // 2
                pos_y = (screen_h - win_h) // 2
            except:
                win_w = 510
                win_h = 960
                pos_x = (1366 - win_w) // 2
                pos_y = 100
            
            subprocess.Popen([
                browser_path,
                "--app=" + url,
                f"--window-size={win_w},{win_h}",
                "--window-position=" + str(pos_x) + "," + str(pos_y),
                "--new-window",
                "--disable-session-crashed-bubble",
                "--no-first-run",
                "--user-data-dir=" + temp_dir
            ])
            return
    
    # 回退到默认浏览器
    webbrowser.open(url)


def _tray_on_open_screenwall(icon, item):
    """打开屏幕墙"""
    cfg = load_config()
    srv = cfg.get("server", {})
    host = srv.get("host", "localhost").replace("http://", "").replace("https://", "").rstrip("/")
    port = srv.get("port", 3000)
    
    auto_token = generate_admin_token()
    params = [
        "auto=1",
        f"token={auto_token}",
        f"deviceId={urllib.parse.quote(ADMIN_DEVICE_ID)}",
        f"deviceName={urllib.parse.quote(ADMIN_DEVICE_NAME)}"
    ]
    page_url = f"http://{host}:{port}/main.html?{'&'.join(params)}"
    webbrowser.open(page_url)


def _tray_on_open_self_service(icon, item):
    """打开自助登号"""
    cfg = load_config()
    srv = cfg.get("server", {})
    host = srv.get("host", "localhost").replace("http://", "").replace("https://", "").rstrip("/")
    port = srv.get("port", 3000)
    
    auto_token = generate_admin_token()
    params = [
        "auto=1",
        f"token={auto_token}",
        f"deviceId={urllib.parse.quote(ADMIN_DEVICE_ID)}",
        f"deviceName={urllib.parse.quote(ADMIN_DEVICE_NAME)}"
    ]
    page_url = f"http://{host}:{port}/self-service.html?{'&'.join(params)}"
    open_self_service_page(page_url)


def _tray_on_toggle_auto_start(icon, item):
    """切换开机自启"""
    new_state = not is_auto_start_enabled()
    set_auto_start(new_state)
    icon.menu = _build_menu()


def _tray_on_set_server(icon, item):
    """设置服务器地址"""
    try:
        import tkinter as tk
        from tkinter import simpledialog, messagebox
        
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        root.lift()
        root.focus_force()
        
        cfg = load_config()
        srv = cfg.get("server", {})
        current_host = srv.get("host", "localhost")
        current_port = srv.get("port", 3000)
        current_value = f"{current_host}:{current_port}"
        
        result = simpledialog.askstring(
            "设置服务器",
            "请输入服务器地址（格式：IP:端口）",
            initialvalue=current_value,
            parent=root
        )
        
        if result:
            result = result.strip()
            if ':' in result:
                host_part, port_part = result.split(':', 1)
                host = host_part.strip()
                try:
                    port = int(port_part.strip())
                except ValueError:
                    port = 3000
            else:
                host = result
                port = 3000
            
            if host:
                cfg["server"] = {"host": host, "port": port}
                save_config(cfg)
                messagebox.showinfo("成功", f"服务器地址已设置为：{host}:{port}")
        
        root.destroy()
    except Exception:
        try:
            # tkinter 不可用时，尝试原生 MessageBox + 简单输入（简化版）
            MB_ICONINFORMATION = 0x40
            MB_OK = 0x0
            MB_TOPMOST = 0x40000
            MB_SETFOREGROUND = 0x10000
            
            ctypes.windll.user32.MessageBoxW(
                None,
                "请手动编辑配置文件设置服务器地址",
                "提示",
                MB_ICONINFORMATION | MB_OK | MB_TOPMOST | MB_SETFOREGROUND
            )
            
            # 打开配置文件所在目录
            config_dir = get_config_dir()
            os.startfile(config_dir)
        except Exception:
            pass


def _tray_on_quit(icon, item):
    """退出"""
    global _tray_icon
    if _tray_icon:
        try:
            _tray_icon.visible = False
            time.sleep(0.1)
            _tray_icon.stop()
        except Exception:
            pass
    os._exit(0)


def _build_menu():
    """构建托盘菜单"""
    try:
        from pystray import Menu, MenuItem
    except ImportError:
        return None
    
    return Menu(
        MenuItem("ScreenWall Admin", lambda i, t: None, enabled=False),
        MenuItem("打开屏幕墙", _tray_on_open_screenwall),
        MenuItem("自助登号", _tray_on_open_self_service),
        MenuItem("设置服务器地址", _tray_on_set_server),
        MenuItem("开机自启", _tray_on_toggle_auto_start,
                 checked=lambda item: is_auto_start_enabled()),
        MenuItem("退出", _tray_on_quit),
    )


def _create_tray_img():
    """创建托盘图标图片（蓝色圆形 + AD 文字，透明背景）"""
    try:
        from PIL import Image as PILImage, ImageDraw
    except ImportError:
        return None
    
    img = PILImage.new("RGBA", (64, 64), color=(0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # 蓝色圆形
    draw.ellipse([4, 4, 60, 60], fill=(59, 130, 246, 255))
    # AD 文字
    draw.text((14, 18), "AD", fill=(255, 255, 255, 255))
    return img


def start_tray():
    """启动系统托盘图标"""
    global _tray_icon
    try:
        from pystray import Icon
    except ImportError:
        print("缺少 pystray 库，请安装：pip install pystray")
        return None
    
    try:
        img = _create_tray_img()
        _tray_icon = Icon("ScreenWallAdmin", img, "ScreenWall Admin", _build_menu())
        
        t = threading.Thread(target=_tray_icon.run, daemon=True)
        t.start()
        return _tray_icon
    except Exception as e:
        import tempfile
        try:
            with open(os.path.join(tempfile.gettempdir(), "sw_admin_tray_err.txt"), "w", encoding="utf-8") as f:
                import traceback as tb
                tb.print_exc(file=f)
                f.write(f"\nException: {e}\n")
        except Exception:
            pass
        return None


def check_first_run():
    """检查是否首次运行，首次运行弹出服务器设置"""
    config_path = get_config_path()
    is_first_run = not os.path.exists(config_path)
    
    if is_first_run:
        try:
            import tkinter as tk
            from tkinter import simpledialog, messagebox
            
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            root.lift()
            root.focus_force()
            
            result = simpledialog.askstring(
                "设置服务器",
                "请输入服务器地址（格式：IP:端口）\n例如：192.168.1.100:3000",
                initialvalue="localhost:3000",
                parent=root
            )
            
            if result:
                result = result.strip()
                if ':' in result:
                    host_part, port_part = result.split(':', 1)
                    host = host_part.strip()
                    try:
                        port = int(port_part.strip())
                    except ValueError:
                        port = 3000
                else:
                    host = result
                    port = 3000
                
                if host:
                    cfg = load_config()
                    cfg["server"] = {"host": host, "port": port}
                    save_config(cfg)
            
            root.destroy()
        except Exception:
            pass


def main():
    """主函数"""
    # 首次运行检查
    check_first_run()
    
    # 加载配置
    load_config()
    
    # 检查开机自启状态，默认开启
    auto_start_enabled = is_auto_start_enabled()
    if not auto_start_enabled:
        set_auto_start(True)
    
    # 启动托盘
    tray = start_tray()
    if tray is None:
        print("启动托盘图标失败！")
        return
    
    # 保持运行
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
