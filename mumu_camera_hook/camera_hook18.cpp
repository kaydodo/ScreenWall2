#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"
#include <objbase.h>
#include <strmif.h>
#include <dshow.h>

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

typedef HRESULT (WINAPI *CoCreateInstanceEx_t)(REFCLSID rclsid, IUnknown *punkOuter, DWORD dwClsCtx, COSERVERINFO *pServerInfo, DWORD dwCount, MULTI_QI *pResults);
static CoCreateInstanceEx_t g_OriginalCoCreateInstanceEx = NULL;

typedef HRESULT (WINAPI *CreateDevEnum_t)(LPCSTR pTypeFlter, ICreateDevEnum **ppDevEnum, LPUNKNOWN pUnk);
static CreateDevEnum_t g_OriginalCreateDevEnum = NULL;

typedef HRESULT (WINAPI *GetRunningObjectTable_t)(DWORD reserved, IRunningObjectTable **ppROT);
static GetRunningObjectTable_t g_OriginalGetRunningObjectTable = NULL;

typedef HRESULT (WINAPI *CoGetClassObject_t)(REFCLSID rclsid, DWORD dwClsContext, COSERVERINFO *pServerInfo, REFIID riid, LPVOID *ppv);
static CoGetClassObject_t g_OriginalCoGetClassObject = NULL;

typedef HRESULT (WINAPI *CoGetObject_t)(LPCWSTR pszName, BIND_OPTS *pBindOptions, REFIID riid, LPVOID *ppv);
static CoGetObject_t g_OriginalCoGetObject = NULL;

typedef int (WINAPI *lstrcmpW_t)(LPCWSTR, LPCWSTR);
static lstrcmpW_t g_OriginallstrcmpW = NULL;

typedef int (WINAPI *lstrcmpiW_t)(LPCWSTR, LPCWSTR);
static lstrcmpiW_t g_OriginallstrcmpiW = NULL;

typedef LPWSTR (WINAPI *lstrcpyW_t)(LPWSTR, LPCWSTR);
static lstrcpyW_t g_OriginallstrcpyW = NULL;

typedef int (WINAPI *lstrcpynW_t)(LPWSTR, LPCWSTR, int);
static lstrcpynW_t g_OriginallstrcpynW = NULL;

typedef HMODULE (WINAPI *LoadLibraryExW_t)(LPCWSTR, HANDLE, DWORD);
static LoadLibraryExW_t g_OriginalLoadLibraryExW = NULL;

typedef HMODULE (WINAPI *LoadLibraryExA_t)(LPCSTR, HANDLE, DWORD);
static LoadLibraryExA_t g_OriginalLoadLibraryExA = NULL;

typedef HMODULE (WINAPI *LoadLibraryW_t)(LPCWSTR);
static LoadLibraryW_t g_OriginalLoadLibraryW = NULL;

typedef HMODULE (WINAPI *LoadLibraryA_t)(LPCSTR);
static LoadLibraryA_t g_OriginalLoadLibraryA = NULL;

typedef FARPROC (WINAPI *GetProcAddress_t)(HMODULE, LPCSTR);
static GetProcAddress_t g_OriginalGetProcAddress = NULL;

typedef LPVOID (WINAPI *VirtualAlloc_t)(LPVOID, SIZE_T, DWORD, DWORD);
static VirtualAlloc_t g_OriginalVirtualAlloc = NULL;

typedef BOOL (WINAPI *VirtualFree_t)(LPVOID, SIZE_T, DWORD);
static VirtualFree_t g_OriginalVirtualFree = NULL;

typedef HGLOBAL (WINAPI *GlobalAlloc_t)(UINT, SIZE_T);
static GlobalAlloc_t g_OriginalGlobalAlloc = NULL;

typedef HGLOBAL (WINAPI *GlobalFree_t)(HGLOBAL);
static GlobalFree_t g_OriginalGlobalFree = NULL;

