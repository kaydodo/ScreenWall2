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
static HWND g_LastQtDialog = NULL;

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

BOOL IsCameraDialog(HWND hwnd) {
    if (!hwnd) return FALSE;

    char className[256] = {0};
    GetClassNameA(hwnd, className, sizeof(className));

    RECT rect;
    GetWindowRect(hwnd, &rect);
    int width = rect.right - rect.left;

    char title[256] = {0};
    GetWindowTextA(hwnd, title, sizeof(title));

    char buf[1024];
    sprintf(buf, "QtDialog: class=%s title=%s size=%dx%d",
        className, title, width, rect.bottom - rect.top);
    WriteLog(buf);

    if (strstr(className, "QWidget") || strstr(className, "Qt5") || strstr(className, "Qt6")) {
        if (width > 300 && width < 400) {
            sprintf(buf, "CAMERA DIALOG DETECTED! width=%d", width);
            WriteLog(buf);
            return TRUE;
        }
    }

    return FALSE;
}

void EnumQtWindows() {
    WriteLog("=== Searching Qt Windows ===");

    EnumChildWindows(NULL, [](HWND hwnd, LPARAM lParam) -> BOOL {
        char className[256] = {0};
        GetClassNameA(hwnd, className, sizeof(className));

        RECT rect;
        GetWindowRect(hwnd, &rect);
        int width = rect.right - rect.left;

        char title[256] = {0};
        GetWindowTextA(hwnd, title, sizeof(title));

        if (width > 200) {
            char buf[1024];
            sprintf(buf, "  HWND=%p class=%s title=%s size=%dx%d at (%d,%d)",
                hwnd, className, title, width, rect.bottom - rect.top, rect.left, rect.top);
            WriteLog(buf);
        }

        return TRUE;
    }, 0);
}

typedef HWND (WINAPI *CreateWindowExW_t)(DWORD, LPCWSTR, LPCWSTR, DWORD, int, int, int, int, HWND, HMENU, HINSTANCE, LPVOID);
static CreateWindowExW_t g_OriginalCreateWindowExW = NULL;

HWND WINAPI HookedCreateWindowExW(DWORD dwExStyle, LPCWSTR lpClassName, LPCWSTR lpWindowName,
    DWORD dwStyle, int X, int Y, int nWidth, int nHeight, HWND hWndParent, HMENU hMenu,
    HINSTANCE hInstance, LPVOID lpParam) {

    HWND result = g_OriginalCreateWindowExW(dwExStyle, lpClassName, lpWindowName,
        dwStyle, X, Y, nWidth, nHeight, hWndParent, hMenu, hInstance, lpParam);

    if (result && lpClassName) {
        char className[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpClassName, -1, className, sizeof(className), NULL, NULL);

        if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWidget")) {
            if (nWidth > 200 && nWidth < 500 && nHeight < 300) {
                char buf[512];
                sprintf(buf, "Qt Window Created: class=%s size=%dx%d HWND=%p", className, nWidth, nHeight, result);
                WriteLog(buf);
                g_LastQtDialog = result;
            }
        }
    }

    return result;
}

typedef BOOL (WINAPI *ShowWindow_t)(HWND, int);
static ShowWindow_t g_OriginalShowWindow = NULL;

BOOL WINAPI HookedShowWindow(HWND hWnd, int nCmdShow) {
    if (hWnd) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        RECT rect;
        GetWindowRect(hWnd, &rect);
        int width = rect.right - rect.left;

        if ((strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWidget")) &&
            width > 300 && width < 400) {
            char buf[512];
            sprintf(buf, "Qt Dialog ShowWindow: HWND=%p class=%s width=%d nCmdShow=%d",
                hWnd, className, width, nCmdShow);
            WriteLog(buf);

            if (width > 330) {
                sprintf(buf, "CAMERA SELECT DIALOG SHOWN! Attempting auto-select...");
                WriteLog(buf);
            }
        }
    }

    return g_OriginalShowWindow(hWnd, nCmdShow);
}

typedef int (WINAPI *DialogBoxParamW_t)(HINSTANCE, LPCWSTR, HWND, DLGPROC, LPARAM);
static DialogBoxParamW_t g_OriginalDialogBoxParamW = NULL;

int WINAPI HookedDialogBoxParamW(HINSTANCE hInstance, LPCWSTR lpTemplateName,
    HWND hWndParent, DLGPROC lpDialogFunc, LPARAM dwInitParam) {

    char buf[512];
    sprintf(buf, "DialogBoxParamW: template=%p parent=%p", lpTemplateName, hWndParent);
    WriteLog(buf);

    return g_OriginalDialogBoxParamW(hInstance, lpTemplateName, hWndParent, lpDialogFunc, dwInitParam);
}

typedef INT_PTR (WINAPI *DialogBoxW_t)(HINSTANCE, LPCWSTR, HWND, DLGPROC);
static DialogBoxW_t g_OriginalDialogBoxW = NULL;

INT_PTR WINAPI HookedDialogBoxW(HINSTANCE hInstance, LPCWSTR lpTemplateName,
    HWND hWndParent, DLGPROC lpDialogFunc) {

    char buf[512];
    sprintf(buf, "DialogBoxW: template=%p parent=%p", lpTemplateName, hWndParent);
    WriteLog(buf);

    INT_PTR result = g_OriginalDialogBoxW(hInstance, lpTemplateName, hWndParent, lpDialogFunc);
    sprintf(buf, "DialogBoxW returned: %d", result);
    WriteLog(buf);

    return result;
}

