#include <stdio.h>
#include <stdlib.h>
#include <windows.h>

#define MAX_FRAMES 5

int main() {
    const char* files[] = {
        "D:\\mumu_frames_v2\\frame_000_193237_176.raw",
        "D:\\mumu_frames_v2\\frame_001_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_002_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_003_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_004_193237_312.raw"
    };

    int i, j;

    for (i = 0; i < MAX_FRAMES; i++) {
        FILE* f = fopen(files[i], "rb");
        if (!f) {
            printf("Frame #%d not found\n", i);
            continue;
        }

        fseek(f, 0, SEEK_END);
        long size = ftell(f);
        fseek(f, 0, SEEK_SET);

        unsigned char* data = (unsigned char*)malloc(size);
        fread(data, 1, size, f);
        fclose(f);

        printf("\n=== Frame #%d (size=%ld bytes) ===\n", i, size);

        printf("  Offset 6-24: ");
        for (j = 6; j < 24; j++) {
            printf("%02X ", data[j]);
        }

        printf("\n  Offset 16-48: ");
        for (j = 16; j < 48; j++) {
            printf("%02X ", data[j]);
        }

        free(data);
    }

    printf("\n");
    return 0;
}
