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
static BOOL g_bCameraSelected = FALSE;
static HWND g_CameraDialogHwnd = NULL;

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

void LogQtWindow(HWND hwnd, const char* action) {
    if (!hwnd) return;

    char className[256] = {0};
    GetClassNameA(hwnd, className, sizeof(className));

    RECT rect;
    GetWindowRect(hwnd, &rect);

    char buf[512];
    sprintf(buf, "QtWindow %s: HWND=%p class=%s rect=%dx%d at (%d,%d)",
        action, hwnd, className, rect.right - rect.left, rect.bottom - rect.top, rect.left, rect.top);
    WriteLog(buf);
}

BOOL CALLBACK EnumChildProc(HWND hwnd, LPARAM lParam) {
    char className[256] = {0};
    GetClassNameA(hwnd, className, sizeof(className));

    char windowText[256] = {0};
    GetWindowTextA(hwnd, windowText, sizeof(windowText));

    RECT rect;
    GetWindowRect(hwnd, &rect);

    char buf[512];
    sprintf(buf, "  Child: HWND=%p class=%s text=%s rect=%dx%d",
        hwnd, className, windowText, rect.right - rect.left, rect.bottom - rect.top);
    WriteLog(buf);

    return TRUE;
}

void EnumQtChildren(HWND hwnd, const char* title) {
    char buf[256];
    sprintf(buf, "=== EnumChildren for %s ===", title);
    WriteLog(buf);
    EnumChildWindows(hwnd, EnumChildProc, 0);
}

void AutoClickQtButton(HWND hDialog) {
    if (g_bCameraSelected) return;

    WriteLog("=== AUTO-CLICKING CAMERA BUTTON ===");

    LogQtWindow(hDialog, "AUTO-CLICK");

    char buf[256];
    sprintf(buf, "Looking for buttons in dialog HWND=%p", hDialog);
    WriteLog(buf);

    EnumQtChildren(hDialog, "Camera Dialog");

    HWND hChild = GetWindow(hDialog, GW_CHILD);
    int buttonIndex = 0;
    int cameraButtonIndex = -1;

    while (hChild) {
        char className[256] = {0};
        GetClassNameA(hChild, className, sizeof(className));

        char windowText[256] = {0};
        GetWindowTextA(hChild, windowText, sizeof(windowText));

        RECT rect;
        GetWindowRect(hChild, &rect);

        sprintf(buf, "  Button[%d]: HWND=%p class=%s text=%s rect=%dx%d",
            buttonIndex, hChild, className, windowText,
            rect.right - rect.left, rect.bottom - rect.top);
        WriteLog(buf);

        if (strstr(windowText, "camera") || strstr(windowText, "Camera") || strstr(windowText, "\xB2\xE3\xCD\xB8")) {
            cameraButtonIndex = buttonIndex;
            sprintf(buf, "  *** FOUND CAMERA BUTTON at index %d! ***", buttonIndex);
            WriteLog(buf);
        }

        hChild = GetWindow(hChild, GW_HWNDNEXT);
        buttonIndex++;
    }

    if (cameraButtonIndex >= 0) {
        sprintf(buf, "Clicking camera button at index %d...", cameraButtonIndex);
        WriteLog(buf);

        hChild = GetWindow(hDialog, GW_CHILD);
        for (int i = 0; i < cameraButtonIndex && hChild; i++) {
            hChild = GetWindow(hChild, GW_HWNDNEXT);
        }

        if (hChild) {
            RECT rect;
            GetWindowRect(hChild, &rect);
            int cx = (rect.left + rect.right) / 2;
            int cy = (rect.top + rect.bottom) / 2;

            sprintf(buf, "Sending mouse click at (%d, %d)", cx, cy);
            WriteLog(buf);

            SetCursorPos(cx, cy);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            Sleep(50);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

            g_bCameraSelected = TRUE;
            sprintf(buf, "Camera button clicked! g_bCameraSelected = TRUE");
            WriteLog(buf);
        }
    } else {
        WriteLog("WARNING: Camera button not found! Trying index 1...");

        hChild = GetWindow(hDialog, GW_CHILD);
        if (hChild) {
            hChild = GetWindow(hChild, GW_HWNDNEXT);
        }

        if (hChild) {
            RECT rect;
            GetWindowRect(hChild, &rect);
            int cx = (rect.left + rect.right) / 2;
            int cy = (rect.top + rect.bottom) / 2;

            sprintf(buf, "Sending mouse click at index 1: (%d, %d)", cx, cy);
            WriteLog(buf);

            SetCursorPos(cx, cy);
            mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
            Sleep(50);
            mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

            g_bCameraSelected = TRUE;
            WriteLog("Button at index 1 clicked!");
        }
    }
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

        if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "CreateWindowExW Qt: class=%s size=%dx%d HWND=%p parent=%p",
                className, nWidth, nHeight, result, hWndParent);
            WriteLog(buf);
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
        int height = rect.bottom - rect.top;

        if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "ShowWindow Qt: HWND=%p class=%s size=%dx%d cmd=%d",
                hWnd, className, width, height, nCmdShow);
            WriteLog(buf);

            if (nCmdShow == SW_SHOW && width > 300 && width < 400 && height < 300) {
                sprintf(buf, "*** CAMERA DIALOG DETECTED! width=%d height=%d ***", width, height);
                WriteLog(buf);
                g_CameraDialogHwnd = hWnd;

                Sleep(200);
                AutoClickQtButton(hWnd);
            }
        }
    }

    return g_OriginalShowWindow(hWnd, nCmdShow);
}

typedef BOOL (WINAPI *SetWindowPos_t)(HWND, HWND, int, int, int, int, UINT);
static SetWindowPos_t g_OriginalSetWindowPos = NULL;

