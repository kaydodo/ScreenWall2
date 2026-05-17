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

typedef int (WINAPI *lstrcmpiW_t)(LPCWSTR, LPCWSTR);
static lstrcmpiW_t g_OriginallstrcmpiW = NULL;

typedef HMODULE (WINAPI *LoadLibraryExW_t)(LPCWSTR, HANDLE, DWORD);
static LoadLibraryExW_t g_OriginalLoadLibraryExW = NULL;

typedef LPWSTR (WINAPI *lstrcpyW_t)(LPWSTR, LPCWSTR);
static lstrcpyW_t g_OriginallstrcpyW = NULL;

typedef int (WINAPI *lstrcpynW_t)(LPWSTR, LPCWSTR, int);
static lstrcpynW_t g_OriginallstrcpynW = NULL;

typedef LPSTR (WINAPI *lstrcpyA_t)(LPSTR, LPCSTR);
static lstrcpyA_t g_OriginallstrcpyA = NULL;

typedef int (WINAPI *lstrcmpA_t)(LPCSTR, LPCSTR);
static lstrcmpA_t g_OriginallstrcmpA = NULL;

typedef int (WINAPI *lstrcmpiA_t)(LPCSTR, LPCSTR);
static lstrcmpiA_t g_OriginallstrcmpiA = NULL;

typedef int (WINAPI *strcmp_t)(const char*, const char*);
static strcmp_t g_Originalstrcmp = NULL;

typedef int (WINAPI *stricmp_t)(const char*, const char*);
static stricmp_t g_Originalstricmp = NULL;

typedef int (WINAPI *strnicmp_t)(const char*, const char*, size_t);
static strnicmp_t g_Originalstrnicmp = NULL;

BOOL ShouldLogString(const char* str) {
    if (!str || strlen(str) < 3) return FALSE;
    
    const char* keywords[] = {
        "Camera", "camera", "CAMERA",
        "Video", "video", "VIDEO",
        "Integrated", "integrated",
        "USB", "usb",
        "\\\\?\\", "mumu", "MuMu",
        "Capture", "capture"
    };
    
    for (int i = 0; i < sizeof(keywords)/sizeof(keywords[0]); i++) {
        if (strstr(str, keywords[i])) {
            return TRUE;
        }
    }
    return FALSE;
}

BOOL ShouldLogLibrary(const char* libName) {
    if (!libName) return FALSE;
    
    const char* libs[] = {
        "quartz", "dshow", "strmi", "msvid",
        "Camera", "camera", "capture"
    };
    
    for (int i = 0; i < sizeof(libs)/sizeof(libs[0]); i++) {
        if (strstr(libName, libs[i])) {
            return TRUE;
        }
    }
    return FALSE;
}

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

