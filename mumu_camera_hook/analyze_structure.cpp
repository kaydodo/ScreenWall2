#include <stdio.h>
#include <stdlib.h>
#include <windows.h>

int main() {
    FILE* f = fopen("D:\\mumu_frames_v2\\frame_001_193237_312.raw", "rb");
    if (!f) {
        printf("File not found\n");
        return 1;
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    unsigned char* data = (unsigned char*)malloc(size);
    fread(data, 1, size, f);
    fclose(f);

    printf("=== Full Frame Structure Analysis (%d bytes) ===\n\n", (int)size);

    printf("Offset  0-15:  ");
    for (int i = 0; i < 16; i++) {
        printf("%02X ", data[i]);
    }
    printf("\n");

    printf("Offset 16-31:  ");
    for (int i = 16; i < 32; i++) {
        printf("%02X ", data[i]);
    }
    printf("\n\n");

    printf("=== Field Analysis ===\n");
    printf("  Offset 0-1:  0x%02X%02X  (Signature - always C0 01)\n", data[0], data[1]);
    printf("  Offset 2-5:  0x%02X%02X%02X%02X  (Unknown - always 0)\n", data[2], data[3], data[4], data[5]);
    printf("  Offset 6-9:  0x%02X%02X%02X%02X  (Data length/type)\n", data[6], data[7], data[8], data[9]);
    printf("  Offset 10-11: 0x%02X%02X        (Unknown)\n", data[10], data[11]);

    printf("  Offset 12-15: 0x%02X%02X%02X%02X  (Sequence #1 - see 0x%08X)\n",
           data[12], data[13], data[14], data[15], *(unsigned int*)(data + 12));

    printf("  Offset 16-19: 0x%02X%02X%02X%02X  (Frame type - 0x%08X)\n",
           data[16], data[17], data[18], data[19], *(unsigned int*)(data + 16));

    printf("  Offset 20-23: 0x%02X%02X%02X%02X  (Sub-type - 0x%08X)\n",
           data[20], data[21], data[22], data[23], *(unsigned int*)(data + 20));

    printf("  Offset 24-27: 0x%02X%02X%02X%02X  (Unknown - 0x%08X)\n",
           data[24], data[25], data[26], data[27], *(unsigned int*)(data + 24));

    printf("  Offset 28-31: 0x%02X%02X%02X%02X  (Sequence #2 - 0x%08X)\n",
           data[28], data[29], data[30], data[31], *(unsigned int*)(data + 28));

    printf("\n=== NV12 position ===\n");
    for (int i = 0; i < size - 4; i++) {
        if (data[i] == 'N' && data[i + 1] == 'V' && data[i + 2] == '1' && data[i + 3] == '2') {
            printf("  Found at offset %d (0x%X)\n", i, i);

            printf("  Context: ");
            for (int j = i - 8; j < i + 24 && j < size; j++) {
                if (j >= 0) printf("%02X ", data[j]);
            }
            printf("\n");
            break;
        }
    }

    printf("\n=== Full Hex Dump ===\n");
    for (int i = 0; i < size; i += 16) {
        printf("  %04X: ", i);
        for (int j = 0; j < 16 && i + j < size; j++) {
            printf("%02X ", data[i + j]);
        }
        printf("  |");
        for (int j = 0; j < 16 && i + j < size; j++) {
            unsigned char c = data[i + j];
            printf("%c", (c >= 32 && c < 127) ? c : '.');
        }
        printf("|\n");
    }

    free(data);
    return 0;
}
