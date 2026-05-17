# MuMu模拟器摄像头Hook分析进度报告

更新时间：2026-05-17 19:00

## 一、项目目标

通过DLL注入方式，监控MuMu模拟器的摄像头API调用，实现虚拟摄像头替换。

---

## 二、v31-v33重大发现

### 关键结论：MuMu不使用标准HID API

v31测试结果证明：**MuMu直接使用USB HID类驱动，不通过标准HID API**。

| 统计项 | 数值 | 说明 |
|--------|------|------|
| HidD_GetAttributes | 0 | ❌ 未调用 |
| HidD_GetFeature | 0 | ❌ 未调用 |
| HidD_GetPreparsedData | 0 | ❌ 未调用 |
| HidD_GetProductString | 0 | ❌ 未调用 |
| DeviceIoControl | 2000+ | ✅ 大量调用 |
| CreateFileW (HID路径) | 0 | ❌ 未调用 |

---

## 三、摄像头通信分析

### 主要IOCTL代码

| IOCTL | Handle | 数据大小 | 频率 | 说明 |
|-------|--------|---------|------|------|
| 0x002F0410 | 0x1CE8 | 176/312字节 | ~30ms/次 | **摄像头帧数据** |
| 0x00470807 | 0x06CC | 20-608字节 | - | USB描述符 |
| 0x00470813 | 0x06CC | 20-540字节 | - | USB描述符 |
| 0x0047083F | 0x06CC | 22-540字节 | - | USB配置 |
| 0x00470843 | 0x06CC | 8字节 | - | USB状态 |
| 0x00470853 | 0x06CC | 16字节 | - | USB状态 |
| 0x0047085B | 0x06CC | 16字节 | - | USB状态 |

### 摄像头帧格式

```
Handle=0x1CE8 IOCTL=0x002F0410
数据大小: 176/312 字节 (可变)

帧头结构 (前16字节):
[C0 01] [00 00 00 00 00 00] [00 00] [00 00] [00 00]
  标记    未知              长度   偏移   类型

后续数据: 实际摄像头数据 (可能包含NV12标记)
```

### 帧数据特征
- **大小**：176/312字节（不是完整图像帧）
- **格式**：包含NV12标记（YUV 4:2:0）
- **传输方式**：通过HID报告分块传输

### USB描述符数据

从 IOCTL 0x00470813 提取到设备字符串：
- `ROOT\DISPLAY\0001` - 根设备
- `ROOT\BASIC_RENDER\0001` - 渲染设备
- `PCI\VEN_10DE&DEV_1F91...` - NVIDIA GPU
- `USB\VID_13D3&PID_5415...` - USB摄像头设备

---

## 四、版本历史

### v32 - 帧捕获模式
- **新功能**：自动识别摄像头Handle、保存帧数据到`D:\mumu_frames\`
- **Hook函数**：DeviceIoControl、CreateFileW

### v33 - NV12检测
- **新功能**：检测NV12格式字符串
- **问题**：去重逻辑导致只保存1个帧

### v34 - 修复去重
- **修复**：去掉去重逻辑，保存所有帧（最大200帧）
- **新增工具**：`convert_frames.py` - 转换.raw帧为.bmp图片

### v35 - 详细帧分析
- **问题发现**：312字节帧不是完整图像
- **帧结构分析**：
  - 签名：0x01C0
  - NV12标记在offset 144
  - 包含55字节连续NULL序列
- **结论**：需要Hook底层驱动获取完整帧

### v35最新分析 - 序列与分辨率发现！
- **序列标识**：Offset 28-31是递增的序列号（01, 03, 05, 07, 09...每次+0x02）
- **分辨率信息**：Offset 148-151有0x1000 (4096), Offset 152-155有0x0080 (128), Offset 164-167有0x0500 (1280), Offset 168-171有0x02D0 (720)
- **格式**："NV12NV12"在offset 144

---

## 五、帧数据分析结果

### HID报告结构 (312字节)
```
Offset 0-1:   0xC0 0x01 (签名 - 固定)
Offset 2-5:   0x00000000 (未知 - 固定0)
Offset 6-9:   数据长度/类型
Offset 10-11: 未知
Offset 12-15: 序列1 (递增 01, 03, 05...)
Offset 16-19: 帧类型 (0x00402A00)
Offset 20-23: 子类型
Offset 24-27: 未知
Offset 28-31: 序列2 (递增 01, 03, 05, 07, 09, 0B, 0D, 0F, 11...)
Offset 32-143: 负载数据
Offset 144:   "NV12NV12" 格式标识
Offset 148-151: 0x1000 (4096)
Offset 152-155: 0x0080 (128)
Offset 164-167: 0x0500 (1280)
Offset 168-171: 0x02D0 (720)
Offset 248-251: 0x00000078 (120)
Offset 252-255: 0x00001000 (4096)
Offset 256-259: 0x00000040 (64)
```

### 关键发现
1. **312字节只是HID报告碎片**，不是完整摄像头帧
2. **NV12格式**在offset 144处标识
3. **完整帧需要从多个HID报告组合**或Hook底层驱动
4. **MuMu使用USB摄像头**：VID_13D3, PID_5415
5. **分辨率信息**：1280x720（1280=0x500, 720=0x2D0）
6. **序列标识**：每个HID报告有唯一序列号用于重组

---

## 六、当前文件结构

```
D:\ScreenWall2\mumu_camera_hook\
├── camera_hook35.cpp       # v35 - 详细帧分析 ✅
├── camera_hook35.dll       # v35编译产物 ✅
├── camera_hook34.cpp       # v34 - 捕获所有帧
├── camera_hook33.cpp       # v33 - NV12检测
├── camera_hook32.cpp       # v32 - 帧捕获
├── camera_hook31.cpp       # v31 - 完整HID API
├── injector35.exe          # v35注入器 ✅
├── convert_frames.py       # 帧转换工具
├── analyze_frame.exe       # 帧分析工具 ✅
└── minhook\                # MinHook库

输出目录:
D:\mumu_frames\             # v34帧数据
D:\mumu_frames_v2\          # v35帧数据
```

---

## 六、使用方法

### 1. 收集帧数据
```batch
# 清空旧文件
del D:\mumu_camera_hook.log
del D:\mumu_frames\*.raw

# 运行注入器
injector34.exe

# 在MuMu中打开摄像头
# 帧自动保存到 D:\mumu_frames\
```

### 2. 转换帧为图片
```batch
python convert_frames.py
# 输出到 D:\mumu_frames\converted\
```

---

## 七、下一步计划

1. **测试v35** - 收集详细日志，分析完整帧结构
2. **Hook底层驱动** - 可能需要Hook winusb.sys或usbccgp.sys
3. **实现虚拟摄像头** - 基于分析结果实现帧替换

### 编译
```batch
build32.bat
```

### 测试v32
1. 删除 `D:\mumu_camera_hook.log`
2. 清空 `D:\mumu_frames\` 目录
3. 运行MuMu模拟器
4. 运行 `injector32.exe`
5. 在MuMu中打开摄像头应用
6. 等待几秒后关闭
7. 查看日志和帧文件