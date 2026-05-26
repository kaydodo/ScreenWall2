#include <windows.h>
#include <stdio.h>
#include <string>
#include <ctime>

#pragma comment(lib, "user32.lib")

static BOOL g_bCameraSelected = FALSE;
static DWORD g_LastClickTime = 0;
static HWND g_LastCameraHWND = NULL;
static volatile LONG g_CameraCompleted = 0;
static DWORD g_LastJsonWriteTime = 0;

#define CAMERA_DLG_WIDTH 336
#define CAMERA_DLG_HEIGHT 316
#define CHECK_INTERVAL 500
#define JSON_FILE_PATH "D:\\camera_trigger.json"
#define DEBOUNCE_INTERVAL 1000

static std::string GenerateRandomString(int length) {
    static const char chars[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    std::string result;
    result.reserve(length);
    for (int i = 0; i < length; i++) {
        result += chars[rand() % (sizeof(chars) - 1)];
    }
    return result;
}

static BOOL WriteCameraTriggerToJson() {
    DWORD now = GetTickCount();
    if (now - g_LastJsonWriteTime < DEBOUNCE_INTERVAL) {
        return FALSE;
    }
    g_LastJsonWriteTime = now;
    
    FILE* f = fopen(JSON_FILE_PATH, "r");
    std::string jsonContent;
    
    if (f) {
        fseek(f, 0, SEEK_END);
        long fileSize = ftell(f);
        fseek(f, 0, SEEK_SET);
        
        char* buffer = new char[fileSize + 1];
        size_t bytesRead = fread(buffer, 1, fileSize, f);
        buffer[bytesRead] = '\0';
        fclose(f);
        jsonContent = std::string(buffer);
        delete[] buffer;
    } else {
        jsonContent = "{\n  \"cameraTrigger\": \"\"\n}";
    }
    
    std::string triggerToken = GenerateRandomString(16);
    
    size_t pos = jsonContent.find("\"cameraTrigger\"");
    if (pos != std::string::npos) {
        size_t valueStart = jsonContent.find(":", pos);
        if (valueStart != std::string::npos) {
            size_t quoteStart = jsonContent.find("\"", valueStart);
            if (quoteStart != std::string::npos) {
                size_t quoteEnd = jsonContent.find("\"", quoteStart + 1);
                if (quoteEnd != std::string::npos) {
                    jsonContent.replace(quoteStart + 1, quoteEnd - quoteStart - 1, triggerToken);
                }
            }
        }
    } else {
        size_t lastBrace = jsonContent.rfind("}");
        if (lastBrace != std::string::npos) {
            std::string newField = ",\n  \"cameraTrigger\": \"" + triggerToken + "\"";
            jsonContent.insert(lastBrace, newField);
        }
    }
    
    f = fopen(JSON_FILE_PATH, "w");
    if (!f) {
        return FALSE;
    }
    
    fwrite(jsonContent.c_str(), 1, jsonContent.length(), f);
    fclose(f);
    
    return TRUE;
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
                    
                    WriteCameraTriggerToJson();
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
        srand((unsigned int)time(NULL));
        CreateThread(NULL, 0, CheckCameraDialogThread, NULL, 0, NULL);
    }
    return TRUE;
}
