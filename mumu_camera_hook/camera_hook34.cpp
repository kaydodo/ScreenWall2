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

typedef BOOL (WINAPI *DeviceIoControl_t)(HANDLE, DWORD, LPVOID, DWORD, LPVOID, DWORD, LPDWORD, LPOVERLAPPED);
static DeviceIoControl_t g_OriginalDeviceIoControl = NULL;

BOOL WINAPI HookedDeviceIoControl(HANDLE hDevice, DWORD dwIoControlCode, LPVOID lpInBuffer, 
    DWORD nInBufferSize, LPVOID lpOutBuffer, DWORD nOutBufferSize, LPDWORD lpBytesReturned, 
    LPOVERLAPPED lpOverlapped) {
    
    static int callCount = 0;
    
    BOOL result = g_OriginalDeviceIoControl(hDevice, dwIoControlCode, lpInBuffer, nInBufferSize, 
        lpOutBuffer, nOutBufferSize, lpBytesReturned, lpOverlapped);
    
    callCount++;
    
    if (result && lpOutBuffer && lpBytesReturned && *lpBytesReturned > 0) {
        BYTE* data = (BYTE*)lpOutBuffer;
        
        if (dwIoControlCode == 0x002F0410) {
            if (g_CameraHandle == NULL) {
                g_CameraHandle = hDevice;
                char logBuf[256];
                sprintf(logBuf, "CAMERA HANDLE FOUND: %p Size=%lu", hDevice, *lpBytesReturned);
                WriteLog(logBuf);
                
                sprintf(logBuf, "First bytes: %02X %02X %02X %02X %02X %02X %02X %02X",
                    data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]);
                WriteLog(logBuf);
                
                if (data[0] == 0xC0 && data[1] == 0x01) {
                    WriteLog("Frame header signature: C0 01 - Valid frame start");
                }
            }
            
            if (callCount <= 20 || (callCount % 100 == 0)) {
                char logBuf[512];
                sprintf(logBuf, "IOCTL_0x002F0410 #%d: Handle=%p Size=%lu", 
                    callCount, hDevice, *lpBytesReturned);
                WriteLog(logBuf);
            }
            
            if (hDevice == g_CameraHandle && g_FrameCount < 200) {
                if (data[0] == 0xC0 && data[1] == 0x01) {
                    SYSTEMTIME st;
                    GetLocalTime(&st);
                    
                    char frameFile[MAX_PATH];
                    sprintf(frameFile, "%s\\frame_%03d_%02d%02d%02d_%03d_%lu.raw", 
                        g_FramePath, g_FrameCount, st.wHour, st.wMinute, st.wSecond, 
                        st.wMilliseconds, *lpBytesReturned);
                    
                    FILE* fp = fopen(frameFile, "wb");
                    if (fp) {
                        fwrite(data, 1, *lpBytesReturned, fp);
                        fclose(fp);
                        
                        char logBuf[512];
                        sprintf(logBuf, "FRAME SAVED #%d: %lu bytes", 
                            ++g_FrameCount, *lpBytesReturned);
                        WriteLog(logBuf);
                        
                        if (g_FrameCount % 20 == 0) {
                            char hexBuf[128] = {0};
                            for (int i = 0; i < 64 && i < (int)*lpBytesReturned; i++) {
                                sprintf(hexBuf + strlen(hexBuf), "%02X ", data[i]);
                            }
                            sprintf(logBuf, "  Data: %s", hexBuf);
                            WriteLog(logBuf);
                            
                            char* nv12 = strstr((char*)data, "NV12");
                            if (nv12) {
                                sprintf(logBuf, "  NV12 FORMAT DETECTED at offset %d!", nv12 - (char*)data);
                                WriteLog(logBuf);
                            }
                        }
                    }
                }
            }
        }
        
        if (dwIoControlCode == 0x00470813 && *lpBytesReturned > 20) {
            if (data[0] == 0x14 && data[4] == 0x00) {
                for (int i = 8; i < (int)*lpBytesReturned - 1; i++) {
                    if (data[i] >= 0x20 && data[i] < 0x7F && data[i+1] >= 0x20 && data[i+1] < 0x7F) {
                        char strBuf[256] = {0};
                        int j = 0;
                        int start = i;
                        while (i < (int)*lpBytesReturned && j < 250) {
                            if (data[i] >= 0x20 && data[i] < 0x7F) {
                                strBuf[j++] = data[i];
                                i++;
                            } else {
                                break;
                            }
                        }
                        if (j > 8) {
                            char logBuf[512];
                            sprintf(logBuf, "USB String [%d]: %s", start, strBuf);
                            WriteLog(logBuf);
                        }
                        i--;
                    }
                }
            }
        }
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
        
        if (strstr(path, "USB") || strstr(path, "HID") || strstr(path, "hid") || 
            strstr(path, "VID") || strstr(path, "13D3") || strstr(path, "5415")) {
            char logBuf[512];
            sprintf(logBuf, "CreateFileW: %s Handle=%p", path, result);
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
    WriteLog("Hooks installed v34 - Capture All Frames");
    WriteLog("  DeviceIoControl (0x002F0410)");
    WriteLog("  CreateFileW (USB/HID)");
    WriteLog("=============================================");
    
    g_bHooksInstalled = TRUE;
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("=============================================");
        WriteLog("DLL loaded v34 - Capture All Frames");
        WriteLog("=============================================");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        char logBuf[512];
        sprintf(logBuf, "=============================================\nFrames Captured: %d\nCamera Handle: %p\n=============================================",
            g_FrameCount, g_CameraHandle);
        WriteLog(logBuf);
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
