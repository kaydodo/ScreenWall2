#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"
#include <objbase.h>
#include <setupapi.h>
#include <devguid.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "setupapi.lib")
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

typedef HDEVINFO (WINAPI *SetupDiGetClassDevsW_t)(LPCGUID, PCWSTR, HWND, DWORD);
static SetupDiGetClassDevsW_t g_OriginalSetupDiGetClassDevsW = NULL;

typedef BOOL (WINAPI *SetupDiEnumDeviceInterfaces_t)(HDEVINFO, PSP_DEVINFO_DATA, LPCGUID, DWORD, PSP_DEVICE_INTERFACE_DATA);
static SetupDiEnumDeviceInterfaces_t g_OriginalSetupDiEnumDeviceInterfaces = NULL;

typedef BOOL (WINAPI *SetupDiGetDeviceInterfaceDetailW_t)(HDEVINFO, PSP_DEVICE_INTERFACE_DATA, PSP_DEVICE_INTERFACE_DETAIL_DATA_W, DWORD, PDWORD, PSP_DEVINFO_DATA);
static SetupDiGetDeviceInterfaceDetailW_t g_OriginalSetupDiGetDeviceInterfaceDetailW = NULL;

typedef BOOL (WINAPI *SetupDiOpenDeviceInterfaceW_t)(HDEVINFO, PCWSTR, DWORD, PSP_DEVINFO_DATA);
static SetupDiOpenDeviceInterfaceW_t g_OriginalSetupDiOpenDeviceInterfaceW = NULL;

typedef int (WINAPI *lstrcmpW_t)(LPCWSTR, LPCWSTR);
static lstrcmpW_t g_OriginallstrcmpW = NULL;

typedef HANDLE (WINAPI *CreateFileW_t)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
static CreateFileW_t g_OriginalCreateFileW = NULL;

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

static int g_SetupDiCount = 0;
static int g_lstrcmpWCount = 0;
static int g_CreateFileCount = 0;
static int g_IoControlCount = 0;

void DumpGuid(LPCGUID guid, char* buf, size_t bufSize) {
    if (!guid) {
        strcpy(buf, "NULL");
        return;
    }
    sprintf(buf, "{%08lX-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}",
        guid->Data1, guid->Data2, guid->Data3,
        guid->Data4[0], guid->Data4[1], guid->Data4[2], guid->Data4[3],
        guid->Data4[4], guid->Data4[5], guid->Data4[6], guid->Data4[7]);
}

HDEVINFO WINAPI HookedSetupDiGetClassDevsW(LPCGUID ClassGuid, PCWSTR Enumerator, HWND hwndParent, DWORD Flags) {
    char clsidStr[64] = {0};
    char enumStr[128] = {0};
    
    if (ClassGuid) {
        DumpGuid(ClassGuid, clsidStr, sizeof(clsidStr));
    }
    if (Enumerator) {
        WideCharToMultiByte(CP_ACP, 0, Enumerator, -1, enumStr, sizeof(enumStr), NULL, NULL);
    }
    
    char logBuf[512];
    sprintf(logBuf, "SetupDiGetClassDevsW #%d:\n  ClassGuid=%s\n  Enumerator='%s'\n  Flags=0x%08lX", 
            ++g_SetupDiCount, clsidStr, enumStr, Flags);
    WriteLog(logBuf);
    
    return g_OriginalSetupDiGetClassDevsW(ClassGuid, Enumerator, hwndParent, Flags);
}

BOOL WINAPI HookedSetupDiEnumDeviceInterfaces(HDEVINFO DeviceInfoSet, PSP_DEVINFO_DATA DeviceInfoData, 
    LPCGUID InterfaceClassGuid, DWORD MemberIndex, PSP_DEVICE_INTERFACE_DATA DeviceInterfaceData) {
    
    char clsidStr[64] = {0};
    if (InterfaceClassGuid) {
        DumpGuid(InterfaceClassGuid, clsidStr, sizeof(clsidStr));
    }
    
    char logBuf[512];
    sprintf(logBuf, "SetupDiEnumDeviceInterfaces #%d:\n  DeviceInfoSet=%p\n  InterfaceClassGuid=%s\n  MemberIndex=%lu",
            ++g_SetupDiCount, DeviceInfoSet, clsidStr, MemberIndex);
    WriteLog(logBuf);
    
    BOOL result = g_OriginalSetupDiEnumDeviceInterfaces(DeviceInfoSet, DeviceInfoData, InterfaceClassGuid, MemberIndex, DeviceInterfaceData);
    
    if (result && DeviceInterfaceData) {
        char logBuf2[512];
        sprintf(logBuf2, "  Result: Flags=0x%08lX", DeviceInterfaceData->Flags);
        WriteLog(logBuf2);
    }
    
    return result;
}

