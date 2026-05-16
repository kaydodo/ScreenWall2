MuMu Camera Hook
================

This project hooks the camera selection dialog in MuMu emulator.

Files:
- injector.cpp: DLL injector
- camera_hook.cpp: Hook DLL source
- build.bat: Build script
- camera_config.txt: Camera device name config (optional)

Usage:
1. Compile with Visual Studio (run build.bat)
2. Create camera_config.txt with your camera device name (first line)
3. Run injector.exe while MuMu is running

To find your camera device name:
- Open Device Manager
- Find your camera under "Cameras" or "Imaging devices"
- The device name is shown there

Alternative: Use OBS Virtual Camera
1. Install OBS Studio
2. Start OBS Virtual Camera
3. Set it as default in camera_config.txt
