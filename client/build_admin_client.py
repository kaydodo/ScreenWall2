# -*- coding: utf-8 -*-
import subprocess
import os
import shutil

os.chdir(r'D:\ScreenWall2\client')

if os.path.exists('dist_admin'):
    shutil.rmtree('dist_admin')

print("正在打包管理员客户端...")
result = subprocess.run(
    ['pyinstaller', 'admin_client.spec', '-y', '--distpath', 'dist_admin'],
    capture_output=True, text=True, encoding='gbk', errors='replace'
)
if result.returncode != 0:
    print("管理员客户端打包错误:")
    print(result.stderr[-3000:])
    exit(1)
print("  管理员客户端打包完成")

exe_file = os.path.join('dist_admin', 'ScreenWallAdmin.exe')

if os.path.exists(exe_file):
    print(f"管理员客户端打包成功!")
    print(f"输出路径: {os.path.abspath(exe_file)}")
else:
    print("  警告: ScreenWallAdmin.exe 未找到!")
    exit(1)
