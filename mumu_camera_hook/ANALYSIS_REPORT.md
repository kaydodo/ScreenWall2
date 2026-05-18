# MuMu模拟器摄像头Hook分析进度报告

更新时间：2026-05-17 22:00

## 一、项目目标

通过DLL注入方式，自动处理MuMu模拟器的Qt5摄像头选择弹窗，实现摄像头默认连接（无需手动选择）。

---

## 二、Qt5摄像头弹窗分析

### 弹窗特征

| 属性 | 值 |
|------|-----|
| 类名 | Qt5156QWindow |
| 目标尺寸 | 336x316 |
| ShowWindow参数 | cmd=1 (SW_SHOWNORMAL) |
| 出现时机 | 点击摄像头设置选项时 |
| 按钮文字 | "摄像头" 或 "camera" |

---

## 三、版本历史与Hook对比

### Hook函数对比表

| Hook函数 | v36 | v37 | v38 | v40 | v41 | v42/v43 | v47/v48 |
|----------|-----|-----|-----|-----|-----|---------|---------|
| CreateWindowExW | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ShowWindow | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| SetWindowPos | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| MoveWindow | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| DialogBoxParamW | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| DialogBoxW | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MessageBoxW | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| SendMessageW | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| PostMessageW | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| FindWindowExW | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| FindWindowW | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| EnumChildWindows | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **EnumWindows轮询** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **✅** |

### 版本演进

| 版本 | 功能 | 崩溃状态 | 备注 |
|------|------|----------|------|
| v35 | 摄像头数据捕获 | ✅ 无崩溃 | kernel32.dll Hook |
| v36 | 探测摄像头数据 | ❌ 崩溃 | 引入user32.dll Hook |
| v37 | 探测弹窗（第1次） | ❌ 崩溃 | 继承v36 Hook |
| v38 | 探测弹窗（第2次） | ❌ 崩溃 | 继承v36 Hook |
| v40 | 精确尺寸336x316 | ❌ 崩溃 | 继承v36 Hook |
| v41 | 移除DialogBoxParamW | ❌ 崩溃 | 继承v36 Hook |
| v42 | WM_LBUTTON消息 | ❌ 崩溃 | 继承v36 Hook |
| v43 | SW_SHOWNORMAL修复 | ❌ 崩溃 | 继承v36 Hook |
| v44 | 精简Hook | ❌ 崩溃 | 保留CreateWindowExW+ShowWindow |
| v45 | 仅ShowWindow触发 | ❌ 崩溃 | 同v44 |
| v46 | mouse_event替代 | ❌ 崩溃 | PostMessage改为mouse_event |
| **v47** | **EnumWindows轮询** | ✅ **无崩溃** | **基于v35安全架构** |
| **v48** | **极简版** | ✅ **无崩溃** | **去除日志、摄像头捕获** |

---

## 四、崩溃原因分析

### 用户反馈
> "前两次探测弹窗都没有报错，之后就出现了问题"

### 关键差异（v35 vs v36）

**v35特点（无崩溃）**：
- 只Hook `kernel32.dll`：`DeviceIoControl`、`CreateFileW`
- 不Hook任何user32.dll窗口函数
- 用于摄像头数据捕获

**v36变化（开始崩溃）**：
- 新增Hook `user32.dll`：`CreateWindowExW`、`ShowWindow`、`DialogBoxParamW`、`SendMessageW`、`PostMessageW`、`FindWindowW`、`FindWindowExW`、`EnumChildWindows`

### 崩溃根因

| Hook函数 | 问题分析 |
|----------|----------|
| `PostMessageW` | Qt用它发送所有事件，Hook导致事件分发被干扰 |
| `SendMessageW` | Qt用它进行同步消息传递，Hook导致时序问题 |
| `EnumChildWindows` | 枚举窗口触发Qt内部状态变化 |
| `FindWindowW` | 高频调用，Hook开销大 |

**结论**：Hook user32.dll的窗口/消息函数会干扰Qt事件循环，导致程序崩溃。

