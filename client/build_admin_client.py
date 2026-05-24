# -*- coding: utf-8 -*-
import subprocess
import os
import shutil
import time
from datetime import datetime

os.chdir(r'D:\ScreenWall2\client')

# 每次打包使用新的时间戳目录，避免文件锁定
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
dist_dir = f'dist_admin_{timestamp}'
target_dir = 'dist_admin'

print(f"正在打包管理员客户端 (目标目录: {target_dir})...")
result = subprocess.run(
    ['pyinstaller', 'admin_client.spec', '-y', '--distpath', dist_dir],
    capture_output=True, text=True, encoding='gbk', errors='replace'
)
if result.returncode != 0:
    print("管理员客户端打包错误:")
    print(result.stderr[-3000:])
    exit(1)
print("  管理员客户端打包完成")

exe_file = os.path.join(dist_dir, 'ScreenWallAdmin.exe')

if os.path.exists(exe_file):
    # 尝试删除旧的目标目录，删除失败则重命名备份
    if os.path.exists(target_dir):
        for retry in range(3):
            try:
                shutil.rmtree(target_dir)
                break
            except Exception:
                if retry < 2:
                    time.sleep(1)
                else:
                    # 删除失败，重命名旧目录为备份
                    backup_dir = f'{target_dir}_old'
                    if os.path.exists(backup_dir):
                        try:
                            shutil.rmtree(backup_dir)
                        except Exception:
                            pass
                    try:
                        os.rename(target_dir, backup_dir)
                    except Exception:
                        pass
    
    # 重命名新目录为目标目录
    try:
        os.rename(dist_dir, target_dir)
    except Exception:
        # 如果重命名失败，直接移动
        if os.path.exists(target_dir):
            try:
                shutil.rmtree(target_dir)
            except Exception:
                pass
        shutil.move(dist_dir, target_dir)
    
    final_exe = os.path.join(target_dir, 'ScreenWallAdmin.exe')
    print(f"管理员客户端打包成功!")
    print(f"输出路径: {os.path.abspath(final_exe)}")
else:
    print("  警告: ScreenWallAdmin.exe 未找到!")
    exit(1)
