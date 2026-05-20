import asyncio
import json
import base64
import time
from pathlib import Path
import websockets
from PIL import Image
import io
import ctypes
import os


class MumuClient:
    def __init__(self, config_path="config.json"):
        self.config = self._load_config(config_path)
        self.running = False
        self._real_width = 1080
        self._real_height = 1920
        self._frame_queue = asyncio.Queue(maxsize=3)
        self._last_frame_time = 0
        self._send_timeout = 1.0
        self._dll_handle = None
        self._get_camera_completed = None
        self._reset_camera_completed = None
        self._click_history = []  # 保存最近的点击记录
        self._last_camera_notify_time = 0  # 上次相机点击通知时间

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
        import ctypes
        try:
            adb_path = self.config['adb'].get('path', 'adb')
            proc = await asyncio.create_subprocess_exec(
                adb_path, "connect", f"{self.config['adb']['host']}:{self.config['adb']['port']}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            result = stdout.decode('utf-8', errors='ignore').strip()
            print(f"[ADB] 连接结果: {result}")

            if 'refused' in result.lower() or '10061' in result:
                MessageBox = ctypes.windll.user32.MessageBoxW
                MessageBox(None, "模拟器没有正在运行，请先启动模拟器后再打开客户端", "MUMU客户端", 0x30)
                return False

            return True
        except Exception as e:
            print(f"[ADB] 连接失败: {e}")
            return False

    async def _adb_screenshot(self, compress=True):
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

                if compress:
                    output = io.BytesIO()
                    img.save(output, format='WEBP', quality=30)
                    img_bytes = output.getvalue()
                else:
                    output = io.BytesIO()
                    img.save(output, format='PNG')
                    img_bytes = output.getvalue()

                process_time = (time.time() - process_start) * 1000
                return img_bytes

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
                        device_id = data.get("deviceId", "")
                        device_name = data.get("deviceName", "")
                        business_id = data.get("businessId", "")
                        business_name = data.get("businessName", "")
                        if x and y:
                            # 记录点击历史
                            click_record = {
                                "x": x,
                                "y": y,
                                "deviceId": device_id,
                                "deviceName": device_name,
                                "businessId": business_id,
                                "businessName": business_name,
                                "timestamp": time.time()
                            }
                            self._click_history.append(click_record)
                            # 只保留最近5条记录
                            if len(self._click_history) > 5:
                                self._click_history.pop(0)
                            
                            if device_name and business_name:
                                print(f"[ADB] 点击坐标: ({x}, {y}) - 设备: {device_name}(业务: {business_name})")
                            elif device_id and business_id:
                                print(f"[ADB] 点击坐标: ({x}, {y}) - 设备ID: {device_id}(业务ID: {business_id})")
                            else:
                                print(f"[ADB] 点击坐标: ({x}, {y})")
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

                    elif msg_type == "getCameraStatus":
                        status = self.get_camera_status()
                        await ws.send(json.dumps({
                            "type": "cameraStatus",
                            "status": status
                        }))

                    elif msg_type == "resetCameraStatus":
                        success = self.reset_camera_status()
                        await ws.send(json.dumps({
                            "type": "cameraStatusReset",
                            "success": success
                        }))

                except Exception as e:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass

    async def _screenshot_worker(self):
        while self.running:
            try:
                img_bytes = await self._adb_screenshot(compress=True)
                if img_bytes:
                    current_time = time.time()
                    try:
                        self._frame_queue.put_nowait((current_time, img_bytes))
                    except asyncio.QueueFull:
                        while not self._frame_queue.empty():
                            self._frame_queue.get_nowait()
                        self._frame_queue.put_nowait((current_time, img_bytes))
            except Exception as e:
                await asyncio.sleep(0.05)

    async def _get_device_resolution(self):
        try:
            img_bytes = await self._adb_screenshot(compress=True)
            if img_bytes:
                return self._real_width, self._real_height
        except Exception as e:
            pass
        return 1080, 1920

    def _inject_camera_hook(self):
        import subprocess
        import os
        import ctypes

        base_dir = os.path.dirname(os.path.abspath(__file__))
        injector_path = os.path.join(base_dir, "injector49.exe")
        dll_path = os.path.join(base_dir, "camera_hook49.dll")

        if not os.path.exists(injector_path):
            MessageBox = ctypes.windll.user32.MessageBoxW
            MessageBox(None, "注入器 injector49.exe 不存在，请检查客户端安装目录", "MUMU客户端", 0x10)
            return False

        if not os.path.exists(dll_path):
            MessageBox = ctypes.windll.user32.MessageBoxW
            MessageBox(None, "摄像头Hook DLL不存在，请检查客户端安装目录", "MUMU客户端", 0x10)
            return False

        print("[MUMU] 正在注入摄像头Hook...")
        try:
            result = subprocess.run(
                [injector_path],
                capture_output=True,
                text=True,
                timeout=10
            )
            output = result.stdout.strip()

            if "INJECT_SUCCESS" in output:
                print("[MUMU] 摄像头Hook注入成功")
            elif "ALREADY_INJECTED" in output:
                print("[MUMU] 已注入Hook，无需再次注入")
            else:
                print(f"[MUMU] 注入器返回: {output}")
                MessageBox = ctypes.windll.user32.MessageBoxW
                MessageBox(None, "注入失败，请检查模拟器状态后重新打开客户端", "MUMU客户端", 0x10)
                return False

            return True

        except subprocess.TimeoutExpired:
            print("[MUMU] 注入超时")
            MessageBox = ctypes.windll.user32.MessageBoxW
            MessageBox(None, "注入失败，请检查模拟器状态后重新打开客户端", "MUMU客户端", 0x10)
            return False
        except Exception as e:
            print(f"[MUMU] 注入失败: {e}")
            MessageBox = ctypes.windll.user32.MessageBoxW
            MessageBox(None, "注入失败，请检查模拟器状态后重新打开客户端", "MUMU客户端", 0x10)
            return False

    def _load_camera_hook_dll(self):
        import os
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dll_path = os.path.join(base_dir, "camera_hook49.dll")
        
        if not os.path.exists(dll_path):
            print(f"[MUMU] DLL不存在: {dll_path}")
            return False
        
        try:
            self._dll_handle = ctypes.CDLL(dll_path)
            self._get_camera_completed = self._dll_handle.GetCameraCompleted
            self._get_camera_completed.restype = ctypes.c_int
            self._reset_camera_completed = self._dll_handle.ResetCameraCompleted
            self._reset_camera_completed.restype = None
            print("[MUMU] 成功加载camera_hook49.dll")
            return True
        except Exception as e:
            print(f"[MUMU] 加载DLL失败: {e}")
            return False

    def _get_camera_status_via_pipe(self):
        import struct
        try:
            pipe_name = r"\\.\pipe\MuMuCameraHook"
            handle = ctypes.windll.kernel32.CreateFileW(
                pipe_name,
                ctypes.c_uint32(0xC0000000),  # GENERIC_READ | GENERIC_WRITE
                0,
                None,
                ctypes.c_uint32(3),  # OPEN_EXISTING
                0,
                None
            )
            
            if handle == ctypes.c_void_p(-1).value:
                return None
            
            try:
                buffer = ctypes.create_string_buffer(b"GET_STATUS")
                bytes_written = ctypes.c_uint32(0)
                success = ctypes.windll.kernel32.WriteFile(
                    handle,
                    buffer,
                    len(buffer) - 1,
                    ctypes.byref(bytes_written),
                    None
                )
                
                if not success:
                    return None
                
                read_buffer = ctypes.create_string_buffer(32)
                bytes_read = ctypes.c_uint32(0)
                success = ctypes.windll.kernel32.ReadFile(
                    handle,
                    read_buffer,
                    31,
                    ctypes.byref(bytes_read),
                    None
                )
                
                if not success or bytes_read.value == 0:
                    return None
                
                response = read_buffer.value.decode('ascii', errors='ignore')
                if response.startswith("STATUS:"):
                    return int(response[7:])
                
                return None
            finally:
                ctypes.windll.kernel32.CloseHandle(handle)
        except Exception as e:
            print(f"[MUMU] 管道通信失败: {e}")
            return None

    def _reset_camera_status_via_pipe(self):
        try:
            pipe_name = r"\\.\pipe\MuMuCameraHook"
            handle = ctypes.windll.kernel32.CreateFileW(
                pipe_name,
                ctypes.c_uint32(0xC0000000),  # GENERIC_READ | GENERIC_WRITE
                0,
                None,
                ctypes.c_uint32(3),  # OPEN_EXISTING
                0,
                None
            )
            
            if handle == ctypes.c_void_p(-1).value:
                return False
            
            try:
                buffer = ctypes.create_string_buffer(b"RESET_STATUS")
                bytes_written = ctypes.c_uint32(0)
                success = ctypes.windll.kernel32.WriteFile(
                    handle,
                    buffer,
                    len(buffer) - 1,
                    ctypes.byref(bytes_written),
                    None
                )
                
                if not success:
                    return False
                
                read_buffer = ctypes.create_string_buffer(32)
                bytes_read = ctypes.c_uint32(0)
                success = ctypes.windll.kernel32.ReadFile(
                    handle,
                    read_buffer,
                    31,
                    ctypes.byref(bytes_read),
                    None
                )
                
                if success and bytes_read.value > 0:
                    response = read_buffer.value.decode('ascii', errors='ignore')
                    return response == "RESET_OK"
                
                return False
            finally:
                ctypes.windll.kernel32.CloseHandle(handle)
        except Exception as e:
            print(f"[MUMU] 重置状态失败: {e}")
            return False

    def get_camera_status(self):
        if self._get_camera_completed:
            try:
                return self._get_camera_completed()
            except:
                pass
        
        status = self._get_camera_status_via_pipe()
        if status is not None:
            return status
        
        return 0

    def reset_camera_status(self):
        if self._reset_camera_completed:
            try:
                self._reset_camera_completed()
                return True
            except:
                pass
        
        return self._reset_camera_status_via_pipe()

    def _listen_camera_notify_thread(self, notify_queue):
        import ctypes
        import time
        while self.running:
            try:
                pipe_name = r"\\.\pipe\MuMuCameraNotify"
                handle = ctypes.windll.kernel32.CreateFileW(
                    pipe_name,
                    ctypes.c_uint32(0x80000000),  # GENERIC_READ
                    0,
                    None,
                    ctypes.c_uint32(3),  # OPEN_EXISTING
                    0,
                    None
                )
                
                if handle == ctypes.c_void_p(-1).value:
                    time.sleep(0.5)
                    continue
                
                try:
                    while self.running:
                        read_buffer = ctypes.create_string_buffer(256)
                        bytes_read = ctypes.c_uint32(0)
                        success = ctypes.windll.kernel32.ReadFile(
                            handle,
                            read_buffer,
                            255,
                            ctypes.byref(bytes_read),
                            None
                        )
                        
                        if not success or bytes_read.value == 0:
                            break
                        
                        response = read_buffer.value.decode('ascii', errors='ignore')
                        if response.startswith("CLICKED:"):
                            try:
                                timestamp_ms = int(response[8:])
                                # 将本地时间戳转换为服务端标准时间戳（秒）
                                # 这里我们使用本地当前时间作为参考，实际业务中可以使用NTP同步
                                local_timestamp = time.time()
                                notify_queue.put_nowait(local_timestamp)
                            except:
                                pass
                finally:
                    ctypes.windll.kernel32.CloseHandle(handle)
            except Exception as e:
                time.sleep(0.5)

    async def _camera_notify_worker(self, ws):
        import asyncio
        import threading
        import queue
        
        notify_queue = queue.Queue()
        
        # 启动监听线程
        listen_thread = threading.Thread(
            target=self._listen_camera_notify_thread,
            args=(notify_queue,),
            daemon=True
        )
        listen_thread.start()
        
        while self.running:
            try:
                try:
                    timestamp = notify_queue.get_nowait()
                except queue.Empty:
                    await asyncio.sleep(0.05)
                    continue
                
                # 去重：1秒内的重复通知只处理一次
                current_time = time.time()
                if current_time - self._last_camera_notify_time < 1.0:
                    continue
                self._last_camera_notify_time = current_time
                
                print(f"[MUMU] 收到相机点击通知")
                
                # 查找最近的点击记录（3秒内）
                matched_click = None
                for click in reversed(self._click_history):
                    if current_time - click["timestamp"] < 3.0:
                        matched_click = click
                        break
                
                # 构建上报消息
                msg = {
                    "type": "cameraClicked",
                    "timestamp": timestamp
                }
                
                # 如果匹配到点击记录，添加详细信息
                if matched_click:
                    msg.update({
                        "x": matched_click["x"],
                        "y": matched_click["y"],
                        "deviceId": matched_click["deviceId"],
                        "deviceName": matched_click["deviceName"],
                        "businessId": matched_click["businessId"],
                        "businessName": matched_click["businessName"]
                    })
                    print(f"[MUMU] 匹配到点击: ({matched_click['x']}, {matched_click['y']}) - 业务: {matched_click['businessId']}")
                else:
                    print(f"[MUMU] 未找到匹配的点击记录")
                
                # 向服务端发送相机点击通知
                await ws.send(json.dumps(msg))
                print(f"[MUMU] 已上报相机点击")
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                await asyncio.sleep(0.05)

    async def run(self):
        self.running = True

        print("[MUMU] 正在初始化...")

        if not await self._check_adb_connection():
            print("[MUMU] ADB连接失败，程序退出")
            return

        if not self._inject_camera_hook():
            print("[MUMU] 摄像头Hook注入失败，程序退出")
            return

        self._load_camera_hook_dll()

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
                notify_task = asyncio.create_task(self._camera_notify_worker(ws))

                while self.running:
                    try:
                        timestamp, img_bytes = await asyncio.wait_for(
                            self._frame_queue.get(), timeout=self._send_timeout
                        )

                        age = time.time() - timestamp
                        if age > 2.0:
                            continue

                        await self._send_binary_frame(ws, img_bytes)
                    except asyncio.TimeoutError:
                        continue
                    except websockets.exceptions.ConnectionClosed:
                        break
                    except Exception as e:
                        break

                listen_task.cancel()
                screenshot_task.cancel()
                notify_task.cancel()
                try:
                    await listen_task
                except asyncio.CancelledError:
                    pass
                try:
                    await screenshot_task
                except asyncio.CancelledError:
                    pass
                try:
                    await notify_task
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
