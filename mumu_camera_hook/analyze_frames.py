import os
import sys
import struct

def analyze_frame(raw_file):
    print(f"\n{'='*60}")
    print(f"Analyzing: {raw_file}")

    with open(raw_file, 'rb') as f:
        data = f.read()

    print(f"File size: {len(data)} bytes")

    if len(data) < 16:
        print("File too small")
        return

    sig = struct.unpack('<H', data[0:2])[0]
    print(f"Signature: 0x{sig:04X} ({sig})")

    if sig == 0x01C0:
        print("Valid frame header detected")
        print(f"First 16 bytes: {' '.join(f'{b:02X}' for b in data[:16])}")
    else:
        print(f"Unknown signature: 0x{sig:04X}")
        print(f"First 32 bytes: {' '.join(f'{b:02X}' for b in data[:32])}")

    nv12_pos = data.find(b'NV12')
    if nv12_pos >= 0:
        print(f"\nNV12 marker found at offset: {nv12_pos}")
        start = max(0, nv12_pos - 16)
        end = min(len(data), nv12_pos + 32)
        print(f"Context around NV12 ({start}-{end}):")
        print(f"  Hex: {' '.join(f'{b:02X}' for b in data[start:end])}")

        if nv12_pos + 4 < len(data):
            after_nv12 = data[nv12_pos+4:nv12_pos+32]
            print(f"  After NV12: {' '.join(f'{b:02X}' for b in after_nv12)}")

            ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[nv12_pos:nv12_pos+32])
            print(f"  ASCII: {ascii_str}")

    for i in range(len(data) - 3):
        if data[i] == 0x00 and data[i+1] == 0x00 and data[i+2] == 0x00:
            print(f"NULL sequence at offset {i}: {' '.join(f'{b:02X}' for b in data[i:i+8])}")

    print("\nFull hex dump (first 64 bytes):")
    for row in range(0, min(64, len(data)), 16):
        hex_str = ' '.join(f'{b:02X}' for b in data[row:row+16])
        ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[row:row+16])
        print(f"  {row:04X}: {hex_str:<48} |{ascii_str}|")

    if len(data) > 64:
        print("\nFull hex dump (last 64 bytes):")
        start = max(64, len(data) - 64)
        for row in range(start, len(data), 16):
            hex_str = ' '.join(f'{b:02X}' for b in data[row:row+16])
            ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[row:row+16])
            print(f"  {row:04X}: {hex_str:<48} |{ascii_str}|")

    print("="*60)

def main():
    frames_dir = r"D:\mumu_frames"

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
        analyze_frame(raw_path)

if __name__ == '__main__':
    main()
