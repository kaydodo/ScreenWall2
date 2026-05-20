# MuMu Camera Hook

## 功能概述

自动点击MUMU模拟器的摄像头选择弹窗（336x316尺寸的Qt5窗口），实现摄像头默认连接。

## 版本说明

### v49（当前版本）

**返回值约定**：
| 返回值 | 含义 |
|--------|------|
| 0 | 成功（无论注入成功还是重复注入） |
| 1 | 失败（无MUMU进程） |

**输出格式**：
```
# 情况1：无MUMU进程
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

**DLL新增功能**：
- 命名管道通信：`\\\\.\\pipe\\MuMuCameraHook`（查询/重置状态）
- 命名管道通信：`\\\\.\\pipe\\MuMuCameraNotify`（主动推送通知）
- 管道命令（MuMuCameraHook）：
  - `GET_STATUS` → 返回 `STATUS:0` 或 `STATUS:1`
  - `RESET_STATUS` → 返回 `RESET_OK`
- 管道通知（MuMuCameraNotify）：
  - 点击完成后主动发送 `CLICKED:时间戳`（时间戳为GetTickCount64()毫秒值）
- 导出函数：
  - `int GetCameraCompleted()`: 获取摄像头选择状态（0=未完成，1=已完成）
  - `void ResetCameraCompleted()`: 重置摄像头选择状态

**自助登号流程**：
1. MUMU客户端启动，注入camera_hook49.dll
2. 客户端启动两个线程：
   - 查询线程：连接`\\\\.\\pipe\\MuMuCameraHook`，用于查询/重置状态
   - 监听线程：连接`\\\\.\\pipe\\MuMuCameraNotify`，用于接收主动推送
3. 自助登号页面可通过服务端查询/重置摄像头状态：
   - `getCameraStatus` → 客户端返回 `cameraStatus`
   - `resetCameraStatus` → 客户端返回 `cameraStatusReset`
4. 当检测到摄像头弹窗点击后，DLL主动通过`MuMuCameraNotify`推送通知
5. 客户端收到通知后，向服务端发送`cameraClicked`消息，携带统一时间戳

---

## 目录结构

```
mumu_camera_hook/
├── README.md              # 本文档
├── ANALYSIS_REPORT.md     # 技术分析报告
├── camera_hook49.cpp      # v49 DLL源代码
├── camera_hook49.dll      # v49 Hook DLL
├── injector49.cpp         # v49 注入器源代码
└── injector49.exe        # v49 注入器
└── build_injector49.bat  # 编译脚本
```

---

## 编译方法

```batch
cd D:\ScreenWall2\mumu_camera_hook
build_injector49.bat
```

---

## 使用方法

### 独立使用

1. 启动MUMU模拟器
2. 运行 `injector49.exe`
3. 查看输出

### 与 MuMu 客户端联动

**目录要求**：
```
mumu-client/
├── mumu_client.py
├── injector49.exe
└── camera_hook49.dll
```

**客户端联动流程**：
1. 客户端先检查 ADB 连接（确保模拟器已启动）
2. 调用 `injector49.exe`，捕获标准输出
3. 解析输出判断结果：
   - 有 `INJECT_SUCCESS` → 控制台打印，不弹窗
   - 有 `ALREADY_INJECTED` → 控制台打印，不弹窗
   - 其他情况 → 弹窗提示"注入失败"并退出

**代码参考**（简化版）：
```python
import subprocess
import os

base_dir = os.path.dirname(os.path.abspath(__file__))
injector_path = os.path.join(base_dir, "injector49.exe")

if not os.path.exists(injector_path):
    MessageBox(None, "注入器不存在", "错误", 0x10)
    return False

