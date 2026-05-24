# -*- mode: python ; coding: utf-8 -*-
# ScreenWall Admin 管理员客户端打包配置
# 打包命令: pyinstaller admin_client.spec

from PyInstaller.utils.hooks import collect_data_files

block_cipher = None

pystray_data = collect_data_files('pystray', include_py_files=True)

a = Analysis(
    ['admin_client.py'],
    pathex=[],
    binaries=[],
    datas=[] + pystray_data,
    hiddenimports=[
        'pystray',
        'pystray._util',
        'pystray._win32',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'ctypes',
        'winreg',
        'json',
        'base64',
        'threading',
        'time',
        'webbrowser',
        'urllib.parse',
        'subprocess',
        'os',
        'sys',
        'pathlib',
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
    name='ScreenWallAdmin',
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
    name='ScreenWallAdmin',
)
