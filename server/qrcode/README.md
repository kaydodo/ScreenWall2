# SplitCam A/B 刷新方案

## 概述

此方案用于解决 SplitCam 缓存图片不刷新的问题，通过在两个项目之间切换来强制刷新图片。

## 文件结构

| 文件 | 说明 |
|------|------|
| `Project_A.scproject` | 方案A - 显示 `last_qrcode.png` 二维码 |
| `Project_B.scproject` | 方案B - 显示 `blank.png` 空白图 |
| `blank.png` | 空白占位图 |
| `create_blank_image.py` | 重新生成空白图的脚本（如果需要） |
| `last_qrcode.png` | 当前使用的二维码图片 |

## 工作流程

1. 当二维码成功生成后，`qrcode_processor.py` 会：
   - 启动方案A
   - 等待3秒
   - 启动方案B
2. 通过切换项目来让 SplitCam 重新加载图片，解决缓存问题

## 使用方法

- 请确保已安装 SplitCam
- 方案A和方案B会在二维码更新时自动被 `qrcode_processor.py` 调用
- 如需手动测试，可以直接双击打开两个项目文件

## 注意事项

- 两个项目文件使用相对路径加载图片，因此它们必须与图片在同一目录下
- 确保 SplitCam 安装在默认路径 `C:\Program Files\SplitCam\10\`
