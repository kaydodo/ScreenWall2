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

**导出函数**：
无（当前 v49 DLL 与 v48 一致，仅保留核心功能）

---

## 技术细节

| 项目 | 说明 |
|------|------|
| DLL 检测方式 | EnumWindows API 轮询（每 500ms） |
| 点击方式 | PostMessage 发送 WM_LBUTTONDOWN/UP |
| 目标窗口 | Qt5/Qt6 窗口，尺寸 336x316 |
| 注入检测 | EnumProcessModules 枚举模块列表 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
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

1. **必须先启动模拟器**：客户端启动前必须先运行MUMU模拟器
2. **注入器与 DLL 同目录**：`injector49.exe` 和 `camera_hook49.dll` 需要在同一目录
3. **重复启动**：MUMU客户端重启时会自动跳过已注入的进程
4. **DLL 卸载**：关闭MUMU模拟器后 DLL 自动卸载
5. **进程筛选**：MuMu有多个进程，非目标进程注入失败是正常的，不影响结果
