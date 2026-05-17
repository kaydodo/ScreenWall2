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
        fprintf(f, "[%02d:%02d:%02d] %s\n", st.wHour, st.wMinute, st.wSecond, msg);
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

typedef HMODULE (WINAPI *LoadLibraryExW_t)(LPCWSTR, HANDLE, DWORD);
static LoadLibraryExW_t g_OriginalLoadLibraryExW = NULL;

typedef HMODULE (WINAPI *LoadLibraryW_t)(LPCWSTR);
static LoadLibraryW_t g_OriginalLoadLibraryW = NULL;

typedef FARPROC (WINAPI *GetProcAddress_t)(HMODULE, LPCSTR);
static GetProcAddress_t g_OriginalGetProcAddress = NULL;

static int g_CoCreateCallCount = 0;
static int g_USBCompareCount = 0;
static int g_DllLoadCount = 0;
static int g_GetProcCount = 0;

BOOL ShouldLogCoCreate(REFCLSID rclsid) {
    char clsidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    
    if (strstr(clsidStr, "88753B26") || 
        strstr(clsidStr, "C6E133") ||
        strstr(clsidStr, "9FC8E510") ||
        strstr(clsidStr, "00000323") ||
        strstr(clsidStr, "00000346") ||
        strstr(clsidStr, "34A12398") ||
        strstr(clsidStr, "F077CR")) {
        return TRUE;
    }
    return FALSE;
}

BOOL ShouldLogUSBPath(const char* str) {
    if (!str) return FALSE;
    
    if (strstr(str, "vid_048d") && strstr(str, "pid_c100")) {
        return TRUE;
    }
    if (strstr(str, "vid_") && strstr(str, "pid_")) {
        if (strlen(str) < 200) return TRUE;
    }
    return FALSE;
}

BOOL ShouldLogProcAddress(const char* procName) {
    if (!procName) return FALSE;
    
    const char* targets[] = {
        "Enum", "Filter", "Pin", "Graph", "Sample",
        "Receive", "Connect", "Render", "Stream",
        "Capture", "Video", "Camera", "Source"
    };
    
    for (int i = 0; i < sizeof(targets)/sizeof(targets[0]); i++) {
        if (strstr(procName, targets[i])) {
            return TRUE;
        }
    }
    return FALSE;
}