typedef LPVOID (WINAPI *GlobalLock_t)(HGLOBAL);
static GlobalLock_t g_OriginalGlobalLock = NULL;

typedef BOOL (WINAPI *GlobalUnlock_t)(HGLOBAL);
static GlobalUnlock_t g_OriginalGlobalUnlock = NULL;

typedef HRESULT (WINAPI *CreateBindCtx_t)(DWORD, IBindCtx**);
static CreateBindCtx_t g_OriginalCreateBindCtx = NULL;

typedef HRESULT (WINAPI *CreateGenericMoniker_t)(IUnknown*, IMoniker**);
static CreateGenericMoniker_t g_OriginalCreateGenericMoniker = NULL;

typedef HRESULT (WINAPI *GetClassFile_t)(LPCWSTR, CLSID*);
static GetClassFile_t g_OriginalGetClassFile = NULL;

typedef HRESULT (WINAPI *CreateFileMoniker_t)(LPCWSTR, IMoniker**);
static CreateFileMoniker_t g_OriginalCreateFileMoniker = NULL;

typedef HRESULT (WINAPI *CreateObjrefMoniker_t)(IUnknown*, IMoniker**);
static CreateObjrefMoniker_t g_OriginalCreateObjrefMoniker = NULL;

typedef HRESULT (WINAPI *CreateItemMoniker_t)(LPCWSTR, LPCWSTR, IMoniker**);
static CreateItemMoniker_t g_OriginalCreateItemMoniker = NULL;

typedef HRESULT (WINAPI *CoMarshalInterface_t)(IStream*, REFIID, IUnknown*, DWORD, IUnknown*, DWORD);
static CoMarshalInterface_t g_OriginalCoMarshalInterface = NULL;

typedef HRESULT (WINAPI *CoUnmarshalInterface_t)(IStream*, REFIID, LPVOID*);
static CoUnmarshalInterface_t g_OriginalCoUnmarshalInterface = NULL;

typedef LPUNKNOWN (WINAPI *CoUnmarshalISmtpAutoDiscoverCallback_t)(IStream*);
static CoUnmarshalISmtpAutoDiscoverCallback_t g_OriginalCoUnmarshalISmtpAutoDiscoverCallback = NULL;

typedef HANDLE (WINAPI *CreateFileMappingW_t)(HANDLE, LPSECURITY_ATTRIBUTES, DWORD, DWORD, DWORD, LPCWSTR);
static CreateFileMappingW_t g_OriginalCreateFileMappingW = NULL;

typedef LPVOID (WINAPI *MapViewOfFile_t)(HANDLE, DWORD, DWORD, DWORD, SIZE_T);
static MapViewOfFile_t g_OriginalMapViewOfFile = NULL;

typedef BOOL (WINAPI *UnmapViewOfFile_t)(LPCVOID);
static UnmapViewOfFile_t g_OriginalUnmapViewOfFile = NULL;

