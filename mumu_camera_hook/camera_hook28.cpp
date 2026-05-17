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
static int g_lstrcmpWCount = 0;

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, 
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition, 
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
    
    char path[MAX_PATH * 2] = {0};
    if (lpFileName) {
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
    }
    
    char logBuf[4096];
    sprintf(logBuf, "CreateFileW #%d: Path='%s'", ++g_CreateFileCount, path);
    WriteLog(logBuf);
    
    return g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode, 
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
}

BOOL WINAPI HookedReadFile(HANDLE hFile, LPVOID lpBuffer, DWORD nNumberOfBytesToRead, 
    LPDWORD lpNumberOfBytesRead, LPOVERLAPPED lpOverlapped) {
    
    if (g_ReadFileCount < 50) {
        char logBuf[1024];
        sprintf(logBuf, "ReadFile #%d: Handle=%p ToRead=%lu", ++g_ReadFileCount, hFile, nNumberOfBytesToRead);
        WriteLog(logBuf);
    }
    
    return g_OriginalReadFile(hFile, lpBuffer, nNumberOfBytesToRead, lpNumberOfBytesRead, lpOverlapped);
}

BOOL WINAPI HookedWriteFile(HANDLE hFile, LPCVOID lpBuffer, DWORD nNumberOfBytesToWrite, 
    LPDWORD lpNumberOfBytesWritten, LPOVERLAPPED lpOverlapped) {
    
    if (g_WriteFileCount < 50) {
        char logBuf[1024];
        sprintf(logBuf, "WriteFile #%d: Handle=%p ToWrite=%lu", ++g_WriteFileCount, hFile, nNumberOfBytesToWrite);
        WriteLog(logBuf);
    }
    
    return g_OriginalWriteFile(hFile, lpBuffer, nNumberOfBytesToWrite, lpNumberOfBytesWritten, lpOverlapped);
}

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    char logBuf[2048];
    sprintf(logBuf, "DeviceIoControl #%d: Handle=%p IOCTL=0x%08X", ++g_IoControlCount, hDevice, dwIoControlCode);
    WriteLog(logBuf);
    
    return g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
}

static int g_CoCreateCallCount = 0;

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    int result = g_OriginallstrcmpW(lpString1, lpString2);
    
    if (g_lstrcmpWCount < 500) {
        char s1[MAX_PATH * 2] = {0};
        char s2[MAX_PATH * 2] = {0};
        if (lpString1) WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
        if (lpString2) WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        char logBuf[2048];
        sprintf(logBuf, "lstrcmpW #%d: Result=%d\n  '%s'\n  '%s'", ++g_lstrcmpWCount, result, s1, s2);
        WriteLog(logBuf);
    }
    
    return result;
}

HRESULT WINAPI HookedCoCreateInstance(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv) {
    g_CoCreateCallCount++;
    
    char clsidStr[64];
    char iidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    GuidToString(riid, iidStr, sizeof(iidStr));
    
    char logBuf[512];
    sprintf(logBuf, "CoCreateInstance #%d CLSID=%s IID=%s", g_CoCreateCallCount, clsidStr, iidStr);
    WriteLog(logBuf);
    
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
    
    WriteLog("=============================================");
    WriteLog("Hooks installed v28 - All important APIs");
    WriteLog("  - All CreateFileW");
    WriteLog("  - All lstrcmpW (first 500)");
    WriteLog("  - DeviceIoControl");
    WriteLog("  - CoCreateInstance");
    WriteLog("=============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v28");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[1024];
        sprintf(logBuf, "=============================================\nStats:\n  CreateFile=%d\n  ReadFile=%d\n  WriteFile=%d\n  DeviceIoControl=%d\n  lstrcmpW=%d\n=============================================",
            g_CreateFileCount, g_ReadFileCount, g_WriteFileCount, g_IoControlCount, g_lstrcmpWCount);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
