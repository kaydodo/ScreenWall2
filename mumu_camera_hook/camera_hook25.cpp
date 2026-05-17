#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"
#include <objbase.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "libMinHook-x64-v141-md.lib")

static char g_LogPath[MAX_PATH] = {0};
static BOOL g_bHooksInstalled = FALSE;

void InitPaths() {
    if (g_LogPath[0] == 0) {
        strcpy(g_LogPath, "D:\\mumu_camera_hook.log");
    }
}

void WriteLog(const char* msg) {
    InitPaths();
    FILE* f = fopen(g_LogPath, "a");
    if (f) {
        SYSTEMTIME st;
        GetLocalTime(&st);
        fprintf(f, "[%02d:%02d:%02d.%03d] %s\n", st.wHour, st.wMinute, st.wSecond, st.wMilliseconds, msg);
        fclose(f);
    }
}

void GuidToString(REFGUID guid, char* buf, size_t bufSize) {
    sprintf(buf, "{%08lX-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}",
        guid.Data1, guid.Data2, guid.Data3,
        guid.Data4[0], guid.Data4[1], guid.Data4[2], guid.Data4[3],
        guid.Data4[4], guid.Data4[5], guid.Data4[6], guid.Data4[7]);
}

typedef HRESULT (WINAPI *CoCreateInstance_t)(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv);
static CoCreateInstance_t g_OriginalCoCreateInstance = NULL;

typedef int (WINAPI *lstrcmpW_t)(LPCWSTR, LPCWSTR);
static lstrcmpW_t g_OriginallstrcmpW = NULL;

typedef HANDLE (WINAPI *CreateFileW_t)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
static CreateFileW_t g_OriginalCreateFileW = NULL;

