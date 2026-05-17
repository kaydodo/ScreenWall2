# MuMu模拟器摄像头Hook分析进度报告

更新时间：2026-05-17 18:15

## 一、项目目标

通过DLL注入方式，监控MuMu模拟器的摄像头API调用，实现虚拟摄像头替换。

---

## 二、当前文件结构

```
D:\ScreenWall2\mumu_camera_hook\
├── camera_hook31.cpp       # v31版本源码（完整HID API Hook）✅
├── camera_hook31.dll       # v31编译产物 ✅
├── camera_hook30.cpp       # v30版本源码（Hook HID专用函数）✅
├── camera_hook29.cpp       # v29版本源码（Hook SetupDi设备枚举）✅
├── injector.cpp            # 注入器源码
├── injector31.exe          # v31注入器 ✅
├── build31.bat             # v31编译脚本 ✅
└── minhook\                # MinHook库
```

---

## 三、v31改进内容（最新版）

### Hook新增函数
- **HidD_GetFeature** - 获取HID特性报告（关键！用于获取摄像头能力）
- **HidD_GetProductString** - 获取产品字符串
- **HidD_GetManufacturerString** - 获取制造商字符串
- **HidD_GetSerialNumberString** - 获取序列号字符串

### 已有函数（继续Hook）
- HidD_GetAttributes
- HidD_GetPreparsedData
- CreateFileW（仅HID相关路径）
- DeviceIoControl（记录所有调用及返回数据）
- lstrcmpW（仅HID路径匹配）

### 日志增强
- 记录所有DeviceIoControl调用（不只是前50个）
- 记录返回数据的十六进制内容
- 记录所有HID字符串信息

---

## 四、已知发现回顾

### 已确认事实
| 发现 | 证据来源 |
|-----|---------|
| MuMu使用HID设备 | v23-v24日志：`\\?\hid#vid_048d&pid_c100&col02#...` |
| 使用DeviceIoControl通信 | v23-v24日志：IOCTL 0x000B01A8 |
| 通过lstrcmpW匹配路径 | v24日志 |
| 不使用SetupDi API | v29测试：0次调用 |
| DeviceIoControl高频率 | v28测试：4950次 |

### IOCTL代码汇总
| IOCTL代码 | 频率 | 用途推测 |
|----------|------|---------|
| 0x000B01A8 | 高 | 摄像头数据读取 |
| 0x002F0410 | 高 | HID输入报告 |
| 0x002F040C | 中 | HID输出报告 |
| 0x0047080C | 低 | USB控制请求 |

---

## 五、快速使用总结

| 版本 | 功能 | 状态 |
|-----|------|------|
| v23-v24 | HID通信记录 | ✅ 发现关键信息 |
| v25-v28 | 通用API Hook | ✅ 已验证 |
| v29 | SetupDi Hook | ✅ 已确认MuMu不使用此API |
| v30 | HID函数Hook | ⚠️ 测试未捕获数据 |
| v31 | 完整HID API Hook | ✅ 已编译，等待测试 |

---

## 六、下一步计划

1. **测试v31**：在MuMu中打开摄像头应用
2. **观察HID函数调用**：确认MuMu使用哪些HID函数
3. **分析DeviceIoControl数据**：解析摄像头帧数据格式
4. **确定替换方案**：基于分析结果设计虚拟摄像头

---

## 七、使用说明

### 编译
```batch
build31.bat
```

### 使用
1. 确保MuMu模拟器正在运行
2. 运行 `injector31.exe`
3. 在MuMu中打开摄像头应用
4. 查看 `D:\mumu_camera_hook.log` 日志文件

### 日志分析重点
1. **HidD_GetProductString** - 获取的设备名称
2. **CreateFileW** - HID设备路径
3. **DeviceIoControl** - IOCTL代码和返回数据
4. **lstrcmpW** - 设备路径匹配过程