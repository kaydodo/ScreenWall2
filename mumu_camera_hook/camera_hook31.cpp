#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "hid.lib")
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
    size_t limit = min(len, 128);
    for (size_t i = 0; i < limit && pos < bufSize - 4; i++) {
        pos += sprintf(buf + pos, "%02X ", data[i]);
    }
    if (len > limit) {
        sprintf(buf + pos, "... [%zu more]", len - limit);
    }
}

static int g_HidD_GetAttributes_Count = 0;
static int g_HidD_GetFeature_Count = 0;
static int g_HidD_GetPreparsedData_Count = 0;
static int g_HidD_GetProductString_Count = 0;
static int g_CreateFileW_Count = 0;
static int g_DeviceIoControl_Count = 0;
static int g_lstrcmpW_Count = 0;

typedef BOOLEAN (WINAPI *HidD_GetAttributes_t)(HANDLE, PVOID);
static HidD_GetAttributes_t g_OriginalHidD_GetAttributes = NULL;

typedef BOOLEAN (WINAPI *HidD_GetFeature_t)(HANDLE, PVOID, ULONG);
static HidD_GetFeature_t g_OriginalHidD_GetFeature = NULL;

typedef BOOLEAN (WINAPI *HidD_GetPreparsedData_t)(HANDLE, PVOID*);
static HidD_GetPreparsedData_t g_OriginalHidD_GetPreparsedData = NULL;

typedef BOOLEAN (WINAPI *HidD_GetProductString_t)(HANDLE, PVOID, ULONG);
static HidD_GetProductString_t g_OriginalHidD_GetProductString = NULL;

typedef BOOLEAN (WINAPI *HidD_GetManufacturerString_t)(HANDLE, PVOID, ULONG);
static HidD_GetManufacturerString_t g_OriginalHidD_GetManufacturerString = NULL;

typedef BOOLEAN (WINAPI *HidD_GetSerialNumberString_t)(HANDLE, PVOID, ULONG);
static HidD_GetSerialNumberString_t g_OriginalHidD_GetSerialNumberString = NULL;

typedef HANDLE (WINAPI *CreateFileW_t)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
static CreateFileW_t g_OriginalCreateFileW = NULL;

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

typedef int (WINAPI *lstrcmpW_t)(LPCWSTR, LPCWSTR);
static lstrcmpW_t g_OriginallstrcmpW = NULL;

BOOLEAN WINAPI HookedHidD_GetAttributes(HANDLE Handle, PVOID pAttributes) {
    g_HidD_GetAttributes_Count++;
    
    char logBuf[512];
    sprintf(logBuf, "HidD_GetAttributes #%d: Handle=%p", g_HidD_GetAttributes_Count, Handle);
    WriteLog(logBuf);
    
    return g_OriginalHidD_GetAttributes(Handle, pAttributes);
}

BOOLEAN WINAPI HookedHidD_GetFeature(HANDLE Handle, PVOID pReport, ULONG ReportLength) {
    g_HidD_GetFeature_Count++;
    
    char logBuf[512];
    sprintf(logBuf, "HidD_GetFeature #%d: Handle=%p Length=%lu", 
            g_HidD_GetFeature_Count, Handle, ReportLength);
    WriteLog(logBuf);
    
    BOOLEAN result = g_OriginalHidD_GetFeature(Handle, pReport, ReportLength);
    
    if (result && pReport && ReportLength > 0) {
        char hexBuf[256] = {0};
        DumpHex((const BYTE*)pReport, min(ReportLength, 64), hexBuf, sizeof(hexBuf));
        char logBuf2[512];
        sprintf(logBuf2, "  Data: [%s]", hexBuf);
        WriteLog(logBuf2);
    }
    
    return result;
}

BOOLEAN WINAPI HookedHidD_GetPreparsedData(HANDLE Handle, PVOID* pPreparsedData) {
    g_HidD_GetPreparsedData_Count++;
    
    char logBuf[512];
    sprintf(logBuf, "HidD_GetPreparsedData #%d: Handle=%p", 
            g_HidD_GetPreparsedData_Count, Handle);
    WriteLog(logBuf);
    
    BOOLEAN result = g_OriginalHidD_GetPreparsedData(Handle, pPreparsedData);
    
    if (result) {
        WriteLog("  SUCCESS");
    }
    
    return result;
}