static int g_StringHookCallCount = 0;

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            char s1[512] = {0};
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (ShouldLogString(s1) || ShouldLogString(s2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpW: '%s' <-> '%s'", s1, s2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcmpW(lpString1, lpString2);
}

int WINAPI HookedlstrcmpiW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            char s1[512] = {0};
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (ShouldLogString(s1) || ShouldLogString(s2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpiW: '%s' <-> '%s'", s1, s2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcmpiW(lpString1, lpString2);
}

LPWSTR WINAPI HookedlstrcpyW(LPWSTR lpString1, LPCWSTR lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (ShouldLogString(s2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcpyW: '%s'", s2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcpyW(lpString1, lpString2);
}

int WINAPI HookedlstrcpynW(LPWSTR lpString1, LPCWSTR lpString2, int iMaxLength) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (ShouldLogString(s2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcpynW: '%s' len=%d", s2, iMaxLength);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcpynW(lpString1, lpString2, iMaxLength);
}

HMODULE WINAPI HookedLoadLibraryExW(LPCWSTR lpLibFileName, HANDLE hFile, DWORD dwFlags) {
    if (lpLibFileName) {
        char name[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpLibFileName, -1, name, sizeof(name), NULL, NULL);
        
        if (ShouldLogLibrary(name)) {
            char logBuf[1024];
            sprintf(logBuf, "LoadLibraryW: %s", name);
            WriteLog(logBuf);
        }
    }
    return g_OriginalLoadLibraryExW(lpLibFileName, hFile, dwFlags);
}

LPSTR WINAPI HookedlstrcpyA(LPSTR lpString1, LPCSTR lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            if (ShouldLogString(lpString2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcpyA: '%s'", lpString2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcpyA(lpString1, lpString2);
}

int WINAPI HookedlstrcmpA(LPCSTR lpString1, LPCSTR lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            if (ShouldLogString(lpString1) || ShouldLogString(lpString2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpA: '%s' <-> '%s'", lpString1, lpString2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcmpA(lpString1, lpString2);
}

int WINAPI HookedlstrcmpiA(LPCSTR lpString1, LPCSTR lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            if (ShouldLogString(lpString1) || ShouldLogString(lpString2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpiA: '%s' <-> '%s'", lpString1, lpString2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcmpiA(lpString1, lpString2);
}

int WINAPI Hookedstrcmp(const char* lpString1, const char* lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            if (ShouldLogString(lpString1) || ShouldLogString(lpString2)) {
                char logBuf[1024];
                sprintf(logBuf, "strcmp: '%s' <-> '%s'", lpString1, lpString2);
                WriteLog(logBuf);
            }
        }
    }
    return g_Originalstrcmp(lpString1, lpString2);
}

int WINAPI Hookedstricmp(const char* lpString1, const char* lpString2) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2) {
            if (ShouldLogString(lpString1) || ShouldLogString(lpString2)) {
                char logBuf[1024];
                sprintf(logBuf, "stricmp: '%s' <-> '%s'", lpString1, lpString2);
                WriteLog(logBuf);
            }
        }
    }
    return g_Originalstricmp(lpString1, lpString2);
}

int WINAPI Hookedstrnicmp(const char* lpString1, const char* lpString2, size_t MaxCount) {
    if (g_StringHookCallCount++ < 10000) {
        if (lpString1 && lpString2 && MaxCount > 3) {
            if (ShouldLogString(lpString1) || ShouldLogString(lpString2)) {
                char logBuf[1024];
                sprintf(logBuf, "strnicmp: '%s' <-> '%s' [%d]", lpString1, lpString2, (int)MaxCount);
                WriteLog(logBuf);
            }
        }
    }
    return g_Originalstrnicmp(lpString1, lpString2, MaxCount);
}

static int g_CoCreateCallCount = 0;

HRESULT WINAPI HookedCoCreateInstance(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv) {
    g_CoCreateCallCount++;
    
    char clsidStr[64];
    char iidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    GuidToString(riid, iidStr, sizeof(iidStr));
    
    if (ShouldLogCoCreate(rclsid)) {
        char logBuf[512];
        sprintf(logBuf, "CoCreateInstance #%d CLSID=%s IID=%s", g_CoCreateCallCount, clsidStr, iidStr);
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
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpiW", &HookedlstrcmpiW, (LPVOID*)&g_OriginallstrcmpiW);
    MH_CreateHookApi(L"kernel32.dll", "lstrcpyW", &HookedlstrcpyW, (LPVOID*)&g_OriginallstrcpyW);
    MH_CreateHookApi(L"kernel32.dll", "lstrcpynW", &HookedlstrcpynW, (LPVOID*)&g_OriginallstrcpynW);
    MH_CreateHookApi(L"kernel32.dll", "LoadLibraryExW", &HookedLoadLibraryExW, (LPVOID*)&g_OriginalLoadLibraryExW);
    MH_CreateHookApi(L"kernel32.dll", "lstrcpyA", &HookedlstrcpyA, (LPVOID*)&g_OriginallstrcpyA);
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpA", &HookedlstrcmpA, (LPVOID*)&g_OriginallstrcmpA);
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpiA", &HookedlstrcmpiA, (LPVOID*)&g_OriginallstrcmpiA);
    MH_CreateHookApi(L"msvcrt.dll", "strcmp", &Hookedstrcmp, (LPVOID*)&g_Originalstrcmp);
    MH_CreateHookApi(L"msvcrt.dll", "stricmp", &Hookedstricmp, (LPVOID*)&g_Originalstricmp);
    MH_CreateHookApi(L"msvcrt.dll", "_strnicmp", &Hookedstrnicmp, (LPVOID*)&g_Originalstrnicmp);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("Hooks installed v19 - STRING+COM TRACKING");
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("DLL loaded v19");
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
