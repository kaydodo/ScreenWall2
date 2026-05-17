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

---

## 五、当前文件结构

```
D:\ScreenWall2\mumu_camera_hook\
├── camera_hook34.cpp       # v34 - 捕获所有帧 ✅
├── camera_hook34.dll       # v34编译产物 ✅
├── camera_hook33.cpp       # v33 - NV12检测
├── camera_hook32.cpp       # v32 - 帧捕获
├── camera_hook31.cpp       # v31 - 完整HID API
├── injector34.exe          # v34注入器 ✅
├── convert_frames.py       # 帧转换工具 ✅
└── minhook\                # MinHook库

输出目录:
D:\mumu_frames\
├── frame_XXX.raw           # 原始帧数据
└── converted\              # 转换后的.bmp图片
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

1. **测试v34** - 收集足够的帧数据
2. **分析帧组合方式** - 确定如何从多个HID报告重构完整图像
3. **开发虚拟摄像头** - 基于分析结果实现帧替换

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