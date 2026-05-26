# MU服务使用说明

## 功能概述

MU服务是用于控制模拟器摄像头和虚拟摄像头的服务程序，主要功能包括：

1. **相机点击检测**：监听模拟器相机区域的点击事件
2. **二维码处理**：接收截图并进行二维码识别和处理
3. **虚拟摄像头控制**：通过SplitCam切换场景（二维码/白图）

## 启动方式

直接运行 `mumu_service.py`：
```bash
python mumu_service.py
```

服务启动时会自动：
- 最小化控制台窗口
- 连接模拟器ADB
- 注入摄像头Hook
- 启动虚拟摄像头（白图场景）
- 连接服务端

## 工作流程

### 初始化阶段
1. 检测模拟器连接
2. 注入camera_hook49.dll
3. 重置相机状态
4. 更新批处理文件路径（自动生成绝对路径）
5. 启动场景B（白图）

### 相机点击处理
1. 通过管道接收点击通知
2. 发送cameraClicked消息到服务端

### 二维码处理
1. 接收processQrcode消息
2. 识别二维码并裁剪保存
3. 启动场景A（二维码）
4. 延迟0.5秒后自动恢复场景B（白图）

## 文件结构

```
mumu-service/
├── mumu_service.py      # 主服务程序
├── injector49.exe       # DLL注入器
├── camera_hook49.dll    # 摄像头Hook DLL
├── config.json          # 配置文件
└── qrcode/
    ├── Project_A.scproject  # 场景A（二维码）
    ├── Project_B.scproject  # 场景B（白图）
    ├── start_a.bat          # 启动场景A的批处理（自动生成）
    ├── start_b.bat          # 启动场景B的批处理（自动生成）
    └── last_qrcode.png      # 最新二维码图片
```

## 配置说明

`config.json` 配置项：
- `adb.host`: ADB连接地址
- `adb.port`: ADB端口
- `adb.path`: ADB路径（可选）
- `server.host`: 服务端地址
- `server.port`: 服务端端口
- `device.deviceId`: 设备ID
- `device.deviceName`: 设备名称

## 常见问题

### 注入器问题
- 确保 `injector49.exe` 和 `camera_hook49.dll` 与 `mumu_service.py` 在同一目录
- 如果注入失败，检查模拟器是否已启动
- 尝试重启模拟器后重新运行服务

### 虚拟摄像头问题
- 确保已安装SplitCam并配置正确路径
- 首次运行可能需要手动启动一次SplitCam进行初始化
- 场景文件路径会在初始化时自动更新

### 管道连接问题
- 服务会自动处理管道占用问题
- 如果提示管道错误，等待几秒后会自动重试

## 注意事项

1. 服务启动后会自动最小化窗口，运行在后台
2. 需要保持模拟器ADB连接正常
3. SplitCam需要正确配置为虚拟摄像头输出
4. 二维码图片仅显示0.5秒后自动切换回白图，防止重复使用