BOOLEAN WINAPI HookedHidD_GetProductString(HANDLE Handle, PVOID pString, ULONG StringLength) {
    g_HidD_GetProductString_Count++;
    
    char logBuf[512];
    sprintf(logBuf, "HidD_GetProductString #%d: Handle=%p Length=%lu", 
            g_HidD_GetProductString_Count, Handle, StringLength);
    WriteLog(logBuf);
    
    BOOLEAN result = g_OriginalHidD_GetProductString(Handle, pString, StringLength);
    
    if (result && pString) {
        char strBuf[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, (LPCWSTR)pString, -1, strBuf, sizeof(strBuf), NULL, NULL);
        char logBuf2[512];
        sprintf(logBuf2, "  ProductString: %s", strBuf);
        WriteLog(logBuf2);
    }
    
    return result;
}

BOOLEAN WINAPI HookedHidD_GetManufacturerString(HANDLE Handle, PVOID pString, ULONG StringLength) {
    char logBuf[512];
    sprintf(logBuf, "HidD_GetManufacturerString: Handle=%p Length=%lu", Handle, StringLength);
    WriteLog(logBuf);
    
    BOOLEAN result = g_OriginalHidD_GetManufacturerString(Handle, pString, StringLength);
    
    if (result && pString) {
        char strBuf[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, (LPCWSTR)pString, -1, strBuf, sizeof(strBuf), NULL, NULL);
        char logBuf2[512];
        sprintf(logBuf2, "  Manufacturer: %s", strBuf);
        WriteLog(logBuf2);
    }
    
    return result;
}

