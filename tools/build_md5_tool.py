import PyInstaller.__main__
import os
import shutil

# 清理之前的构建
dist_dir = os.path.join(os.path.dirname(__file__), 'dist')
build_dir = os.path.join(os.path.dirname(__file__), 'build')
if os.path.exists(dist_dir):
    shutil.rmtree(dist_dir)
if os.path.exists(build_dir):
    shutil.rmtree(build_dir)

# 打包
PyInstaller.__main__.run([
    'md5_tool.py',
    '--name=MD5校验工具',
    '--onefile',
    '--windowed',
    '--clean',
    '--noconfirm',
])

print("\n打包完成！")
print(f"输出文件: {os.path.join(dist_dir, 'MD5校验工具.exe')}")