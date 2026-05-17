#include <stdio.h>
#include <stdlib.h>
#include <windows.h>

#define MAX_FRAMES 20

int main() {
    const char* files[] = {
        "D:\\mumu_frames_v2\\frame_000_193237_176.raw",
        "D:\\mumu_frames_v2\\frame_001_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_002_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_003_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_004_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_005_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_006_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_007_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_008_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_009_193237_312.raw",
        "D:\\mumu_frames_v2\\frame_010_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_011_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_012_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_013_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_014_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_015_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_016_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_017_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_018_193238_312.raw",
        "D:\\mumu_frames_v2\\frame_019_193238_312.raw"
    };

    int i, j;

    printf("=== Sequence Number Analysis ===\n\n");
    printf("Frame#  Offset24-27  Offset28-31\n");
    printf("--------------------------------\n");

    for (i = 0; i < MAX_FRAMES; i++) {
        FILE* f = fopen(files[i], "rb");
        if (!f) {
            continue;
        }

        fseek(f, 0, SEEK_END);
        long size = ftell(f);
        fseek(f, 0, SEEK_SET);

        unsigned char* data = (unsigned char*)malloc(size);
        fread(data, 1, size, f);
        fclose(f);

        printf("%2d:   ", i);
        for (j = 24; j < 28; j++) {
            printf("%02X ", data[j]);
        }
        printf(" ");
        for (j = 28; j < 32; j++) {
            printf("%02X ", data[j]);
        }
        printf("\n");

        free(data);
    }

    printf("\n=== Offset 24-27 as 32-bit value:\n");

    for (i = 0; i < MAX_FRAMES; i++) {
        FILE* f = fopen(files[i], "rb");
        if (!f) continue;

        fseek(f, 0, SEEK_END);
        long size = ftell(f);
        fseek(f, 0, SEEK_SET);

        unsigned char* data = (unsigned char*)malloc(size);
        fread(data, 1, size, f);
        fclose(f);

        unsigned int seq = *(unsigned int*)(data + 24);
        printf("%2d: 0x%08X\n", i, seq);

        free(data);
    }

    printf("\n");
    return 0;
}
