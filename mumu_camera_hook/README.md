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
ERROR:NO_MUMU_PROCESS        # 返回1，无模拟器
RESULT:OK:成功数:跳过数:失败数  # 返回0
```

**示例**：
```
# 注入成功
RESULT:OK:1:0:0

# 重复注入
RESULT:OK:0:1:0

# 混合情况
RESULT:OK:1:2:0
```

**静默退出**：注入器不显示任何弹窗或窗口，由客户端统一处理。

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
3. 检查返回码

### 与客户端集成

```python
import subprocess

result = subprocess.run(['injector49.exe'], capture_output=True, text=True)
output = result.stdout.strip()

if result.returncode == 0:
    # 成功，解析输出
    if ':' in output:
        _, data = output.split(':', 1)
        success, skip, fail = map(int, data.split(':'))
        if success > 0:
            print("注入成功")
        else:
            print("重复注入，跳过")
else:
    print("无MUMU进程，请先启动模拟器")
```

---

## DLL导出函数

```cpp
extern "C" __declspec(dllexport) BOOL GetCameraCompleted();
extern "C" __declspec(dllexport) void ResetCameraCompleted();
```

---

## 技术细节

| 项目 | 说明 |
|------|------|
| 检测方式 | EnumWindows API轮询（每500ms） |
| 点击方式 | PostMessage发送WM_LBUTTONDOWN/UP |
| 目标窗口 | Qt5/Qt6窗口，尺寸336x316 |
| 注入检测 | EnumProcessModules枚举模块列表 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v49 | 2026-05-19 | 简化返回值，静默退出 |
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
2. **注入器路径**：injector49.exe需与客户端同目录
3. **重复启动**：MUMU客户端重启时会自动跳过已注入的进程
4. **DLL卸载**：关闭MUMU模拟器后DLL自动卸载
