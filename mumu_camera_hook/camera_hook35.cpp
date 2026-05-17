#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "hid.lib")
#pragma comment(lib, "libMinHook-x64-v141-md.lib")

static char g_LogPath[MAX_PATH] = {0};
static char g_FramePath[MAX_PATH] = {0};
static int g_FrameCount = 0;
static BOOL g_bHooksInstalled = FALSE;
static HANDLE g_CameraHandle = NULL;
static BYTE g_LargeBuffer[1024 * 1024];

void InitPaths() {
    if (g_LogPath[0] == 0) {
        strcpy(g_LogPath, "D:\\mumu_camera_hook.log");
        strcpy(g_FramePath, "D:\\mumu_frames_v2");
        CreateDirectoryA(g_FramePath, NULL);
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

void SaveHexLog(const char* title, BYTE* data, DWORD len) {
    char buf[8192] = {0};
    sprintf(buf, "%s (len=%lu):", title, len);
    int offset = strlen(buf);
    for (DWORD i = 0; i < len && i < 256; i++) {
        if (i % 16 == 0) {
            sprintf(buf + offset, "\n  %04X: ", i);
            offset = strlen(buf);
        }
        sprintf(buf + offset, "%02X ", data[i]);
        offset = strlen(buf);
    }
    WriteLog(buf);
}

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer,
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned,
    LPOVERLAPPED lpOverlapped) {

    static int callCount = 0;

    if (dwIoControlCode == 0x002F0410) {
        callCount++;

        if (g_CameraHandle == NULL) {
            g_CameraHandle = hDevice;
            char buf[256];
            sprintf(buf, "CAMERA HANDLE: %p first IOCTL=0x002F0410", hDevice);
            WriteLog(buf);
        }

        BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize,
            lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);

        if (result && lpBytesReturned && *lpBytesReturned > 0) {
            BYTE* data = (BYTE*)lpOutBuffer;
            DWORD size = *lpBytesReturned;

            if (g_FrameCount < 100) {
                if (callCount <= 5 || callCount % 100 == 1) {
                    char buf[512];
                    sprintf(buf, "IOCTL #%d: Handle=%p Size=%lu", callCount, hDevice, size);
                    WriteLog(buf);
                    SaveHexLog("First call data", data, size);
                }

                if (data[0] == 0xC0 && data[1] == 0x01) {
                    char frameFile[MAX_PATH];
                    SYSTEMTIME st;
                    GetLocalTime(&st);
                    sprintf(frameFile, "%s\\frame_%03d_%02d%02d%02d_%03lu.raw",
                        g_FramePath, g_FrameCount++, st.wHour, st.wMinute, st.wSecond, size);

                    FILE* fp = fopen(frameFile, "wb");
                    if (fp) {
                        fwrite(data, 1, size, fp);
                        fclose(fp);

                        char buf[256];
                        sprintf(buf, "SAVED #%d: %lu bytes -> %s", g_FrameCount, size, frameFile);
                        WriteLog(buf);
                    }
                }
            }

            if (callCount == 1 || callCount == 2) {
                char buf[512];
                sprintf(buf, "=== IOCTL #%d RETURNED %lu BYTES ===", callCount, size);
                WriteLog(buf);
                SaveHexLog("Full data", data, size);

                for (DWORD i = 0; i < size - 4; i++) {
                    if (data[i] == 'N' && data[i+1] == 'V' && data[i+2] == '1' && data[i+3] == '2') {
                        sprintf(buf, "NV12 at offset %lu (0x%lX)", i, i);
                        WriteLog(buf);
                    }
                }
            }
        }

        return result;
    }

    return g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize,
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
}

typedef HANDLE (WINAPI *CreateFileW_t)(LPCWSTR, DWORD, DWORD, LPSECURITY_ATTRIBUTES, DWORD, DWORD, HANDLE);
static CreateFileW_t g_OriginalCreateFileW = NULL;

HANDLE WINAPI HookedCreateFileW(LPCWSTR lpFileName, DWORD dwDesiredAccess, DWORD dwShareMode,
    LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition,
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {

    HANDLE result = g_OriginalCreateFileW(lpFileName, dwDesiredAccess, dwShareMode,
        lpSecurityAttributes, dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);

    if (result != INVALID_HANDLE_VALUE && lpFileName) {
        char path[MAX_PATH * 2] = {0};
        WideCharToMultiByte(CP_ACP, 0, lpFileName, -1, path, sizeof(path), NULL, NULL);

        if (strstr(path, "USB") || strstr(path, "HID") || strstr(path, "VID")) {
            char buf[512];
            sprintf(buf, "CreateFileW: %s -> %p", path, result);
            WriteLog(buf);
        }
    }

    return result;
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;

    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }

    MH_CreateHookApi(L"kernel32.dll", "DeviceIoControl", &HookedDeviceIoControl, (LPVOID*)&g_OriginalDeviceIoControl);
    MH_CreateHookApi(L"kernel32.dll", "CreateFileW", &HookedCreateFileW, (LPVOID*)&g_OriginalCreateFileW);

    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }

    WriteLog("=============================================");
    WriteLog("Hooks installed v35 - Detailed Analysis");
    WriteLog("=============================================");

    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v35 - Detailed Analysis");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }

        char buf[512];
        sprintf(buf, "=============================================\nFrames saved: %d\nCamera Handle: %p\n=============================================",
            g_FrameCount, g_CameraHandle);
        WriteLog(buf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
