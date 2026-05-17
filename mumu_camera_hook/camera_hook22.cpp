#include <windows.h>
#include <stdio.h>
#include <string.h>
#include "MinHook.h"
#include <objbase.h>
#include <initguid.h>
#include <dshow.h>
#include <strmif.h>
#include <aviriff.h>

#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "libMinHook-x64-v141-md.lib")

static char g_LogPath[MAX_PATH] = {0};
static BOOL g_bHooksInstalled = FALSE;

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
        fprintf(f, "[%02d:%02d:%02d] %s\n", st.wHour, st.wMinute, st.wSecond, msg);
        fclose(f);
    }
}

void GuidToString(REFGUID guid, char* buf, size_t bufSize) {
    sprintf(buf, "{%08lX-%04X-%04X-%02X%02X-%02X%02X%02X%02X%02X%02X}",
        guid.Data1, guid.Data2, guid.Data3,
        guid.Data4[0], guid.Data4[1], guid.Data4[2], guid.Data4[3],
        guid.Data4[4], guid.Data4[5], guid.Data4[6], guid.Data4[7]);
}

void DumpMediaType(const AM_MEDIA_TYPE* pmt, char* buf, size_t bufSize) {
    if (!pmt || !buf) {
        if (buf) strcpy(buf, "NULL");
        return;
    }
    
    if (pmt->majortype == GUID_NULL) {
        sprintf(buf, "NULL");
        return;
    }
    
    char majorType[64] = {0};
    char subType[64] = {0};
    
    if (pmt->majortype == MEDIATYPE_Video) {
        strcpy(majorType, "Video");
    } else {
        GuidToString(pmt->majortype, majorType, sizeof(majorType));
    }
    
    if (pmt->subtype == MEDIASUBTYPE_RGB24) {
        strcpy(subType, "RGB24");
    } else if (pmt->subtype == MEDIASUBTYPE_RGB32) {
        strcpy(subType, "RGB32");
    } else if (pmt->subtype == MEDIASUBTYPE_RGB565) {
        strcpy(subType, "RGB565");
    } else if (pmt->subtype == MEDIASUBTYPE_RGB555) {
        strcpy(subType, "RGB555");
    } else if (pmt->subtype == MEDIASUBTYPE_YUY2) {
        strcpy(subType, "YUY2");
    } else if (pmt->subtype == MEDIASUBTYPE_UYVY) {
        strcpy(subType, "UYVY");
    } else if (pmt->subtype == MEDIASUBTYPE_MJPG) {
        strcpy(subType, "MJPG");
    } else if (pmt->subtype == MEDIASUBTYPE_I420) {
        strcpy(subType, "I420");
    } else if (pmt->subtype == MEDIASUBTYPE_IYUV) {
        strcpy(subType, "IYUV");
    } else if (pmt->subtype == GUID_NULL) {
        strcpy(subType, "ANY");
    } else {
        GuidToString(pmt->subtype, subType, sizeof(subType));
    }
    
    if (pmt->pbFormat && pmt->formattype == FORMAT_VideoInfo) {
        VIDEOINFOHEADER* pVih = (VIDEOINFOHEADER*)pmt->pbFormat;
        sprintf(buf, "%s/%s %dx%d", majorType, subType, 
                pVih->bmiHeader.biWidth, pVih->bmiHeader.biHeight);
    } else if (pmt->pbFormat && pmt->formattype == FORMAT_VideoInfo2) {
        VIDEOINFOHEADER2* pVih2 = (VIDEOINFOHEADER2*)pmt->pbFormat;
        sprintf(buf, "%s/%s %dx%d", majorType, subType, 
                pVih2->bmiHeader.biWidth, pVih2->bmiHeader.biHeight);
    } else {
        sprintf(buf, "%s/%s", majorType, subType);
    }
}

typedef HRESULT (WINAPI *CoCreateInstance_t)(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv);
static CoCreateInstance_t g_OriginalCoCreateInstance = NULL;

typedef int (WINAPI *lstrcmpW_t)(LPCWSTR, LPCWSTR);
static lstrcmpW_t g_OriginallstrcmpW = NULL;

static int g_CoCreateCallCount = 0;
static int g_USBCompareCount = 0;
static int g_ReceiveCallCount = 0;
static int g_FilterCallCount = 0;

static BOOL g_bCameraFilterCreated = FALSE;

