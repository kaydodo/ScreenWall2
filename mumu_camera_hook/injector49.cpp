#include <windows.h>
#include <tlhelp32.h>
#include <psapi.h>
#include <stdio.h>
#include <string.h>

#define MAX_PROCESSES 16

typedef struct {
    char name[64];
    DWORD pid;
} ProcessInfo;

BOOL IsHookInjected(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!hProcess) return FALSE;

    HMODULE modules[1024];
    DWORD needed;

    BOOL found = FALSE;
    if (EnumProcessModules(hProcess, modules, sizeof(modules), &needed)) {
        for (DWORD i = 0; i < (needed / sizeof(HMODULE)); i++) {
            char name[MAX_PATH];
            if (GetModuleBaseNameA(hProcess, modules[i], name, sizeof(name))) {
                if (strstr(name, "camera_hook")) {
                    found = TRUE;
                    break;
                }
            }
        }
    }

    CloseHandle(hProcess);
    return found;
}

int FindAllMuMuProcesses(ProcessInfo* processes, int maxCount) {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 0;

    PROCESSENTRY32 pe32;
    pe32.dwSize = sizeof(PROCESSENTRY32);
    int count = 0;

    if (Process32First(snapshot, &pe32)) {
        do {
            if (_strnicmp(pe32.szExeFile, "MuMu", 4) == 0) {
                if (count < maxCount) {
                    strcpy(processes[count].name, pe32.szExeFile);
                    processes[count].pid = pe32.th32ProcessID;
                    count++;
                }
            }
        } while (Process32Next(snapshot, &pe32));
    }

    CloseHandle(snapshot);
    return count;
}

BOOL InjectDll(DWORD pid, const char* dllPath) {
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
    if (!hProcess) {
        printf("  Failed to open process. Error: %lu\n", GetLastError());
        return FALSE;
    }

    size_t pathLen = strlen(dllPath) + 1;
    LPVOID remoteMem = VirtualAllocEx(hProcess, NULL, pathLen, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remoteMem) {
        printf("  Failed to allocate memory. Error: %lu\n", GetLastError());
        CloseHandle(hProcess);
        return FALSE;
    }

    if (!WriteProcessMemory(hProcess, remoteMem, dllPath, pathLen, NULL)) {
        printf("  Failed to write memory. Error: %lu\n", GetLastError());
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return FALSE;
    }

    HMODULE hKernel32 = GetModuleHandleA("kernel32.dll");
    LPVOID pLoadLibraryA = GetProcAddress(hKernel32, "LoadLibraryA");

    HANDLE hThread = CreateRemoteThread(hProcess, NULL, 0,
        (LPTHREAD_START_ROUTINE)pLoadLibraryA, remoteMem, 0, NULL);

    if (!hThread) {
        printf("  Failed to create remote thread. Error: %lu\n", GetLastError());
        VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
        CloseHandle(hProcess);
        return FALSE;
    }

    WaitForSingleObject(hThread, INFINITE);

    DWORD exitCode = 0;
    GetExitCodeThread(hThread, &exitCode);

    CloseHandle(hThread);
    VirtualFreeEx(hProcess, remoteMem, 0, MEM_RELEASE);
    CloseHandle(hProcess);

    return exitCode != 0;
}

int main(int argc, char* argv[]) {
    char exePath[MAX_PATH];
    char dllPath[MAX_PATH];

    GetModuleFileNameA(NULL, exePath, MAX_PATH);
    strcpy(dllPath, exePath);

    char* lastSlash = strrchr(dllPath, '\\');
    char* exeName = lastSlash ? lastSlash + 1 : dllPath;

    char* numStart = strstr(exeName, "injector");
    if (numStart) {
        numStart += 8;
        char* numEnd = strstr(numStart, ".exe");
        if (numEnd) {
            char version[16] = {0};
            strncpy(version, numStart, numEnd - numStart);
            sprintf(lastSlash + 1, "camera_hook%s.dll", version);
        } else {
            strcpy(lastSlash + 1, "camera_hook.dll");
        }
    } else {
        strcpy(lastSlash + 1, "camera_hook.dll");
    }

    printf("=== MuMu Camera Hook Injector v49 ===\n");
    printf("DLL: %s\n\n", dllPath);

    ProcessInfo processes[MAX_PROCESSES];
    int count = FindAllMuMuProcesses(processes, MAX_PROCESSES);

    if (count == 0) {
        printf("No MuMu processes found!\n");
        return 1;
    }

    printf("Found %d MuMu process(es):\n", count);
    for (int i = 0; i < count; i++) {
        BOOL injected = IsHookInjected(processes[i].pid);
        printf("  [%d] %s (PID: %lu) %s\n", i + 1, processes[i].name, processes[i].pid,
               injected ? "[ALREADY INJECTED]" : "");
    }
    printf("\n");

    int injectCount = 0;
    int skipCount = 0;

    for (int i = 0; i < count; i++) {
        if (IsHookInjected(processes[i].pid)) {
            printf("Skipping %s (already injected)\n", processes[i].name);
            skipCount++;
            continue;
        }

        printf("Injecting into %s (PID: %lu)...\n", processes[i].name, processes[i].pid);
        if (InjectDll(processes[i].pid, dllPath)) {
            printf("  Success!\n");
            injectCount++;
        } else {
            printf("  Failed!\n");
        }
    }

    printf("\n=== Result: %d injected, %d skipped, %d failed ===\n",
           injectCount, skipCount, count - injectCount - skipCount);

    return injectCount > 0 ? 0 : 1;
}
