# MuMu Camera Hook

## 功能概述

自动点击MuMu模拟器的摄像头选择弹窗（336x316尺寸的Qt5窗口），实现摄像头默认连接。

## 版本说明

### v49（当前版本）

**返回值约定**：
| 返回值 | 含义 |
|--------|------|
| 0 | 成功（无论注入成功还是重复注入） |
| 1 | 失败（无MuMu进程） |

**输出格式**：
```
# 情况1：无MuMu进程
ERROR:NO_MUMU

# 情况2：有至少一个成功注入
OK:INJECT_SUCCESS

# 情况3：全是已注入
OK:ALREADY_INJECTED

# 情况4：全失败
ERROR:INJECT_FAILED
```

**关键逻辑**：
- 枚举所有MuMu进程，逐个检查是否已注入
- 已注入的跳过，未注入的尝试注入
- 注入失败的进程标记为"可能不是目标进程"，不影响整体判断
- 只要有成功或已注入，就返回成功，忽略非目标进程失败

**DLL功能**：
- 检测336x316尺寸的Qt5/Qt6窗口（摄像头选择弹窗）
- 使用PostMessage发送WM_LBUTTONDOWN/UP点击窗口中心
- 点击完成后写入JSON文件通知MU服务
- 导出函数：
  - `int GetCameraCompleted()`: 获取摄像头选择状态（0=未完成，1=已完成）
  - `void ResetCameraCompleted()`: 重置摄像头选择状态

---

## DLL与MU服务通信机制

### 通信方式：JSON文件轮询

**触发文件路径**：`D:\camera_trigger.json`

**文件格式**：
```json
{
  "cameraTrigger": "随机16字符字符串"
}
```

**通信流程**：
```
1. MU服务初始化
   ├─ 检查 D:\camera_trigger.json 是否存在
   ├─ 不存在则创建，存在则记录修改时间
   └─ 启动轮询线程（0.5秒间隔）

2. DLL检测到摄像头弹窗
   ├─ 点击关闭弹窗
   ├─ 读取 JSON 文件
   ├─ 生成随机字符串更新 cameraTrigger 字段
   ├─ 写入 JSON 文件（1秒防抖）
   └─ 文件修改时间更新

3. MU服务轮询检测
   ├─ 检测文件修改时间变化
   ├─ 变化则发送 cameraClicked 消息到服务端
   └─ 携带点击信息和时间戳
```

**防抖机制**：
- DLL写入间隔至少1秒（`DEBOUNCE_INTERVAL = 1000`）
- 避免频繁写入造成IO压力

**轮询间隔**：
- MU服务每0.5秒检测一次文件修改时间
- 简单可靠，开销极小

---

## 目录结构

```
mumu_camera_hook/
├── README.md              # 本文档
├── ANALYSIS_REPORT.md     # 技术分析报告
├── camera_hook49.cpp      # v49 DLL源代码
├── camera_hook49.dll      # v49 Hook DLL
├── injector49.cpp         # v49 注入器源代码
├── injector49.exe         # v49 注入器
├── build_dll49.bat        # DLL编译脚本
└── build_injector49.bat   # 注入器编译脚本
```

---

## 编译方法

```batch
cd D:\ScreenWall2\mumu_camera_hook
build_dll49.bat
build_injector49.bat
```

---

## 使用方法

### 独立使用

1. 启动MuMu模拟器
2. 运行 `injector49.exe`
3. 查看输出

### 与MU服务联动

**目录要求**：
```
mumu-service/
├── mumu_service.py
├── injector49.exe
└── camera_hook49.dll
```

**联动流程**：
1. MU服务先连接WebSocket服务端并注册
2. 等待MuMu模拟器ADB连接
3. 调用 `injector49.exe` 注入DLL
4. DLL检测到摄像头弹窗后写入 `D:\camera_trigger.json`
5. MU服务轮询检测文件变化，发送 `cameraClicked` 消息

---

## DLL 功能

**功能**：
- 每500ms调用EnumWindows枚举窗口
- 检测336x316尺寸的Qt5/Qt6窗口
- 使用PostMessage发送WM_LBUTTONDOWN/UP点击窗口中心
- 点击完成后写入JSON文件通知MU服务
- 提供导出函数供外部调用

**导出函数**：
```cpp
// 获取摄像头选择状态
// 返回值：0=未完成，1=已完成
extern "C" __declspec(dllexport) int GetCameraCompleted();

// 重置摄像头选择状态
extern "C" __declspec(dllexport) void ResetCameraCompleted();
```

---

## 技术细节

| 项目 | 说明 |
|------|------|
| DLL检测方式 | EnumWindows API轮询（每500ms） |
| 点击方式 | PostMessage发送WM_LBUTTONDOWN/UP |
| 目标窗口 | Qt5/Qt6窗口，尺寸336x316 |
| 注入检测 | EnumProcessModules枚举模块列表 |
| 通信方式 | JSON文件轮询（D:\camera_trigger.json） |
| 防抖间隔 | 1秒 |
| 轮询间隔 | 0.5秒 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v49 | 2026-05-27 | 重构通信机制：从管道改为JSON文件轮询，固定路径D:\camera_trigger.json |
| v49 | 2026-05-20 | 新增主动推送通知机制，通过管道推送CLICKED:时间戳 |
| v49 | 2026-05-19 | 注入器移除弹窗，修复进程查重逻辑，完善返回值判断 |
| v48 | 2026-05-17 | 极简版（去日志） |
| v47 | 2026-05-17 | 首个稳定版（EnumWindows） |

---

## 编译环境

- SDK：Windows 10 (10.0.26100.0)
- VS：Visual Studio 2022 Community
- MSVC：14.44.35207

---

## 注意事项

1. **必须先启动模拟器**：客户端启动前必须先运行MuMu模拟器
2. **注入器与DLL同目录**：`injector49.exe`和`camera_hook49.dll`需要在同一目录
3. **重复启动**：MuMu客户端重启时会自动跳过已注入的进程
4. **DLL卸载**：关闭MuMu模拟器后DLL自动卸载
5. **进程筛选**：MuMu有多个进程，非目标进程注入失败是正常的，不影响结果
6. **触发文件**：`D:\camera_trigger.json` 需要D盘存在