static PVOID g_pCaptureFilter = NULL;
static PVOID g_pCapturePin = NULL;
static char g_CaptureMediaType[256] = {0};

BOOL ShouldLogCoCreate(REFCLSID rclsid) {
    char clsidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    
    if (strstr(clsidStr, "88753B26") || 
        strstr(clsidStr, "C6E133") ||
        strstr(clsidStr, "9FC8E510") ||
        strstr(clsidStr, "00000323")) {
        return TRUE;
    }
    return FALSE;
}

BOOL ShouldLogUSBPath(const char* str) {
    if (!str) return FALSE;
    
    if (strstr(str, "vid_048d") && strstr(str, "pid_c100")) {
        return TRUE;
    }
    if (strstr(str, "vid_") && strstr(str, "pid_")) {
        if (strlen(str) < 200) return TRUE;
    }
    return FALSE;
}

int WINAPI HookedlstrcmpW(LPCWSTR lpString1, LPCWSTR lpString2) {
    if (g_USBCompareCount++ < 500) {
        if (lpString1 && lpString2) {
            char s1[512] = {0};
            char s2[512] = {0};
            WideCharToMultiByte(CP_ACP, 0, lpString1, -1, s1, sizeof(s1), NULL, NULL);
            WideCharToMultiByte(CP_ACP, 0, lpString2, -1, s2, sizeof(s2), NULL, NULL);
            
            if (ShouldLogUSBPath(s1) || ShouldLogUSBPath(s2)) {
                char logBuf[1024];
                sprintf(logBuf, "lstrcmpW USB: '%s' <-> '%s'", s1, s2);
                WriteLog(logBuf);
            }
        }
    }
    return g_OriginallstrcmpW(lpString1, lpString2);
}

typedef struct IMemInputPinVtbl {
    HRESULT (WINAPI *QueryInterface)(PVOID, REFIID, PVOID*);
    ULONG (WINAPI *AddRef)(PVOID);
    ULONG (WINAPI *Release)(PVOID);
    HRESULT (WINAPI *GetPointer)(PVOID, long*);
    HRESULT (WINAPI *Receive)(PVOID, IMediaSample*);
    HRESULT (WINAPI *EndOfStream)(PVOID);
    HRESULT (WINAPI *NewSegment)(PVOID, REFERENCE_TIME, REFERENCE_TIME, double);
} IMemInputPinVtbl;

typedef struct IBaseFilterVtbl {
    HRESULT (WINAPI *QueryInterface)(PVOID, REFIID, PVOID*);
    ULONG (WINAPI *AddRef)(PVOID);
    ULONG (WINAPI *Release)(PVOID);
    HRESULT (WINAPI *GetClassID)(PVOID, CLSID*);
    HRESULT (WINAPI *State)(PVOID, FILTER_STATE*);
    HRESULT (WINAPI *SetSyncSource)(PVOID, IReferenceClock*);
    HRESULT (WINAPI *GetSyncSource)(PVOID, IReferenceClock**);
    HRESULT (WINAPI *Pause)(PVOID);
    HRESULT (WINAPI *Run)(PVOID, REFERENCE_TIME);
    HRESULT (WINAPI *Stop)(PVOID);
    HRESULT (WINAPI *FindPin)(PVOID, LPCWSTR, IPin**);
    HRESULT (WINAPI *QueryFilterInfo)(PVOID, FILTER_INFO*);
    HRESULT (WINAPI *JoinFilterGraph)(PVOID, IFilterGraph*, LPCWSTR);
    HRESULT (WINAPI *AddSourceFilter)(PVOID, LPCWSTR, IDispatch**);
    HRESULT (WINAPI *QueryVendorInfo)(PVOID, LPWSTR*);
} IBaseFilterVtbl;

