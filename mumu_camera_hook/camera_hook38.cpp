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
static int g_ClickAttemptCount = 0;

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

void LogRect(HWND hwnd, const char* label) {
    if (!hwnd) return;
    RECT rect;
    GetWindowRect(hwnd, &rect);
    char className[256] = {0};
    GetClassNameA(hwnd, className, sizeof(className));
    char text[256] = {0};
    GetWindowTextA(hwnd, text, sizeof(text));
    char buf[512];
    sprintf(buf, "%s: HWND=%p class=%s text=%s rect=%dx%d at (%d,%d)",
        label, hwnd, className, text,
        rect.right - rect.left, rect.bottom - rect.top, rect.left, rect.top);
    WriteLog(buf);
}

BOOL CALLBACK EnumAllChildProc(HWND hwnd, LPARAM lParam) {
    LogRect(hwnd, "  Child");
    return TRUE;
}

void EnumAllChildren(HWND hwnd) {
    WriteLog("=== EnumAllChildren ===");
    EnumChildWindows(hwnd, EnumAllChildProc, 0);
}

void TryClickWithWM_COMMAND(HWND hButton) {
    if (!hButton) return;

    char buf[256];
    sprintf(buf, "Sending BM_CLICK to HWND=%p", hButton);
    WriteLog(buf);

    SendMessage(hButton, BM_CLICK, 0, 0);
    g_bCameraSelected = TRUE;
    sprintf(buf, "BM_CLICK sent successfully!");
    WriteLog(buf);
}

void TryClickWithMouse(HWND hButton) {
    if (!hButton) return;

    RECT rect;
    GetWindowRect(hButton, &rect);
    int cx = (rect.left + rect.right) / 2;
    int cy = (rect.top + rect.bottom) / 2;

    char buf[256];
    sprintf(buf, "Mouse click at (%d, %d)", cx, cy);
    WriteLog(buf);

    SetCursorPos(cx, cy);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    Sleep(50);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

    g_bCameraSelected = TRUE;
    WriteLog("Mouse click done!");
}