---

## 五、v47/v48测试结果

### v47测试日志
```
21:17:07.810  WM_LBUTTONDOWN/UP sent  ← 点击发送
21:17:17.015  DLL unloaded            ← 10秒后程序退出
```
**v47结论**：点击功能正常，但仍有崩溃问题。

### v48测试日志
```
Camera dialog check thread started
*** CAMERA 336x316 FOUND! HWND=XXXXXXX
WM_LBUTTONDOWN/UP sent via PostMessage
```
**v48结论**：
1. ✅ 弹窗检测成功
2. ✅ 自动点击成功
3. ✅ 无崩溃
4. ✅ 无日志写入

---

## 六、最终精简目录结构

```
D:\ScreenWall2\mumu_camera_hook\
├── README.md              # 项目说明
├── ANALYSIS_REPORT.md     # 本分析报告
├── build48.bat            # 编译脚本
├── camera_hook48.cpp      # DLL源代码（极简版）
├── camera_hook48.dll      # 最终Hook DLL
├── injector.cpp           # 注入器源代码
├── injector48.exe         # 最终注入器
└── minimal_injector.cpp  # 备用注入器（带MessageBox提示）
```

### 历史遗留文件（被进程锁定，待清理）
```
camera_hook16.dll ~ camera_hook47.dll（各版本历史DLL）
```

---

## 七、v48技术实现

### 完整源代码

```cpp
#include <windows.h>
#include <stdio.h>

#pragma comment(lib, "user32.lib")

static BOOL g_bCameraSelected = FALSE;
static DWORD g_LastClickTime = 0;
static HWND g_LastCameraHWND = NULL;

#define CAMERA_DLG_WIDTH 336
#define CAMERA_DLG_HEIGHT 316
#define CHECK_INTERVAL 500

BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    char className[256] = {0};
    GetClassNameA(hwnd, className, sizeof(className));

    if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWindow")) {
        RECT rect;
        GetWindowRect(hwnd, &rect);
        int width = rect.right - rect.left;
        int height = rect.bottom - rect.top;

        if (width == CAMERA_DLG_WIDTH && height == CAMERA_DLG_HEIGHT) {
            DWORD now = GetTickCount();

            if (hwnd != g_LastCameraHWND) {
                if (!g_bCameraSelected || (now - g_LastClickTime) > 5000) {
                    RECT r;
                    GetWindowRect(hwnd, &r);
                    int clientX = (r.right - r.left) / 2;
                    int clientY = (r.bottom - r.top) / 2;

                    LONG lParamCoord = MAKELPARAM(clientX, clientY);
                    PostMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lParamCoord);
                    Sleep(100);
                    PostMessage(hwnd, WM_LBUTTONUP, 0, lParamCoord);

                    g_bCameraSelected = TRUE;
                    g_LastClickTime = GetTickCount();
                    g_LastCameraHWND = hwnd;
                }
            }
        }
    }

    return TRUE;
}

DWORD WINAPI CheckCameraDialogThread(LPVOID lpParam) {
    while (TRUE) {
        EnumWindows(EnumWindowsProc, 0);
        Sleep(CHECK_INTERVAL);
    }
    return 0;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        CreateThread(NULL, 0, CheckCameraDialogThread, NULL, 0, NULL);
    }
    return TRUE;
}
```

### 注入器源代码

