import asyncio
import json
import base64
import time
from pathlib import Path
import websockets
from PIL import Image
import io


class MumuClient:
    def __init__(self, config_path="config.json"):
        self.config = self._load_config(config_path)
        self.running = False
        self._real_width = 1080
        self._real_height = 1920
        self._frame_queue = asyncio.Queue(maxsize=3)
        self._last_frame_time = 0
        self._send_timeout = 1.0

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
            proc = await asyncio.create_subprocess_exec(
                adb_path, "connect", f"{self.config['adb']['host']}:{self.config['adb']['port']}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            print(f"[ADB] 连接结果: {stdout.decode('utf-8', errors='ignore').strip()}")
            return True
        except Exception as e:
            print(f"[ADB] 连接失败: {e}")
            return False

    async def _adb_screenshot(self, log_perf=True):
        try:
            adb_start = time.time()
            cmd = self._get_adb_cmd(["exec-out", "screencap", "-p"])
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=10)
            adb_time = (time.time() - adb_start) * 1000

            if stdout and len(stdout) > 0:
                process_start = time.time()
                img = Image.open(io.BytesIO(stdout))
                self._real_width = img.width
                self._real_height = img.height
                img = img.resize((360, 640), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                img.save(output, format='WEBP', quality=30)
                process_time = (time.time() - process_start) * 1000
                
                if log_perf:
                    total_time = adb_time + process_time
                    print(f"[PERF] ADB: {adb_time:.0f}ms 处理: {process_time:.0f}ms 总: {total_time:.0f}ms 分辨率: {self._real_width}x{self._real_height}")
                return output.getvalue()

            return None
        except Exception as e:
            print(f"[ADB] 截图失败: {e}")
            return None

    async def _adb_click(self, x, y):
        try:
            cmd = self._get_adb_cmd(["shell", "input", "tap", str(x), str(y)])
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await asyncio.wait_for(proc.communicate(), timeout=5)
            print(f"[ADB] 点击坐标: ({x}, {y})")
        except Exception as e:
            print(f"[ADB] 点击失败: {e}")

    async def _adb_swipe(self, x1, y1, x2, y2, duration=300):
        try:
            cmd = self._get_adb_cmd(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)])
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await asyncio.wait_for(proc.communicate(), timeout=5)
            print(f"[ADB] 滑动: ({x1}, {y1}) -> ({x2}, {y2})")
        except Exception as e:
            print(f"[ADB] 滑动失败: {e}")

    async def _adb_keyevent(self, keycode):
        try:
            android_key = keycode
            if keycode == "Back":
                android_key = "4"
            elif keycode == "Home":
                android_key = "3"
            elif keycode == "Recent":
                android_key = "187"

            cmd = self._get_adb_cmd(["shell", "input", "keyevent", str(android_key)])
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await asyncio.wait_for(proc.communicate(), timeout=5)
            print(f"[ADB] 按键: {keycode} (keycode: {android_key})")
        except Exception as e:
            print(f"[ADB] 按键失败: {e}")

    async def _send_binary_frame(self, ws, img_bytes):
        device_id = self.config["device"]["deviceId"]
        device_id_bytes = device_id.encode("utf-8")

        header = bytearray(8)
        header[0] = 0x01
        header[1] = len(device_id_bytes)
        header[2] = 0x00
        header[3] = 0x00

        screen_width = getattr(self, '_real_width', 1080)
        screen_height = getattr(self, '_real_height', 1920)
        header[4:6] = screen_width.to_bytes(2, byteorder="big")
        header[6:8] = screen_height.to_bytes(2, byteorder="big")

        frame = bytes(header) + device_id_bytes + img_bytes
        await ws.send(frame)

    async def _send_hd_screenshot(self, ws, purpose, timestamp):
        img_bytes = await self._adb_screenshot()
        if not img_bytes:
            return

        device_id = self.config["device"]["deviceId"]
        screen_width = getattr(self, '_real_width', 1080)
        screen_height = getattr(self, '_real_height', 1920)
        await ws.send(json.dumps({
            "type": "hdScreenshot",
            "deviceId": device_id,
            "image": "data:image/webp;base64," + base64.b64encode(img_bytes).decode("ascii"),
            "purpose": purpose,
            "timestamp": timestamp,
            "screenWidth": screen_width,
            "screenHeight": screen_height
        }))
        print(f"[MUMU] 已发送 HD 截图, purpose={purpose}")

    async def _listen(self, ws, cfg):
        try:
            async for msg in ws:
                try:
                    data = json.loads(msg)
                    msg_type = data.get("type")

                    if msg_type == "requestHdScreenshot":
                        purpose = data.get("purpose", "collection")
                        timestamp = data.get("timestamp")
                        if timestamp:
                            await self._send_hd_screenshot(ws, purpose, timestamp)

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
                        x1 = data.get("x", 0)
                        y1 = data.get("y", 0)
                        x2 = data.get("x2", 0)
                        y2 = data.get("y2", 0)
                        duration = data.get("duration", 300)
                        await self._adb_swipe(x1, y1, x2, y2, duration)

                    elif msg_type == "mouseScroll":
                        delta = data.get("delta", 120)
                        center_x = 180
                        center_y = 320
                        if delta > 0:
                            await self._adb_swipe(center_x, center_y + 50, center_x, center_y - 50, 200)
                        else:
                            await self._adb_swipe(center_x, center_y - 50, center_x, center_y + 50, 200)

                except Exception as e:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass

    async def _screenshot_worker(self):
        while self.running:
            try:
                img_bytes = await self._adb_screenshot()
                if img_bytes:
                    current_time = time.time()
                    try:
                        self._frame_queue.put_nowait((current_time, img_bytes))
                    except asyncio.QueueFull:
                        while not self._frame_queue.empty():
                            self._frame_queue.get_nowait()
                        self._frame_queue.put_nowait((current_time, img_bytes))
                await asyncio.sleep(0.1)
            except Exception as e:
                await asyncio.sleep(0.5)

    async def _get_device_resolution(self):
        try:
            img_bytes = await self._adb_screenshot(log_perf=False)
            if img_bytes:
                return self._real_width, self._real_height
        except Exception as e:
            pass
        return 1080, 1920

    async def run(self):
        self.running = True

        print("[MUMU] 正在初始化...")
        await self._check_adb_connection()
        
        screen_width, screen_height = await self._get_device_resolution()
        print(f"[MUMU] 检测到模拟器分辨率: {screen_width}x{screen_height}")

        server_host = self.config["server"]["host"]
        server_port = self.config["server"]["port"]
        ws_uri = f"ws://{server_host}:{server_port}/ws/client"
        cfg = self.config

        print(f"[MUMU] 正在连接服务端: {ws_uri}")

        while self.running:
            try:
                ws = await websockets.connect(ws_uri, ping_interval=30, ping_timeout=10)
                print("[MUMU] 已连接到服务端")

                device_id = cfg["device"]["deviceId"]
                device_name = cfg["device"]["deviceName"]
                await ws.send(json.dumps({
                    "type": "register",
                    "deviceId": device_id,
                    "deviceName": device_name,
                    "uuInstalled": False,
                    "uuVersion": "",
                    "supportsKeyClient": False,
                    "version": "1.0.0",
                    "monitorIndex": 1,
                    "monitorCount": 1,
                    "screenWidth": screen_width,
                    "screenHeight": screen_height,
                    "monitorOffsetX": 0,
                    "monitorOffsetY": 0
                }))
                print(f"[MUMU] 已注册: deviceId={device_id}")

                listen_task = asyncio.create_task(self._listen(ws, cfg))
                screenshot_task = asyncio.create_task(self._screenshot_worker())

                frame_count = 0
                last_print = time.time()
                
                while self.running:
                    try:
                        timestamp, img_bytes = await asyncio.wait_for(
                            self._frame_queue.get(), timeout=self._send_timeout
                        )

                        age = time.time() - timestamp
                        if age > 2.0:
                            continue

                        await self._send_binary_frame(ws, img_bytes)
                        
                        frame_count += 1
                        now = time.time()
                        if now - last_print > 5.0:
                            fps = frame_count / (now - last_print)
                            print(f"[PERF] 发送帧率: {fps:.1f} fps (过去{now - last_print:.0f}秒)")
                            frame_count = 0
                            last_print = now
                    except asyncio.TimeoutError:
                        continue
                    except websockets.exceptions.ConnectionClosed:
                        break
                    except Exception as e:
                        break

                listen_task.cancel()
                screenshot_task.cancel()
                try:
                    await listen_task
                except asyncio.CancelledError:
                    pass
                try:
                    await screenshot_task
                except asyncio.CancelledError:
                    pass

            except Exception as e:
                if not isinstance(e, websockets.exceptions.ConnectionClosed):
                    print(f"[MUMU] 连接失败: {e}")
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