BOOL ShouldLogDllName(const char* dllName) {
    if (!dllName) return FALSE;
    
    const char* dlls[] = {
        "quartz", "strmi", "msvid", "ddraw",
        "strmbase", "BDA", "bda"
    };
    
    for (int i = 0; i < sizeof(dlls)/sizeof(dlls[0]); i++) {
        if (strstr(dllName, dlls[i])) {
            return TRUE;
        }
    }
    return FALSE;
}

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (g_USBCompareCount++ < 1000) {
        if (lpString1 && lpString2) {
            char s1[512] = {0};
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (ShouldLogUSBPath(s1) || ShouldLogUSBPath(s2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpW USB: '%s' <-> '%s'", s1, s2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcmpW(lpString1, lpString2);
}

HMODULE WINAPI HookedLoadLibraryExW(LPCWSTR lpLibFileName, HANDLE hFile, DWORD dwFlags) {
    HMODULE hResult = g_OriginalLoadLibraryExW(lpLibFileName, hFile, dwFlags);
    
    if (hResult && lpLibFileName) {
        wchar_t fileName[MAX_PATH] = {0};
        const wchar_t* pLastSlash = wcsrchr(lpLibFileName, L'\\');
        if (pLastSlash) {
            wcscpy(fileName, pLastSlash + 1);
        } else {
            wcscpy(fileName, lpLibFileName);
        }
        
        char ansiName[MAX_PATH] = {0};
        WideCharToMultiByte(CP_ACP, 0, fileName, -1, ansiName, sizeof(ansiName), NULL, NULL);
        
        if (ShouldLogDllName(ansiName)) {
            char logBuf[512];
            sprintf(logBuf, "LoadLibraryExW: %s (base=%p)", ansiName, hResult);
            WriteLog(logBuf);
        }
    }
    
    return hResult;
}

HMODULE WINAPI HookedLoadLibraryW(LPCWSTR lpLibFileName) {
    HMODULE hResult = g_OriginalLoadLibraryW(lpLibFileName);
    
    if (hResult && lpLibFileName) {
        wchar_t fileName[MAX_PATH] = {0};
        const wchar_t* pLastSlash = wcsrchr(lpLibFileName, L'\\');
        if (pLastSlash) {
            wcscpy(fileName, pLastSlash + 1);
        } else {
            wcscpy(fileName, lpLibFileName);
        }
        
        char ansiName[MAX_PATH] = {0};
        WideCharToMultiByte(CP_ACP, 0, fileName, -1, ansiName, sizeof(ansiName), NULL, NULL);
        
        if (ShouldLogDllName(ansiName)) {
            char logBuf[512];
            sprintf(logBuf, "LoadLibraryW: %s (base=%p)", ansiName, hResult);
            WriteLog(logBuf);
        }
    }
    
    return hResult;
}

FARPROC WINAPI HookedGetProcAddress(HMODULE hModule, LPCSTR lpProcName) {
    if (lpProcName && g_GetProcCount++ < 2000) {
        char modName[MAX_PATH] = {0};
        if (hModule) {
            GetModuleFileNameA(hModule, modName, sizeof(modName));
            const char* pLastSlash = strrchr(modName, '\\');
            if (pLastSlash) strcpy(modName, pLastSlash + 1);
        }
        
        if (ShouldLogDllName(modName) || ShouldLogProcAddress(lpProcName)) {
            if (ShouldLogProcAddress(lpProcName)) {
                char logBuf[512];
                sprintf(logBuf, "GetProcAddress: %s from %s", lpProcName, modName);
                WriteLog(logBuf);
            }
        }
    }
    
    return g_OriginalGetProcAddress(hModule, lpProcName);
}

static int g_QuartzProcCount = 0;

FARPROC WINAPI HookedGetProcAddress_QuartzTrack(HMODULE hModule, LPCSTR lpProcName) {
    FARPROC result = HookedGetProcAddress(hModule, lpProcName);
    
    if (result && lpProcName) {
        char modName[MAX_PATH] = {0};
        if (hModule) {
            GetModuleFileNameA(hModule, modName, sizeof(modName));
            const char* pLastSlash = strrchr(modName, '\\');
            if (pLastSlash) strcpy(modName, pLastSlash + 1);
        }
        
        if (_stricmp(modName, "quartz.dll") == 0 || 
            _stricmp(modName, "strmiids.dll") == 0) {
            
            if (g_QuartzProcCount++ < 100) {
                char logBuf[512];
                sprintf(logBuf, "Quartz GetProcAddress: %s @ %p", lpProcName, result);
                WriteLog(logBuf);
            }
        }
    }
    
    return result;
}

static int g_CoCreateQuartzCount = 0;

static int g_LastCoCreateTime = 0;

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
    
    HRESULT hr = g_OriginalCoCreateInstance(rclsid, pUnkOuter, dwClsContext, riid, ppv);
    
    return hr;
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    MH_CreateHookApi(L"ole32.dll", "CoCreateInstance", &HookedCoCreateInstance, (LPVOID*)&g_OriginalCoCreateInstance);
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpW", &HookedlstrcmpW, (LPVOID*)&g_OriginallstrcmpW);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryExW", &HookedLoadLibraryExW, (LPVOID*)&g_OriginalLoadLibraryExW);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryW", &HookedLoadLibraryW, (LPVOID*)&g_OriginalLoadLibraryW);
    MH_CreateHookApi(L"kernel32.dll", "GetProcAddress", &HookedGetProcAddress, (LPVOID*)&g_OriginalGetProcAddress);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("Hooks installed v20 - DirectShow DLL/Proc Tracking");
    WriteLog("Tracking: LoadLibraryExW/LoadLibraryW/GetProcAddress");
    WriteLog("Focus: quartz.dll, strmiids.dll, strmbase.dll");
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("DLL loaded v20");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
