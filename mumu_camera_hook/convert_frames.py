import os
import sys
import struct
import math

def find_nv12_offset(data):
    nv12_pos = data.find(b'NV12')
    if nv12_pos >= 0:
        return nv12_pos
    nv12_pos = data.find(b'nv12')
    if nv12_pos >= 0:
        return nv12_pos
    nv12_pos = data.find(b'NV12 ')
    if nv12_pos >= 0:
        return nv12_pos
    return -1

def parse_frame_header(data):
    if len(data) < 16:
        return None

    signature = struct.unpack('<H', data[0:2])[0]
    if signature == 0x01C0:
        unknown1 = struct.unpack('<I', data[2:6])[0]
        width = struct.unpack('<H', data[6:8])[0]
        height = struct.unpack('<H', data[8:10])[0]
        frame_type = struct.unpack('<H', data[10:12])[0]
        return {
            'signature': signature,
            'unknown': unknown1,
            'width': width,
            'height': height,
            'type': frame_type
        }
    return None

def nv12_to_rgb(nv12_data, width, height):
    y_data = nv12_data[:width * height]
    uv_data = nv12_data[width * height:]

    rgb = []
    for i in range(width * height):
        y = y_data[i]
        uv_index = (i // 2) * 2
        u = uv_data[uv_index] - 128
        v = uv_data[uv_index + 1] - 128

        r = int(y + 1.402 * v)
        g = int(y - 0.344136 * u - 0.714136 * v)
        b = int(y + 1.772 * u)

        r = max(0, min(255, r))
        g = max(0, min(255, g))
        b = max(0, min(255, b))

        rgb.extend([r, g, b])

    return bytes(rgb)

def create_bmp(width, height, rgb_data):
    row_size = (width * 3 + 3) & ~3
    file_size = 54 + row_size * height

    bmp = bytearray(file_size)
    struct.pack_into('<H', bmp, 0, 0x4D42)
    struct.pack_into('<I', bmp, 2, file_size)
    struct.pack_into('<I', bmp, 10, 54)
    struct.pack_into('<I', bmp, 14, 40)
    struct.pack_into('<i', bmp, 18, width)
    struct.pack_into('<i', bmp, 22, -height)
    struct.pack_into('<H', bmp, 26, 1)
    struct.pack_into('<H', bmp, 28, 24)
    struct.pack_into('<I', bmp, 30, 0)
    struct.pack_into('<I', bmp, 34, row_size * height)
    struct.pack_into('<i', bmp, 38, 2835)
    struct.pack_into('<i', bmp, 42, 2835)
    struct.pack_into('<I', bmp, 46, 0)
    struct.pack_into('<I', bmp, 50, 0)

    for y in range(height):
        row_start = 54 + y * row_size
        for x in range(width):
            src_idx = (y * width + x) * 3
            dst_idx = row_start + x * 3
            bmp[dst_idx:dst_idx+3] = rgb_data[src_idx:src_idx+3]

    return bytes(bmp)

def convert_frame(raw_file, output_dir):
    print(f"Converting: {raw_file}")

    with open(raw_file, 'rb') as f:
        data = f.read()

    print(f"  File size: {len(data)} bytes")

    header = parse_frame_header(data)
    if header:
        print(f"  Header: {header}")

    nv12_offset = find_nv12_offset(data)
    if nv12_offset >= 0:
        print(f"  NV12 at offset: {nv12_offset}")

        width = 640
        height = 480

        nv12_pos = nv12_offset
        if nv12_offset > 16:
            test_data = data[nv12_offset:]
            if len(test_data) >= width * height * 3 // 2:
                print(f"  Extracting NV12 from offset {nv12_offset}")
                nv12_data = test_data

                print(f"  Converting NV12 to RGB ({width}x{height})...")
                rgb_data = nv12_to_rgb(nv12_data[:width*height*3//2], width, height)

                print(f"  Creating BMP...")
                bmp_data = create_bmp(width, height, rgb_data)

                base_name = os.path.splitext(os.path.basename(raw_file))[0]
                bmp_file = os.path.join(output_dir, base_name + '.bmp')

                with open(bmp_file, 'wb') as f:
                    f.write(bmp_data)

                print(f"  Saved: {bmp_file}")
                return True

    print(f"  Could not find valid NV12 data")
    return False

def main():
    frames_dir = r"D:\mumu_frames"
    output_dir = r"D:\mumu_frames\converted"

    os.makedirs(output_dir, exist_ok=True)

    if not os.path.exists(frames_dir):
        print(f"Frames directory not found: {frames_dir}")
        return

    raw_files = [f for f in os.listdir(frames_dir) if f.endswith('.raw')]

    if not raw_files:
        print("No .raw files found")
        return

    print(f"Found {len(raw_files)} frames to convert")
    print("=" * 50)

    success_count = 0
    for i, filename in enumerate(sorted(raw_files)):
        raw_path = os.path.join(frames_dir, filename)
        if convert_frame(raw_path, output_dir):
            success_count += 1

        if (i + 1) % 10 == 0:
            print(f"Progress: {i+1}/{len(raw_files)}")

    print("=" * 50)
    print(f"Converted {success_count}/{len(raw_files)} frames")
    print(f"Output: {output_dir}")

if __name__ == '__main__':
    main()