typedef struct IPinVtbl {
    HRESULT (WINAPI *QueryInterface)(PVOID, REFIID, PVOID*);
    ULONG (WINAPI *AddRef)(PVOID);
    ULONG (WINAPI *Release)(PVOID);
    HRESULT (WINAPI *Connect)(PVOID, IPin*, const AM_MEDIA_TYPE*);
    HRESULT (WINAPI *ReceiveConnection)(PVOID, IPin*, const AM_MEDIA_TYPE*);
    HRESULT (WINAPI *Disconnect)(PVOID);
    HRESULT (WINAPI *ConnectedTo)(PVOID, IPin**);
    HRESULT (WINAPI *ConnectionMediaType)(PVOID, AM_MEDIA_TYPE*);
    HRESULT (WINAPI *QueryPinInfo)(PVOID, PIN_INFO*);
    HRESULT (WINAPI *QueryDirection)(PVOID, PIN_DIRECTION*);
    HRESULT (WINAPI *QueryAccept)(PVOID, const AM_MEDIA_TYPE*);
    HRESULT (WINAPI *EnumMediaTypes)(PVOID, IEnumMediaTypes**);
    HRESULT (WINAPI *QueryInternalConnections)(PVOID, IPin**, ULONG*);
    HRESULT (WINAPI *EndOfStream)(PVOID);
    HRESULT (WINAPI *BeginFlush)(PVOID);
    HRESULT (WINAPI *EndFlush)(PVOID);
    HRESULT (WINAPI *NewSegment)(PVOID, REFERENCE_TIME, REFERENCE_TIME, double);
} IPinVtbl;

static IMemInputPinVtbl* g_OriginalIMemInputPinVtbl = NULL;
static IMemInputPinVtbl* g_HookedIMemInputPinVtbl = NULL;

static IBaseFilterVtbl* g_OriginalIBaseFilterVtbl = NULL;
static IPinVtbl* g_OriginalIPinVtbl = NULL;

static PVOID g_pLastReceivePin = NULL;

typedef HRESULT (WINAPI *pfnReceive)(PVOID pThis, IMediaSample* pSample);
static pfnReceive g_OriginalReceive = NULL;

typedef HRESULT (WINAPI *pfnRun)(PVOID pThis, REFERENCE_TIME tStart);
static pfnRun g_OriginalRun = NULL;

typedef HRESULT (WINAPI *pfnPause)(PVOID pThis);
static pfnPause g_OriginalPause = NULL;

typedef HRESULT (WINAPI *pfnReceiveConnection)(PVOID pThis, IPin* pPin, const AM_MEDIA_TYPE* pmt);
static pfnReceiveConnection g_OriginalReceiveConnection = NULL;

typedef HRESULT (WINAPI *pfnConnect)(PVOID pThis, IPin* pPin, const AM_MEDIA_TYPE* pmt);
static pfnConnect g_OriginalConnect = NULL;

typedef HRESULT (WINAPI *pfnJoinFilterGraph)(PVOID pThis, IFilterGraph* pGraph, LPCWSTR pName);
static pfnJoinFilterGraph g_OriginalJoinFilterGraph = NULL;

static int g_ReceiveCallTotal = 0;
static int g_ReceiveBytesTotal = 0;
static BOOL g_bFirstFrame = TRUE;

void GetPinName(IPin* pPin, char* nameBuf, size_t bufSize) {
    if (!pPin || !nameBuf) return;
    
    PIN_INFO info = {0};
    HRESULT hr = pPin->lpVtbl->QueryPinInfo(pPin, &info);
    if (hr == S_OK && info.pFilter) {
        FILTER_INFO fInfo;
        hr = info.pFilter->lpVtbl->QueryFilterInfo(info.pFilter, &fInfo);
        if (hr == S_OK) {
            char filterName[256] = {0};
            WideCharToMultiByte(CP_ACP, 0, fInfo.achName, -1, filterName, sizeof(filterName), NULL, NULL);
            
            PIN_DIRECTION dir;
            pPin->lpVtbl->QueryDirection(pPin, &dir);
            sprintf(nameBuf, "%s:%s", filterName, dir == PINDIR_INPUT ? "In" : "Out");
            
            if (fInfo.pGraph) fInfo.pGraph->lpVtbl->Release(fInfo.pGraph);
        }
        info.pFilter->lpVtbl->Release(info.pFilter);
    }
}

void GetFilterClassId(PVOID pFilter, char* buf, size_t bufSize) {
    if (!pFilter || !buf) return;
    
    IBaseFilterVtbl* vtbl = *(IBaseFilterVtbl**)pFilter;
    
    CLSID clsid;
    HRESULT hr = vtbl->GetClassID(pFilter, &clsid);
    if (hr == S_OK) {
        GuidToString(clsid, buf, bufSize);
    } else {
        strcpy(buf, "Unknown");
    }
}

