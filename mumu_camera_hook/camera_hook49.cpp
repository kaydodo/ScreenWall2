#include <windows.h>
#include <stdio.h>

#pragma comment(lib, "user32.lib")

static BOOL g_bCameraSelected = FALSE;
static DWORD g_LastClickTime = 0;
static HWND g_LastCameraHWND = NULL;
static volatile LONG g_CameraCompleted = 0;

#define CAMERA_DLG_WIDTH 336
#define CAMERA_DLG_HEIGHT 316
#define CHECK_INTERVAL 500
#define PIPE_NAME "\\\\.\\pipe\\MuMuCameraHook"

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
                    InterlockedExchange(&g_CameraCompleted, 1);
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

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        CreateThread(NULL, 0, CheckCameraDialogThread, NULL, 0, NULL);
        CreateThread(NULL, 0, PipeServerThread, NULL, 0, NULL);
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {}