void AutoClickCameraButton(HWND hDialog) {
    if (g_bCameraSelected) {
        WriteLog("Already clicked, skipping...");
        return;
    }

    g_ClickAttemptCount++;
    char buf[256];
    sprintf(buf, "=== AUTO-CLICK ATTEMPT #%d ===", g_ClickAttemptCount);
    WriteLog(buf);

    LogRect(hDialog, "Dialog");
    EnumAllChildren(hDialog);

    HWND hChild = GetWindow(hDialog, GW_CHILD);
    int index = 0;
    HWND hCameraBtn = NULL;
    int cameraBtnIndex = -1;

    while (hChild) {
        char className[256] = {0};
        GetClassNameA(hChild, className, sizeof(className));

        char windowText[256] = {0};
        GetWindowTextA(hChild, windowText, sizeof(windowText));

        sprintf(buf, "  [%d] HWND=%p class=%s text=%s",
            index, hChild, className, windowText);
        WriteLog(buf);

        if (strstr(windowText, "camera") || strstr(windowText, "Camera") ||
            strstr(windowText, "\xB2\xE3\xCD\xB8") || strstr(windowText, "\xD3\xA2\xD3\xCE")) {
            hCameraBtn = hChild;
            cameraBtnIndex = index;
            sprintf(buf, "  *** CAMERA BUTTON FOUND at index %d ***", index);
            WriteLog(buf);
        }

        hChild = GetWindow(hChild, GW_HWNDNEXT);
        index++;
    }

    if (cameraBtnIndex >= 0 && hCameraBtn) {
        sprintf(buf, "Clicking button at index %d...", cameraBtnIndex);
        WriteLog(buf);

        TryClickWithWM_COMMAND(hCameraBtn);

        Sleep(100);
        TryClickWithMouse(hCameraBtn);
    } else {
        WriteLog("Camera button not found by text. Trying buttons...");

        hChild = GetWindow(hDialog, GW_CHILD);
        index = 0;
        while (hChild && index < 5) {
            char className[256] = {0};
            GetClassNameA(hChild, className, sizeof(className));

            if (strstr(className, "Button") || strstr(className, "QPushButton")) {
                sprintf(buf, "Found button at index %d, clicking...", index);
                WriteLog(buf);

                TryClickWithWM_COMMAND(hChild);
                Sleep(100);
                TryClickWithMouse(hChild);
                break;
            }

            hChild = GetWindow(hChild, GW_HWNDNEXT);
            index++;
        }

        if (!g_bCameraSelected && index >= 5) {
            WriteLog("No buttons found, trying to close dialog with IDOK...");

            HWND hOkBtn = FindWindowExW(hDialog, NULL, NULL, L"OK");
            if (hOkBtn) {
                TryClickWithWM_COMMAND(hOkBtn);
            } else {
                hOkBtn = FindWindowExW(hDialog, NULL, NULL, L"\x786E\x5B9A");
            }
            if (hOkBtn) {
                TryClickWithWM_COMMAND(hOkBtn);
            }
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
            sprintf(buf, "CreateWindowExW Qt: class=%s size=%dx%d HWND=%p",
                className, nWidth, nHeight, result);
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

            if (nCmdShow == SW_SHOW && width >= 300 && width <= 450 && height <= 300) {
                sprintf(buf, "*** CAMERA DIALOG DETECTED! width=%d height=%d ***", width, height);
                WriteLog(buf);
                g_CameraDialogHwnd = hWnd;

                Sleep(300);
                AutoClickCameraButton(hWnd);
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
    sprintf(buf, "DialogBoxParamW called");
    WriteLog(buf);

    int result = g_OriginalDialogBoxParamW(hInstance, lpTemplateName, hWndParent, lpDialogFunc, dwInitParam);

    sprintf(buf, "DialogBoxParamW returned: %d", result);
    WriteLog(buf);

    return result;
}

typedef BOOL (WINAPI *SetWindowPos_t)(HWND, HWND, int, int, int, int, UINT);
static SetWindowPos_t g_OriginalSetWindowPos = NULL;

BOOL WINAPI HookedSetWindowPos(HWND hWnd, HWND hWndInsertAfter, int X, int Y, int cx, int cy, UINT uFlags) {
    if (hWnd) {
        char className[256] = {0};
        GetClassNameA(hWnd, className, sizeof(className));

        if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWindow")) {
            char buf[512];
            sprintf(buf, "SetWindowPos Qt: HWND=%p size=%dx%d at (%d,%d)",
                hWnd, cx, cy, X, Y);
            WriteLog(buf);

            if (g_CameraDialogHwnd == NULL && cx >= 300 && cx <= 450 && cy <= 300) {
                g_CameraDialogHwnd = hWnd;
                WriteLog("*** Camera dialog set via SetWindowPos ***");

                Sleep(300);
                AutoClickCameraButton(hWnd);
            }
        }
    }

    return g_OriginalSetWindowPos(hWnd, hWndInsertAfter, X, Y, cx, cy, uFlags);
}

typedef LRESULT (WINAPI *SendMessageW_t)(HWND, UINT, WPARAM, LPARAM);
static SendMessageW_t g_OriginalSendMessageW = NULL;

LRESULT WINAPI HookedSendMessageW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam) {
    if (hWnd && Msg == WM_COMMAND) {
        char buf[512];
        sprintf(buf, "SendMessageW WM_COMMAND: HWND=%p wParam=0x%I64X", hWnd, (UINT64)wParam);
        WriteLog(buf);
    }

    return g_OriginalSendMessageW(hWnd, Msg, wParam, lParam);
}

typedef HWND (WINAPI *FindWindowExW_t)(HWND, HWND, LPCWSTR, LPCWSTR);
static FindWindowExW_t g_OriginalFindWindowExW = NULL;

HWND WINAPI HookedFindWindowExW(HWND hWndParent, HWND hWndChildAfter, LPCWSTR lpszClass, LPCWSTR lpszWindow) {
    HWND result = g_OriginalFindWindowExW(hWndParent, hWndChildAfter, lpszClass, lpszWindow);

    if (result) {
        char buf[512];
        sprintf(buf, "FindWindowExW result=%p parent=%p", result, hWndParent);
        WriteLog(buf);
    }

    return result;
}

typedef HWND (WINAPI *FindWindowW_t)(LPCWSTR, LPCWSTR);
static FindWindowW_t g_OriginalFindWindowW = NULL;

HWND WINAPI HookedFindWindowW(LPCWSTR lpClassName, LPCWSTR lpWindowName) {
    HWND result = g_OriginalFindWindowW(lpClassName, lpWindowName);

    if (result) {
        char buf[256];
        sprintf(buf, "FindWindowW result=%p", result);
        WriteLog(buf);
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
            sprintf(buf, "MoveWindow Qt: HWND=%p size=%dx%d", hWnd, nWidth, nHeight);
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
    MH_CreateHookApi(L"user32.dll", "DialogBoxParamW", &HookedDialogBoxParamW, (LPVOID*)&g_OriginalDialogBoxParamW);
    MH_CreateHookApi(L"user32.dll", "SendMessageW", &HookedSendMessageW, (LPVOID*)&g_OriginalSendMessageW);
    MH_CreateHookApi(L"user32.dll", "FindWindowExW", &HookedFindWindowExW, (LPVOID*)&g_OriginalFindWindowExW);
    MH_CreateHookApi(L"user32.dll", "FindWindowW", &HookedFindWindowW, (LPVOID*)&g_OriginalFindWindowW);
    MH_CreateHookApi(L"user32.dll", "EnumChildWindows", &HookedEnumChildWindows, (LPVOID*)&g_OriginalEnumChildWindows);
    MH_CreateHookApi(L"user32.dll", "MoveWindow", &HookedMoveWindow, (LPVOID*)&g_OriginalMoveWindow);

    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }

    WriteLog("=============================================");
    WriteLog("Hooks installed v38 - Qt5 Camera Auto-Select");
    WriteLog("=============================================");
    WriteLog("Method: BM_CLICK + Mouse simulation");
    WriteLog("Target: Qt5156QWindow width 300-450");
    WriteLog("=============================================");

    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v38 - Qt5 Camera Auto-Select");
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
