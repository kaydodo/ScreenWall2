# MuMu Camera Hook

## 功能概述

自动点击MUMU模拟器的摄像头选择弹窗（336x316尺寸的Qt5窗口），实现摄像头默认连接。

## 版本说明

### v49（当前版本）

**新增功能**：
- 自动注入：MUMU客户端启动时自动注入
- 二次注入检测：避免重复注入已加载的DLL
- 命名管道预留：摄像头弹窗完成后可通知客户端

**使用场景**：
- 配合MUMU客户端（mumu_client.py）使用
- 用于自助登号功能的摄像头扫码流程

### v48（历史版本）

极简版，去除日志、摄像头捕获等功能。

### v47（历史版本）

首个稳定版本，基于v35安全架构。

---

## 目录结构

```
mumu_camera_hook/
├── README.md              # 本文档
├── ANALYSIS_REPORT.md     # 技术分析报告
├── build49.bat            # v49编译脚本
├── camera_hook49.cpp      # v49 DLL源代码
├── camera_hook49.dll      # v49 Hook DLL
├── injector49.cpp         # v49 注入器源代码
├── injector49.exe        # v49 注入器
├── build48.bat            # v48编译脚本（历史）
├── camera_hook48.cpp      # v48 DLL源代码（历史）
├── camera_hook48.dll      # v48 Hook DLL（历史）
├── injector48.cpp         # v48 注入器源代码（历史）
└── injector48.exe        # v48 注入器（历史）
```

---

## v49 详细说明

### 编译方法

```batch
cd D:\ScreenWall2\mumu_camera_hook
build49.bat
```

**编译输出**：
- `camera_hook49.dll` - Hook DLL
- `injector49.exe` - 注入器

### 独立使用

1. 启动MUMU模拟器
2. 运行 `injector49.exe`
3. 观察输出：
   - `[ALREADY INJECTED]` = 已注入，跳过
   - `Success!` = 注入成功
   - `Failed!` = 注入失败

### 与MUMU客户端集成

**目录结构**：
```
mumu-client/
├── injector49.exe    # 注入器（与客户端同目录）
├── mumu_client.py    # 客户端主程序
└── config.json       # 配置文件
```

**客户端启动流程**：
1. 检测MUMU模拟器是否运行
2. 若未运行 → 弹窗提示"请先启动模拟器"
3. 检测DLL是否已注入
4. 未注入则执行注入
5. 注入失败 → 弹窗提示"请检查模拟器状态后重新打开客户端"

### DLL导出函数

```cpp
extern "C" __declspec(dllexport) BOOL GetCameraCompleted();
// 返回：摄像头弹窗是否已处理完成

extern "C" __declspec(dllexport) void ResetCameraCompleted();
// 功能：重置摄像头完成状态
```

### 命名管道

- 管道名称：`\\.\pipe\MuMuCameraHook`
- 用途：摄像头弹窗处理完成后通知客户端
- 数据格式：`"CAMERA_OK"`（9字节）

---

## 技术细节

| 项目 | 说明 |
|------|------|
| 检测方式 | EnumWindows API轮询（每500ms） |
| 点击方式 | PostMessage发送WM_LBUTTONDOWN/UP |
| 目标窗口 | Qt5/Qt6窗口，尺寸336x316 |
| 注入检测 | EnumProcessModules枚举模块列表 |
| 稳定性 | 不Hook user32.dll窗口函数，避免Qt崩溃 |

---

## 业务流程（自助登号场景）

```
1. 用户在电脑客户端右键 → 选择"自助登号"
   ↓
2. 打开 self-service.html
   ↓
3. 页面加载完成，自动获取当前设备的businessId
   ↓
4. 用户点击"扫码登号"按钮
   ↓
5. 前端发送 cameraRequest 消息给MUMU客户端
   ↓
6. MUMU客户端通过命名管道通知DLL
   ↓
7. DLL检测到摄像头弹窗 → 自动点击中心位置
   ↓
8. DLL通过命名管道返回 cameraDone 给MUMU客户端
   ↓
9. MUMU客户端通知服务端截图申请
   ↓
10. 服务端向对应电脑客户端申请截图 → 二维码处理
```

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v49 | 2026-05-19 | 自动注入+二次检测+命名管道 |
| v48 | 2026-05-17 | 极简版（去日志） |
| v47 | 2026-05-17 | 首个稳定版（EnumWindows） |
| v35-v46 | 2026-05 | 调试版本（存在崩溃） |

---

## 编译环境

- SDK：Windows 10 (10.0.26100.0)
- VS：Visual Studio 2022 Community
- MSVC：14.44.35207

**依赖库**：
- psapi.lib（进程模块枚举）
- user32.lib（弹窗功能）

---

## 注意事项

1. **必须先启动模拟器**：客户端启动前必须先运行MUMU模拟器
2. **注入器路径**：injector49.exe需与mumu_client.py同目录
3. **重复启动**：MUMU客户端重启时会自动跳过已注入的进程
4. **DLL卸载**：关闭MUMU模拟器后DLL自动卸载
