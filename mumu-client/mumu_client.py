import asyncio
import json
import base64
import time
import os
import sys
import subprocess
os.environ['OPENCV_LOG_LEVEL'] = '3'

import numpy as np
from pathlib import Path
import websockets
from PIL import Image
import io
import ctypes
import cv2
from pyzbar.pyzbar import decode

class SuppressZbarWarnings:
    def __enter__(self):
        self._original_stderr = os.dup(2)
        self._devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(self._devnull, 2)
        return self
    def __exit__(self, *args):
        os.dup2(self._original_stderr, 2)
        os.close(self._original_stderr)
        os.close(self._devnull)


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
        self._last_click_info = None
        self._last_camera_notify_time = 0
        self._camera_trigger_area = {
            "x_min": 326,
            "x_max": 474,
            "y_min": 38,
            "y_max": 105
        }
        self._camera_trigger_base_resolution = (540, 960)
        self._is_reconnecting = False
        self._cmd_queue = asyncio.Queue()
        self._status_notify_queue = asyncio.Queue()
        
        script_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_path = os.path.join(script_dir, 'qrcode', 'last_qrcode.png')
        self.debug_dir = os.path.join(script_dir, 'qrcode', 'debug')
        self.project_a = os.path.join(script_dir, "qrcode", "Project_A.scproject")
        self.project_b = os.path.join(script_dir, "qrcode", "Project_B.scproject")
        self.splitcam_path = r"C:\Program Files\SplitCam\10\splitcam.exe"

    def _get_camera_trigger_area_scaled(self):
        base_w, base_h = self._camera_trigger_base_resolution
        current_w = getattr(self, '_real_width', base_w)
        current_h = getattr(self, '_real_height', base_h)

        if current_w == base_w and current_h == base_h:
            return self._camera_trigger_area

        scale_x = current_w / base_w
        scale_y = current_h / base_h

        return {
            "x_min": int(self._camera_trigger_area["x_min"] * scale_x),
            "x_max": int(self._camera_trigger_area["x_max"] * scale_x),
            "y_min": int(self._camera_trigger_area["y_min"] * scale_y),
            "y_max": int(self._camera_trigger_area["y_max"] * scale_y)
        }

    def _load_config(self, config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _get_adb_cmd(self, cmd):
        adb_path = self.config['adb'].get('path', 'adb')
        adb_device_id = self.config['adb'].get('device_id')
        if adb_device_id:
            return [adb_path, "-s", adb_device_id] + cmd
        return [adb_path] + cmd

    async def _check_adb_connection(self, silent=False):
        try:
            adb_path = self.config['adb'].get('path', 'adb')
            proc = await asyncio.create_subprocess_exec(
                adb_path, "connect", f"{self.config['adb']['host']}:{self.config['adb']['port']}",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
            result = stdout.decode('utf-8', errors='ignore').strip()

            if 'refused' in result.lower() or '10061' in result or 'unable' in result.lower():
                return False

            return True
        except Exception as e:
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

            if not stdout or len(stdout) == 0:
                return None

            process_start = time.time()
            try:
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
            except Exception:
                return None

        except asyncio.TimeoutError:
            print("[ADB] 截图超时")
            return None
        except Exception as e:
            print(f"[ADB] 截图异常: {e}")
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
        except Exception:
            pass

    async def _adb_swipe(self, x1, y1, x2, y2, duration=300):
        try:
            cmd = self._get_adb_cmd(["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(duration)])
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            await asyncio.wait_for(proc.communicate(), timeout=5)
        except Exception:
            pass

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
        except Exception:
            pass

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

    async def _send_hd_screenshot_async(self, ws, purpose, timestamp, business_id=None, operator_id=None):
        try:
            img_bytes = await self._adb_screenshot()
            if not img_bytes:
                return

            device_id = self.config["device"]["deviceId"]
            screen_width = getattr(self, '_real_width', 1080)
            screen_height = getattr(self, '_real_height', 1920)
            payload = {
                "type": "hdScreenshot",
                "deviceId": device_id,
                "image": "data:image/webp;base64," + base64.b64encode(img_bytes).decode("ascii"),
                "purpose": purpose,
                "timestamp": timestamp,
                "screenWidth": screen_width,
                "screenHeight": screen_height
            }
            if business_id:
                payload["businessId"] = business_id
            if operator_id:
                payload["operatorId"] = operator_id
            await ws.send(json.dumps(payload))
            print(f"[MUMU] 已发送 HD 截图, purpose={purpose}")
        except Exception as e:
            print(f"[MUMU] 发送 HD 截图失败: {e}")

    async def _process_qrcode_async(self, ws, data):
        request_id = data.get("requestId", "")
        try:
            screenshot_base64 = data.get("screenshot", "")
            
            if not screenshot_base64:
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "failed",
                    "error": "缺少截图数据"
                }))
                return

            base64_data = screenshot_base64.replace('data:image/webp;base64,', '')
            img_bytes = base64.b64decode(base64_data)

            img_array = np.frombuffer(img_bytes, dtype=np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            
            if img is None:
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "failed",
                    "error": "图片解码失败"
                }))
                return

            height, width = img.shape[:2]
            
            if width > 1920 or height > 1080:
                scale = min(2.0, max(1920 / width, 1080 / height) + 0.5)
                new_width = int(width * scale)
                new_height = int(height * scale)
                img = cv2.resize(img, (new_width, new_height), interpolation=cv2.INTER_CUBIC)
            
            detect_start = time.time()
            found, data_qr, qr_rect, attempts = self._detect_qr(img)
            detect_time = (time.time() - detect_start) * 1000
            
            if not found:
                os.makedirs(self.debug_dir, exist_ok=True)
                timestamp_str = time.strftime("%Y%m%d_%H%M%S")
                debug_path = os.path.join(self.debug_dir, f"failed_{timestamp_str}.png")
                cv2.imwrite(debug_path, img)
                print(f"[MUMU] 二维码识别失败: 未识别到二维码 (耗时{detect_time:.0f}ms, 尝试{attempts}轮), 已保存截图到 {debug_path}")
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "failed",
                    "error": "未识别到二维码"
                }))
                return
            
            print(f"[MUMU] 二维码识别成功: 耗时{detect_time:.0f}ms, 尝试{attempts}轮")
            
            if self._is_url_or_ad(data_qr):
                print(f"[MUMU] 二维码识别失败: 识别到URL或广告内容")
                print(f"[MUMU] 二维码完整内容: {data_qr}")
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "failed",
                    "error": "识别到URL或广告内容"
                }))
                return

            img_array_for_process = np.frombuffer(img_bytes, dtype=np.uint8)
            img_for_process = cv2.imdecode(img_array_for_process, cv2.IMREAD_COLOR)
            
            if img_for_process is None:
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "failed",
                    "error": "处理图片失败"
                }))
                return

            process_success = self._process_qrcode(img_for_process, qr_rect)
            
            if process_success:
                self._launch_splitcam(self.project_a)
                print(f"[MUMU] 二维码解析成功，已刷新A")
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "success"
                }))
            else:
                print(f"[MUMU] 二维码处理失败: 图片处理失败")
                await ws.send(json.dumps({
                    "type": "qrcodeResult",
                    "requestId": request_id,
                    "status": "failed",
                    "error": "图片处理失败"
                }))
                
        except Exception as e:
            print(f"[MUMU] 二维码处理异常: {e}")
            await ws.send(json.dumps({
                "type": "qrcodeResult",
                "requestId": request_id,
                "status": "failed",
                "error": str(e)
            }))

    def _is_url_or_ad(self, data):
        data_lower = data.lower()
        url_prefixes = ('http://', 'https://', 'www.', 'ftp://', 'mailto:', 'tel:', 
                        'weixin://', 'mapi.weixin.qq.com', 'wxp://')
        ad_keywords = ('广告', '推广', '优惠', '活动', 'promotion')
        
        if data_lower.startswith(url_prefixes):
            return True
        if any(keyword in data_lower for keyword in ad_keywords):
            return True
        return False

    def _detect_qr(self, img):
        try:
            height, width = img.shape[:2]
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
            attempts = 0
            
            def try_decode(src):
                nonlocal attempts
                attempts += 1
                try:
                    with SuppressZbarWarnings():
                        results = decode(src)
                    if results:
                        qr = results[0]
                        data = qr.data.decode('utf-8')
                        x, y, w, h = qr.rect
                        return True, data, (x, y, w, h)
                except Exception:
                    pass
                return None
            
            result = try_decode(img)
            if result: return result[0], result[1], result[2], attempts
            
            result = try_decode(gray)
            if result: return result[0], result[1], result[2], attempts
            
            for scale in [1.5, 2.0]:
                scaled = cv2.resize(img, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_CUBIC)
                result = try_decode(scaled)
                if result:
                    x, y, w, h = result[2]
                    return True, result[1], (int(x / scale), int(y / scale), int(w / scale), int(h / scale)), attempts
                result = try_decode(cv2.cvtColor(scaled, cv2.COLOR_BGR2GRAY))
                if result:
                    x, y, w, h = result[2]
                    return True, result[1], (int(x / scale), int(y / scale), int(w / scale), int(h / scale)), attempts
            
            result = try_decode(cv2.equalizeHist(gray))
            if result: return result[0], result[1], result[2], attempts
            
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            result = try_decode(clahe.apply(gray))
            if result: return result[0], result[1], result[2], attempts
            
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            result = try_decode(binary)
            if result: return result[0], result[1], result[2], attempts
            
            result = try_decode(cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2))
            if result: return result[0], result[1], result[2], attempts
            
            result = try_decode(cv2.GaussianBlur(gray, (3, 3), 0))
            if result: return result[0], result[1], result[2], attempts
            
            result = try_decode(cv2.bilateralFilter(gray, 9, 75, 75))
            if result: return result[0], result[1], result[2], attempts
            
            return False, None, None, attempts
        except Exception as e:
            return False, None, None, 0

    def _process_qrcode(self, img, qr_rect):
        try:
            if img is None:
                return False
            
            x, y, w, h = qr_rect
            
            margin = 1
            pad = 2
            x1 = max(0, x - margin)
            y1 = max(0, y - margin)
            x2 = min(img.shape[1], x + w + pad)
            y2 = min(img.shape[0], y + h + pad)
            
            qr_region = img[y1:y2, x1:x2]
            
            target_width = 200
            target_height = 360
            qr_target_height = 90
            
            qr_h, qr_w = qr_region.shape[:2]
            scale = target_width / qr_w
            new_w = target_width
            new_h = int(qr_h * scale)
            
            if new_h > qr_target_height:
                scale = qr_target_height / qr_h
                new_w = int(qr_w * scale)
                new_h = qr_target_height
            
            resized = cv2.resize(qr_region, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
            
            result = np.full((target_height, target_width, 3), 255, dtype=np.uint8)
            
            y_offset = max(0, (target_height - new_h) // 2 + 40)
            x_offset = (target_width - new_w) // 2
            
            result[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized
            
            os.makedirs(os.path.dirname(self.output_path), exist_ok=True)
            
            before_save_time = time.time() * 1000
            
            cv2.imwrite(self.output_path, result)
            
            if os.path.exists(self.output_path):
                stats = os.stat(self.output_path)
                file_modified_time = stats.st_mtime * 1000
                
                if file_modified_time < before_save_time - 1000:
                    return False
            
            return True
        except Exception as e:
            return False

    def _launch_splitcam(self, project_file):
        try:
            subprocess.Popen([self.splitcam_path, project_file], shell=True)
            return True
        except Exception as e:
            print(f"[MUMU] SplitCam启动失败: {e}")
            return False

    async def _cmd_worker(self):
        while self.running:
            try:
                cmd = await asyncio.wait_for(self._cmd_queue.get(), timeout=1.0)
                cmd_type = cmd.get("type")
                cmd_time = cmd.get("time", 0)
                
                if time.time() - cmd_time > 3:
                    continue
                
                if cmd_type == "click":
                    await self._adb_click(cmd["x"], cmd["y"])
                elif cmd_type == "swipe":
                    await self._adb_swipe(cmd["x1"], cmd["y1"], cmd["x2"], cmd["y2"], cmd["duration"])
                elif cmd_type == "scroll":
                    delta = cmd["delta"]
                    center_x = 180
                    center_y = 320
                    if delta > 0:
                        await self._adb_swipe(center_x, center_y - 50, center_x, center_y + 50, 200)
                    else:
                        await self._adb_swipe(center_x, center_y + 50, center_x, center_y - 50, 200)
                elif cmd_type == "keyevent":
                    await self._adb_keyevent(cmd["key"])
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                print(f"[MUMU] 命令执行错误: {e}")

    async def _listen(self, ws, cfg):
        try:
            async for msg in ws:
                try:
                    data = json.loads(msg)
                    msg_type = data.get("type")

                    if msg_type == "requestHdScreenshot":
                        purpose = data.get("purpose", "collection")
                        timestamp = data.get("timestamp")
                        business_id = data.get("businessId")
                        operator_id = data.get("operatorId")
                        if timestamp:
                            asyncio.create_task(self._send_hd_screenshot_async(ws, purpose, timestamp, business_id, operator_id))

                    elif msg_type == "keyClick":
                        key = data.get("key", "")
                        if key:
                            self._cmd_queue.put_nowait({
                                "type": "keyevent",
                                "key": key,
                                "time": time.time()
                            })

                    elif msg_type == "mouseClick":
                        x = data.get("x", 0)
                        y = data.get("y", 0)
                        device_id = data.get("deviceId", "")
                        operator_id = data.get("operatorId", "")
                        operator_name = data.get("operatorName", "")
                        business_id = data.get("businessId", "")
                        business_name = data.get("businessName", "")

                        if x and y:
                            self._last_click_info = {
                                "x": x,
                                "y": y,
                                "deviceId": device_id,
                                "operatorId": operator_id,
                                "operatorName": operator_name,
                                "businessId": business_id,
                                "businessName": business_name,
                                "timestamp": time.time()
                            }
                            self._cmd_queue.put_nowait({
                                "type": "click",
                                "x": x,
                                "y": y,
                                "time": time.time()
                            })

                    elif msg_type == "mouseSwipe":
                        x1 = data.get("x", 0)
                        y1 = data.get("y", 0)
                        x2 = data.get("x2", 0)
                        y2 = data.get("y2", 0)
                        duration = data.get("duration", 300)
                        self._cmd_queue.put_nowait({
                            "type": "swipe",
                            "x1": x1,
                            "y1": y1,
                            "x2": x2,
                            "y2": y2,
                            "duration": duration,
                            "time": time.time()
                        })

                    elif msg_type == "mouseScroll":
                        delta = data.get("delta", 120)
                        self._cmd_queue.put_nowait({
                            "type": "scroll",
                            "delta": delta,
                            "time": time.time()
                        })

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

                    elif msg_type == "processQrcode":
                        print(f"[MUMU] 收到processQrcode消息请求")
                        asyncio.create_task(self._process_qrcode_async(ws, data))

                except Exception as e:
                    pass
        except websockets.exceptions.ConnectionClosed:
            pass

    async def _screenshot_worker(self):
        consecutive_errors = 0
        while self.running:
            try:
                try:
                    img_bytes = await self._adb_screenshot(compress=True)
                except Exception as screenshot_error:
                    print(f"[MUMU] 截图Worker异常: {screenshot_error}")
                    img_bytes = None

                if img_bytes:
                    consecutive_errors = 0
                    current_time = time.time()
                    try:
                        self._frame_queue.put_nowait((current_time, img_bytes))
                    except asyncio.QueueFull:
                        while not self._frame_queue.empty():
                            self._frame_queue.get_nowait()
                        self._frame_queue.put_nowait((current_time, img_bytes))
                else:
                    consecutive_errors += 1
                    if consecutive_errors < 3:
                        await asyncio.sleep(0.5)
            except Exception as e:
                consecutive_errors += 1
                print(f"[MUMU] ScreenshotWorker错误: {e}")
                await asyncio.sleep(1)

            if consecutive_errors >= 3:
                print("[MUMU] ADB连接断开，等待恢复...")
                self._status_notify_queue.put_nowait({"type": "deviceOffline"})
                consecutive_errors = 0
                self._is_reconnecting = True
                
                stable_count = 0
                while self.running and stable_count < 5:
                    await asyncio.sleep(2)
                    try:
                        adb_path = self.config['adb'].get('path', 'adb')
                        proc = await asyncio.create_subprocess_exec(
                            adb_path, "connect", f"{self.config['adb']['host']}:{self.config['adb']['port']}",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE
                        )
                        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
                        result = stdout.decode('utf-8', errors='ignore').strip()
                        if 'connected' in result.lower() or 'already connected' in result.lower():
                            stable_count += 1
                        else:
                            stable_count = 0
                    except Exception:
                        stable_count = 0
                
                if stable_count >= 5:
                    print("[MUMU] ADB已稳定重连")
                    self._is_reconnecting = False
                    sw, sh = self._real_width, self._real_height
                    print(f"[MUMU] 模拟器已恢复，分辨率: {sw}x{sh}")
                    self._status_notify_queue.put_nowait({
                        "type": "deviceOnline",
                        "screenWidth": sw,
                        "screenHeight": sh
                    })
                    print("[MUMU] 等待模拟器稳定...")
                    await asyncio.sleep(5)
                    print("[MUMU] 尝试重新注入DLL...")
                    self._inject_camera_hook()
                else:
                    self._is_reconnecting = False

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
            print("[MUMU] 注入器不存在: injector49.exe")
            return False

        if not os.path.exists(dll_path):
            print("[MUMU] DLL不存在: camera_hook49.dll")
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
                return False

            return True

        except subprocess.TimeoutExpired:
            print("[MUMU] 注入超时")
            return False
        except Exception as e:
            print(f"[MUMU] 注入失败: {e}")
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
                ctypes.c_uint32(0xC0000000),
                0,
                None,
                ctypes.c_uint32(3),
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
                ctypes.c_uint32(0xC0000000),
                0,
                None,
                ctypes.c_uint32(3),
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
                    ctypes.c_uint32(0x80000000),
                    0,
                    None,
                    ctypes.c_uint32(3),
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
                
                current_time = time.time()
                if current_time - self._last_camera_notify_time < 1.0:
                    continue
                self._last_camera_notify_time = current_time
                
                self._launch_splitcam(self.project_b)
                print(f"[MUMU] 相机点击，已刷新B")
                
                msg = {
                    "type": "cameraClicked",
                    "timestamp": timestamp,
                    "mumuClientId": self.config["device"]["deviceId"]
                }
                
                if self._last_click_info:
                    click_time = self._last_click_info.get("timestamp", 0)
                    if current_time - click_time <= 3:
                        msg.update({
                            "x": self._last_click_info["x"],
                            "y": self._last_click_info["y"],
                            "deviceId": self._last_click_info["operatorId"],
                            "deviceName": self._last_click_info["operatorName"],
                            "businessId": self._last_click_info["businessId"],
                            "businessName": self._last_click_info["businessName"]
                        })
                    else:
                        self._last_click_info = None

                await ws.send(json.dumps(msg))
            except websockets.exceptions.ConnectionClosed:
                break
            except Exception as e:
                await asyncio.sleep(0.05)

    async def run(self):
        self.running = True

        print("[MUMU] 正在初始化...")

        while self.running:
            if await self._check_adb_connection():
                break
            print("[MUMU] 未检测到模拟器，等待连接...")
            await asyncio.sleep(3)

        if not self.running:
            return

        print("[MUMU] 等待模拟器启动完成...")
        await asyncio.sleep(10)

        screen_width, screen_height = await self._get_device_resolution()
        print(f"[MUMU] 检测到模拟器分辨率: {screen_width}x{screen_height}")

        while self.running:
            if self._inject_camera_hook():
                break
            print("[MUMU] 注入失败，等待重试...")
            await asyncio.sleep(3)

        if not self.running:
            return

        self._load_camera_hook_dll()

        self._launch_splitcam(self.project_b)
        print("[MUMU] 已启动虚拟摄像头（白图）")

        server_host = self.config["server"]["host"]
        server_port = self.config["server"]["port"]
        ws_uri = f"ws://{server_host}:{server_port}/ws/client"
        cfg = self.config
        is_reconnected = False

        print(f"[MUMU] 正在连接服务端: {ws_uri}")
        
        cmd_task = asyncio.create_task(self._cmd_worker())

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

                if is_reconnected:
                    await ws.send(json.dumps({
                        "type": "deviceOnline",
                        "deviceId": device_id,
                        "screenWidth": screen_width,
                        "screenHeight": screen_height
                    }))
                    print("[MUMU] 模拟器已恢复连接")
                    is_reconnected = False

                listen_task = asyncio.create_task(self._listen(ws, cfg))
                screenshot_task = asyncio.create_task(self._screenshot_worker())
                notify_task = asyncio.create_task(self._camera_notify_worker(ws))

                while self.running:
                    try:
                        done, pending = await asyncio.wait(
                            [
                                asyncio.create_task(self._frame_queue.get()),
                                asyncio.create_task(self._status_notify_queue.get())
                            ],
                            timeout=self._send_timeout,
                            return_when=asyncio.FIRST_COMPLETED
                        )

                        for task in pending:
                            task.cancel()

                        for task in done:
                            result = task.result()
                            if isinstance(result, tuple):
                                timestamp, img_bytes = result
                                age = time.time() - timestamp
                                if age > 2.0:
                                    continue

                                try:
                                    await self._send_binary_frame(ws, img_bytes)
                                except websockets.exceptions.ConnectionClosed:
                                    raise
                                except Exception as send_error:
                                    print(f"[MUMU] 发送帧失败: {send_error}")
                            elif isinstance(result, dict):
                                notify_type = result.get("type")
                                if notify_type == "deviceOffline":
                                    await ws.send(json.dumps({
                                        "type": "deviceOffline",
                                        "deviceId": device_id
                                    }))
                                    print("[MUMU] 已通知服务端模拟器断开")
                                elif notify_type == "deviceOnline":
                                    await ws.send(json.dumps({
                                        "type": "deviceOnline",
                                        "deviceId": device_id,
                                        "screenWidth": result.get("screenWidth", screen_width),
                                        "screenHeight": result.get("screenHeight", screen_height)
                                    }))
                                    print("[MUMU] 已通知服务端模拟器重连成功")

                    except asyncio.TimeoutError:
                        continue
                    except websockets.exceptions.ConnectionClosed:
                        break
                    except Exception as e:
                        print(f"[MUMU] 主循环异常: {e}")
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

                if self.running:
                    print("[MUMU] 等待模拟器重新连接...")
                    reconnect_wait = 0
                    reconnect_success = False
                    while self.running and reconnect_wait < 30:
                        await asyncio.sleep(2)
                        reconnect_wait += 2
                        if await self._check_adb_connection(silent=True):
                            await asyncio.sleep(2)
                            if await self._check_adb_connection(silent=True):
                                sw, sh = await self._get_device_resolution()
                                if sw and sh:
                                    screen_width, screen_height = sw, sh
                                    print(f"[MUMU] 模拟器已恢复，分辨率: {screen_width}x{screen_height}")
                                    reconnect_success = True
                                    break
                    if reconnect_success:
                        is_reconnected = True
                    if not self.running:
                        break

            except Exception as e:
                if not isinstance(e, websockets.exceptions.ConnectionClosed):
                    if "1225" in str(e) or "拒绝" in str(e):
                        print("[MUMU] 服务端已断开，重试中...")
                    else:
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