static int g_StrCompareCount = 0;
static char g_LastCompareStr1[512] = {0};
static char g_LastCompareStr2[512] = {0};

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (lpString1 && lpString2) {
        char s1[256] = {0};
        char s2[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
        WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        if (strstr(s1, "Camera") || strstr(s1, "camera") || 
            strstr(s1, "CAMERA") || strstr(s2, "Camera") || 
            strstr(s2, "camera") || strstr(s2, "CAMERA") ||
            strstr(s1, "Video") || strstr(s1, "video") ||
            strstr(s2, "Video") || strstr(s2, "video") ||
            strstr(s1, "Integrated") || strstr(s1, "integrated") ||
            strstr(s2, "Integrated") || strstr(s2, "integrated") ||
            strstr(s1, "Mumu") || strstr(s1, "mumu") ||
            strstr(s2, "Mumu") || strstr(s2, "mumu")) {
            
            char logBuf[1024];
            sprintf(logBuf, "lstrcmpW: '%s' vs '%s'", s1, s2);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginallstrcmpW(lpString1, lpString2);
}

int WINAPI HookedlstrcmpiW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (lpString1 && lpString2) {
        char s1[256] = {0};
        char s2[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
        WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        if (strstr(s1, "Camera") || strstr(s1, "camera") || 
            strstr(s1, "CAMERA") || strstr(s2, "Camera") || 
            strstr(s2, "camera") || strstr(s2, "CAMERA") ||
            strstr(s1, "Video") || strstr(s1, "video") ||
            strstr(s2, "Video") || strstr(s2, "video")) {
            
            char logBuf[1024];
            sprintf(logBuf, "lstrcmpiW: '%s' vs '%s'", s1, s2);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginallstrcmpiW(lpString1, lpString2);
}

LPWSTR WINAPI HookedlstrcpyW(LPWSTR lpString1, LPCWSTR lpString2) {
    if (lpString1 && lpString2) {
        char s2[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        if (strstr(s2, "Camera") || strstr(s2, "camera") || 
            strstr(s2, "Video") || strstr(s2, "video") ||
            strstr(s2, "Integrated") || strstr(s2, "USB") ||
            strstr(s2, "\\\\?\\")) {
            
            char logBuf[1024];
            sprintf(logBuf, "lstrcpyW: '%s'", s2);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginallstrcpyW(lpString1, lpString2);
}

int WINAPI HookedlstrcpynW(LPWSTR lpString1, LPCWSTR lpString2, int iMaxLength) {
    if (lpString1 && lpString2) {
        char s2[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
        
        if (strstr(s2, "Camera") || strstr(s2, "camera") || 
            strstr(s2, "Video") || strstr(s2, "video") ||
            strstr(s2, "Integrated") || strstr(s2, "USB") ||
            strstr(s2, "\\\\?\\")) {
            
            char logBuf[1024];
            sprintf(logBuf, "lstrcpynW: '%s' (len=%d)", s2, iMaxLength);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginallstrcpynW(lpString1, lpString2, iMaxLength);
}

HMODULE WINAPI HookedLoadLibraryExW(LPCWSTR lpLibFileName, HANDLE hFile, DWORD dwFlags) {
    if (lpLibFileName) {
        char name[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpLibFileName, -1, name, sizeof(name), NULL, NULL);
        
        char logBuf[1024];
        sprintf(logBuf, "LoadLibraryExW: %s", name);
        WriteLog(logBuf);
    }
    
    return g_OriginalLoadLibraryExW(lpLibFileName, hFile, dwFlags);
}

HMODULE WINAPI HookedLoadLibraryExA(LPCSTR lpLibFileName, HANDLE hFile, DWORD dwFlags) {
    if (lpLibFileName) {
        if (strstr(lpLibFileName, "quartz") || strstr(lpLibFileName, "dshow") ||
            strstr(lpLibFileName, "strmi") || strstr(lpLibFileName, "msvid") ||
            strstr(lpLibFileName, "Camera") || strstr(lpLibFileName, "camera")) {
            
            char logBuf[1024];
            sprintf(logBuf, "LoadLibraryExA: %s", lpLibFileName);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginalLoadLibraryExA(lpLibFileName, hFile, dwFlags);
}

HMODULE WINAPI HookedLoadLibraryW(LPCWSTR lpLibFileName) {
    if (lpLibFileName) {
        char name[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpLibFileName, -1, name, sizeof(name), NULL, NULL);
        
        char logBuf[1024];
        sprintf(logBuf, "LoadLibraryW: %s", name);
        WriteLog(logBuf);
    }
    
    return g_OriginalLoadLibraryW(lpLibFileName);
}

HMODULE WINAPI HookedLoadLibraryA(LPCSTR lpLibFileName) {
    if (lpLibFileName) {
        if (strstr(lpLibFileName, "quartz") || strstr(lpLibFileName, "dshow") ||
            strstr(lpLibFileName, "strmi") || strstr(lpLibFileName, "msvid")) {
            
            char logBuf[1024];
            sprintf(logBuf, "LoadLibraryA: %s", lpLibFileName);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginalLoadLibraryA(lpLibFileName);
}

FARPROC WINAPI HookedGetProcAddress(HMODULE hModule, LPCSTR lpProcName) {
    if (lpProcName) {
        if (strstr(lpProcName, "Enum") || strstr(lpProcName, "Filter") ||
            strstr(lpProcName, "Pin") || strstr(lpProcName, "Graph") ||
            strstr(lpProcName, "Capture") || strstr(lpProcName, "Video")) {
            
            char modName[256] = {0};
            if (hModule) {
                GetModuleFileNameA(hModule, modName, sizeof(modName));
                char* p = strrchr(modName, '\\');
                if (p) strcpy(modName, p + 1);
            }
            
            char logBuf[1024];
            sprintf(logBuf, "GetProcAddress: %s from %s", lpProcName, modName);
            WriteLog(logBuf);
        }
    }
    
    return g_OriginalGetProcAddress(hModule, lpProcName);
}

LPVOID WINAPI HookedVirtualAlloc(LPVOID lpAddress, SIZE_T dwSize, DWORD flAllocationType, DWORD flProtect) {
    char logBuf[256];
    sprintf(logBuf, "VirtualAlloc: addr=%p size=%lu protect=0x%lX", lpAddress, dwSize, flProtect);
    WriteLog(logBuf);
    
    return g_OriginalVirtualAlloc(lpAddress, dwSize, flAllocationType, flProtect);
}

BOOL WINAPI HookedVirtualFree(LPVOID lpAddress, SIZE_T dwSize, DWORD dwFreeType) {
    char logBuf[256];
    sprintf(logBuf, "VirtualFree: addr=%p size=%lu type=0x%lX", lpAddress, dwSize, dwFreeType);
    WriteLog(logBuf);
    
    return g_OriginalVirtualFree(lpAddress, dwSize, dwFreeType);
}

HGLOBAL WINAPI HookedGlobalAlloc(UINT uFlags, SIZE_T dwBytes) {
    char logBuf[256];
    sprintf(logBuf, "GlobalAlloc: flags=0x%X size=%lu", uFlags, dwBytes);
    WriteLog(logBuf);
    
    return g_OriginalGlobalAlloc(uFlags, dwBytes);
}

HGLOBAL WINAPI HookedGlobalFree(HGLOBAL hMem) {
    char logBuf[256];
    sprintf(logBuf, "GlobalFree: hMem=%p", hMem);
    WriteLog(logBuf);
    
    return g_OriginalGlobalFree(hMem);
}

LPVOID WINAPI HookedGlobalLock(HGLOBAL hMem) {
    char logBuf[256];
    sprintf(logBuf, "GlobalLock: hMem=%p", hMem);
    WriteLog(logBuf);
    
    return g_OriginalGlobalLock(hMem);
}

BOOL WINAPI HookedGlobalUnlock(HGLOBAL hMem) {
    char logBuf[256];
    sprintf(logBuf, "GlobalUnlock: hMem=%p", hMem);
    WriteLog(logBuf);
    
    return g_OriginalGlobalUnlock(hMem);
}

HANDLE WINAPI HookedCreateFileMappingW(HANDLE hFile, LPSECURITY_ATTRIBUTES lpAttributes, DWORD flProtect, DWORD dwMaxSizeHi, DWORD dwMaxSizeLo, LPCWSTR lpName) {
    if (lpName) {
        char name[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpName, -1, name, sizeof(name), NULL, NULL);
        
        char logBuf[1024];
        sprintf(logBuf, "CreateFileMappingW: name=%s size=%lu", name, dwMaxSizeLo);
        WriteLog(logBuf);
    }
    
    return g_OriginalCreateFileMappingW(hFile, lpAttributes, flProtect, dwMaxSizeHi, dwMaxSizeLo, lpName);
}

LPVOID WINAPI HookedMapViewOfFile(HANDLE hFileMappingObject, DWORD dwDesiredAccess, DWORD dwFileOffsetHigh, DWORD dwFileOffsetLow, SIZE_T dwNumberOfBytesToMap) {
    char logBuf[256];
    sprintf(logBuf, "MapViewOfFile: handle=%p size=%lu", hFileMappingObject, dwNumberOfBytesToMap);
    WriteLog(logBuf);
    
    return g_OriginalMapViewOfFile(hFileMappingObject, dwDesiredAccess, dwFileOffsetHigh, dwFileOffsetLow, dwNumberOfBytesToMap);
}

BOOL WINAPI HookedUnmapViewOfFile(LPCVOID lpBaseAddress) {
    char logBuf[256];
    sprintf(logBuf, "UnmapViewOfFile: addr=%p", lpBaseAddress);
    WriteLog(logBuf);
    
    return g_OriginalUnmapViewOfFile(lpBaseAddress);
}

LPUNKNOWN WINAPI HookedCoUnmarshalISmtpAutoDiscoverCallback(IStream* pStm) {
    WriteLog("CoUnmarshalISmtpAutoDiscoverCallback called");
    return g_OriginalCoUnmarshalISmtpAutoDiscoverCallback(pStm);
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpW", &HookedlstrcmpW, (LPVOID*)&g_OriginallstrcmpW);
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpiW", &HookedlstrcmpiW, (LPVOID*)&g_OriginallstrcmpiW);
    MH_CreateHookApi(L"kernel32.dll", "lstrcpyW", &HookedlstrcpyW, (LPVOID*)&g_OriginallstrcpyW);
    MH_CreateHookApi(L"kernel32.dll", "lstrcpynW", &HookedlstrcpynW, (LPVOID*)&g_OriginallstrcpynW);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryExW", &HookedLoadLibraryExW, (LPVOID*)&g_OriginalLoadLibraryExW);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryExA", &HookedLoadLibraryExA, (LPVOID*)&g_OriginalLoadLibraryExA);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryW", &HookedLoadLibraryW, (LPVOID*)&g_OriginalLoadLibraryW);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryA", &HookedLoadLibraryA, (LPVOID*)&g_OriginalLoadLibraryA);
    MH_CreateHookApi(L"kernel32.dll", "GetProcAddress", &HookedGetProcAddress, (LPVOID*)&g_OriginalGetProcAddress);
    MH_CreateHookApi(L"kernel32.dll", "VirtualAlloc", &HookedVirtualAlloc, (LPVOID*)&g_OriginalVirtualAlloc);
    MH_CreateHookApi(L"kernel32.dll", "VirtualFree", &HookedVirtualFree, (LPVOID*)&g_OriginalVirtualFree);
    MH_CreateHookApi(L"kernel32.dll", "GlobalAlloc", &HookedGlobalAlloc, (LPVOID*)&g_OriginalGlobalAlloc);
    MH_CreateHookApi(L"kernel32.dll", "GlobalFree", &HookedGlobalFree, (LPVOID*)&g_OriginalGlobalFree);
    MH_CreateHookApi(L"kernel32.dll", "GlobalLock", &HookedGlobalLock, (LPVOID*)&g_OriginalGlobalLock);
    MH_CreateHookApi(L"kernel32.dll", "GlobalUnlock", &HookedGlobalUnlock, (LPVOID*)&g_OriginalGlobalUnlock);
    MH_CreateHookApi(L"kernel32.dll", "CreateFileMappingW", &HookedCreateFileMappingW, (LPVOID*)&g_OriginalCreateFileMappingW);
    MH_CreateHookApi(L"kernel32.dll", "MapViewOfFile", &HookedMapViewOfFile, (LPVOID*)&g_OriginalMapViewOfFile);
    MH_CreateHookApi(L"kernel32.dll", "UnmapViewOfFile", &HookedUnmapViewOfFile, (LPVOID*)&g_OriginalUnmapViewOfFile);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("Hooks installed v18 - STRING/LOAD TRACKING");
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("DLL loaded v18");
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
