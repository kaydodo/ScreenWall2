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

static DWORD g_Ioctl01A8Count = 0;

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

void DumpHex(const BYTE* data, size_t len, char* buf, size_t bufSize) {
    size_t pos = 0;
    size_t limit = min(len, 64);
    for (size_t i = 0; i < limit && pos < bufSize - 4; i++) {
        pos += sprintf(buf + pos, "%02X ", data[i]);
    }
    if (len > 64) {
        sprintf(buf + pos, "... [%lu more]", len - 64);
    }
}

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, 
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition, 
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
    
    if (lpFileName) {
        char path[MAX_PATH] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        char logBuf[2048];
        sprintf(logBuf, "CreateFileW #%d: Path='%s'\n  Access=0x%08lX Share=0x%08lX Create=0x%08lX",
            ++g_CreateFileCount, path, dwDesiredAccess, dwShareMode, dwCreationDisposition);
        WriteLog(logBuf);
    }
    
    HANDLE hResult = g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode, 
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
    
    if (lpFileName && hResult != INVALID_HANDLE_VALUE) {
        char path[MAX_PATH] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        BOOL isCam = FALSE;
        if (strstr(path, "vid_") || strstr(path, "pid_") || 
            strstr(path, "HID") || strstr(path, "hid") ||
            strstr(path, "camera") || strstr(path, "CAMERA") ||
            strstr(path, "video") || strstr(path, "VIDEO")) {
            isCam = TRUE;
            AddCameraHandle(hResult);
            
            char logBuf[512];
            sprintf(logBuf, "  CreateFileW ADDED TO CAMERA LIST: Handle=%p", hResult);
            WriteLog(logBuf);
        }
    }
    
    return hResult;
}

BOOL WINAPI HookedReadFile(HANDLE hFile, LPVOID lpBuffer, DWORD nNumberOfBytesToRead, 
    LPDWORD lpNumberOfBytesRead, LPOVERLAPPED lpOverlapped) {
    
    if (IsCameraHandle(hFile)) {
        char logBuf[1024];
        sprintf(logBuf, "ReadFile #%d: Handle=%p, ToRead=%lu", ++g_ReadFileCount, hFile, nNumberOfBytesToRead);
        WriteLog(logBuf);
    }
    
    return g_OriginalReadFile(hFile, lpBuffer, nNumberOfBytesToRead, lpNumberOfBytesRead, lpOverlapped);
}

BOOL WINAPI HookedWriteFile(HANDLE hFile, LPCVOID lpBuffer, DWORD nNumberOfBytesToWrite, 
    LPDWORD lpNumberOfBytesWritten, LPOVERLAPPED lpOverlapped) {
    
    if (IsCameraHandle(hFile)) {
        char logBuf[1024];
        sprintf(logBuf, "WriteFile #%d: Handle=%p, ToWrite=%lu", ++g_WriteFileCount, hFile, nNumberOfBytesToWrite);
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
        if (dwIoControlCode == 0x000B01A8) {
            g_Ioctl01A8Count++;
        }
        
        char logBuf[1024];
        sprintf(logBuf, "DeviceIoControl #%d: Handle=%p, IOCTL=0x%08lX, InSize=%lu, OutSize=%lu, OutBytes=%lu",
            ++g_IoControlCount, hDevice, dwIoControlCode, nInBufferSize, nOutBufferSize,
            lpBytesReturned ? *lpBytesReturned : 0);
        WriteLog(logBuf);
        
        if (dwIoControlCode == 0x000B01A8 && result && lpOutBuffer && lpBytesReturned && *lpBytesReturned > 0) {
            char hexBuf[512] = {0};
            DumpHex((const BYTE*)lpOutBuffer, *lpBytesReturned, hexBuf, sizeof(hexBuf));
            
            char logBuf2[1024];
            sprintf(logBuf2, "  IOCTL_01A8 Data: %s", hexBuf);
            WriteLog(logBuf2);
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
    if (g_USBCompareCount++ < 100) {
        if (lpString1 && lpString2) {
            char s1[512] = {0};
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (strstr(s1, "vid_") || strstr(s1, "pid_") ||
                strstr(s2, "vid_") || strstr(s2, "pid_")) {
                
                int result = g_OriginallstrcmpW(lpString1, lpString2);
                
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpW #%d: Result=%d\n  '%s'\n  '%s'", g_USBCompareCount, result, s1, s2);
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
    WriteLog("Hooks installed v26 - Log ALL CreateFile");
    WriteLog("  Will log any CreateFile with vid/pid/HID/camera/video");
    WriteLog("==============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("==============================================");
        WriteLog("DLL loaded v26");
        WriteLog("==============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[1024];
        sprintf(logBuf, "==============================================\nStats:\n  CreateFile=%d\n  ReadFile=%d\n  WriteFile=%d\n  DeviceIoControl=%d\n  CameraHandles=%d\n  lstrcmpW=%d\n  IOCTL_01A8=%d\n==============================================",
            g_CreateFileCount, g_ReadFileCount, g_WriteFileCount, 
            g_IoControlCount, g_CameraHandleCount, g_USBCompareCount, g_Ioctl01A8Count);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