BOOL IsVideoFilter(PVOID pFilter) {
    char clsidStr[64];
    GetFilterClassId(pFilter, clsidStr, sizeof(clsidStr));
    
    if (strstr(clsidStr, "C6E133")) {
        return TRUE;
    }
    return FALSE;
}

BOOL IsCapturePin(IPin* pPin) {
    PIN_INFO info = {0};
    HRESULT hr = pPin->lpVtbl->QueryPinInfo(pPin, &info);
    if (hr == S_OK) {
        BOOL result = IsVideoFilter(info.pFilter);
        info.pFilter->lpVtbl->Release(info.pFilter);
        return result;
    }
    return FALSE;
}

BOOL IsInputPin(IPin* pPin) {
    PIN_DIRECTION dir;
    HRESULT hr = pPin->lpVtbl->QueryDirection(pPin, &dir);
    return (hr == S_OK && dir == PINDIR_INPUT);
}

static int g_FrameLogCount = 0;

void LogFrameInfo(IMediaSample* pSample, PVOID pPin) {
    if (!pSample || g_FrameLogCount++ > 100) return;
    
    long size = pSample->lpVtbl->GetActualDataLength(pSample);
    BYTE* pData = NULL;
    HRESULT hr = pSample->lpVtbl->GetPointer(pSample, &pData);
    
    char pinName[256] = {0};
    GetPinName((IPin*)pPin, pinName, sizeof(pinName));
    
    AM_MEDIA_TYPE* pmt = NULL;
    hr = pSample->lpVtbl->GetMediaType(pSample, &pmt);
    
    char mediaType[256] = {0};
    if (pmt) {
        DumpMediaType(pmt, mediaType, sizeof(mediaType));
        CoTaskMemFree(pmt);
    }
    
    REFERENCE_TIME tStart = 0, tEnd = 0;
    pSample->lpVtbl->GetTime(pSample, &tStart, &tEnd);
    
    char logBuf[1024];
    sprintf(logBuf, "FRAME #%d Pin=%s Type=%s Size=%ld Time=%lldms",
            g_FrameLogCount, pinName, mediaType, size, tStart/10000);
    WriteLog(logBuf);
    
    if (g_FrameLogCount <= 3) {
        sprintf(logBuf, "  First bytes: %02X %02X %02X %02X %02X %02X %02X %02X",
                pData[0], pData[1], pData[2], pData[3],
                pData[4], pData[5], pData[6], pData[7]);
        WriteLog(logBuf);
    }
    
    g_ReceiveBytesTotal += size;
}

static int g_LogReceiveConnectionCount = 0;

void LogReceiveConnection(IPin* pPin, const AM_MEDIA_TYPE* pmt) {
    if (g_LogReceiveConnectionCount++ > 50) return;
    
    char pinName[256] = {0};
    GetPinName(pPin, pinName, sizeof(pinName));
    
    char mediaType[256] = {0};
    DumpMediaType(pmt, mediaType, sizeof(mediaType));
    
    char logBuf[512];
    sprintf(logBuf, "PIN_CONNECT Pin=%s Type=%s", pinName, mediaType);
    WriteLog(logBuf);
}

void LogFilterJoin(PVOID pFilter, IFilterGraph* pGraph, LPCWSTR pName) {
    if (!pFilter) return;
    
    char clsidStr[64];
    GetFilterClassId(pFilter, clsidStr, sizeof(clsidStr));
    
    char name[256] = {0};
    if (pName) {
        WideCharToMultiByte(CP_ACP, 0, pName, -1, name, sizeof(name), NULL, NULL);
    }
    
    if (IsVideoFilter(pFilter)) {
        char logBuf[512];
        sprintf(logBuf, "FILTER_JOIN Name=%s CLSID=%s", name, clsidStr);
        WriteLog(logBuf);
    }
}

void LogFilterRun(PVOID pFilter, REFERENCE_TIME tStart) {
    if (!pFilter) return;
    
    char clsidStr[64];
    GetFilterClassId(pFilter, clsidStr, sizeof(clsidStr));
    
    if (IsVideoFilter(pFilter)) {
        char logBuf[512];
        sprintf(logBuf, "FILTER_RUN CLSID=%s Time=%lld", clsidStr, tStart);
        WriteLog(logBuf);
    }
}

