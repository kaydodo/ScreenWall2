#!/usr/bin/env python3
import time
import base64
import mss
from PIL import Image
import io

def test_alarm_screenshot():
    """测试报警截图的耗时"""
    # 获取屏幕分辨率
    with mss.mss() as sct:
        monitors = sct.monitors
        if len(monitors) < 2:
            print("没有检测到显示器")
            return
        
        monitor = monitors[1]  # 主显示器
        off_w = monitor["width"]
        off_h = monitor["height"]
        print(f"屏幕分辨率: {off_w}x{off_h}")
        
        # 计算中心区域坐标
        crop_x = (off_w - 640) // 2
        crop_y = (off_h - 360) // 2
        print(f"截取区域: ({crop_x}, {crop_y}) 640x360")
        
        # 测试10次取平均值
        total_time = 0
        for i in range(10):
            start = time.time()
            
            region = {
                "left": monitor["left"] + crop_x,
                "top": monitor["top"] + crop_y,
                "width": 640,
                "height": 360
            }
            sct_img = sct.grab(region)
            
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
            out = io.BytesIO()
            img.save(out, format='WEBP', quality=30)
            alarm_screenshot = "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode("ascii")
            
            elapsed = time.time() - start
            total_time += elapsed
            print(f"测试 {i+1}: {elapsed*1000:.2f}ms")
        
        avg_time = total_time / 10
        print(f"\n平均耗时: {avg_time*1000:.2f}ms")
        print(f"6fps 帧间隔: {1000/6:.2f}ms")
        print(f"占比: {avg_time/(1/6)*100:.2f}%")
        
        if avg_time < 0.1:  # 100ms
            print("\n✅ 结论：截图耗时很短，不会阻塞6fps主循环")
        else:
            print("\n⚠️  结论：截图耗时较长，可能影响主循环")

if __name__ == "__main__":
    test_alarm_screenshot()
