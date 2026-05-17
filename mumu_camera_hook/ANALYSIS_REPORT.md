# MuMu模拟器摄像头Hook分析进度报告

更新时间：2026-05-17 18:50

## 一、项目目标

通过DLL注入方式，监控MuMu模拟器的摄像头API调用，实现虚拟摄像头替换。

---

## 二、v31/v32重大发现

### 关键结论：MuMu不使用标准HID API

v31测试结果证明：**MuMu直接使用USB HID类驱动，不通过标准HID API**。

| 统计项 | 数值 | 说明 |
|--------|------|------|
| HidD_GetAttributes | 0 | ❌ 未调用 |
| HidD_GetFeature | 0 | ❌ 未调用 |
| HidD_GetPreparsedData | 0 | ❌ 未调用 |
| HidD_GetProductString | 0 | ❌ 未调用 |
| DeviceIoControl | 2024+ | ✅ 大量调用 |
| CreateFileW (HID路径) | 0 | ❌ 未调用 |

---

## 三、摄像头通信分析

### 主要IOCTL代码

| IOCTL | Handle | 数据大小 | 频率 | 说明 |
|-------|--------|---------|------|------|
| 0x002F0410 | 0x0B28 | 448字节 | ~30ms/次 | **摄像头帧数据** |
| 0x002F041C | - | - | - | 摄像头控制 |
| 0x002F0420 | - | - | - | 摄像头控制 |
| 0x002F040C | - | 24字节 | - | USB输出 |
| 0x00470807 | 0x06CC | 20-608字节 | - | USB描述符 |
| 0x00470813 | 0x06CC | 20-540字节 | - | USB描述符 |
| 0x0047083F | 0x06CC | 22-540字节 | - | USB配置 |
| 0x00470843 | 0x06CC | 8字节 | - | USB状态 |
| 0x00470853 | 0x06CC | 16字节 | - | USB状态 |
| 0x0047085B | 0x06CC | 16字节 | - | USB状态 |

### 摄像头帧格式

```
Handle=0x0B28 IOCTL=0x002F0410
数据大小: 176/312/448 字节 (可变)

帧头结构 (前16字节):
[C0 01] [00 00 00 00 00 00] [00 00] [00 00] [00 00]
  标记    未知              长度   偏移   类型

后续数据: 实际摄像头图像/视频数据
```

### USB描述符数据

从 IOCTL 0x00470813 提取到设备字符串：
- `ROOT\DISPLAY\0001` - 根设备
- `ROOT\BASIC_RENDER\0001` - 渲染设备
- `PCI\VEN_10DE&DEV_1F91...` - NVIDIA GPU
- `USB\VID_13D3&PID_5415...` - USB摄像头设备

---

## 四、v32改进 - 帧捕获模式

### 新功能
1. **自动识别摄像头Handle** - 检测 IOCTL 0x002F0410 的Handle
2. **保存帧数据到文件** - `D:\mumu_frames\frame_XXX.raw`
3. **USB描述符解析** - 提取设备字符串信息
4. **简化日志** - 减少日志量，聚焦关键信息

### Hook函数
- DeviceIoControl - 捕获所有调用
- CreateFileW - 记录USB/HID设备打开

---

## 五、当前文件结构

```
D:\ScreenWall2\mumu_camera_hook\
├── camera_hook32.cpp       # v32帧捕获版本 ✅
├── camera_hook32.dll       # v32编译产物 ✅
├── camera_hook31.cpp       # v31完整HID API
├── injector32.exe          # v32注入器 ✅
└── minhook\                # MinHook库
```

---

## 六、下一步计划

1. **测试v32** - 捕获实际帧文件
2. **分析帧格式** - 确定图像编码方式
3. **开发虚拟摄像头** - 基于分析结果实现替换

---

## 七、使用说明

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