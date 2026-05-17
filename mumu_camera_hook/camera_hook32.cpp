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

void InitPaths() {
    if (g_LogPath[0] == 0) {
        strcpy(g_LogPath, "D:\\mumu_camera_hook.log");
        strcpy(g_FramePath, "D:\\mumu_frames");
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

void DumpHex(const BYTE* data, size_t len, char* buf, size_t bufSize) {
    size_t pos = 0;
    size_t limit = min(len, 64);
    for (size_t i = 0; i < limit && pos < bufSize - 4; i++) {
        pos += sprintf(buf + pos, "%02X ", data[i]);
    }
    if (len > limit) {
        sprintf(buf + pos, "... [%zu more]", len - limit);
    }
}

static int g_DeviceIoControl_Count = 0;

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    g_DeviceIoControl_Count++;
    
    BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
    
    if (result && lpOutBuffer && lpBytesReturned && *lpBytesReturned > 0) {
        if (dwIoControlCode == 0x002F0410 && *lpBytesReturned >= 16) {
            BYTE* data = (BYTE*)lpOutBuffer;
            
            if (g_CameraHandle == NULL) {
                g_CameraHandle = hDevice;
                char logBuf[256];
                sprintf(logBuf, "CAMERA FOUND! Handle=%p Size=%lu", hDevice, *lpBytesReturned);
                WriteLog(logBuf);
            }
            
            if (hDevice == g_CameraHandle && g_FrameCount < 100) {
                SYSTEMTIME st;
                GetLocalTime(&st);
                
                char frameFile[MAX_PATH];
                sprintf(frameFile, "%s\\frame_%03d_%02d%02d%02d_%03d.raw", 
                    g_FramePath, g_FrameCount, st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
                
                FILE* fp = fopen(frameFile, "wb");
                if (fp) {
                    fwrite(data, 1, *lpBytesReturned, fp);
                    fclose(fp);
                    
                    char logBuf[512];
                    sprintf(logBuf, "FRAME #%d: Handle=%p Size=%lu [%02X %02X %02X %02X %02X %02X %02X %02X...]",
                        ++g_FrameCount, hDevice, *lpBytesReturned,
                        data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]);
                    WriteLog(logBuf);
                }
            }
        }
        
        if (dwIoControlCode == 0x00470813 && *lpBytesReturned > 0) {
            BYTE* data = (BYTE*)lpOutBuffer;
            if (data[0] == 0x14 && data[4] == 0x00) {
                int dataLen = 0;
                if (*lpBytesReturned >= 8) {
                    dataLen = data[7];
                }
                
                char logBuf[1024];
                sprintf(logBuf, "USB Desc #%d: Handle=%p Len=%d", 
                    g_DeviceIoControl_Count, hDevice, *lpBytesReturned);
                WriteLog(logBuf);
                
                if (*lpBytesReturned > 8) {
                    char hexBuf[256] = {0};
                    int copyLen = min(*lpBytesReturned - 8, 100);
                    DumpHex(data + 8, copyLen, hexBuf, sizeof(hexBuf));
                    sprintf(logBuf, "  Data: %s", hexBuf);
                    WriteLog(logBuf);
                    
                    for (int i = 8; i < *lpBytesReturned - 1; i++) {
                        if (data[i] >= 0x20 && data[i] < 0x7F && data[i+1] >= 0x20 && data[i+1] < 0x7F) {
                            int start = i;
                            char strBuf[256] = {0};
                            int j = 0;
                            while (i < *lpBytesReturned && j < 250) {
                                if (data[i] >= 0x20 && data[i] < 0x7F) {
                                    strBuf[j++] = data[i];
                                    i++;
                                } else {
                                    break;
                                }
                            }
                            if (j > 4) {
                                sprintf(logBuf, "  String[%d]: %s", start, strBuf);
                                WriteLog(logBuf);
                            }
                            i--;
                        }
                    }
                }
            }
        }
    }
    
    if (g_DeviceIoControl_Count <= 100) {
        char logBuf[256];
        sprintf(logBuf, "DeviceIoControl #%d: Handle=%p IOCTL=0x%08lX InSize=%lu OutSize=%lu %s",
                g_DeviceIoControl_Count, hDevice, dwIoControlCode, nInBufferSize, nOutBufferSize,
                result ? "OK" : "FAIL");
        WriteLog(logBuf);
    }
    
    return result;
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
        
        if (strstr(path, "USB") || strstr(path, "HID") || strstr(path, "hid")) {
            char logBuf[512];
            sprintf(logBuf, "CreateFileW: Path='%s' Handle=%p Access=0x%08lX", 
                    path, result, dwDesiredAccess);
            WriteLog(logBuf);
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
    WriteLog("Hooks installed v32 - Frame Capture");
    WriteLog("  - DeviceIoControl (IOCTL 0x002F0410)");
    WriteLog("  - CreateFileW (USB/HID devices)");
    WriteLog("=============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v32 - Frame Capture Mode");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[512];
        sprintf(logBuf, "=============================================\nStats:\n  DeviceIoControl=%d\n  FramesCaptured=%d\n  CameraHandle=%p\n=============================================",
            g_DeviceIoControl_Count, g_FrameCount, g_CameraHandle);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}