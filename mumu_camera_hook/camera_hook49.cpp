#include <windows.h>
#include <stdio.h>

#pragma comment(lib, "user32.lib")

static volatile LONG g_CameraSelected = 0;
static volatile LONG g_CameraCompleted = 0;
static volatile LONG g_LastClickTime = 0;
static HWND g_LastCameraHWND = NULL;

#define CAMERA_DLG_WIDTH 336
#define CAMERA_DLG_HEIGHT 316
#define CHECK_INTERVAL 500

#define PIPE_NAME "\\\\.\\pipe\\MuMuCameraHook"

static HANDLE g_hPipe = INVALID_HANDLE_VALUE;

void NotifyCameraCompleted() {
    InterlockedExchange(&g_CameraCompleted, 1);

    if (g_hPipe != INVALID_HANDLE_VALUE) {
        DWORD written;
        WriteFile(g_hPipe, "CAMERA_OK", 9, &written, NULL);
    }
}

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
                if (!g_CameraSelected || (now - g_LastClickTime) > 5000) {
                    RECT r;
                    GetWindowRect(hwnd, &r);
                    int clientX = (r.right - r.left) / 2;
                    int clientY = (r.bottom - r.top) / 2;

                    LONG lParamCoord = MAKELPARAM(clientX, clientY);
                    PostMessage(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, lParamCoord);
                    Sleep(100);
                    PostMessage(hwnd, WM_LBUTTONUP, 0, lParamCoord);

                    InterlockedExchange(&g_CameraSelected, 1);
                    InterlockedExchange(&g_LastClickTime, GetTickCount());
                    g_LastCameraHWND = hwnd;

                    NotifyCameraCompleted();
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
    while (TRUE) {
        HANDLE hPipe = CreateNamedPipeA(
            PIPE_NAME,
            PIPE_ACCESS_OUTBOUND,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            1,
            4096, 4096,
            0,
            NULL
        );

        if (hPipe == INVALID_HANDLE_VALUE) {
            Sleep(1000);
            continue;
        }

        if (ConnectNamedPipe(hPipe, NULL)) {
            g_hPipe = hPipe;
        } else {
            CloseHandle(hPipe);
            hPipe = INVALID_HANDLE_VALUE;
        }
    }
    return 0;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        CreateThread(NULL, 0, CheckCameraDialogThread, NULL, 0, NULL);
        CreateThread(NULL, 0, PipeServerThread, NULL, 0, NULL);
    }
    return TRUE;
}

extern "C" __declspec(dllexport) BOOL GetCameraCompleted() {
    return g_CameraCompleted;
}

extern "C" __declspec(dllexport) void ResetCameraCompleted() {
    InterlockedExchange(&g_CameraCompleted, 0);
}

extern "C" __declspec(dllexport) void Dummy() {
}
