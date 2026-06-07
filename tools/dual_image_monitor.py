import os
import sys
import json
import asyncio
import threading
from pathlib import Path
from datetime import datetime
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import base64
from aiohttp import web
import watchdog.observers
import watchdog.events
try:
    import winreg
except ImportError:
    winreg = None

if getattr(sys, 'frozen', False):
    APP_DIR = Path(sys.executable).parent
else:
    APP_DIR = Path(__file__).parent

CONFIG_FILE = APP_DIR / 'dual_image_config.json'
DEFAULT_PORT = 8765
AUTOSTART_REG_KEY = r'Software\Microsoft\Windows\CurrentVersion\Run'
AUTOSTART_REG_VALUE = 'DualImageMonitor'

class DualImageMonitor:
    def __init__(self):
        self.config = self.load_config()
        self.server_thread = None
        self.server_running = False
        self.app = None
        self.runner = None
        self.site = None
        self.loop = None
        self.observer = None
        self.image_cache = {'left': None, 'right': None}
        self.cache_ready = {'left': False, 'right': False}
        self.ws_clients = set()
        self.last_mtime = {'left': 0, 'right': 0}
        
        self.setup_gui()
        
    def load_config(self):
        try:
            if CONFIG_FILE.exists():
                return json.loads(CONFIG_FILE.read_text())
        except:
            pass
        return {
            'left_image': '',
            'right_image': '',
            'port': DEFAULT_PORT,
            'auto_startup': False,
            'auto_start_service': False
        }
    
    def save_config(self):
        CONFIG_FILE.write_text(json.dumps(self.config, indent=2))
    
    def setup_gui(self):
        self.root = tk.Tk()
        self.root.title('双图监控服务')
        self.root.geometry('420x300')
        self.root.resizable(False, False)
        self.root.iconbitmap(default='')
        
        main_frame = ttk.Frame(self.root, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        port_frame = ttk.LabelFrame(main_frame, text='服务端口', padding=5)
        port_frame.pack(fill=tk.X, pady=5)
        
        self.port_var = tk.StringVar(value=str(self.config.get('port', DEFAULT_PORT)))
        ttk.Label(port_frame, text='端口:').pack(side=tk.LEFT, padx=5)
        ttk.Entry(port_frame, textvariable=self.port_var, width=8).pack(side=tk.LEFT, padx=5)
        ttk.Label(port_frame, text='（访问: http://IP:端口）').pack(side=tk.LEFT, padx=5)
        
        image_frame = ttk.LabelFrame(main_frame, text='图片设置', padding=5)
        image_frame.pack(fill=tk.X, pady=5)
        
        left_frame = ttk.Frame(image_frame)
        left_frame.pack(fill=tk.X, pady=2)
        ttk.Label(left_frame, text='左5发图片:').pack(side=tk.LEFT, padx=5)
        self.left_var = tk.StringVar(value=self.config.get('left_image', ''))
        ttk.Entry(left_frame, textvariable=self.left_var, width=28).pack(side=tk.LEFT, padx=5)
        ttk.Button(left_frame, text='选择', command=self.select_left_image).pack(side=tk.LEFT, padx=3)
        
        right_frame = ttk.Frame(image_frame)
        right_frame.pack(fill=tk.X, pady=2)
        ttk.Label(right_frame, text='右5发图片:').pack(side=tk.LEFT, padx=5)
        self.right_var = tk.StringVar(value=self.config.get('right_image', ''))
        ttk.Entry(right_frame, textvariable=self.right_var, width=28).pack(side=tk.LEFT, padx=5)
        ttk.Button(right_frame, text='选择', command=self.select_right_image).pack(side=tk.LEFT, padx=3)
        
        options_frame = ttk.Frame(main_frame)
        options_frame.pack(fill=tk.X, pady=5)
        
        self.auto_startup_var = tk.BooleanVar(value=self.config.get('auto_startup', False))
        self.auto_startup_cb = ttk.Checkbutton(
            options_frame,
            text='自动开机启动',
            variable=self.auto_startup_var,
            command=self.toggle_auto_startup
        )
        self.auto_startup_cb.pack(side=tk.LEFT, padx=5)
        
        self.auto_start_service_var = tk.BooleanVar(value=self.config.get('auto_start_service', False))
        self.auto_start_service_cb = ttk.Checkbutton(
            options_frame,
            text='自动启动服务',
            variable=self.auto_start_service_var,
            command=self.toggle_auto_start_service
        )
        self.auto_start_service_cb.pack(side=tk.LEFT, padx=5)
        
        control_frame = ttk.Frame(main_frame)
        control_frame.pack(fill=tk.X, pady=10)
        
        self.start_btn = ttk.Button(control_frame, text='启动服务', command=self.start_server)
        self.start_btn.pack(side=tk.LEFT, padx=10)
        
        self.stop_btn = ttk.Button(control_frame, text='停止服务', command=self.stop_server, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT, padx=10)
        
        self.status_var = tk.StringVar(value='状态: 未启动')
        ttk.Label(control_frame, textvariable=self.status_var).pack(side=tk.LEFT, padx=10)
        
        self.root.protocol('WM_DELETE_WINDOW', self.on_close)
        
        self.check_autostart_registry()
        
    def select_left_image(self):
        file = filedialog.askopenfilename(
            title='选择左5发图片',
            filetypes=[('图片文件', '*.png *.jpg *.jpeg *.bmp *.gif *.webp')]
        )
        if file:
            self.left_var.set(file)
            self.config['left_image'] = file
            self.save_config()
            
    def select_right_image(self):
        file = filedialog.askopenfilename(
            title='选择右5发图片',
            filetypes=[('图片文件', '*.png *.jpg *.jpeg *.bmp *.gif *.webp')]
        )
        if file:
            self.right_var.set(file)
            self.config['right_image'] = file
            self.save_config()
    
    def check_can_auto_start_service(self):
        left_img = self.left_var.get()
        right_img = self.right_var.get()
        if not left_img or not right_img:
            return False
        if not os.path.exists(left_img) or not os.path.exists(right_img):
            return False
        try:
            int(self.port_var.get())
        except:
            return False
        if not CONFIG_FILE.exists():
            return False
        return True
    
    def toggle_auto_start_service(self):
        if self.auto_start_service_var.get():
            if not self.check_can_auto_start_service():
                self.auto_start_service_var.set(False)
                messagebox.showwarning('提示', '请先设置图片')
                return
        self.config['auto_start_service'] = self.auto_start_service_var.get()
        self.save_config()
    
    def check_autostart_registry(self):
        if winreg is None:
            self.auto_startup_var.set(False)
            self.config['auto_startup'] = False
            return
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_KEY)
            value, _ = winreg.QueryValueEx(key, AUTOSTART_REG_VALUE)
            winreg.CloseKey(key)
            if value:
                self.auto_startup_var.set(True)
                self.config['auto_startup'] = True
            else:
                self.auto_startup_var.set(False)
                self.config['auto_startup'] = False
        except:
            self.auto_startup_var.set(False)
            self.config['auto_startup'] = False
    
    def toggle_auto_startup(self):
        enabled = self.auto_startup_var.get()
        self.config['auto_startup'] = enabled
        self.save_config()
        
        if winreg is None:
            self.auto_startup_var.set(False)
            messagebox.showerror('错误', '注册表操作不可用')
            return
        
        try:
            if enabled:
                exe_path = str(sys.executable) if getattr(sys, 'frozen', False) else str(Path(sys.executable))
                key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_KEY, 0, winreg.KEY_SET_VALUE)
                winreg.SetValueEx(key, AUTOSTART_REG_VALUE, 0, winreg.REG_SZ, exe_path)
                winreg.CloseKey(key)
            else:
                try:
                    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, AUTOSTART_REG_KEY, 0, winreg.KEY_SET_VALUE)
                    winreg.DeleteValue(key, AUTOSTART_REG_VALUE)
                    winreg.CloseKey(key)
                except:
                    pass
        except Exception as e:
            self.auto_startup_var.set(not enabled)
            messagebox.showerror('错误', f'操作失败: {e}')
    
    def start_auto_startup_service_check(self):
        if self.config.get('auto_start_service', False):
            if self.check_can_auto_start_service():
                self.start_server()
            
    def start_server(self):
        if self.server_running:
            return
        
        left_img = self.left_var.get()
        right_img = self.right_var.get()
        if not left_img or not right_img:
            messagebox.showwarning('提示', '请选择两张图片')
            return
        
        if not os.path.exists(left_img):
            messagebox.showwarning('提示', '左5发图片不存在')
            return
        if not os.path.exists(right_img):
            messagebox.showwarning('提示', '右5发图片不存在')
            return
        
        try:
            port = int(self.port_var.get())
        except:
            port = DEFAULT_PORT
        
        self.config['left_image'] = left_img
        self.config['right_image'] = right_img
        self.config['port'] = port
        self.save_config()
        
        self.server_running = True
        self.start_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)
        self.status_var.set(f'运行中 (端口 {port})')
        
        self.server_thread = threading.Thread(target=self.run_server, daemon=True)
        self.server_thread.start()
        
        self.start_file_monitor()
        
    def stop_server(self):
        if not self.server_running:
            return
        
        self.server_running = False
        self.stop_file_monitor()
        
        if self.loop and self.site:
            asyncio.run_coroutine_threadsafe(self.site.stop(), self.loop)
        
        self.start_btn.config(state=tk.NORMAL)
        self.stop_btn.config(state=tk.DISABLED)
        self.status_var.set('状态: 已停止')
        
    def run_server(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        
        self.app = web.Application()
        self.app.router.add_get('/', self.handle_index)
        self.app.router.add_get('/ws', self.handle_ws)
        
        self.runner = web.AppRunner(self.app)
        self.loop.run_until_complete(self.runner.setup())
        
        port = int(self.port_var.get())
        self.site = web.TCPSite(self.runner, '0.0.0.0', port)
        self.loop.run_until_complete(self.site.start())
        
        self.load_initial_images()
        
        self.loop.run_forever()
        
    async def handle_index(self, request):
        html = self.get_html_page()
        return web.Response(text=html, content_type='text/html')
        
    async def handle_ws(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        self.ws_clients.add(ws)
        
        if self.cache_ready['left'] and self.cache_ready['right']:
            await self.send_images_to_client(ws)
        
        try:
            async for msg in ws:
                pass
        except:
            pass
        
        self.ws_clients.discard(ws)
        
        return ws
        
    async def send_images_to_client(self, ws):
        if ws.closed:
            return
        
        left_b64 = base64.b64encode(self.image_cache['left']).decode() if self.image_cache['left'] else ''
        right_b64 = base64.b64encode(self.image_cache['right']).decode() if self.image_cache['right'] else ''
        
        await ws.send_json({
            'type': 'update',
            'left': left_b64,
            'right': right_b64,
            'timestamp': datetime.now().isoformat()
        })
        
    async def broadcast_images(self):
        if not self.ws_clients:
            return
        
        left_b64 = base64.b64encode(self.image_cache['left']).decode() if self.image_cache['left'] else ''
        right_b64 = base64.b64encode(self.image_cache['right']).decode() if self.image_cache['right'] else ''
        
        msg = {
            'type': 'update',
            'left': left_b64,
            'right': right_b64,
            'timestamp': datetime.now().isoformat()
        }
        
        for ws in list(self.ws_clients):
            try:
                if not ws.closed:
                    await ws.send_json(msg)
            except:
                self.ws_clients.discard(ws)
                
    def load_initial_images(self):
        left_path = self.config.get('left_image', '')
        right_path = self.config.get('right_image', '')
        
        if left_path and os.path.exists(left_path):
            self.image_cache['left'] = self.read_image(left_path)
            self.cache_ready['left'] = True
            self.last_mtime['left'] = os.path.getmtime(left_path)
        
        if right_path and os.path.exists(right_path):
            self.image_cache['right'] = self.read_image(right_path)
            self.cache_ready['right'] = True
            self.last_mtime['right'] = os.path.getmtime(right_path)
                
    def read_image(self, path):
        try:
            with open(path, 'rb') as f:
                return f.read()
        except:
            return None
            
    def start_file_monitor(self):
        left_path = self.config.get('left_image', '')
        right_path = self.config.get('right_image', '')
        
        self.observer = watchdog.observers.Observer()
        handler = ImageChangeHandler(self)
        
        if left_path:
            left_folder = os.path.dirname(left_path)
            if os.path.isdir(left_folder):
                self.observer.schedule(handler, left_folder, recursive=False)
        
        if right_path:
            right_folder = os.path.dirname(right_path)
            if os.path.isdir(right_folder) and right_folder != os.path.dirname(left_path):
                self.observer.schedule(handler, right_folder, recursive=False)
        
        self.observer.start()
        
    def stop_file_monitor(self):
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.observer = None
            
    def on_image_changed(self, path):
        left_path = self.config.get('left_image', '')
        right_path = self.config.get('right_image', '')
        
        side = None
        if os.path.normpath(path) == os.path.normpath(left_path):
            side = 'left'
        elif os.path.normpath(path) == os.path.normpath(right_path):
            side = 'right'
        
        if not side:
            return
        
        try:
            current_mtime = os.path.getmtime(path)
        except:
            return
        
        if current_mtime <= self.last_mtime[side]:
            return
        
        self.last_mtime[side] = current_mtime
        
        self.image_cache[side] = self.read_image(path)
        self.cache_ready[side] = True
        
        if self.loop and self.server_running:
            asyncio.run_coroutine_threadsafe(self.broadcast_images(), self.loop)
                
    def get_html_page(self):
        return '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>双图监控</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  width: 100%;
  height: 100%;
  background: #1a1a2e;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
}
.container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  width: 100%;
  height: 100%;
  padding: 20px;
}
.image-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  max-width: 50%;
}
.image-wrapper {
  width: 100%;
  height: calc(100% - 50px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f0f1a;
  border: 3px solid #4f8ef7;
  border-radius: 8px;
  overflow: hidden;
}
.image-wrapper img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.label-box {
  margin-top: 10px;
  padding: 8px 20px;
  background: #4f8ef7;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}
</style>
</head>
<body>
<div class="container">
  <div class="image-box">
    <div class="image-wrapper">
      <img id="leftImage" alt="左5发" src="">
    </div>
    <div class="label-box">左5发</div>
  </div>
  <div class="image-box">
    <div class="image-wrapper">
      <img id="rightImage" alt="右5发" src="">
    </div>
    <div class="label-box">右5发</div>
  </div>
</div>
<script>
var ws = null;
var leftImg = document.getElementById('leftImage');
var rightImg = document.getElementById('rightImage');

function connect() {
  var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(wsUrl);
  
  ws.onclose = function() {
    setTimeout(connect, 3000);
  };
  
  ws.onmessage = function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.type === 'update') {
        if (data.left) {
          leftImg.src = 'data:image/webp;base64,' + data.left;
        }
        if (data.right) {
          rightImg.src = 'data:image/webp;base64,' + data.right;
        }
      }
    } catch(err) {}
  };
}

connect();
</script>
</body>
</html>'''
        
    def on_close(self):
        self.stop_server()
        self.root.destroy()
        
    def run(self):
        self.root.after(100, self.start_auto_startup_service_check)
        self.root.mainloop()

class ImageChangeHandler(watchdog.events.FileSystemEventHandler):
    def __init__(self, monitor):
        self.monitor = monitor
        
    def on_modified(self, event):
        if not event.is_directory:
            self.monitor.on_image_changed(event.src_path)
            
    def on_created(self, event):
        if not event.is_directory:
            self.monitor.on_image_changed(event.src_path)

def main():
    app = DualImageMonitor()
    app.run()

if __name__ == '__main__':
    main()