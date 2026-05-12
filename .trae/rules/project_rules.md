# ScreenWall2 项目规则

## Git 提交规则
- 每次修改代码后，必须立即提交 Git，不要积累多次修改再提交
- Git 路径：`C:\Program Files\Git\cmd\git.exe`
- 提交命令示例：`& "C:\Program Files\Git\cmd\git.exe" -C "D:\ScreenWall2" add -A; & "C:\Program Files\Git\cmd\git.exe" -C "D:\ScreenWall2" commit -m "描述"`
- 提交信息使用中文，格式：`类型: 简要描述`

## 代码风格
- 不添加注释，除非用户要求

## 客户端版本号规则
- 客户端版本号格式：`主版本.次版本.修订号`（如 1.8.0）
- 大版本更新（全新架构/重大功能）：加前面（1.x.x → 2.x.x）
- 小版本更新（新增功能/优化）：加中间（x.8.x → x.9.x）
- 修订版更新（Bug修复/小调整）：加后面（x.x.0 → x.x.1）

## 客户端打包命令
- 使用 build_client.py 打包：`python build_client.py`
- 打包前会清空 dist 目录
- 输出目录：`client/dist/ScreenWallClient/`
- 必须使用原有的 client.spec 配置文件
