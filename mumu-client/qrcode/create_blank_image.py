#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在 QR code 目录创建空白图
"""

from PIL import Image, ImageColor
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
output_path = os.path.join(script_dir, 'blank.png')

width = 1280
height = 720

img = Image.new('RGB', (width, height), color='white')
img.save(output_path, 'PNG')

print(f'[OK] 空白图已创建: {output_path}')
