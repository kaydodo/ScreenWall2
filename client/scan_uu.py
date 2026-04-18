"""
UU远程/网易UU远程 设备扫描工具 v5（精准路径版）
直接从已知配置文件读取设备ID和设备名
配置文件路径：C:\\ProgramData\\Netease\\GameViewer\\
"""
import sys
import os
import json
from pathlib import Path

def log(msg):      print(f"  {msg}")
def log_ok(msg):   print(f"  [OK]    {msg}")
def log_fail(msg): print(f"  [FAIL]  {msg}")
def log_warn(msg): print(f"  [WARN]  {msg}")
def log_step(msg): print(f"  [STEP]  {msg}")


def read_ini_section(filepath):
    """读取INI文件，返回 {section: {key: value}}"""
    result = {}
    current_section = "General"
    if not os.path.exists(filepath):
        return result
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or line.startswith(";"):
                    continue
                if line.startswith("[") and line.endswith("]"):
                    current_section = line[1:-1]
                    result[current_section] = {}
                elif "=" in line:
                    key, _, val = line.partition("=")
                    result.setdefault(current_section, {})[key.strip()] = val.strip()
    except Exception as e:
        log_warn(f"读取失败 {filepath}: {e}")
    return result


def parse_device_info():
    """
    读取网易GameViewer(UU远程)设备信息
    已知安装路径：C:\\Program Files\\Netease\\GameViewer\\
    配置存储路径：C:\\ProgramData\\Netease\\GameViewer\\
    """
    base = Path("C:/ProgramData/Netease/GameViewer")
    if not base.exists():
        return None

    device_id    = None
    device_name  = None
    uuid         = None
    source_files = []

    # 1. user_info.ini → 包含 deviceId 和 userId
    user_info = read_ini_section(base / "user_info.ini")
    if "General" in user_info:
        gi = user_info["General"]
        device_id = gi.get("deviceId", "")
        uid = gi.get("userId", "")
        if device_id:
            log_ok(f"读取 deviceId: {device_id}")
            source_files.append("user_info.ini")
        if uid:
            log_ok(f"读取 userId:  {uid}")

    # 2. remote_assist_code.ini → 包含 设备显示ID 和 远程码
    rac = read_ini_section(base / "remote_assist_code.ini")
    # 键是 deviceId，值包含 code, enable_remote 等
    for section, fields in rac.items():
        if section == "General":
            continue
        device_id = section  # deviceId作为section名
        code = fields.get("code", "")
        enable = fields.get("enable_remote", "")
        if code:
            log_ok(f"读取远程码: deviceId={section}, enable={enable}")
            source_files.append("remote_assist_code.ini")

    # 3. config.ini → 包含 uuid（机器唯一标识）
    cfg = read_ini_section(base / "config.ini")
    if "General" in cfg:
        uuid = cfg["General"].get("uuid", "")
        if uuid:
            log_ok(f"读取 UUID:   {uuid}")
            source_files.append("config.ini")

    # 4. 设备名称：目前没有单独的name字段，尝试从GameViewer目录名或注册表
    if not device_name:
        hostname = os.environ.get("COMPUTERNAME", "未知设备")
        device_name = hostname

    # 检查是否有 deviceName 字段（新版可能支持）
    if "General" in user_info:
        if "deviceName" in user_info["General"]:
            device_name = user_info["General"]["deviceName"]
            log_ok(f"读取 deviceName: {device_name}")
        elif "name" in user_info["General"]:
            device_name = user_info["General"]["name"]
            log_ok(f"读取 name: {device_name}")

    found = bool(device_id)
    return {
        "device_id":   device_id   or "",
        "device_name": device_name or "",
        "uuid":        uuid        or "",
        "found":       found,
        "sources":     source_files,
    }


def check_gameviewer_installed():
    """检查GameViewer是否安装"""
    gv_path = Path("C:/Program Files/Netease/GameViewer/GameViewer.exe")
    return gv_path.exists(), str(gv_path)


def main():
    print()
    print("=" * 54)
    print("   UU Remote Device Scanner  v5")
    print("=" * 54)
    print()

    hostname = os.environ.get("COMPUTERNAME", "UnknownPC")
    device_id    = None
    device_name  = hostname
    uuid         = None
    uu_found     = False

    # 1. 检查GameViewer是否安装
    log_step("Checking GameViewer installation...")
    gv_exists, gv_path = check_gameviewer_installed()
    if gv_exists:
        log_ok(f"Found: {gv_path}")
    else:
        log_fail("GameViewer not found in default path")
    print()

    # 2. 读取设备信息
    log_step("Reading device info from config files...")
    info = parse_device_info()
    if info and info["found"]:
        uu_found   = True
        device_id   = info["device_id"]
        uuid        = info["uuid"]
        if info["device_name"]:
            device_name = info["device_name"]
        for src in info["sources"]:
            log_ok(f"Config source: {src}")
    print()

    # 结果输出
    print("-" * 54)

    if uu_found:
        print()
        print("  [RESULT] UU Remote Device Found!")
        print()
        print(f"  Device ID    : {device_id}")
        print(f"  UUID         : {uuid}")
        print(f"  Device Name  : {device_name}")
        print(f"  Computer Name: {hostname}")
    else:
        print()
        print("  [RESULT] No UU Remote device found")
        print()
        print("  Possible reasons:")
        print("  1. GameViewer (UU Remote) not installed")
        print("  2. Not logged in / device not bound")
        print("  3. Config files are encrypted")
        print()
        print(f"  Computer Name: {hostname}")

    print()
    print("-" * 54)
    print()
    print("  config.json template:")
    print()
    cfg = {
        "server": {
            "host": "YOUR_SERVER_HOST",
            "port": 3000
        },
        "device": {
            "deviceId":   device_id   or "",
            "deviceName": device_name or hostname,
            "uuDeviceId": device_id   or ""
        }
    }
    for line in json.dumps(cfg, indent=4, ensure_ascii=False).split("\n"):
        print(f"  {line}")
    print()
    print("=" * 54)
    print()
    input("  Press Enter to exit...")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print()
        print(f"  [ERROR] {e}")
        import traceback
        traceback.print_exc()
        print()
        input("  Press Enter to exit...")
