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
        self.left_folder = ''
        self.right_folder = ''
        
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
            'port': DEFAULT_PORT
        }
    
    def save_config(self):
        CONFIG_FILE.write_text(json.dumps(self.config, indent=2))
    
    def setup_gui(self):
        self.root = tk.Tk()
        self.root.title('双图监控服务')
        self.root.geometry('500x280')
        self.root.resizable(False, False)
        
        main_frame = ttk.Frame(self.root, padding=10)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        port_frame = ttk.LabelFrame(main_frame, text='服务端口', padding=5)
        port_frame.pack(fill=tk.X, pady=5)
        
        self.port_var = tk.StringVar(value=str(self.config.get('port', DEFAULT_PORT)))
        ttk.Label(port_frame, text='端口:').pack(side=tk.LEFT, padx=5)
        ttk.Entry(port_frame, textvariable=self.port_var, width=10).pack(side=tk.LEFT, padx=5)
        ttk.Label(port_frame, text='（外部访问: http://IP:端口）').pack(side=tk.LEFT, padx=5)
        
        image_frame = ttk.LabelFrame(main_frame, text='图片设置', padding=5)
        image_frame.pack(fill=tk.X, pady=5)
        
        left_frame = ttk.Frame(image_frame)
        left_frame.pack(fill=tk.X, pady=3)
        ttk.Label(left_frame, text='左5发图片:').pack(side=tk.LEFT, padx=5)
        self.left_var = tk.StringVar(value=self.config.get('left_image', ''))
        ttk.Entry(left_frame, textvariable=self.left_var, width=35).pack(side=tk.LEFT, padx=5)
        ttk.Button(left_frame, text='选择', command=self.select_left_image).pack(side=tk.LEFT, padx=5)
        
        right_frame = ttk.Frame(image_frame)
        right_frame.pack(fill=tk.X, pady=3)
        ttk.Label(right_frame, text='右5发图片:').pack(side=tk.LEFT, padx=5)
        self.right_var = tk.StringVar(value=self.config.get('right_image', ''))
        ttk.Entry(right_frame, textvariable=self.right_var, width=35).pack(side=tk.LEFT, padx=5)
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
        
        self.log_text = tk.Text(log_frame, height=5, state=tk.DISABLED)
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
        
    def select_left_image(self):
        file = filedialog.askopenfilename(
            title='选择左5发图片',
            filetypes=[('图片文件', '*.png *.jpg *.jpeg *.bmp *.gif *.webp')]
        )
        if file:
            self.left_var.set(file)
            self.config['left_image'] = file
            self.left_folder = os.path.dirname(file)
            self.save_config()
            self.log(f'左5发图片: {os.path.basename(file)}')
            
    def select_right_image(self):
        file = filedialog.askopenfilename(
            title='选择右5发图片',
            filetypes=[('图片文件', '*.png *.jpg *.jpeg *.bmp *.gif *.webp')]
        )
        if file:
            self.right_var.set(file)
            self.config['right_image'] = file
            self.right_folder = os.path.dirname(file)
            self.save_config()
            self.log(f'右5发图片: {os.path.basename(file)}')
            
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
            self.log(f'已加载左5发图片: {os.path.basename(left_path)}')
        
        if right_path and os.path.exists(right_path):
            self.image_cache['right'] = self.read_image(right_path)
            self.cache_ready['right'] = True
            self.last_mtime['right'] = os.path.getmtime(right_path)
            self.log(f'已加载右5发图片: {os.path.basename(right_path)}')
                
    def read_image(self, path):
        try:
            with open(path, 'rb') as f:
                return f.read()
        except Exception as e:
            self.log(f'读取图片失败: {e}')
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
        self.log('开始监测图片文件')
        
    def stop_file_monitor(self):
        if self.observer:
            self.observer.stop()
            self.observer.join()
            self.observer = None
            
    def on_image_changed(self, path):
        left_path = self.config.get('left_image', '')
        right_path = self.config.get('right_image', '')
        
        side = None
        if path == left_path:
            side = 'left'
        elif path == right_path:
            side = 'right'
        
        if not side:
            return
        
        current_mtime = os.path.getmtime(path)
        if current_mtime <= self.last_mtime[side]:
            return
        
        self.last_mtime[side] = current_mtime
        
        self.image_cache[side] = self.read_image(path)
        self.cache_ready[side] = True
        
        label = '左5发' if side == 'left' else '右5发'
        self.log(f'{label}图片已更新')
        
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
  display: flex;
  align-items: center;
  justify-content: center;
}
.container {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 20px;
}
.image-box {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.image-wrapper {
  width: 640px;
  height: 512px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0f0f1a;
  border: 3px solid #4f8ef7;
  border-radius: 8px;
  overflow: hidden;
}
.image-wrapper img {
  width: 640px;
  height: 512px;
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
.status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
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
  <div class="image-box">
    <div class="image-wrapper">
      <img id="leftImage" alt="左5块" src="">
    </div>
    <div class="label-box">左5块</div>
  </div>
  <div class="image-box">
    <div class="image-wrapper">
      <img id="rightImage" alt="右5块" src="">
    </div>
    <div class="label-box">右5块</div>
  </div>
</div>
<div class="status-bar">
  <span class="status-text" id="statusText">状态: 未连接</span>
  <span class="status-text" id="lastUpdate">最后更新: --</span>
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