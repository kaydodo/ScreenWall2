import os
import shutil
import subprocess
import sys

def main():
    tools_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(tools_dir, 'dual_image_monitor.py')
    dist_dir = os.path.join(tools_dir, 'dist')
    
    if os.path.exists(dist_dir):
        shutil.rmtree(dist_dir)
    
    print('正在安装依赖...')
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'aiohttp', 'watchdog', 'pyinstaller'], check=True)
    
    print('正在打包...')
    subprocess.run([
        sys.executable, '-m', 'PyInstaller',
        '--onefile',
        '--windowed',
        '--name', 'DualImageMonitor',
        '--distpath', dist_dir,
        '--workpath', os.path.join(tools_dir, 'build'),
        '--specpath', tools_dir,
        '--hidden-import', 'aiohttp',
        '--hidden-import', 'watchdog',
        '--hidden-import', 'watchdog.observers',
        '--hidden-import', 'watchdog.events',
        script_path
    ], check=True)
    
    exe_path = os.path.join(dist_dir, 'DualImageMonitor.exe')
    if os.path.exists(exe_path):
        print(f'打包完成: {exe_path}')
    else:
        print('打包失败')
    
    build_dir = os.path.join(tools_dir, 'build')
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir)
    
    spec_file = os.path.join(tools_dir, 'DualImageMonitor.spec')
    if os.path.exists(spec_file):
        os.remove(spec_file)

if __name__ == '__main__':
    main()