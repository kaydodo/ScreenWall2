# -*- coding: utf-8 -*-
import sys
import os
import json
import time
import subprocess
import warnings
warnings.filterwarnings('ignore')
os.environ['OPENCV_LOG_LEVEL'] = '3'

import numpy as np
import cv2
from pyzbar.pyzbar import decode

# 路径配置
OUTPUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qrcode', 'last_qrcode.png')
script_dir = os.path.dirname(os.path.abspath(__file__))
project_a = os.path.join(script_dir, "qrcode", "Project_A.scproject")
project_b = os.path.join(script_dir, "qrcode", "Project_B.scproject")
splitcam_path = r"C:\Program Files\SplitCam\10\splitcam.exe"


def launch_splitcam(project_file):
    """启动 SplitCam 加载指定项目（直接启动，不杀进程）"""
    try:
        subprocess.Popen([splitcam_path, project_file], shell=True)
        return True
    except Exception as e:
        print(f"[ERROR] SplitCam启动失败: {e}", file=sys.stderr)
        return False


def trigger_ab_refresh():
    """触发 A/B 刷新流程：方案A → 3秒 → 方案B"""
    try:
        # 1. 启动方案A
        launch_splitcam(project_a)
        
        # 2. 等待3秒
        time.sleep(3)
        
        # 3. 启动方案B
        launch_splitcam(project_b)
        
        return True
    except Exception as e:
        print(f"[ERROR] A/B刷新失败: {e}", file=sys.stderr)
        return False


def is_url_or_ad(data):
    """检查是否为URL或广告内容"""
    data_lower = data.lower()
    url_prefixes = ('http://', 'https://', 'www.', 'ftp://', 'mailto:', 'tel:', 
                    'weixin://', 'mapi.weixin.qq.com', 'wxp://')
    ad_keywords = ('ad', 'ads', 'promotion', '广告', '推广', '优惠', '活动')
    
    if data_lower.startswith(url_prefixes):
        return True
    if any(keyword in data_lower for keyword in ad_keywords):
        return True
    return False


def detect_qr(image_path):
    """从图片中检测二维码"""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return False, None, None
        
        # 尝试原图和灰度图
        for src in [img, cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)]:
            try:
                results = decode(src)
                if results:
                    qr = results[0]
                    data = qr.data.decode('utf-8')
                    x, y, w, h = qr.rect
                    return True, data, (x, y, w, h)
            except Exception:
                pass
        
        return False, None, None
    except Exception as e:
        return False, None, None


def process_qrcode(image_path, qr_rect):
    """处理二维码图片：裁剪、调整大小、添加边框"""
    try:
        img = cv2.imread(image_path)
        if img is None:
            return False
        
        x, y, w, h = qr_rect
        
        # 添加少量padding（参考qrcode_dashen.py的margin逻辑）
        margin = 1
        pad = 2
        x1 = max(0, x - margin)
        y1 = max(0, y - margin)
        x2 = min(img.shape[1], x + w + pad)
        y2 = min(img.shape[0], y + h + pad)
        
        # 裁剪二维码区域
        qr_region = img[y1:y2, x1:x2]
        
        # 目标尺寸：200x360，二维码占1/4高度（90像素）
        target_width = 200
        target_height = 360
        qr_target_height = 90
        
        # 等比例缩放到宽度200，高度自适应
        qr_h, qr_w = qr_region.shape[:2]
        scale = target_width / qr_w
        new_w = target_width
        new_h = int(qr_h * scale)
        
        # 如果缩放后高度超过90，按高度90缩放
        if new_h > qr_target_height:
            scale = qr_target_height / qr_h
            new_w = int(qr_w * scale)
            new_h = qr_target_height
        
        resized = cv2.resize(qr_region, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)
        
        # 创建白色背景
        result = np.full((target_height, target_width, 3), 255, dtype=np.uint8)
        
        # 计算位置（向上偏移20像素，不再居中）
        y_offset = max(0, (target_height - new_h) // 2 - 20)
        x_offset = (target_width - new_w) // 2
        
        # 放置二维码
        result[y_offset:y_offset+new_h, x_offset:x_offset+new_w] = resized
        
        # 确保输出目录存在
        os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
        
        # 记录保存前的时间
        before_save_time = time.time() * 1000
        
        # 保存图片
        cv2.imwrite(OUTPUT_PATH, result)
        
        # 检查文件是否真的被更新（对比修改时间）
        if os.path.exists(OUTPUT_PATH):
            stats = os.stat(OUTPUT_PATH)
            file_modified_time = stats.st_mtime * 1000
            
            if file_modified_time < before_save_time - 1000:
                return False
        
        return True
    except Exception as e:
        return False


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "failed", "error": "缺少图片路径参数"}))
        return
    
    image_path = sys.argv[1]
    
    if not os.path.exists(image_path):
        print(json.dumps({"status": "failed", "error": "图片文件不存在"}))
        return
    
    # 检测二维码
    found, data, rect = detect_qr(image_path)
    
    if not found:
        print(json.dumps({"status": "failed", "error": "未识别到二维码"}))
        return
    
    # 检查是否为URL或广告
    if is_url_or_ad(data):
        print(json.dumps({"status": "failed", "error": "识别到URL或广告内容"}))
        return
    
    # 处理并保存二维码图片
    if process_qrcode(image_path, rect):
        # 图片保存成功，触发 A/B 刷新
        trigger_ab_refresh()
        print(json.dumps({"status": "success", "data": data}))
    else:
        print(json.dumps({"status": "failed", "error": "图片处理失败"}))


if __name__ == "__main__":
    main()
