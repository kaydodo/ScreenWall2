import asyncio
import json
import subprocess
import base64
import time
from pathlib import Path
import websockets
from PIL import Image
import io


class MumuClient:
    def __init__(self, config_path="config.json"):
        self.config = self._load_config(config_path)
        self.ws = None
        self.running = False

    def _load_config(self, config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _get_adb_cmd(self, cmd):
        adb_path = self.config['adb'].get('path', 'adb')
        adb_device_id = self.config['adb'].get('device_id')
        if adb_device_id:
            return [adb_path, "-s", adb_device_id] + cmd
        return [adb_path] + cmd

    async def _check_adb_connection(self):
        try:
            adb_path = self.config['adb'].get('path', 'adb')
            result = subprocess.run(
                [adb_path, "connect", f"{self.config['adb']['host']}:{self.config['adb']['port']}"],
                capture_output=True,
                text=True,
                timeout=5
            )
            print(f"[ADB] 连接结果: {result.stdout.strip()}")
            return True
        except Exception as e:
            print(f"[ADB] 连接失败: {e}")
            return False

    async def _adb_screenshot(self):
        try:
            result = subprocess.run(
                self._get_adb_cmd(["exec-out", "screencap", "-p"]),
                capture_output=True,
                timeout=10
            )
            
            if result.stdout and len(result.stdout) > 0:
                img = Image.open(io.BytesIO(result.stdout))
                img = img.resize((480, 854), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                img.save(output, format='WEBP', quality=30)
                return output.getvalue()
            
            return None
        except Exception as e:
            print(f"[ADB] 截图失败: {e}")
            return None

    async def _adb_click(self, x, y):
        try:
            subprocess.run(
                self._get_adb_cmd(["shell", "input", "tap", str(x), str(y)]),
                timeout=5
            )
            print(f"[ADB] 点击坐标: ({x}, {y})")
        except Exception as e:
            print(f"[ADB] 点击失败: {e}")

    async def _adb_swipe(self, x1, y1, x2, y2, duration=300):
        try:
            subprocess.run(
                self._get_adb_cmd(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)]),
                timeout=5
            )
            print(f"[ADB] 滑动: ({x1}, {y1}) -> ({x2}, {y2})")
        except Exception as e:
            print(f"[ADB] 滑动失败: {e}")

    async def _adb_keyevent(self, keycode):
        try:
            subprocess.run(
                self._get_adb_cmd(["shell", "input", "keyevent", str(keycode)]),
                timeout=5
            )
            print(f"[ADB] 按键: {keycode}")
        except Exception as e:
            print(f"[ADB] 按键失败: {e}")

    async def _send_binary_frame(self, img_bytes):
        device_id = self.config["device"]["deviceId"]
        device_id_bytes = device_id.encode("utf-8")
        
        header = bytearray(8)
        header[0] = 0x01
        header[1] = len(device_id_bytes)
        header[2] = 0x00
        header[3] = 0x00
        
        screen_width = 480
        screen_height = 854
        header[4:6] = screen_width.to_bytes(2, byteorder="big")
        header[6:8] = screen_height.to_bytes(2, byteorder="big")
        
        frame = bytes(header) + device_id_bytes + img_bytes
        await self.ws.send(frame)

    async def _send_hd_screenshot(self, purpose, timestamp):
        img_bytes = await self._adb_screenshot()
        if not img_bytes:
            return
        
        device_id = self.config["device"]["deviceId"]
        await self.ws.send(json.dumps({
            "type": "hdScreenshot",
            "deviceId": device_id,
            "image": "data:image/webp;base64," + base64.b64encode(img_bytes).decode("ascii"),
            "purpose": purpose,
            "timestamp": timestamp,
            "screenWidth": 480,
            "screenHeight": 854
        }))
        print(f"[MUMU] 已发送 HD 截图, purpose={purpose}")

    async def _register(self):
        device_id = self.config["device"]["deviceId"]
        device_name = self.config["device"]["deviceName"]
        await self.ws.send(json.dumps({
            "type": "register",
            "deviceId": device_id,
            "deviceName": device_name,
            "uuInstalled": False,
            "uuVersion": "",
            "supportsKeyClient": False,
            "version": "1.0.0",
            "monitorIndex": 1,
            "monitorCount": 1,
            "screenWidth": 480,
            "screenHeight": 854,
            "monitorOffsetX": 0,
            "monitorOffsetY": 0
        }))
        print(f"[MUMU] 已注册: deviceId={device_id}")

    async def _handle_message(self, message):
        try:
            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "requestHdScreenshot":
                purpose = data.get("purpose", "collection")
                timestamp = data.get("timestamp")
                if timestamp:
                    await self._send_hd_screenshot(purpose, timestamp)
            
            elif msg_type == "keyClick":
                key = data.get("key", "")
                if key:
                    await self._adb_keyevent(key)
            
            elif msg_type == "mouseClick":
                x = data.get("x", 0)
                y = data.get("y", 0)
                if x and y:
                    await self._adb_click(x, y)
            
            elif msg_type == "mouseSwipe":
                x1 = data.get("x1", 0)
                y1 = data.get("y1", 0)
                x2 = data.get("x2", 0)
                y2 = data.get("y2", 0)
                duration = data.get("duration", 300)
                await self._adb_swipe(x1, y1, x2, y2, duration)
        
        except Exception as e:
            print(f"[MUMU] 处理消息失败: {e}")

    async def _screenshot_loop(self):
        fps = self.config["device"]["fps"]
        interval = 1.0 / fps
        
        while self.running:
            start_time = time.time()
            
            if self.ws:
                try:
                    img_bytes = await self._adb_screenshot()
                    if img_bytes:
                        await self._send_binary_frame(img_bytes)
                except websockets.exceptions.ConnectionClosed:
                    break
                except Exception as e:
                    pass
            
            elapsed = time.time() - start_time
            sleep_time = max(0, interval - elapsed)
            await asyncio.sleep(sleep_time)

    async def _message_loop(self):
        while self.running and self.ws:
            try:
                message = await self.ws.recv()
                await self._handle_message(message)
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                pass

    async def run(self):
        self.running = True
        
        print("[MUMU] 正在初始化...")
        await self._check_adb_connection()
        
        server_host = self.config["server"]["host"]
        server_port = self.config["server"]["port"]
        ws_uri = f"ws://{server_host}:{server_port}/ws/client"
        
        print(f"[MUMU] 正在连接服务端: {ws_uri}")
        
        while self.running:
            try:
                self.ws = await websockets.connect(ws_uri, ping_interval=30, ping_timeout=10)
                print("[MUMU] 已连接到服务端")
                
                await self._register()
                
                screenshot_task = asyncio.create_task(self._screenshot_loop())
                message_task = asyncio.create_task(self._message_loop())
                
                await asyncio.gather(screenshot_task, message_task)
                
            except Exception as e:
                # 服务端可能主动关闭连接，这是正常的
                if not str(e).endswith("(close)") and not isinstance(e, websockets.exceptions.ConnectionClosed):
                    print(f"[MUMU] 连接失败: {e}")
                # 等待3秒再尝试
                await asyncio.sleep(3)

    def stop(self):
        self.running = False


if __name__ == "__main__":
    client = MumuClient()
    try:
        asyncio.run(client.run())
    except KeyboardInterrupt:
        print("[MUMU] 正在停止...")
        client.stop()
