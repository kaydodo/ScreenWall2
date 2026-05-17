import os
import sys
import struct
import math

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
            if src_idx + 3 <= len(rgb_data):
                bmp[dst_idx:dst_idx+3] = rgb_data[src_idx:src_idx+3]

    return bytes(bmp)

def nv12_to_rgb(nv12_data, width, height):
    y_plane_size = width * height
    uv_plane_size = width * height // 2

    if len(nv12_data) < y_plane_size + uv_plane_size:
        print(f"NV12 data too small: {len(nv12_data)} < {y_plane_size + uv_plane_size}")
        return None

    y_data = nv12_data[:y_plane_size]
    uv_data = nv12_data[y_plane_size:y_plane_size + uv_plane_size]

    rgb = []
    for i in range(y_plane_size):
        y = y_data[i]
        uv_index = (i // 2) * 2

        if uv_index + 1 < len(uv_data):
            u = uv_data[uv_index] - 128
            v = uv_data[uv_index + 1] - 128
        else:
            u = 0
            v = 0

        r = int(y + 1.402 * v)
        g = int(y - 0.344136 * u - 0.714136 * v)
        b = int(y + 1.772 * u)

        r = max(0, min(255, r))
        g = max(0, min(255, g))
        b = max(0, min(255, b))

        rgb.extend([b, g, r])

    return bytes(rgb)

def extract_from_hid_report(data):
    if len(data) < 16:
        return None

    sig = struct.unpack('<H', data[0:2])[0]

    if sig == 0x01C0:
        unknown = struct.unpack('<I', data[2:6])[0]
        data_len = struct.unpack('<H', data[6:8])[0]
        offset = struct.unpack('<H', data[8:10])[0]
        frame_type = struct.unpack('<H', data[10:12])[0]

        if data_len == 0:
            data_len = struct.unpack('<H', data[12:14])[0]
        if data_len == 0:
            data_len = len(data) - 16

        payload_offset = 16
        payload = data[payload_offset:payload_offset + data_len]

        return {
            'sig': sig,
            'unknown': unknown,
            'data_len': data_len,
            'offset': offset,
            'frame_type': frame_type,
            'payload': payload
        }

    return None

def convert_hid_frame_to_image(raw_file, output_dir, width=640, height=480):
    print(f"\nConverting: {raw_file}")

    with open(raw_file, 'rb') as f:
        data = f.read()

    print(f"  File size: {len(data)} bytes")

    info = extract_from_hid_report(data)
    if info:
        print(f"  HID Report: len={info['data_len']}, offset={info['offset']}, type={info['frame_type']}")
        print(f"  Payload size: {len(info['payload'])} bytes")

        nv12_pos = info['payload'].find(b'NV12')
        if nv12_pos >= 0:
            print(f"  NV12 marker found in payload at offset: {nv12_pos}")
            return True

        nv12_pos = data.find(b'NV12')
        if nv12_pos >= 0:
            print(f"  NV12 marker found at: {nv12_pos}")
            return True

    print("  No valid image data found (HID report fragment)")
    return False

def analyze_and_convert(raw_file, output_dir):
    print(f"\n{'='*60}")
    print(f"Analyzing: {raw_file}")

    with open(raw_file, 'rb') as f:
        data = f.read()

    print(f"File size: {len(data)} bytes")

    sig = struct.unpack('<H', data[0:2])[0]
    print(f"Signature: 0x{sig:04X}")

    if sig == 0x01C0:
        unknown = struct.unpack('<I', data[2:6])[0]
        data_len = struct.unpack('<H', data[6:8])[0]
        offset = struct.unpack('<H', data[8:10])[0]
        frame_type = struct.unpack('<H', data[10:12])[0]

        print(f"  Unknown: 0x{unknown:08X}")
        print(f"  Data Len: {data_len}")
        print(f"  Offset: {offset}")
        print(f"  Frame Type: {frame_type}")

        print(f"\nFirst 32 bytes:")
        hex_str = ' '.join(f'{b:02X}' for b in data[16:48])
        print(f"  {hex_str}")

        ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[16:48])
        print(f"  ASCII: {ascii_str}")

        nv12_pos = data.find(b'NV12')
        if nv12_pos >= 0:
            print(f"\nNV12 found at offset: {nv12_pos}")

            nv12_start = nv12_pos
            nv12_str = b''
            for i in range(nv12_pos, min(nv12_pos + 100, len(data))):
                if 32 <= data[i] < 127:
                    nv12_str += bytes([data[i]])
                else:
                    break

            print(f"  String: {nv12_str.decode('ascii', errors='ignore')}")

    print("="*60)

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

    print(f"Found {len(raw_files)} frame files")
    print(f"Analyzing first {min(5, len(raw_files))} files...")

    for filename in sorted(raw_files)[:5]:
        raw_path = os.path.join(frames_dir, filename)
        analyze_and_convert(raw_path, output_dir)

    print(f"\n\n{'='*60}")
    print("Note: HID reports are fragments, not complete images.")
    print("The full camera frame needs multiple HID reports to reconstruct.")
    print("="*60)

if __name__ == '__main__':
    main()