typedef HWND (WINAPI *FindWindowExW_t)(HWND, HWND, LPCWSTR, LPCWSTR);
static FindWindowExW_t g_OriginalFindWindowExW = NULL;

HWND WINAPI HookedFindWindowExW(HWND hWndParent, HWND hWndChildAfter, LPCWSTR lpszClass, LPCWSTR lpszWindow) {
    HWND result = g_OriginalFindWindowExW(hWndParent, hWndChildAfter, lpszClass, lpszWindow);

    if (result && lpszClass) {
        char className[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpszClass, -1, className, sizeof(className), NULL, NULL);

        if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWidget")) {
            char buf[512];
            sprintf(buf, "FindWindowExW Qt: class=%s HWND=%p", className, result);
            WriteLog(buf);
        }
    }

    return result;
}

typedef HWND (WINAPI *FindWindowW_t)(LPCWSTR, LPCWSTR);
static FindWindowW_t g_OriginalFindWindowW = NULL;

HWND WINAPI HookedFindWindowW(LPCWSTR lpClassName, LPCWSTR lpWindowName) {
    HWND result = g_OriginalFindWindowW(lpClassName, lpWindowName);

    if (result) {
        char buf[512];
        sprintf(buf, "FindWindowW: class=%p name=%p HWND=%p", lpClassName, lpWindowName, result);
        WriteLog(buf);
    }

    return result;
}

typedef LRESULT (WINAPI *SendMessageW_t)(HWND, UINT, WPARAM, LPARAM);
static SendMessageW_t g_OriginalSendMessageW = NULL;

LRESULT WINAPI HookedSendMessageW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam) {
    if (Msg == WM_COMMAND && hWnd) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        if (strstr(className, "Qt5") || strstr(className, "QWidget")) {
            char buf[512];
            sprintf(buf, "SendMessageW Qt WM_COMMAND: HWND=%p wParam=0x%X lParam=%p class=%s",
                hWnd, wParam, lParam, className);
            WriteLog(buf);
        }
    }

    if (Msg == BM_CLICK && hWnd) {
        char buf[512];
        sprintf(buf, "BM_CLICK sent to HWND=%p", hWnd);
        WriteLog(buf);
    }

    return g_OriginalSendMessageW(hWnd, Msg, wParam, lParam);
}

typedef BOOL (WINAPI *PostMessageW_t)(HWND, UINT, WPARAM, LPARAM);
static PostMessageW_t g_OriginalPostMessageW = NULL;

BOOL WINAPI HookedPostMessageW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam) {
    if (hWnd) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        RECT rect;
        GetWindowRect(hWnd, &rect);
        int width = rect.right - rect.left;

        if ((strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWidget"))) {
            if (Msg == WM_COMMAND || Msg == WM_LBUTTONDOWN || Msg == BM_CLICK) {
                char buf[512];
                sprintf(buf, "PostMessageW Qt: HWND=%p Msg=0x%X wParam=0x%X class=%s width=%d",
                    hWnd, Msg, wParam, className, width);
                WriteLog(buf);
            }
        }
    }

    return g_OriginalPostMessageW(hWnd, Msg, wParam, lParam);
}

typedef BOOL (WINAPI *EnumChildWindows_t)(HWND, WNDENUMPROC, LPARAM);
static EnumChildWindows_t g_OriginalEnumChildWindows = NULL;

BOOL WINAPI HookedEnumChildWindows(HWND hWndParent, WNDENUMPROC lpEnumFunc, LPARAM lParam) {
    if (hWndParent) {
        char buf[512];
        sprintf(buf, "EnumChildWindows: parent=%p", hWndParent);
        WriteLog(buf);
    }

    BOOL result = g_OriginalEnumChildWindows(hWndParent, lpEnumFunc, lParam);
    return result;
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;

    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }

    MH_CreateHookApi(L"user32.dll", "CreateWindowExW", &HookedCreateWindowExW, (LPVOID*)&g_OriginalCreateWindowExW);
    MH_CreateHookApi(L"user32.dll", "ShowWindow", &HookedShowWindow, (LPVOID*)&g_OriginalShowWindow);
    MH_CreateHookApi(L"user32.dll", "DialogBoxParamW", &HookedDialogBoxParamW, (LPVOID*)&g_OriginalDialogBoxParamW);
    MH_CreateHookApi(L"user32.dll", "DialogBoxW", &HookedDialogBoxW, (LPVOID*)&g_OriginalDialogBoxW);
    MH_CreateHookApi(L"user32.dll", "FindWindowExW", &HookedFindWindowExW, (LPVOID*)&g_OriginalFindWindowExW);
    MH_CreateHookApi(L"user32.dll", "FindWindowW", &HookedFindWindowW, (LPVOID*)&g_OriginalFindWindowW);
    MH_CreateHookApi(L"user32.dll", "SendMessageW", &HookedSendMessageW, (LPVOID*)&g_OriginalSendMessageW);
    MH_CreateHookApi(L"user32.dll", "PostMessageW", &HookedPostMessageW, (LPVOID*)&g_OriginalPostMessageW);
    MH_CreateHookApi(L"user32.dll", "EnumChildWindows", &HookedEnumChildWindows, (LPVOID*)&g_OriginalEnumChildWindows);

    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }

    WriteLog("=============================================");
    WriteLog("Hooks installed v36 - Qt5 Camera Dialog Auto-Select");
    WriteLog("=============================================");
    WriteLog("Hooking: CreateWindowExW, ShowWindow, DialogBox,");
    WriteLog("         FindWindow, SendMessage, PostMessage");
    WriteLog("=============================================");

    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v36 - Qt5 Camera Dialog");
        WriteLog("=============================================");
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
