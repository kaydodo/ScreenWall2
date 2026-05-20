#include <windows.h>
#include <stdio.h>

#pragma comment(lib, "user32.lib")

static BOOL g_bCameraSelected = FALSE;
static DWORD g_LastClickTime = 0;
static HWND g_LastCameraHWND = NULL;
static volatile LONG g_CameraCompleted = 0;
static HANDLE g_hCameraClickedEvent = NULL;  // 点击完成通知事件
static DWORD g_ClickTimestamp = 0;  // 点击完成时的时间戳

#define CAMERA_DLG_WIDTH 336
#define CAMERA_DLG_HEIGHT 316
#define CHECK_INTERVAL 500
#define PIPE_NAME "\\\\.\\pipe\\MuMuCameraHook"
#define NOTIFY_PIPE_NAME "\\\\.\\pipe\\MuMuCameraNotify"  // 主动通知管道

BOOL CALLBACK EnumWindowsProc(HWND hwnd, LPARAM lParam) {
    char className[256] = {0};
    GetClassNameA(hwnd, className, sizeof(className));

    if (strstr(className, "Qt5") || strstr(className, "Qt6") || strstr(className, "QWindow")) {
        RECT rect;
        GetWindowRect(hwnd, &rect);
        int width = rect.right - rect.left;
        int height = rect.bottom - rect.top;

        if (width == CAMERA_DLG_WIDTH && height == CAMERA_DLG_HEIGHT) {
            DWORD now = GetTickCount();

            if (hwnd != g_LastCameraHWND) {
                if (!g_bCameraSelected || (now - g_LastClickTime) > 5000) {
                    RECT r;
                    GetWindowRect(hwnd, &r);
                    int clientX = (r.right - r.left) / 2;
                    int clientY = (r.bottom - r.top) / 2;

                    LONG lParamCoord = MAKELPARAM(clientX, clientY);
                    PostMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lParamCoord);
                    Sleep(100);
                    PostMessage(hwnd, WM_LBUTTONUP, 0, lParamCoord);

                    g_bCameraSelected = TRUE;
                    g_LastClickTime = GetTickCount();
                    g_LastCameraHWND = hwnd;
                    g_ClickTimestamp = (DWORD)GetTickCount64();
                    InterlockedExchange(&g_CameraCompleted, 1);
                    
                    // 触发事件通知
                    if (g_hCameraClickedEvent) {
                        SetEvent(g_hCameraClickedEvent);
                    }
                }
            }
        }
    }

    return TRUE;
}

DWORD WINAPI CheckCameraDialogThread(LPVOID lpParam) {
    while (TRUE) {
        EnumWindows(EnumWindowsProc, 0);
        Sleep(CHECK_INTERVAL);
    }
    return 0;
}

DWORD WINAPI NotifyPipeServerThread(LPVOID lpParam) {
    HANDLE hPipe = INVALID_HANDLE_VALUE;
    char buffer[256] = {0};
    DWORD bytesWritten = 0;

    while (TRUE) {
        hPipe = CreateNamedPipeA(NOTIFY_PIPE_NAME,
            PIPE_ACCESS_OUTBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1, 256, 256, 0, NULL);

        if (hPipe == INVALID_HANDLE_VALUE) {
            Sleep(1000);
            continue;
        }

        if (!ConnectNamedPipe(hPipe, NULL) && GetLastError() != ERROR_PIPE_CONNECTED) {
            CloseHandle(hPipe);
            Sleep(1000);
            continue;
        }

        // 等待点击事件
        if (WaitForSingleObject(g_hCameraClickedEvent, INFINITE) == WAIT_OBJECT_0) {
            char notifyMsg[256] = {0};
            sprintf(notifyMsg, "CLICKED:%lu", g_ClickTimestamp);
            WriteFile(hPipe, notifyMsg, (DWORD)strlen(notifyMsg), &bytesWritten, NULL);
            ResetEvent(g_hCameraClickedEvent);
        }

        DisconnectNamedPipe(hPipe);
        CloseHandle(hPipe);
    }
    return 0;
}

DWORD WINAPI PipeServerThread(LPVOID lpParam) {
    HANDLE hPipe = INVALID_HANDLE_VALUE;
    char buffer[128] = {0};
    DWORD bytesRead = 0;
    DWORD bytesWritten = 0;

    while (TRUE) {
        hPipe = CreateNamedPipeA(PIPE_NAME,
            PIPE_ACCESS_DUPLEX,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1, 128, 128, 0, NULL);

        if (hPipe == INVALID_HANDLE_VALUE) {
            Sleep(1000);
            continue;
        }

        if (!ConnectNamedPipe(hPipe, NULL) && GetLastError() != ERROR_PIPE_CONNECTED) {
            CloseHandle(hPipe);
            Sleep(1000);
            continue;
        }

        if (ReadFile(hPipe, buffer, 128, &bytesRead, NULL)) {
            if (strncmp(buffer, "GET_STATUS", 10) == 0) {
                char response[32] = {0};
                sprintf(response, "STATUS:%d", (int)g_CameraCompleted);
                WriteFile(hPipe, response, (DWORD)strlen(response), &bytesWritten, NULL);
            } else if (strncmp(buffer, "RESET_STATUS", 13) == 0) {
                InterlockedExchange(&g_CameraCompleted, 0);
                g_bCameraSelected = FALSE;
                g_LastCameraHWND = NULL;
                WriteFile(hPipe, "RESET_OK", 8, &bytesWritten, NULL);
            }
        }

        DisconnectNamedPipe(hPipe);
        CloseHandle(hPipe);
    }
    return 0;
}

extern "C" __declspec(dllexport) int GetCameraCompleted() {
    return (int)InterlockedCompareExchange(&g_CameraCompleted, 0, 0);
}

extern "C" __declspec(dllexport) void ResetCameraCompleted() {
    InterlockedExchange(&g_CameraCompleted, 0);
    g_bCameraSelected = FALSE;
    g_LastCameraHWND = NULL;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPARAM reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        // 创建事件对象
        g_hCameraClickedEvent = CreateEventA(NULL, TRUE, FALSE, "MuMuCameraClickedEvent");
        CreateThread(NULL, 0, CheckCameraDialogThread, NULL, 0, NULL);
        CreateThread(NULL, 0, PipeServerThread, NULL, 0, NULL);
        CreateThread(NULL, 0, NotifyPipeServerThread, NULL, 0, NULL);
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_hCameraClickedEvent) {
            CloseHandle(g_hCameraClickedEvent);
            g_hCameraClickedEvent = NULL;
        }
    }
    return TRUE;
}