typedef BOOL (WINAPI *ReadFile_t)(HANDLE, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static ReadFile_t g_OriginalReadFile = NULL;

typedef BOOL (WINAPI *WriteFile_t)(HANDLE, LPCVOID, DWORD, LPDWORD, LPOVERLAPPED);
static WriteFile_t g_OriginalWriteFile = NULL;

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

static int g_CreateFileCount = 0;
static int g_ReadFileCount = 0;
static int g_WriteFileCount = 0;
static int g_IoControlCount = 0;

#define MAX_CAMERA_HANDLES 16
static HANDLE g_CameraHandles[MAX_CAMERA_HANDLES] = {0};
static int g_CameraHandleCount = 0;

static DWORD g_LastIoctl01A8Time[100] = {0};
static int g_Ioctl01A8Index = 0;
static DWORD g_Ioctl01A8TotalInterval = 0;
static int g_Ioctl01A8IntervalCount = 0;

static BYTE g_LastIoctl01A8Data[4096] = {0};
static DWORD g_LastIoctl01A8Size = 0;

static FILE* g_FrameLogFile = NULL;

void OpenFrameLog() {
    if (!g_FrameLogFile) {
        g_FrameLogFile = fopen("D:\\mumu_camera_hook_frames.log", "wb");
    }
}

void CloseFrameLog() {
    if (g_FrameLogFile) {
        fclose(g_FrameLogFile);
        g_FrameLogFile = NULL;
    }
}

BOOL IsCameraPath(const char* path) {
    if (!path) return FALSE;
    
    if (strstr(path, "vid_048d") && strstr(path, "pid_c100")) {
        return TRUE;
    }
    if (strstr(path, "HID") || strstr(path, "hid")) {
        if (strstr(path, "vid_") && strstr(path, "pid_")) {
            return TRUE;
        }
    }
    return FALSE;
}

BOOL IsCameraHandle(HANDLE hFile) {
    for (int i = 0; i < g_CameraHandleCount; i++) {
        if (g_CameraHandles[i] == hFile) {
            return TRUE;
        }
    }
    return FALSE;
}

void AddCameraHandle(HANDLE hFile) {
    if (!hFile || hFile == INVALID_HANDLE_VALUE) return;
    
    for (int i = 0; i < g_CameraHandleCount; i++) {
        if (g_CameraHandles[i] == hFile) return;
    }
    
    if (g_CameraHandleCount < MAX_CAMERA_HANDLES) {
        g_CameraHandles[g_CameraHandleCount++] = hFile;
    }
}

void DumpHexLimited(const BYTE* data, size_t len, char* buf, size_t bufSize) {
    size_t pos = 0;
    size_t limit = min(len, 64);
    for (size_t i = 0; i < limit && pos < bufSize - 4; i++) {
        pos += sprintf(buf + pos, "%02X ", data[i]);
    }
    if (len > 64) {
        sprintf(buf + pos, "... [%lu more]", len - 64);
    }
}

BOOL IsJPEGImage(const BYTE* data, size_t len) {
    if (len < 3) return FALSE;
    
    if (data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF) {
        return TRUE;
    }
    
    return FALSE;
}

BOOL IsHIDReportWithImageData(const BYTE* data, size_t len) {
    if (len < 12) return FALSE;
    
    BYTE reportId = data[0];
    
    if (reportId >= 0x10 && reportId <= 0xFF) {
        if (len >= 16) {
            DWORD maybeSize = *(DWORD*)&data[4];
            if (maybeSize > 100 && maybeSize < 100000) {
                return TRUE;
            }
        }
    }
    
    return FALSE;
}

void SaveFrameData(const BYTE* data, size_t len, const char* type) {
    if (!g_FrameLogFile) return;
    
    SYSTEMTIME st;
    GetLocalTime(&st);
    
    fprintf(g_FrameLogFile, "[%02d:%02d:%02d.%03d] %s Size=%lu\n", 
            st.wHour, st.wMinute, st.wSecond, st.wMilliseconds,
            type, len);
    
    fwrite(data, 1, len, g_FrameLogFile);
    fprintf(g_FrameLogFile, "\n\n");
    fflush(g_FrameLogFile);
}

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, 
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition, 
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
    
    if (lpFileName) {
        char path[MAX_PATH] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        if (IsCameraPath(path)) {
            char logBuf[2048];
            sprintf(logBuf, "CreateFileW #%d: Path='%s'", ++g_CreateFileCount, path);
            WriteLog(logBuf);
        }
    }
    
    HANDLE hResult = g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode, 
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
    
    if (lpFileName && hResult != INVALID_HANDLE_VALUE) {
        char path[MAX_PATH] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        if (IsCameraPath(path)) {
            AddCameraHandle(hResult);
            
            char logBuf[512];
            sprintf(logBuf, "  SUCCESS: Handle=%p (CameraHandle #%d)", hResult, g_CameraHandleCount);
            WriteLog(logBuf);
        }
    }
    
    return hResult;
}

BOOL WINAPI HookedReadFile(HANDLE hFile, LPVOID lpBuffer, DWORD nNumberOfBytesToRead, 
    LPDWORD lpNumberOfBytesRead, LPOVERLAPPED lpOverlapped) {
    
    BOOL result = g_OriginalReadFile(hFile, lpBuffer, nNumberOfBytesToRead, lpNumberOfBytesRead, lpOverlapped);
    
    if (IsCameraHandle(hFile) && result && lpNumberOfBytesRead && *lpNumberOfBytesRead > 0) {
        char logBuf[4096];
        char hexBuf[1024] = {0};
        DumpHexLimited((const BYTE*)lpBuffer, *lpNumberOfBytesRead, hexBuf, sizeof(hexBuf));
        
        BOOL isJPEG = IsJPEGImage((const BYTE*)lpBuffer, *lpNumberOfBytesRead);
        
        sprintf(logBuf, "ReadFile #%d: Handle=%p, Read=%lu %s\n  Data=[%s]", 
                ++g_ReadFileCount, hFile, *lpNumberOfBytesRead,
                isJPEG ? "*** JPEG IMAGE ***" : "", hexBuf);
        WriteLog(logBuf);
        
        if (isJPEG) {
            SaveFrameData((const BYTE*)lpBuffer, *lpNumberOfBytesRead, "ReadFile JPEG");
        }
    }
    
    return result;
}

