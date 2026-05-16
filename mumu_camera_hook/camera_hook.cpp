#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "libMinHook-x64-v141-md.lib")

static char g_CameraName[512] = {0};
static char g_ConfigPath[MAX_PATH] = {0};
static char g_LogPath[MAX_PATH] = {0};
static DWORD g_LastCheckTime = 0;
static FILETIME g_LastWriteTime = {0};
static HANDLE g_hTimerThread = NULL;
static BOOL g_bRunning = TRUE;
static BOOL g_bHooksInstalled = FALSE;
static BOOL g_bLogMode = TRUE;

void InitPaths();
void WriteLog(const char* msg);
void LoadCameraName();

void InitPaths() {
    if (g_ConfigPath[0] != 0) return;
    strcpy(g_ConfigPath, "D:\\mumu_camera_config.txt");
    strcpy(g_LogPath, "D:\\mumu_camera_hook.log");
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

void LoadCameraName() {
    InitPaths();
    
    DWORD now = GetTickCount();
    if (now - g_LastCheckTime < 2000) return;
    g_LastCheckTime = now;
    
    WIN32_FILE_ATTRIBUTE_DATA fileAttr;
    if (GetFileAttributesExA(g_ConfigPath, GetFileExInfoStandard, &fileAttr)) {
        if (CompareFileTime(&fileAttr.ftLastWriteTime, &g_LastWriteTime) == 0 && g_CameraName[0] != 0) {
            return;
        }
        g_LastWriteTime = fileAttr.ftLastWriteTime;
    }
    
    FILE* f = fopen(g_ConfigPath, "r");
    if (f) {
        if (fgets(g_CameraName, sizeof(g_CameraName), f)) {
            g_CameraName[strcspn(g_CameraName, "\r\n")] = 0;
        }
        fclose(f);
    } else {
        strcpy(g_CameraName, "Integrated Camera");
        f = fopen(g_ConfigPath, "w");
        if (f) {
            fprintf(f, "%s\n", g_CameraName);
            fclose(f);
        }
    }
}

typedef HRESULT (WINAPI *CoCreateInstance_t)(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv);
static CoCreateInstance_t g_OriginalCoCreateInstance = NULL;

static void GuidToString(REFGUID guid, char* buf, size_t bufSize) {
    sprintf(buf, "{%08lX-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}",
        guid.Data1, guid.Data2, guid.Data3,
        guid.Data4[0], guid.Data4[1], guid.Data4[2], guid.Data4[3],
        guid.Data4[4], guid.Data4[5], guid.Data4[6], guid.Data4[7]);
}

HRESULT WINAPI HookedCoCreateInstance(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv) {
    char clsidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    
    char logBuf[256];
    sprintf(logBuf, "CoCreateInstance: CLSID=%s", clsidStr);
    WriteLog(logBuf);
    
    HRESULT hr = g_OriginalCoCreateInstance(rclsid, pUnkOuter, dwClsContext, riid, ppv);
    
    return hr;
}

typedef LSTATUS (WINAPI *RegOpenKeyExW_t)(HKEY hKey, LPCWSTR lpSubKey, DWORD ulOptions, REGSAM samDesired, PHKEY phkResult);
typedef LSTATUS (WINAPI *RegQueryValueExW_t)(HKEY hKey, LPCWSTR lpValueName, LPDWORD lpReserved, LPDWORD lpType, LPBYTE lpData, LPDWORD lpcbData);

static RegOpenKeyExW_t g_OriginalRegOpenKeyExW = NULL;
static RegQueryValueExW_t g_OriginalRegQueryValueExW = NULL;

LSTATUS WINAPI HookedRegOpenKeyExW(HKEY hKey, LPCWSTR lpSubKey, DWORD ulOptions, REGSAM samDesired, PHKEY phkResult) {
    LSTATUS status = g_OriginalRegOpenKeyExW(hKey, lpSubKey, ulOptions, samDesired, phkResult);
    
    if (lpSubKey) {
        char subKeyA[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpSubKey, -1, subKeyA, sizeof(subKeyA), NULL, NULL);
        
        if (strstr(subKeyA, "Image") != NULL || strstr(subKeyA, "Camera") != NULL || 
            strstr(subKeyA, "Video") != NULL || strstr(subKeyA, "Device") != NULL) {
            char logBuf[1024];
            sprintf(logBuf, "RegOpenKeyExW: %s", subKeyA);
            WriteLog(logBuf);
        }
    }
    
    return status;
}

LSTATUS WINAPI HookedRegQueryValueExW(HKEY hKey, LPCWSTR lpValueName, LPDWORD lpReserved, LPDWORD lpType, LPBYTE lpData, LPDWORD lpcbData) {
    LSTATUS status = g_OriginalRegQueryValueExW(hKey, lpValueName, lpReserved, lpType, lpData, lpcbData);
    
    if (status == ERROR_SUCCESS && lpValueName && lpData) {
        if (wcscmp(lpValueName, L"FriendlyName") == 0 || wcscmp(lpValueName, L"DevicePath") == 0) {
            WCHAR* value = (WCHAR*)lpData;
            char valueA[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, value, -1, valueA, sizeof(valueA), NULL, NULL);
            
            char logBuf[1024];
            sprintf(logBuf, "RegQueryValueExW(%S): %s", lpValueName, valueA);
            WriteLog(logBuf);
        }
    }
    
    return status;
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    MH_CreateHookApi(L"ole32.dll", "CoCreateInstance", &HookedCoCreateInstance, (LPVOID*)&g_OriginalCoCreateInstance);
    MH_CreateHookApi(L"advapi32.dll", "RegOpenKeyExW", &HookedRegOpenKeyExW, (LPVOID*)&g_OriginalRegOpenKeyExW);
    MH_CreateHookApi(L"advapi32.dll", "RegQueryValueExW", &HookedRegQueryValueExW, (LPVOID*)&g_OriginalRegQueryValueExW);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("Hooks installed - LOGGING MODE");
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("DLL loaded - LOGGING MODE");
        LoadCameraName();
        InstallHooks();
    }
    else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) const char* GetDefaultCamera() {
    LoadCameraName();
    return g_CameraName;
}

extern "C" __declspec(dllexport) void SetDefaultCamera(const char* name) {
    InitPaths();
    strncpy(g_CameraName, name, sizeof(g_CameraName) - 1);
    FILE* f = fopen(g_ConfigPath, "w");
    if (f) {
        fprintf(f, "%s\n", g_CameraName);
        fclose(f);
    }
}