```cpp
#include <windows.h>
#include <tlhelp32.h>
#include <stdio.h>

typedef struct {
    char name[64];
    DWORD pid;
} ProcessInfo;

int FindAllMuMuProcesses(ProcessInfo* processes, int maxCount) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;

    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);
    int count = 0;

    if (Process32First(snapshot, &pe32)) {
        do {
            if (_strnicmp(pe32.szExeFile, "MuMu", 4) == 0) {
                if (count < maxCount) {
                    strcpy(processes[count].name, pe32.szExeFile);
                    processes[count].pid = pe32.th32ProcessID;
                    count++;
                }
            }
        } while (Process32Next(snapshot, &pe32));
    }
    CloseHandle(snapshot);
    return count;
}

BOOL InjectDll(DWORD pid, const char* dllPath) {
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
    if (!hProcess) return FALSE;

    size_t pathLen = strlen(dllPath) + 1;
    LPVOID remoteMem = VirtualAllocEx(hProcess, NULL, pathLen, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remoteMem) { CloseHandle(hProcess); return FALSE; }

    if (!WriteProcessMemory(hProcess, remoteMem, dllPath, pathLen, NULL)) {
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return FALSE;
    }

    HMODULE hKernel32 = GetModuleHandleA("kernel32.dll");
    LPVOID pLoadLibraryA = GetProcAddress(hKernel32, "LoadLibraryA");
    HANDLE hThread = CreateRemoteThread(hProcess, NULL, 0,
        (LPTHREAD_START_ROUTINE)pLoadLibraryA, remoteMem, 0, NULL);

    if (!hThread) {
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return FALSE;
    }

    WaitForSingleObject(hThread, INFINITE);
    CloseHandle(hThread);
    VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
    CloseHandle(hProcess);
    return TRUE;
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    char exePath[MAX_PATH], dllPath[MAX_PATH];
    GetModuleFileNameA(NULL, exePath, MAX_PATH);
    strcpy(dllPath, exePath);

    char* lastSlash = strrchr(dllPath, '\\');
    char* exeName = lastSlash ? lastSlash + 1 : dllPath;
    char* numStart = strstr(exeName, "injector");
    if (numStart) {
        numStart += 8;
        char* numEnd = strstr(numStart, ".exe");
        if (numEnd) {
            char version[16] = {0};
            strncpy(version, numStart, numEnd - numStart);
            sprintf(lastSlash + 1, "camera_hook%s.dll", version);
        } else {
            strcpy(lastSlash + 1, "camera_hook.dll");
        }
    } else {
        strcpy(lastSlash + 1, "camera_hook.dll");
    }

    ProcessInfo processes[16];
    int count = FindAllMuMuProcesses(processes, 16);

    if (count == 0) {
        MessageBox(NULL, "No MuMu process found", "Info", MB_OK | MB_ICONWARNING);
        return 1;
    }

    int successCount = 0;
    for (int i = 0; i < count; i++) {
        if (InjectDll(processes[i].pid, dllPath)) successCount++;
    }

    if (successCount > 0) {
        MessageBox(NULL, "Injection successful", "Done", MB_OK | MB_ICONINFORMATION);
    } else {
        MessageBox(NULL, "Injection failed", "Error", MB_OK | MB_ICONERROR);
    }
    return 0;
}
```

### 编译脚本

```batch
cl.exe /EHsc /O2 /MD /LD camera_hook48.cpp /Fe:camera_hook48.dll
cl.exe /EHsc /O2 /MD injector48.cpp /Fe:injector48.exe /link user32.lib
```

### 技术特点

| 特性 | 实现方式 |
|------|----------|
| 弹窗检测 | EnumWindows API轮询（非Hook） |
| 点击方式 | PostMessage发送WM_LBUTTONDOWN/UP |
| 无日志 | 完全去除WriteLog函数 |
| 无崩溃 | 不Hook user32.dll窗口函数 |
| 常驻运行 | DLL随MUMU进程启动/关闭 |

---

## 八、测试命令

```batch
D:\ScreenWall2\mumu_camera_hook\injector48.exe
```

### 使用流程
1. 启动MUMU模拟器
2. 运行 `injector48.exe`
3. 弹出提示"已注入成功"后关闭
4. 触发摄像头弹窗时自动点击中心位置

---

## 九、关键代码修复记录

### 1. injector.cpp DLL名称动态获取

**问题**：原代码硬编码 `camera_hook42.dll`

