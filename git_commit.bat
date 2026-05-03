@echo off
cd /d D:\ScreenWall2
git status
git add -A
git commit -m "feat: 更新 ScanWall2Startup.bat (全盘扫描版)

- 扫描 D/E/F/G 盘全盘找 ScreenWallClient.exe
- 工作目录自动跟随 exe 所在目录
- 镜像注入: D:\备份\WIM\install.wim"