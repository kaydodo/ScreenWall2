#include <stdio.h>
#include <stdlib.h>

int main() {
    const char* filePath = "D:\\mumu_frames\\frame_158_191848_770_312.raw";

    FILE* f = fopen(filePath, "rb");
    if (!f) {
        printf("Cannot open file: %s\n", filePath);
        return 1;
    }

    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);

    printf("File size: %ld bytes\n\n", size);

    unsigned char* data = (unsigned char*)malloc(size);
    fread(data, 1, size, f);
    fclose(f);

    printf("=== First 64 bytes ===\n");
    for (int i = 0; i < 64; i += 16) {
        printf("%04X: ", i);
        for (int j = 0; j < 16 && i + j < size; j++) {
            printf("%02X ", data[i + j]);
        }
        printf(" |");
        for (int j = 0; j < 16 && i + j < size; j++) {
            unsigned char b = data[i + j];
            printf("%c", (b >= 32 && b < 127) ? b : '.');
        }
        printf("|\n");
    }

    printf("\n=== Last 64 bytes ===\n");
    for (int i = (size > 64 ? size - 64 : 0); i < size; i += 16) {
        printf("%04X: ", i);
        for (int j = 0; j < 16 && i + j < size; j++) {
            printf("%02X ", data[i + j]);
        }
        printf(" |");
        for (int j = 0; j < 16 && i + j < size; j++) {
            unsigned char b = data[i + j];
            printf("%c", (b >= 32 && b < 127) ? b : '.');
        }
        printf("|\n");
    }

    printf("\n=== Analysis ===\n");
    unsigned short sig = *(unsigned short*)data;
    printf("Signature: 0x%04X\n", sig);

    if (sig == 0x01C0) {
        unsigned int unknown = *(unsigned int*)(data + 2);
        unsigned short dataLen = *(unsigned short*)(data + 6);
        unsigned short offset = *(unsigned short*)(data + 8);
        unsigned short frameType = *(unsigned short*)(data + 10);
        printf("Unknown: 0x%08X\n", unknown);
        printf("DataLen: %u\n", dataLen);
        printf("Offset: %u\n", offset);
        printf("FrameType: %u\n", frameType);
    }

    for (int i = 0; i < (int)size - 3; i++) {
        if (data[i] == 'N' && data[i+1] == 'V' && data[i+2] == '1' && data[i+3] == '2') {
            printf("\nNV12 found at offset: %d (0x%X)\n", i, i);
            printf("Context: ");
            for (int j = i; j < i + 16 && j < (int)size; j++) {
                printf("%02X ", data[j]);
            }
            printf("\n");

            int strLen = 0;
            while (i + strLen < (int)size && data[i + strLen] >= 32 && data[i + strLen] < 127) {
                strLen++;
            }
            printf("String: \"");
            for (int j = 0; j < strLen && j < 32; j++) {
                printf("%c", data[i + j]);
            }
            printf("\"\n");
        }
    }

    printf("\n=== Searching for more patterns ===\n");
    int nullCount = 0;
    for (int i = 0; i < (int)size - 1; i++) {
        if (data[i] == 0x00 && data[i+1] == 0x00) {
            nullCount++;
        }
    }
    printf("NULL pair count: %d\n", nullCount);

    int maxConsec = 0, currConsec = 0, nullStart = 0, maxNullStart = 0;
    for (int i = 0; i < (int)size; i++) {
        if (data[i] == 0x00) {
            if (currConsec == 0) nullStart = i;
            currConsec++;
        } else {
            if (currConsec > maxConsec) {
                maxConsec = currConsec;
                maxNullStart = nullStart;
            }
            currConsec = 0;
        }
    }
    printf("Max consecutive NULLs: %d at offset %d\n", maxConsec, maxNullStart);

    free(data);
    return 0;
}