BOOL WINAPI HookedSetWindowPos(HWND hWnd, HWND hWndInsertAfter, int X, int Y, int cx, int cy, UINT uFlags) {
    if (hWnd) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "SetWindowPos Qt: HWND=%p class=%s pos=%d,%d size=%dx%d flags=0x%X",
                hWnd, className, X, Y, cx, cy, uFlags);
            WriteLog(buf);
        }
    }

    return g_OriginalSetWindowPos(hWnd, hWndInsertAfter, X, Y, cx, cy, uFlags);
}

typedef int (WINAPI *MessageBoxW_t)(HWND, LPCWSTR, LPCWSTR, UINT);
static MessageBoxW_t g_OriginalMessageBoxW = NULL;

int WINAPI HookedMessageBoxW(HWND hWnd, LPCWSTR lpText, LPCWSTR lpCaption, UINT uType) {
    if (lpText) {
        char text[512] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpText, -1, text, sizeof(text), NULL, NULL);
        char buf[512];
        sprintf(buf, "MessageBoxW: %s", text);
        WriteLog(buf);
    }
    return g_OriginalMessageBoxW(hWnd, lpText, lpCaption, uType);
}

typedef LRESULT (WINAPI *SendMessageW_t)(HWND, UINT, WPARAM, LPARAM);
static SendMessageW_t g_OriginalSendMessageW = NULL;

LRESULT WINAPI HookedSendMessageW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam) {
    if (hWnd && (Msg == WM_COMMAND || Msg == WM_LBUTTONDOWN || Msg == BM_CLICK)) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        if (strstr(className, "Qt5") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "SendMessageW Qt: HWND=%p msg=0x%X wParam=0x%I64X class=%s",
                hWnd, Msg, (UINT64)wParam, className);
            WriteLog(buf);
        }
    }

    return g_OriginalSendMessageW(hWnd, Msg, wParam, lParam);
}

typedef HWND (WINAPI *FindWindowExW_t)(HWND, HWND, LPCWSTR, LPCWSTR);
static FindWindowExW_t g_OriginalFindWindowExW = NULL;

HWND WINAPI HookedFindWindowExW(HWND hWndParent, HWND hWndChildAfter, LPCWSTR lpszClass, LPCWSTR lpszWindow) {
    HWND result = g_OriginalFindWindowExW(hWndParent, hWndChildAfter, lpszClass, lpszWindow);

    if (result && lpszClass) {
        char className[256] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpszClass, -1, className, sizeof(className), NULL, NULL);

        if (strstr(className, "Qt5") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "FindWindowExW Qt: class=%s result=%p", className, result);
            WriteLog(buf);
        }
    }

    return result;
}

typedef BOOL (WINAPI *EnumChildWindows_t)(HWND, WNDENUMPROC, LPARAM);
static EnumChildWindows_t g_OriginalEnumChildWindows = NULL;

BOOL WINAPI HookedEnumChildWindows(HWND hWndParent, WNDENUMPROC lpEnumFunc, LPARAM lParam) {
    if (hWndParent) {
        char buf[256];
        sprintf(buf, "EnumChildWindows: parent=%p", hWndParent);
        WriteLog(buf);
    }

    return g_OriginalEnumChildWindows(hWndParent, lpEnumFunc, lParam);
}

typedef BOOL (WINAPI *MoveWindow_t)(HWND, int, int, int, int, BOOL);
static MoveWindow_t g_OriginalMoveWindow = NULL;

BOOL WINAPI HookedMoveWindow(HWND hWnd, int X, int Y, int nWidth, int nHeight, BOOL bRepaint) {
    if (hWnd) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        if (strstr(className, "Qt5") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "MoveWindow Qt: HWND=%p size=%dx%d at (%d,%d) class=%s",
                hWnd, nWidth, nHeight, X, Y, className);
            WriteLog(buf);
        }
    }

    return g_OriginalMoveWindow(hWnd, X, Y, nWidth, nHeight, bRepaint);
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;

    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }

    MH_CreateHookApi(L"user32.dll", "CreateWindowExW", &HookedCreateWindowExW, (LPVOID*)&g_OriginalCreateWindowExW);
    MH_CreateHookApi(L"user32.dll", "ShowWindow", &HookedShowWindow, (LPVOID*)&g_OriginalShowWindow);
    MH_CreateHookApi(L"user32.dll", "SetWindowPos", &HookedSetWindowPos, (LPVOID*)&g_OriginalSetWindowPos);
    MH_CreateHookApi(L"user32.dll", "MessageBoxW", &HookedMessageBoxW, (LPVOID*)&g_OriginalMessageBoxW);
    MH_CreateHookApi(L"user32.dll", "SendMessageW", &HookedSendMessageW, (LPVOID*)&g_OriginalSendMessageW);
    MH_CreateHookApi(L"user32.dll", "FindWindowExW", &HookedFindWindowExW, (LPVOID*)&g_OriginalFindWindowExW);
    MH_CreateHookApi(L"user32.dll", "EnumChildWindows", &HookedEnumChildWindows, (LPVOID*)&g_OriginalEnumChildWindows);
    MH_CreateHookApi(L"user32.dll", "MoveWindow", &HookedMoveWindow, (LPVOID*)&g_OriginalMoveWindow);

    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }

    WriteLog("=============================================");
    WriteLog("Hooks installed v37 - Qt5 Camera Auto-Select");
    WriteLog("=============================================");
    WriteLog("Method: Mouse click simulation on Qt buttons");
    WriteLog("Target: Qt5156QWindow width 300-400");
    WriteLog("=============================================");

    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v37 - Qt5 Camera Auto-Select");
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
