# -*- coding: utf-8 -*-
import subprocess
import os
import shutil

os.chdir(r'D:\ScreenWall2\client')

print("正在打包主客户端...")
result = subprocess.run(
    ['pyinstaller', 'client.spec', '-y', '--distpath', 'dist2'],
    capture_output=True, text=True, encoding='gbk', errors='replace'
)
if result.returncode != 0:
    print("主客户端打包错误:")
    print(result.stderr[-3000:])
    exit(1)
print("  主客户端打包完成")

dist_dir = 'dist2/ScreenWallClient'

internal_dir = os.path.join(dist_dir, '_internal')
os.makedirs(internal_dir, exist_ok=True)

print("正在打包 KeyClient（单文件）...")
keyclient_cmd = [
    'pyinstaller',
    '--name=KeyClient',
    '--onefile',
    '--windowed',
    '-y',
    '--distpath', 'dist2',
    '--hidden-import=ctypes',
    '--hidden-import=_ctypes',
    'keyclient.py'
]

result = subprocess.run(keyclient_cmd, capture_output=True, text=True, encoding='gbk', errors='replace')
if result.returncode != 0:
    print("KeyClient 打包错误:")
    print(result.stderr)
    exit(1)
print("  KeyClient 打包完成")

keyclient_exe_src = 'dist2/KeyClient.exe'
if os.path.exists(keyclient_exe_src):
    shutil.copy(keyclient_exe_src, os.path.join(internal_dir, 'KeyClient.exe'))
    print("  KeyClient.exe 已复制到 _internal/")
    os.remove(keyclient_exe_src)
else:
    print("  警告: KeyClient.exe 未找到!")
    exit(1)

shutil.rmtree('build/KeyClient', ignore_errors=True)

if os.path.exists(dist_dir):
    shutil.copy('config.json', dist_dir + '/config.json')

print("全部打包完成!")
print(f"主客户端输出目录: {os.path.abspath(dist_dir)}")
