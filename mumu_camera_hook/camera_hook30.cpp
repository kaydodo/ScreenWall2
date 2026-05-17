#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"

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

void DumpHex(const BYTE* data, size_t len, char* buf, size_t bufSize) {
    size_t pos = 0;
    size_t limit = min(len, 256);
    for (size_t i = 0; i < limit && pos < bufSize - 4; i++) {
        pos += sprintf(buf + pos, "%02X ", data[i]);
    }
    if (len > limit) {
        sprintf(buf + pos, "... [%zu more]", len - limit);
    }
}

typedef HANDLE (WINAPI *CreateFileW_t)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
static CreateFileW_t g_OriginalCreateFileW = NULL;

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

typedef int (WINAPI *lstrcmpW_t)(LPCWSTR, LPCWSTR);
static lstrcmpW_t g_OriginallstrcmpW = NULL;

typedef BOOLEAN (WINAPI *HidD_GetAttributes_t)(HANDLE, PVOID);
static HidD_GetAttributes_t g_OriginalHidD_GetAttributes = NULL;

typedef BOOLEAN (WINAPI *HidD_GetPreparsedData_t)(HANDLE, PVOID*);
static HidD_GetPreparsedData_t g_OriginalHidD_GetPreparsedData = NULL;

static int g_HidD_Count = 0;
static int g_CreateFileCount = 0;
static int g_IoControlCount = 0;
static int g_lstrcmpWCount = 0;

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, 
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition, 
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
    
    if (lpFileName) {
        char path[MAX_PATH * 2] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        if (strstr(path, "vid_") || strstr(path, "pid_") || 
            strstr(path, "hid") || strstr(path, "HID") ||
            strstr(path, "camera") || strstr(path, "CAMERA") ||
            strstr(path, "\\\\?\\")) {
            
            char logBuf[2048];
            sprintf(logBuf, "CreateFileW #%d: Path='%s'\n  Access=0x%08lX Share=0x%08lX", 
                    ++g_CreateFileCount, path, dwDesiredAccess, dwShareMode);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode, 
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
}

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    g_IoControlCount++;
    
    BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
    
    if (g_IoControlCount <= 50) {
        char logBuf[2048];
        sprintf(logBuf, "DeviceIoControl #%d: Handle=%p IOCTL=0x%08lX InSize=%lu OutSize=%lu OutRet=%lu %s",
                g_IoControlCount, hDevice, dwIoControlCode, nInBufferSize, nOutBufferSize,
                lpBytesReturned ? *lpBytesReturned : 0,
                result ? "SUCCESS" : "FAILED");
        WriteLog(logBuf);
        
        if (result && lpOutBuffer && lpBytesReturned && *lpBytesReturned > 0 && *lpBytesReturned <= 256) {
            char hexBuf[1024] = {0};
            DumpHex((const BYTE*)lpOutBuffer, *lpBytesReturned, hexBuf, sizeof(hexBuf));
            char logBuf2[2048];
            sprintf(logBuf2, "  Data: [%s]", hexBuf);
            WriteLog(logBuf2);
        }
    }
    
    return result;
}

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    int result = g_OriginallstrcmpW(lpString1, lpString2);
    
    if (g_lstrcmpWCount < 100) {
        char s1[512] = {0};
        char s2[512] = {0};
        if (lpString1) WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
        if (lpString2) WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        if (strlen(s1) > 10 || strlen(s2) > 10) {
            char logBuf[1024];
            sprintf(logBuf, "lstrcmpW #%d: Result=%d\n  '%s'\n  '%s'", ++g_lstrcmpWCount, result, s1, s2);
            WriteLog(logBuf);
        }
    }
    
    return result;
}

BOOLEAN WINAPI HookedHidD_GetAttributes(HANDLE Handle, PVOID Attributes) {
    g_HidD_Count++;
    char logBuf[512];
    sprintf(logBuf, "HidD_GetAttributes #%d: Handle=%p", g_HidD_Count, Handle);
    WriteLog(logBuf);
    
    return g_OriginalHidD_GetAttributes(Handle, Attributes);
}

BOOLEAN WINAPI HookedHidD_GetPreparsedData(HANDLE Handle, PVOID* PreparsedData) {
    g_HidD_Count++;
    char logBuf[512];
    sprintf(logBuf, "HidD_GetPreparsedData #%d: Handle=%p", g_HidD_Count, Handle);
    WriteLog(logBuf);
    
    BOOLEAN result = g_OriginalHidD_GetPreparsedData(Handle, PreparsedData);
    
    if (result) {
        WriteLog("  SUCCESS: Got PreparsedData");
    }
    
    return result;
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    HMODULE hHid = GetModuleHandleA("hid.dll");
    if (hHid) {
        FARPROC pHidD_GetAttributes = GetProcAddress(hHid, "HidD_GetAttributes");
        if (pHidD_GetAttributes) {
            MH_CreateHook(pHidD_GetAttributes, &HookedHidD_GetAttributes, (LPVOID*)&g_OriginalHidD_GetAttributes);
            WriteLog("Hooked HidD_GetAttributes");
        }
        
        FARPROC pHidD_GetPreparsedData = GetProcAddress(hHid, "HidD_GetPreparsedData");
        if (pHidD_GetPreparsedData) {
            MH_CreateHook(pHidD_GetPreparsedData, &HookedHidD_GetPreparsedData, (LPVOID*)&g_OriginalHidD_GetPreparsedData);
            WriteLog("Hooked HidD_GetPreparsedData");
        }
    }
    
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpW", &HookedlstrcmpW, (LPVOID*)&g_OriginallstrcmpW);
    MH_CreateHookApi(L"kernel32.dll", "CreateFileW", &HookedCreateFileW, (LPVOID*)&g_OriginalCreateFileW);
    MH_CreateHookApi(L"kernel32.dll", "DeviceIoControl", &HookedDeviceIoControl, (LPVOID*)&g_OriginalDeviceIoControl);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("=============================================");
    WriteLog("Hooks installed v30 - HID + DeviceIoControl");
    WriteLog("  - HidD_GetAttributes");
    WriteLog("  - HidD_GetPreparsedData");
    WriteLog("  - lstrcmpW");
    WriteLog("  - CreateFileW (HID related)");
    WriteLog("  - DeviceIoControl (first 50 with data)");
    WriteLog("=============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v30");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[1024];
        sprintf(logBuf, "=============================================\nStats:\n  HidD=%d\n  CreateFile=%d\n  DeviceIoControl=%d\n  lstrcmpW=%d\n=============================================",
            g_HidD_Count, g_CreateFileCount, g_IoControlCount, g_lstrcmpWCount);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