void LogFilterPause(PVOID pFilter) {
    if (!pFilter) return;
    
    char clsidStr[64];
    GetFilterClassId(pFilter, clsidStr, sizeof(clsidStr));
    
    if (IsVideoFilter(pFilter)) {
        char logBuf[256];
        sprintf(logBuf, "FILTER_PAUSE CLSID=%s", clsidStr);
        WriteLog(logBuf);
    }
}

void InstallVtableHooks() {
    WriteLog("Installing DirectShow VTable hooks...");
    
    HMODULE hQuartz = GetModuleHandleW(L"quartz.dll");
    if (!hQuartz) {
        hQuartz = GetModuleHandleW(L"strmiids.dll");
    }
    if (!hQuartz) {
        hQuartz = GetModuleHandleW(L"strmbase.dll");
    }
    
    if (hQuartz) {
        char logBuf[256];
        sprintf(logBuf, "Found DirectShow DLL: %p", hQuartz);
        WriteLog(logBuf);
    } else {
        WriteLog("Warning: DirectShow DLL not loaded yet");
    }
}

static int g_CoCreateQuartzCount = 0;

HRESULT WINAPI HookedCoCreateInstance(REFCLSID rclsid, LPUNKNOWN pUnkOuter, DWORD dwClsContext, REFIID riid, LPVOID *ppv) {
    g_CoCreateCallCount++;
    
    char clsidStr[64];
    char iidStr[64];
    GuidToString(rclsid, clsidStr, sizeof(clsidStr));
    GuidToString(riid, iidStr, sizeof(iidStr));
    
    if (ShouldLogCoCreate(rclsid)) {
        char logBuf[512];
        sprintf(logBuf, "CoCreateInstance #%d CLSID=%s IID=%s", 
                g_CoCreateCallCount, clsidStr, iidStr);
        WriteLog(logBuf);
        
        if (strstr(clsidStr, "C6E133")) {
            char logBuf2[256];
            sprintf(logBuf2, "*** VIDEO CAPTURE FILTER CREATED ***");
            WriteLog(logBuf2);
        }
    }
    
    HRESULT hr = g_OriginalCoCreateInstance(rclsid, pUnkOuter, dwClsContext, riid, ppv);
    
    if (hr == S_OK && ppv && *ppv) {
        if (strstr(clsidStr, "C6E133")) {
            g_bCameraFilterCreated = TRUE;
            
            char logBuf[256];
            sprintf(logBuf, "Video capture filter created: %p", *ppv);
            WriteLog(logBuf);
            
            g_pCaptureFilter = *ppv;
        }
    }
    
    return hr;
}

BOOL InstallHooks() {
    if (g_bHooksInstalled) return TRUE;
    
    if (MH_Initialize() != MH_OK) {
        WriteLog("MH_Initialize failed");
        return FALSE;
    }
    
    MH_CreateHookApi(L"ole32.dll", "CoCreateInstance", &HookedCoCreateInstance, (LPVOID*)&g_OriginalCoCreateInstance);
    MH_CreateHookApi(L"kernel32.dll", "lstrcmpW", &HookedlstrcmpW, (LPVOID*)&g_OriginallstrcmpW);
    
    if (MH_EnableHook(MH_ALL_HOOKS) != MH_OK) {
        WriteLog("MH_EnableHook failed");
        MH_Uninitialize();
        return FALSE;
    }
    
    WriteLog("Hooks installed v22 - DirectShow Frame Tracking");
    WriteLog("Tracking: CoCreateInstance (video filters), lstrcmpW (USB paths)");
    WriteLog("Installing VTable hooks on next DirectShow load...");
    
    g_bHooksInstalled = TRUE;
    
    InstallVtableHooks();
    
    return TRUE;
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(hModule);
        WriteLog("DLL loaded v22");
        InstallHooks();
    } else if (reason == DLL_PROCESS_DETACH) {
        if (g_bHooksInstalled) {
            MH_DisableHook(MH_ALL_HOOKS);
            MH_Uninitialize();
        }
        
        if (g_ReceiveCallTotal > 0) {
            char logBuf[256];
            sprintf(logBuf, "Total frames received: %d, Total bytes: %d", 
                    g_ReceiveCallTotal, g_ReceiveBytesTotal);
            WriteLog(logBuf);
        }
        
        WriteLog("DLL unloaded");
    }
    return TRUE;
}

extern "C" __declspec(dllexport) void Dummy() {
}