BOOL WINAPI HookedWriteFile(HANDLE hFile, LPCVOID lpBuffer, DWORD nNumberOfBytesToWrite, 
    LPDWORD lpNumberOfBytesWritten, LPOVERLAPPED lpOverlapped) {
    
    if (IsCameraHandle(hFile)) {
        char logBuf[4096];
        char hexBuf[1024] = {0};
        DumpHexLimited((const BYTE*)lpBuffer, nNumberOfBytesToWrite, hexBuf, sizeof(hexBuf));
        sprintf(logBuf, "WriteFile #%d: Handle=%p, Written=%lu\n  Data=[%s]", 
                ++g_WriteFileCount, hFile, nNumberOfBytesToWrite, hexBuf);
        WriteLog(logBuf);
    }
    
    return g_OriginalWriteFile(hFile, lpBuffer, nNumberOfBytesToWrite, lpNumberOfBytesWritten, lpOverlapped);
}

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
    
    if (IsCameraHandle(hDevice)) {
        if (dwIoControlCode == 0x000B01A8 && result && lpOutBuffer && lpBytesReturned && *lpBytesReturned > 0) {
            DWORD currentTime = GetTickCount();
            char logBuf[8192];
            
            DWORD interval = 0;
            if (g_Ioctl01A8Index > 0) {
                interval = currentTime - g_LastIoctl01A8Time[(g_Ioctl01A8Index - 1) % 100];
                g_Ioctl01A8TotalInterval += interval;
                g_Ioctl01A8IntervalCount++;
            }
            g_LastIoctl01A8Time[g_Ioctl01A8Index % 100] = currentTime;
            g_Ioctl01A8Index++;
            
            sprintf(logBuf, "DeviceIoControl #%d (IOCTL_01A8): Handle=%p, OutSize=%lu, Interval=%lums", 
                    ++g_IoControlCount, hDevice, *lpBytesReturned, interval);
            WriteLog(logBuf);
            
            BOOL dataChanged = FALSE;
            if (*lpBytesReturned != g_LastIoctl01A8Size) {
                dataChanged = TRUE;
            } else {
                for (DWORD i = 0; i < min(*lpBytesReturned, g_LastIoctl01A8Size); i++) {
                    if (((BYTE*)lpOutBuffer)[i] != g_LastIoctl01A8Data[i]) {
                        dataChanged = TRUE;
                        break;
                    }
                }
            }
            
            if (dataChanged) {
                char hexBuf[2048] = {0};
                DumpHexLimited((const BYTE*)lpOutBuffer, *lpBytesReturned, hexBuf, sizeof(hexBuf));
                
                BOOL isJPEG = IsJPEGImage((const BYTE*)lpOutBuffer, *lpBytesReturned);
                BOOL hasImageData = IsHIDReportWithImageData((const BYTE*)lpOutBuffer, *lpBytesReturned);
                
                char logBuf2[8192];
                sprintf(logBuf2, "  *** DATA CHANGED (Size=%lu) %s %s ***\n  Data=[%s]", 
                        *lpBytesReturned,
                        isJPEG ? "*** JPEG IMAGE ***" : "",
                        hasImageData ? "*** POSSIBLE IMAGE DATA ***" : "",
                        hexBuf);
                WriteLog(logBuf2);
                
                if (isJPEG) {
                    SaveFrameData((const BYTE*)lpOutBuffer, *lpBytesReturned, "IOCTL_01A8 JPEG");
                }
                
                memcpy(g_LastIoctl01A8Data, lpOutBuffer, min(*lpBytesReturned, 4096));
                g_LastIoctl01A8Size = *lpBytesReturned;
            }
        } else {
            char logBuf[4096];
            sprintf(logBuf, "DeviceIoControl #%d: Handle=%p, IOCTL=0x%08lX, OutSize=%lu %s", 
                    ++g_IoControlCount, hDevice, dwIoControlCode,
                    lpBytesReturned ? *lpBytesReturned : 0,
                    result ? "SUCCESS" : "FAILED");
            WriteLog(logBuf);
        }
    }
    
    return result;
}