BOOL WINAPI HookedSetupDiGetDeviceInterfaceDetailW(HDEVINFO DeviceInfoSet, PSP_DEVICE_INTERFACE_DATA DeviceInterfaceData,
    PSP_DEVICE_INTERFACE_DETAIL_DATA_W DeviceInterfaceDetailData, DWORD DeviceInterfaceDetailDataSize,
    PDWORD RequiredSize, PSP_DEVINFO_DATA DeviceInfoData) {
    
    char logBuf[512];
    sprintf(logBuf, "SetupDiGetDeviceInterfaceDetailW #%d:\n  DeviceInfoSet=%p DeviceInterfaceData=%p\n  BufferSize=%lu",
            ++g_SetupDiCount, DeviceInfoSet, DeviceInterfaceData, DeviceInterfaceDetailDataSize);
    WriteLog(logBuf);
    
    BOOL result = g_OriginalSetupDiGetDeviceInterfaceDetailW(DeviceInfoSet, DeviceInterfaceData,
        DeviceInterfaceDetailData, DeviceInterfaceDetailDataSize, RequiredSize, DeviceInfoData);
    
    if (result && DeviceInterfaceDetailData && DeviceInterfaceDetailDataSize >= sizeof(DWORD)) {
        char pathBuf[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, DeviceInterfaceDetailData->DevicePath, -1, pathBuf, sizeof(pathBuf), NULL, NULL);
        
        if (strlen(pathBuf) > 0) {
            char logBuf2[1024];
            sprintf(logBuf2, "  DevicePath='%s'", pathBuf);
            WriteLog(logBuf2);
        }
    }
    
    return result;
}

BOOL WINAPI HookedSetupDiOpenDeviceInterfaceW(HDEVINFO DeviceInfoSet, PCWSTR DevicePath, DWORD Flags, PSP_DEVINFO_DATA DeviceInfoData) {
    char pathBuf[512] = {0};
    if (DevicePath) {
        WideCharToMultiByte(CP_ACP, 0, DevicePath, -1, pathBuf, sizeof(pathBuf), NULL, NULL);
    }
    
    char logBuf[512];
    sprintf(logBuf, "SetupDiOpenDeviceInterfaceW #%d:\n  DevicePath='%s'\n  Flags=0x%08lX",
            ++g_SetupDiCount, pathBuf, Flags);
    WriteLog(logBuf);
    
    return g_OriginalSetupDiOpenDeviceInterfaceW(DeviceInfoSet, DevicePath, Flags, DeviceInfoData);
}

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    int result = g_OriginallstrcmpW(lpString1, lpString2);
    
    if (g_lstrcmpWCount < 200) {
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

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode, 
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition, 
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
    
    if (lpFileName) {
        char path[MAX_PATH * 2] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);
        
        if (strstr(path, "vid_") || strstr(path, "pid_") || 
            strstr(path, "hid") || strstr(path, "HID") ||
            strstr(path, "camera") || strstr(path, "CAMERA") ||
            strstr(path, "video") || strstr(path, "VIDEO") ||
            strstr(path, "\\\\?\\")) {
            
            char logBuf[2048];
            sprintf(logBuf, "CreateFileW #%d: Path='%s'", ++g_CreateFileCount, path);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode, 
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
}

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    if (dwIoControlCode == 0x000B01A8 || dwIoControlCode == 0x002F0410 || dwIoControlCode == 0x002F040C) {
        char logBuf[1024];
        sprintf(logBuf, "DeviceIoControl #%d: Handle=%p IOCTL=0x%08lX", 
                ++g_IoControlCount, hDevice, dwIoControlCode);
        WriteLog(logBuf);
    }
    
    return g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    MH_CreateHookApi(L"setupapi.dll", "SetupDiGetClassDevsW", &HookedSetupDiGetClassDevsW, (LPVOID*)&g_OriginalSetupDiGetClassDevsW);
    MH_CreateHookApi(L"setupapi.dll", "SetupDiEnumDeviceInterfaces", &HookedSetupDiEnumDeviceInterfaces, (LPVOID*)&g_OriginalSetupDiEnumDeviceInterfaces);
    MH_CreateHookApi(L"setupapi.dll", "SetupDiGetDeviceInterfaceDetailW", &HookedSetupDiGetDeviceInterfaceDetailW, (LPVOID*)&g_OriginalSetupDiGetDeviceInterfaceDetailW);
    MH_CreateHookApi(L"setupapi.dll", "SetupDiOpenDeviceInterfaceW", &HookedSetupDiOpenDeviceInterfaceW, (LPVOID*)&g_OriginalSetupDiOpenDeviceInterfaceW);
    
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpW", &HookedlstrcmpW, (LPVOID*)&g_OriginallstrcmpW);
    MH_CreateHookApi(L"kernel32.dll", "CreateFileW", &HookedCreateFileW, (LPVOID*)&g_OriginalCreateFileW);
    MH_CreateHookApi(L"kernel32.dll", "DeviceIoControl", &HookedDeviceIoControl, (LPVOID*)&g_OriginalDeviceIoControl);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("=============================================");
    WriteLog("Hooks installed v29 - SetupDi + HID");
    WriteLog("  - SetupDiGetClassDevsW");
    WriteLog("  - SetupDiEnumDeviceInterfaces");
    WriteLog("  - SetupDiGetDeviceInterfaceDetailW");
    WriteLog("  - SetupDiOpenDeviceInterfaceW");
    WriteLog("  - lstrcmpW");
    WriteLog("  - CreateFileW (HID related)");
    WriteLog("  - DeviceIoControl (0x000B01A8, 0x002F0410, 0x002F040C)");
    WriteLog("=============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v29");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[1024];
        sprintf(logBuf, "=============================================\nStats:\n  SetupDi=%d\n  lstrcmpW=%d\n  CreateFile=%d\n  DeviceIoControl=%d\n=============================================",
            g_SetupDiCount, g_lstrcmpWCount, g_CreateFileCount, g_IoControlCount);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