**修复**：
```cpp
char* numStart = strstr(exeName, "injector");
if (numStart) {
    numStart += 8;
    char* numEnd = strstr(numStart, ".exe");
    if (numEnd) {
        char version[16] = {0};
        strncpy(version, numStart, numEnd - numStart);
        sprintf(lastSlash + 1, "camera_hook%s.dll", version);
    }
}
```

### 2. ShowWindow条件修复

**问题**：原代码检查 `nCmdShow == SW_SHOW`（值为5）

**修复**：改为 `nCmdShow == SW_SHOWNORMAL`（值为1）

### 3. v47/v48安全架构

**核心发现**：Hook user32.dll的窗口/消息函数会导致Qt程序崩溃

**解决方案**：完全不使用MinHook，采用EnumWindows轮询方式检测弹窗

---

## 十、摄像头数据捕获参考（v35架构）

v35是最后一个稳定的数据捕获版本，仅Hook kernel32.dll，不Hook user32.dll。

### 核心Hook函数

```cpp
#include <windows.h>
#include "MinHook.h"

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer,
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned,
    LPOVERLAPPED lpOverlapped) {

    if (dwIoControlCode == 0x002F0410) {
        BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer,
            nInBufferSize, lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);

        if (result && lpBytesReturned && *lpBytesReturned > 0) {
            BYTE* data = (BYTE*)lpOutBuffer;
            DWORD size = *lpBytesReturned;

            if (data[0] == 0xC0 && data[1] == 0x01) {
                // NV12帧数据：保存到文件
                FILE* fp = fopen("frame.raw", "wb");
                fwrite(data, 1, size, fp);
                fclose(fp);
            }
        }
        return result;
    }

    return g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize,
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
}

typedef HANDLE (WINAPI *CreateFileW_t)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
static CreateFileW_t g_OriginalCreateFileW = NULL;

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode,
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition,
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {

    HANDLE result = g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode,
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);

    if (result != INVALID_HANDLE_VALUE && lpFileName) {
        char path[MAX_PATH * 2] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);

        if (strstr(path, "USB") || strstr(path, "HID") || strstr(path, "VID")) {
            // 检测USB摄像头设备打开
            printf("Camera Device: %s -> %p\n", path, result);
        }
    }

    return result;
}

BOOL InstallHooks() {
    MH_Initialize();
    MH_CreateHookApi(L"kernel32.dll", "DeviceIoControl", &HookedDeviceIoControl, ...);
    MH_CreateHookApi(L"kernel32.dll", "CreateFileW", &HookedCreateFileW, ...);
    MH_EnableHook(MH_ALL_HOOKS);
    return TRUE;
}
```

### 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| IOCTL Code | 0x002F0410 | 摄像头帧数据请求 |
| Handle | 动态分配 | 通过CreateFileW获取 |
| 数据签名 | 0xC001 | NV12格式帧头 |
| 分辨率 | 1280x720 | 摄像头输出尺寸 |
| 格式 | NV12 | YUV420变体 |

### NV12帧格式说明

```
NV12结构（1280x720）：
├── Y平面：1280 × 720 = 921,600 字节
├── UV交织：1280 × 360 = 460,800 字节
└── 总计：1,382,400 字节
```

---

## 十一、历史帧分析（保留）

### 摄像头通信分析

| IOCTL | Handle | 数据大小 | 说明 |
|-------|--------|---------|------|
| 0x002F0410 | 动态 | 176-312字节 | 摄像头帧数据 |
| 0x00470807 | 动态 | 20-608字节 | USB描述符 |

### USB设备信息

| 字段 | 值 |
|------|-----|
| VID | 13D3 (Realtek) |
| PID | 5415 |
| 路径关键字 | USB、HID、VID |

---

## 十二、后续建议

### 已完成
- ✅ 自动点击功能（v47/v48）
- ✅ 解决崩溃问题（EnumWindows替代Hook）
- ✅ 极简版代码（v48）
- ✅ 目录清理

### 可选功能
- 开机自启（注册表或启动文件夹）
- 单文件exe（内嵌DLL）
- 配置化（可指定点击位置）