static int g_CoCreateCallCount = 0;
static int g_USBCompareCount = 0;

BOOL ShouldLogCoCreate(REFCLSID rclsid) {
    char clsidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    
    if (strstr(clsidStr, "88753B26") || 
        strstr(clsidStr, "C6E133") ||
        strstr(clsidStr, "9FC8E510") ||
        strstr(clsidStr, "00000323")) {
        return TRUE;
    }
    return FALSE;
}

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (g_USBCompareCount++ < 500) {
        if (lpString1 && lpString2) {
            char s1[512] = {0};
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (strstr(s1, "vid_") && strstr(s1, "pid_") ||
                strstr(s2, "vid_") && strstr(s2, "pid_")) {
                
                int result = g_OriginallstrcmpW(lpString1, lpString2);
                
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpW: Result=%d\n  '%s'\n  '%s'", result, s1, s2);
                WriteLog(logBuf);
                
                return result;
            }
        }
    }
    return g_OriginallstrcmpW(lpString1, lpString2);
}

HRESULT WINAPI HookedCoCreateInstance(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv) {
    g_CoCreateCallCount++;
    
    char clsidStr[64];
    char iidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    GuidToString(riid, iidStr, sizeof(iidStr));
    
    if (ShouldLogCoCreate(rclsid)) {
        char logBuf[512];
        sprintf(logBuf, "CoCreateInstance #%d CLSID=%s IID=%s", 
                g_CoCreateCallCount, clsidStr, iidStr);
        WriteLog(logBuf);
    }
    
    return g_OriginalCoCreateInstance(rclsid, pUnkOuter, dwClsContext, riid, ppv);
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    MH_CreateHookApi(L"ole32.dll", "CoCreateInstance", &HookedCoCreateInstance, (LPVOID*)&g_OriginalCoCreateInstance);
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpW", &HookedlstrcmpW, (LPVOID*)&g_OriginallstrcmpW);
    MH_CreateHookApi(L"kernel32.dll", "CreateFileW", &HookedCreateFileW, (LPVOID*)&g_OriginalCreateFileW);
    MH_CreateHookApi(L"kernel32.dll", "ReadFile", &HookedReadFile, (LPVOID*)&g_OriginalReadFile);
    MH_CreateHookApi(L"kernel32.dll", "WriteFile", &HookedWriteFile, (LPVOID*)&g_OriginalWriteFile);
    MH_CreateHookApi(L"kernel32.dll", "DeviceIoControl", &HookedDeviceIoControl, (LPVOID*)&g_OriginalDeviceIoControl);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("==============================================");
    WriteLog("Hooks installed v25 - Full Frame Capture");
    WriteLog("Tracking:");
    WriteLog("  - Full IOCTL_01A8 data (up to 4096 bytes)");
    WriteLog("  - JPEG detection in all buffers");
    WriteLog("  - Frame save to D:\\mumu_camera_hook_frames.log");
    WriteLog("  - IOCTL interval analysis");
    WriteLog("==============================================");
    
    OpenFrameLog();
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("==============================================");
        WriteLog("DLL loaded v25");
        WriteLog("==============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        DWORD avgInterval = g_Ioctl01A8IntervalCount > 0 ? 
                           (g_Ioctl01A8TotalInterval / g_Ioctl01A8IntervalCount) : 0;
        
        char logBuf[2048];
        sprintf(logBuf, "==============================================\nStats:\n  CreateFile=%d\n  ReadFile=%d\n  WriteFile=%d\n  DeviceIoControl=%d\n  CameraHandles=%d\n  lstrcmpW=%d\n  IOCTL_01A8_count=%d\n  IOCTL_01A8_avg_interval=%lums\n==============================================",
                g_CreateFileCount, g_ReadFileCount, g_WriteFileCount, 
                g_IoControlCount, g_CameraHandleCount, g_USBCompareCount,
                g_Ioctl01A8Index, avgInterval);
        WriteLog(logBuf);
        
        CloseFrameLog();
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
