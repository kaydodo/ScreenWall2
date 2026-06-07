import os
import sys
import json
import asyncio
import threading
import time
from pathlib import Path
from datetime import datetime
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import base64
from aiohttp import web
import watchdog.observers
import watchdog.events

CONFIG_FILE = Path(__file__).parent / 'dual_image_config.json'
DEFAULT_PORT = 8765

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
            'folder': '',
            'left_image': '',
            'right_image': '',
            'port': DEFAULT_PORT
        }
    
    def save_config(self):
        CONFIG_FILE.write_text(json.dumps(self.config, indent=2))
    
    def setup_gui(self):
        self.root = tk.Tk()
        self.root.title('双图监控服务')
        self.root.geometry('600x400')
        self.root.resizable(True, True)
        
        main_frame = ttk.Frame(self.root, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        folder_frame = ttk.LabelFrame(main_frame, text='图片文件夹', padding=5)
        folder_frame.pack(fill=tk.X, pady=5)
        
        self.folder_var = tk.StringVar(value=self.config.get('folder', ''))
        ttk.Entry(folder_frame, textvariable=self.folder_var, width=50).pack(side=tk.LEFT, padx=5)
        ttk.Button(folder_frame, text='选择文件夹', command=self.select_folder).pack(side=tk.LEFT, padx=5)
        
        port_frame = ttk.LabelFrame(main_frame, text='服务端口', padding=5)
        port_frame.pack(fill=tk.X, pady=5)
        
        self.port_var = tk.StringVar(value=str(self.config.get('port', DEFAULT_PORT)))
        ttk.Entry(port_frame, textvariable=self.port_var, width=10).pack(side=tk.LEFT, padx=5)
        ttk.Label(port_frame, text='（外部访问: http://IP:端口）').pack(side=tk.LEFT, padx=5)
        
        image_frame = ttk.LabelFrame(main_frame, text='图片设置', padding=5)
        image_frame.pack(fill=tk.X, pady=5)
        
        left_frame = ttk.Frame(image_frame)
        left_frame.pack(fill=tk.X, pady=2)
        ttk.Label(left_frame, text='前5发图片:').pack(side=tk.LEFT, padx=5)
        self.left_var = tk.StringVar(value=self.config.get('left_image', ''))
        self.left_combo = ttk.Combobox(left_frame, textvariable=self.left_var, width=30)
        self.left_combo.pack(side=tk.LEFT, padx=5)
        ttk.Button(left_frame, text='选择', command=self.select_left_image).pack(side=tk.LEFT, padx=5)
        
        right_frame = ttk.Frame(image_frame)
        right_frame.pack(fill=tk.X, pady=2)
        ttk.Label(right_frame, text='后5发图片:').pack(side=tk.LEFT, padx=5)
        self.right_var = tk.StringVar(value=self.config.get('right_image', ''))
        self.right_combo = ttk.Combobox(right_frame, textvariable=self.right_var, width=30)
        self.right_combo.pack(side=tk.LEFT, padx=5)
        ttk.Button(right_frame, text='选择', command=self.select_right_image).pack(side=tk.LEFT, padx=5)
        
        control_frame = ttk.Frame(main_frame)
        control_frame.pack(fill=tk.X, pady=10)
        
        self.start_btn = ttk.Button(control_frame, text='启动服务', command=self.start_server)
        self.start_btn.pack(side=tk.LEFT, padx=10)
        
        self.stop_btn = ttk.Button(control_frame, text='停止服务', command=self.stop_server, state=tk.DISABLED)
        self.stop_btn.pack(side=tk.LEFT, padx=10)
        
        self.status_var = tk.StringVar(value='状态: 未启动')
        ttk.Label(control_frame, textvariable=self.status_var).pack(side=tk.LEFT, padx=20)
        
        log_frame = ttk.LabelFrame(main_frame, text='日志', padding=5)
        log_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        
        self.log_text = tk.Text(log_frame, height=8, state=tk.DISABLED)
        self.log_text.pack(fill=tk.BOTH, expand=True)
        
        scrollbar = ttk.Scrollbar(log_frame, orient=tk.VERTICAL, command=self.log_text.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.log_text.config(yscrollcommand=scrollbar.set)
        
        self.root.protocol('WM_DELETE_WINDOW', self.on_close)
        
    def log(self, msg):
        timestamp = datetime.now().strftime('%H:%M:%S')
        self.log_text.config(state=tk.NORMAL)
        self.log_text.insert(tk.END, f'[{timestamp}] {msg}\n')
        self.log_text.see(tk.END)
        self.log_text.config(state=tk.DISABLED)
        
    def select_folder(self):
        folder = filedialog.askdirectory(title='选择图片文件夹')
        if folder:
            self.folder_var.set(folder)
            self.config['folder'] = folder
            self.save_config()
            self.update_image_list()
            self.log(f'已选择文件夹: {folder}')
            
    def update_image_list(self):
        folder = self.folder_var.get()
        if not folder or not os.path.isdir(folder):
            return
        
        images = []
        for f in os.listdir(folder):
            if f.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp')):
                images.append(f)
        
        self.left_combo['values'] = images
        self.right_combo['values'] = images
        
    def select_left_image(self):
        folder = self.folder_var.get()
        if not folder:
            messagebox.showwarning('提示', '请先选择文件夹')
            return
        file = filedialog.askopenfilename(
            title='选择前5发图片',
            initialdir=folder,
            filetypes=[('图片文件', '*.png *.jpg *.jpeg *.bmp *.gif *.webp')]
        )
        if file:
            name = os.path.basename(file)
            self.left_var.set(name)
            self.config['left_image'] = name
            self.save_config()
            self.log(f'前5发图片: {name}')
            
    def select_right_image(self):
        folder = self.folder_var.get()
        if not folder:
            messagebox.showwarning('提示', '请先选择文件夹')
            return
        file = filedialog.askopenfilename(
            title='选择后5发图片',
            initialdir=folder,
            filetypes=[('图片文件', '*.png *.jpg *.jpeg *.bmp *.gif *.webp')]
        )
        if file:
            name = os.path.basename(file)
            self.right_var.set(name)
            self.config['right_image'] = name
            self.save_config()
            self.log(f'后5发图片: {name}')
            
    def start_server(self):
        if self.server_running:
            return
        
        folder = self.folder_var.get()
        if not folder:
            messagebox.showwarning('提示', '请先选择图片文件夹')
            return
        
        left_img = self.left_var.get()
        right_img = self.right_var.get()
        if not left_img or not right_img:
            messagebox.showwarning('提示', '请选择两张图片')
            return
        
        try:
            port = int(self.port_var.get())
        except:
            port = DEFAULT_PORT
        
        self.config['folder'] = folder
        self.config['left_image'] = left_img
        self.config['right_image'] = right_img
        self.config['port'] = port
        self.save_config()
        
        self.server_running = True
        self.start_btn.config(state=tk.DISABLED)
        self.stop_btn.config(state=tk.NORMAL)
        self.status_var.set(f'状态: 运行中 (端口 {port})')
        
        self.server_thread = threading.Thread(target=self.run_server, daemon=True)
        self.server_thread.start()
        
        self.log(f'服务启动，端口: {port}')
        self.log(f'访问地址: http://localhost:{port}')
        
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
        self.log('服务已停止')
        
    def run_server(self):
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        
        self.app = web.Application()
        self.app.router.add_get('/', self.handle_index)
        self.app.router.add_get('/ws', self.handle_ws)
        self.app.router.add_get('/image/{side}', self.handle_image)
        
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
        self.log('WebSocket客户端连接')
        
        if self.cache_ready['left'] and self.cache_ready['right']:
            await self.send_images_to_client(ws)
        
        try:
            async for msg in ws:
                pass
        except:
            pass
        
        self.ws_clients.discard(ws)
        self.log('WebSocket客户端断开')
        
        return ws
        
    async def handle_image(self, request):
        side = request.match_info['side']
        if side in self.image_cache and self.image_cache[side]:
            return web.Response(
                body=self.image_cache[side],
                content_type='image/webp'
            )
        return web.Response(status=404)
        
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
        folder = self.config.get('folder', '')
        left_name = self.config.get('left_image', '')
        right_name = self.config.get('right_image', '')
        
        if folder and left_name:
            left_path = os.path.join(folder, left_name)
            if os.path.exists(left_path):
                self.image_cache['left'] = self.read_image(left_path)
                self.cache_ready['left'] = True
                self.last_mtime['left'] = os.path.getmtime(left_path)
                self.log(f'已加载前5发图片: {left_name}')
        
        if folder and right_name:
            right_path = os.path.join(folder, right_name)
            if os.path.exists(right_path):
                self.image_cache['right'] = self.read_image(right_path)
                self.cache_ready['right'] = True
                self.last_mtime['right'] = os.path.getmtime(right_path)
                self.log(f'已加载后5发图片: {right_name}')
                
    def read_image(self, path):
        try:
            with open(path, 'rb') as f:
                return f.read()
        except Exception as e:
            self.log(f'读取图片失败: {e}')
            return None
            
    def start_file_monitor(self):
        folder = self.config.get('folder', '')
        if not folder:
            return
        
        self.observer = watchdog.observers.Observer()
        handler = ImageChangeHandler(self)
        self.observer.schedule(handler, folder, recursive=False)
        self.observer.start()
        self.log(f'开始监测文件夹: {folder}')
        
    def stop_file_monitor(self):
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.observer = None
            
    def on_image_changed(self, path):
        filename = os.path.basename(path)
        left_name = self.config.get('left_image', '')
        right_name = self.config.get('right_image', '')
        
        side = None
        if filename == left_name:
            side = 'left'
        elif filename == right_name:
            side = 'right'
        
        if not side:
            return
        
        current_mtime = os.path.getmtime(path)
        if current_mtime <= self.last_mtime[side]:
            return
        
        self.last_mtime[side] = current_mtime
        
        self.image_cache[side] = self.read_image(path)
        self.cache_ready[side] = True
        
        label = '前5发' if side == 'left' else '后5发'
        self.log(f'{label}图片已更新: {filename}')
        
        if self.cache_ready['left'] and self.cache_ready['right']:
            if self.loop and self.server_running:
                asyncio.run_coroutine_threadsafe(self.broadcast_images(), self.loop)
                self.log('已推送双图更新')
                
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
}
.container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 20px;
}
.image-row {
  display: flex;
  justify-content: center;
  gap: 20px;
  flex: 1;
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
  height: calc(100% - 60px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f0f1a;
  border: 2px solid #3a3a5e;
  border-radius: 8px;
  overflow: hidden;
}
.image-wrapper img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.label {
  margin-top: 15px;
  font-size: 18px;
  font-weight: 600;
  color: #4f8ef7;
}
.status-bar {
  padding: 10px 20px;
  background: #0f0f1a;
  border-top: 1px solid #3a3a5e;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.status-text {
  color: #888;
  font-size: 14px;
}
.connected { color: #22c55e; }
.disconnected { color: #ef4444; }
</style>
</head>
<body>
<div class="container">
  <div class="image-row">
    <div class="image-box">
      <div class="image-wrapper">
        <img id="leftImage" alt="前5发" src="">
      </div>
      <div class="label">前5发</div>
    </div>
    <div class="image-box">
      <div class="image-wrapper">
        <img id="rightImage" alt="后5发" src="">
      </div>
      <div class="label">后5发</div>
    </div>
  </div>
  <div class="status-bar">
    <span class="status-text" id="statusText">状态: 未连接</span>
    <span class="status-text" id="lastUpdate">最后更新: --</span>
  </div>
</div>
<script>
var ws = null;
var leftImg = document.getElementById('leftImage');
var rightImg = document.getElementById('rightImage');
var statusText = document.getElementById('statusText');
var lastUpdate = document.getElementById('lastUpdate');

function connect() {
  var wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(wsUrl);
  
  ws.onopen = function() {
    statusText.textContent = '状态: 已连接';
    statusText.className = 'status-text connected';
  };
  
  ws.onclose = function() {
    statusText.textContent = '状态: 未连接';
    statusText.className = 'status-text disconnected';
    setTimeout(connect, 3000);
  };
  
  ws.onerror = function() {
    statusText.textContent = '状态: 连接错误';
    statusText.className = 'status-text disconnected';
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
        if (data.timestamp) {
          var t = new Date(data.timestamp);
          lastUpdate.textContent = '最后更新: ' + t.toLocaleTimeString();
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
        if self.config.get('folder'):
            self.update_image_list()
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