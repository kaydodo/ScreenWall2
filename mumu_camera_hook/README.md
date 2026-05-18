# MuMu Camera Hook - v48

## 功能
自动点击MUMU模拟器的摄像头选择弹窗（336x316尺寸的Qt5窗口）

## 文件说明
| 文件 | 说明 |
|------|------|
| camera_hook48.cpp | DLL源代码 |
| camera_hook48.dll | Hook DLL（需注入到MUMU进程） |
| injector.cpp | 注入器源代码 |
| injector48.exe | 注入器（自动注入DLL到MUMU） |
| build48.bat | 编译脚本 |

## 使用方法
1. 启动MUMU模拟器
2. 运行 `injector48.exe`
3. 弹出提示"已注入成功"后关闭
4. 触发摄像头弹窗时自动点击

## 技术细节
- 检测方式：EnumWindows轮询（每500ms）
- 点击方式：PostMessage发送WM_LBUTTONDOWN/UP
- 无日志、无配置文件、完全静默
- DLL随MUMU关闭自动退出

## 版本历史
| 版本 | 说明 |
|------|------|
| v47 | 首个成功版本（基于v35安全架构） |
| v48 | 极简版（去除日志、摄像头捕获等） |

## 编译
```batch
build48.bat
```