BOOLEAN WINAPI HookedHidD_GetSerialNumberString(HANDLE Handle, PVOID pString, ULONG StringLength) {
    char logBuf[512];
    sprintf(logBuf, "HidD_GetSerialNumberString: Handle=%p Length=%lu", Handle, StringLength);
    WriteLog(logBuf);
    
    BOOLEAN result = g_OriginalHidD_GetSerialNumberString(Handle, pString, StringLength);
    
    if (result && pString) {
        char strBuf[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, (LPCWSTR)pString, -1, strBuf, sizeof(strBuf), NULL, NULL);
        char logBuf2[512];
        sprintf(logBuf2, "  SerialNumber: %s", strBuf);
        WriteLog(logBuf2);
    }
    
    return result;
}

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, 
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition, 
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
    
    if (lpFileName) {
        char path[MAX_PATH * 2] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        if (strstr(path, "vid_") || strstr(path, "pid_") || 
            strstr(path, "hid") || strstr(path, "HID") ||
            strstr(path, "camera") || strstr(path, "CAMERA") ||
            strstr(path, "048d") || strstr(path, "c100") ||
            strstr(path, "\\\\?\\")) {
            
            char logBuf[2048];
            sprintf(logBuf, "CreateFileW #%d: Path='%s'\n  Access=0x%08lX Share=0x%08lX Flags=0x%08lX", 
                    ++g_CreateFileW_Count, path, dwDesiredAccess, dwShareMode, dwFlagsAndAttributes);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode, 
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
}

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    g_DeviceIoControl_Count++;
    
    char logBuf[512];
    sprintf(logBuf, "DeviceIoControl #%d: Handle=%p IOCTL=0x%08lX InSize=%lu OutSize=%lu", 
            g_DeviceIoControl_Count, hDevice, dwIoControlCode, nInBufferSize, nOutBufferSize);
    WriteLog(logBuf);
    
    BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
    
    if (result && lpOutBuffer && lpBytesReturned && *lpBytesReturned > 0 && *lpBytesReturned <= 512) {
        char hexBuf[1024] = {0};
        DumpHex((const BYTE*)lpOutBuffer, *lpBytesReturned, hexBuf, sizeof(hexBuf));
        char logBuf2[2048];
        sprintf(logBuf2, "  OutData [%lu bytes]: [%s]", *lpBytesReturned, hexBuf);
        WriteLog(logBuf2);
    }
    
    return result;
}

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    int result = g_OriginallstrcmpW(lpString1, lpString2);
    
    if (g_lstrcmpW_Count < 200) {
        char s1[512] = {0};
        char s2[512] = {0};
        if (lpString1) WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
        if (lpString2) WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        if (strlen(s1) > 5 && strlen(s2) > 5) {
            if (strstr(s1, "vid_") || strstr(s2, "vid_") ||
                strstr(s1, "hid") || strstr(s2, "hid") ||
                strstr(s1, "camera") || strstr(s2, "camera") ||
                strstr(s1, "048d") || strstr(s2, "048d")) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpW #%d: Result=%d\n  '%s'\n  '%s'", 
                        ++g_lstrcmpW_Count, result, s1, s2);
                WriteLog(logBuf);
            }
        }
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
        FARPROC pFunc;
        
        pFunc = GetProcAddress(hHid, "HidD_GetAttributes");
        if (pFunc) {
            MH_CreateHook(pFunc, &HookedHidD_GetAttributes, (LPVOID*)&g_OriginalHidD_GetAttributes);
            WriteLog("Hooked HidD_GetAttributes");
        }
        
        pFunc = GetProcAddress(hHid, "HidD_GetFeature");
        if (pFunc) {
            MH_CreateHook(pFunc, &HookedHidD_GetFeature, (LPVOID*)&g_OriginalHidD_GetFeature);
            WriteLog("Hooked HidD_GetFeature");
        }
        
        pFunc = GetProcAddress(hHid, "HidD_GetPreparsedData");
        if (pFunc) {
            MH_CreateHook(pFunc, &HookedHidD_GetPreparsedData, (LPVOID*)&g_OriginalHidD_GetPreparsedData);
            WriteLog("Hooked HidD_GetPreparsedData");
        }
        
        pFunc = GetProcAddress(hHid, "HidD_GetProductString");
        if (pFunc) {
            MH_CreateHook(pFunc, &HookedHidD_GetProductString, (LPVOID*)&g_OriginalHidD_GetProductString);
            WriteLog("Hooked HidD_GetProductString");
        }
        
        pFunc = GetProcAddress(hHid, "HidD_GetManufacturerString");
        if (pFunc) {
            MH_CreateHook(pFunc, &HookedHidD_GetManufacturerString, (LPVOID*)&g_OriginalHidD_GetManufacturerString);
            WriteLog("Hooked HidD_GetManufacturerString");
        }
        
        pFunc = GetProcAddress(hHid, "HidD_GetSerialNumberString");
        if (pFunc) {
            MH_CreateHook(pFunc, &HookedHidD_GetSerialNumberString, (LPVOID*)&g_OriginalHidD_GetSerialNumberString);
            WriteLog("Hooked HidD_GetSerialNumberString");
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
    WriteLog("Hooks installed v31 - Full HID API");
    WriteLog("  - HidD_GetAttributes");
    WriteLog("  - HidD_GetFeature");
    WriteLog("  - HidD_GetPreparsedData");
    WriteLog("  - HidD_GetProductString");
    WriteLog("  - HidD_GetManufacturerString");
    WriteLog("  - HidD_GetSerialNumberString");
    WriteLog("  - CreateFileW (HID patterns)");
    WriteLog("  - DeviceIoControl (all calls)");
    WriteLog("  - lstrcmpW (HID path matching)");
    WriteLog("=============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v31 - Full HID API");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[1024];
        sprintf(logBuf, "=============================================\nStats:\n  HidD_GetAttributes=%d\n  HidD_GetFeature=%d\n  HidD_GetPreparsedData=%d\n  HidD_GetProductString=%d\n  CreateFileW=%d\n  DeviceIoControl=%d\n  lstrcmpW=%d\n=============================================",
            g_HidD_GetAttributes_Count, g_HidD_GetFeature_Count, g_HidD_GetPreparsedData_Count,
            g_HidD_GetProductString_Count, g_CreateFileW_Count, g_DeviceIoControl_Count, g_lstrcmpW_Count);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}