try:
    result = subprocess.run(
        [injector_path],
        capture_output=True,
        text=True,
        timeout=10
    )
    output = result.stdout.strip()

    if "INJECT_SUCCESS" in output:
        print("[MUMU] 摄像头Hook注入成功")
    elif "ALREADY_INJECTED" in output:
        print("[MUMU] 已注入Hook，无需再次注入")
    else:
        MessageBox(None, "注入失败，请检查模拟器状态", "错误", 0x10)
        return False
except Exception as e:
    MessageBox(None, f"注入失败: {e}", "错误", 0x10)
    return False

return True
```

---

## DLL 功能

**功能**：
- 每 500ms 调用 EnumWindows 枚举窗口
- 检测 336x316 尺寸的 Qt5/Qt6 窗口
- 使用 PostMessage 发送 WM_LBUTTONDOWN/UP 点击窗口中心
- 提供命名管道通信接口（查询/重置 + 主动通知）
- 提供导出函数供外部调用
- 点击完成后通过事件和管道主动推送通知

**导出函数**：
```cpp
// 获取摄像头选择状态
// 返回值：0=未完成，1=已完成
extern "C" __declspec(dllexport) int GetCameraCompleted();

// 重置摄像头选择状态
extern "C" __declspec(dllexport) void ResetCameraCompleted();
```

**命名管道通信（查询/重置）**：
- 管道名称：`\\\\.\\pipe\\MuMuCameraHook`
- 命令格式：
  - 发送 `GET_STATUS` → 收到 `STATUS:0` 或 `STATUS:1`
  - 发送 `RESET_STATUS` → 收到 `RESET_OK`

**命名管道通信（主动通知）**：
- 管道名称：`\\\\.\\pipe\\MuMuCameraNotify`
- 通知格式：
  - 点击完成后主动发送 `CLICKED:时间戳`
  - 时间戳为 `GetTickCount64()` 返回的毫秒值
- 实现方式：事件对象 + 专用线程
  - 创建命名事件 `MuMuCameraClickedEvent`
  - `NotifyPipeServerThread` 线程等待事件触发
  - 触发后通过管道发送通知消息

---

## 技术细节

| 项目 | 说明 |
|------|------|
| DLL 检测方式 | EnumWindows API 轮询（每 500ms） |
| 点击方式 | PostMessage 发送 WM_LBUTTONDOWN/UP |
| 目标窗口 | Qt5/Qt6 窗口，尺寸 336x316 |
| 注入检测 | EnumProcessModules 枚举模块列表 |
| 主动通知机制 | 事件对象（MuMuCameraClickedEvent）+ 专用线程（NotifyPipeServerThread） |
| 状态查询管道 | \\\\.\\pipe\\MuMuCameraHook（双向通信） |
| 主动通知管道 | \\\\.\\pipe\\MuMuCameraNotify（单向推送） |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v49 | 2026-05-20 | 新增主动推送通知机制，通过 \\\\.\\pipe\\MuMuCameraNotify 管道推送 CLICKED:时间戳；DLL增加事件对象和NotifyPipeServerThread线程；完善自助登号流程支持 |
| v49 | 2026-05-19 | 注入器移除弹窗，修复进程查重逻辑，完善返回值判断；DLL恢复管道通信和导出函数功能，支持自助登号流程 |
| v48 | 2026-05-17 | 极简版（去日志） |
| v47 | 2026-05-17 | 首个稳定版（EnumWindows） |

---

## 编译环境

- SDK：Windows 10 (10.0.26100.0)
- VS：Visual Studio 2022 Community
- MSVC：14.44.35207

---

## 注意事项

1. **必须先启动模拟器**：客户端启动前必须先运行MUMU模拟器
2. **注入器与 DLL 同目录**：`injector49.exe` 和 `camera_hook49.dll` 需要在同一目录
3. **重复启动**：MUMU客户端重启时会自动跳过已注入的进程
4. **DLL 卸载**：关闭MUMU模拟器后 DLL 自动卸载
5. **进程筛选**：MuMu有多个进程，非目标进程注入失败是正常的，不影响结果
