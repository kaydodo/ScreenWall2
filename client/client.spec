# -*- mode: python ; coding: utf-8 -*-
# Screen Wall 客户端打包配置
# 打包命令: pyinstaller client.spec

from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

# ── 强制收集纯 Python 包 ──
pystray_data = collect_data_files('pystray', include_py_files=True)
mss_data = collect_data_files('mss', include_py_files=True)

a = Analysis(
    ['client.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('config.json', '.')] + pystray_data + mss_data,
    hiddenimports=[
        'websockets',
        'mss',
        'PIL',
        'PIL._imaging',
        'winreg',
        'uuid',
        'asyncio',
        'ctypes',
        '_ctypes',
        'json',
        'hashlib',
        'base64',
        'logging',
        'pystray',
        'pystray._util',
        'pystray._win32',
        'PIL.Image',
        'PIL.ImageDraw',
        'subprocess',
        'threading',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='ScreenWallClient',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name='ScreenWallClient',
)
