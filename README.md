# ScreenWall2 屏幕墙监控系统

## 项目概述

ScreenWall2 是一套多设备屏幕监控与远控系统，支持同时监控多台电脑设备，实时显示屏幕画面、远程控制、一键启动UU远程、自助登号、设备开关机管理、设备分组、收藏截图、游戏掉线报警、网关反向代理等完整功能。

---

## 核心功能

### 1. 屏幕监控与画面展示
- 实时多设备屏幕画面同步显示
- 200个格子的网格布局（4-10列可选，9/10列需宽屏显示器）
- 支持格子视图（低画质）和预览弹窗（高清画质）
- 设备离线自动显示离线水印
- 网络波动离线自愈机制（连续2帧恢复）

### 2. 远程控制
- 键盘远程控制（可切换启用/禁用）
- 鼠标点击与滑动操作
- 鼠标滚轮支持
- 多显示器切换（预览时）
- 一键启动UU远程控制

### 3. 设备分组与筛选
- 设备分组管理（支持自定义分组名称、颜色）
- 分组筛选功能（按分组显示设备）
- 移动端分组筛选支持
- 分组筛选弹窗（桌面端+移动端）

### 4. 收藏与截图
- 设备收藏标记（星星按钮）
- 收藏设备批量截图
- 截图历史查看
- 截图保存到服务端

### 5. 游戏掉线报警
- 自动检测游戏掉线弹窗（OCR识别）
- 掉线自动生成报警记录
- 报警记录持久化存储
- 侧边栏报警面板实时显示
- 支持标记已查看/删除

### 6. 监控上墙
- 监控墙独立页面
- 自定义行列布局（最多支持大尺寸）
- 快捷布局：4格/6格/9格/12格/16格/20格
- 浮动预览弹窗
- 标准布局/接收布局双模式

### 7. 自助登号
- MUMU模拟器专用页面
- 专属视频流通道（360×640）
- 安卓三键控制（返回/主页/任务）
- 摄像头Hook自动选择与注入
- **DLL与MU服务通信**：JSON文件轮询机制
  - 触发文件：`D:\camera_trigger.json`
  - DLL写入随机字符串更新文件
  - MU服务轮询检测修改时间（0.5秒间隔）
  - 1秒防抖避免频繁写入
- 业务ID指定（URL参数传入）
- Python二维码处理（pyzbar），七重增强识别策略
- 自动裁剪与200×360输出，白色背景居中
- 时间戳验证确保文件更新
- SplitCam A/B 切换刷新机制（批处理文件方式）
- 二维码显示0.5秒后自动恢复白图，防止重复使用

### 8. 权限管理
- 设备级别的权限控制
- 两项核心权限：
  - 打开屏幕墙权限
  - 自助登号权限
- 权限管理界面需要登录验证（用户名/密码）
- 权限配置持久化存储（permissions.json）
- 设备重装后自动继承原有权限
- 客户端右键操作时自动检查权限

### 9. 管理员客户端
- 系统托盘图标常驻运行
- 打开屏幕墙（免验证，自动登录）
- 自助登号（免验证，自动登录）
- 设置服务器地址（IP:端口）
- 开机自启功能（默认开启）
- 配置文件存储在用户目录（`%APPDATA%\ScreenWallAdmin`）
- 首次运行弹出服务器设置对话框
- 管理员身份标识为 `ADMIN`，token格式为 `base64(deviceId:timestamp:admin)`

### 10. 设备开关机管理
- 基于米家智能家居场景
- 集成 mijiaAPI 开源项目（通过 `pip install mijiaAPI` 安装）
- 支持一键执行场景（设备批量开机/关机）
- 独立的 mijia-bridge.py 脚本封装
- 扫码登录米家账户获取设备列表
- 配置后即可在服务端调用米家API

### 11. 网关反向代理（v1.11.4 新增）
- 集成 http-proxy 库实现反向代理
- 支持多服务路由配置（gateway.json）
- 网关管理页面（密码验证）
- 配置热重载（无需重启）
- 已实现路由：
  - `/nas` → Alist 服务（5244端口）✅ 正常运行

### 12. 文件上传功能（v1.11.4 集成）
- 上传功能已集成到主服务（`/_upload` 路径）
- 原独立 upload.js 服务已废弃并删除
- 密码验证使用主服务配置
- 支持大文件上传（最大 2GB）
- 每次请求验证密码（不使用 session）

---

## 网关功能详解（v1.11.4）

### 功能概述

在主 server.js 中集成网关功能，支持反向代理多个服务：
- 主服务保持3000端口
- 外网通过54321端口访问（路由器映射）
- 网关管理页面需要密码验证，支持热重载

### 技术实现

#### 核心技术点

| 技术点 | 说明 |
|--------|------|
| http-proxy | Node.js 反向代理库 |
| selfHandleResponse | 控制响应处理方式 |
| Location header 重写 | 处理重定向路径 |
| HTML/JS 内容替换 | 正则表达式替换路径 |
| 禁用缓存 | 移除 if-none-match 等 headers |

#### NAS 路由（已完成）

**配置**：`/nas` → `http://127.0.0.1:5244`

**实现方式**：简单透传模式
- 不剥离 `/nas` 前缀
- 不做路径替换
- 直接透传请求和响应

**关键技术**：
```javascript
// 路由匹配时不剥离前缀
if (routeBase === '/nas') {
  req.url = req.url;  // 保持原路径
}

// proxyRes 处理时直接透传
if (req._gatewayRoute === '/nas') {
  res._savedWriteHead(proxyRes.statusCode, proxyRes.headers);
  proxyRes.pipe(res);
  return;
}
```

**Alist 配置要求**：
- 在 Alist 设置中配置 `site_url` 为 `http://外网地址:54321/nas`
- 这样 Alist 生成的链接会自动带 `/nas` 前缀

**Alist 看门狗脚本**：
- 项目提供 Alist 看门狗启动脚本（`alist_start.bat`、`alist_watchdog.ps1`、`alist_stop.bat`）
- 每5秒检测端口5244，自动重启 alist.exe
- 使用方法：将脚本复制到 `D:\alist` 目录，运行 `start.bat` 启动

### 配置文件

**gateway.json**（动态生成，不提交Git）：
```json
[
  { "route": "/nas", "target": "http://127.0.0.1:5244" }
]
```

### 网关管理页面

- 访问路径：`/gateway-admin`
- 需要密码验证（与主服务密码相同）
- 功能：添加/删除/修改路由配置
- 支持热重载（修改后立即生效）

### 相关文件

| 文件 | 说明 |
|------|------|
| server/server.js | 网关代理逻辑（proxyRes 处理、路由匹配） |
| server/gateway.json | 路由配置文件（动态生成） |
| alist_start.bat | Alist 看门狗启动脚本 |
| alist_watchdog.ps1 | Alist 看门狗 PowerShell 脚本 |
| alist_stop.bat | Alist 停止脚本 |

---

## 目录结构

```
D:\ScreenWall2\
├── server/                          # 服务端
│   ├── server.js                    # 主服务程序
│   ├── mijia-bridge.py              # 米家API桥接脚本
│   ├── mumu-service/                # MU微服务
│   │   ├── mumu_service.py          # 主程序（含二维码识别功能）
│   │   ├── injector49.exe           # 摄像头Hook注入器
│   │   ├── camera_hook49.dll        # 摄像头Hook DLL
│   │   ├── config.json              # 配置文件
│   │   └── qrcode/                  # 二维码处理目录
│   │       ├── last_qrcode.png      # 处理后的二维码
│   │       ├── blank.png            # 空白占位图
│   │       ├── Project_A.scproject  # SplitCam方案A（显示二维码）
│   │       ├── Project_B.scproject  # SplitCam方案B（显示空白图）
│   │       ├── start_a.bat          # 启动方案A的批处理（初始化时自动生成）
│   │       ├── start_b.bat          # 启动方案B的批处理（初始化时自动生成）
│   │       ├── backup.scproject     # 备份方案
│   │       ├── debug/               # 识别失败调试截图目录
│   │       └── README.md            # MU服务说明文档
│   ├── public/                      # 前端静态资源
│   │   ├── main.html                # 主页面
│   │   ├── monitor-wall.html        # 监控墙页面
│   │   ├── preview.html             # 预览弹窗页面
│   │   ├── self-service.html        # 自助登号页面
│   │   ├── style.css                # 样式文件
│   │   ├── config.json              # 配置文件
│   │   └── devices.json             # 设备数据持久化
│   ├── logs/                        # 日志目录
│   ├── permissions.json             # 设备权限配置
│   ├── mijia-auth.json              # 米家API认证信息（自动生成）
│   └── package.json                 # 依赖配置
│
├── client/                          # 电脑客户端
│   ├── client.py                    # 主程序
│   ├── admin_client.py              # 管理员客户端（独立）
│   ├── config.json                  # 配置文件
│   ├── build_client.py              # 标准客户端打包脚本
│   ├── build_admin_client.py        # 管理员客户端打包脚本
│   ├── admin_client.spec            # 管理员客户端PyInstaller配置
│   └── dist/                        # 打包输出目录
│
└── mumu_camera_hook/                # MUMU摄像头Hook模块（已废弃，功能集成到mumu-service）
    ├── camera_hook49.cpp            # Hook DLL源码
    ├── camera_hook49.dll            # Hook DLL
    ├── injector49.cpp               # 注入器源码
    ├── injector49.exe               # 注入器
    └── README.md                    # Hook模块说明
```

---

## 技术规格

### 画面分辨率与流级别

| 场景 | Level | 分辨率 | 说明 |
|------|-------|--------|------|
| 格子视图 | 0 | 480×270 | 低画质缩略图 |
| 监控墙格子 | 1 | 853×480 | 中等画质 |
| 预览画面 | 2 | 1280×720 | 高清画质 |
| 自助登号MUMU流 | 无 | 360×640 | 专属通道 |

### MUMU模拟器推荐配置

- 模拟器分辨率：**540×960**（最佳帧率）
- 客户端输出：**360×640**
- 压缩格式：WebP（质量30%）
- 理论帧率：3-4 fps

### 帧队列与超时

| 参数 | 值 |
|------|-----|
| 帧队列大小 | 3帧 |
| 帧超时丢弃 | 2秒 |
| 自愈阈值 | 连续2帧 |

---

## 系统架构

### 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      浏览器前端                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │  main.html   │ │monitor-wall │ │ self-service│             │
│  │ (格子视图)   │ │  (监控墙)    │ │  (登号)      │             │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘             │
│         │                │                │                    │
│         └────────────────┴────────────────┘                    │
│                            │ WebSocket                          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      服务端 (server.js)                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  - WebSocket Server (设备/浏览器/监控墙)                  │    │
│  │  - 设备状态管理 (devices.json)                            │    │
│  │  - 帧批量推送 (browserBatch/wallBatch)                   │    │
│  │  - OCR报警检测 (识别掉线弹窗)                             │    │
│  │  - 自助登号状态管理 (selfServiceStateByBusinessId)       │    │
│  │  - 分组管理、收藏管理                                    │    │
│  │  - 管理员Token验证 (识别:admin后缀)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            │ WebSocket                      │ HTTPS
            ▼                                 ▼
┌───────────────────────────┐    ┌──────────────────────────────┐
│      设备客户端           │    │      管理员客户端            │
│  ┌──────────────────┐   │    │  ┌────────────────────┐      │
│  │  电脑客户端     │   │    │  │admin_client.py      │      │
│  │  client.py      │   │    │  ├────────────────────┤      │
│  ├──────────────────┤   │    │  - 系统托盘图标       │      │
│  │- 屏幕截图(MSS)  │   │    │  - 打开屏幕墙(免验证) │      │
│  │- 键盘鼠标远控   │   │    │  - 自助登号(免验证)   │      │
│  │- 心跳/报警截图  │   │    │  - 设置服务器地址     │      │
│  └──────────────────┘   │    │  - 开机自启           │  └──────────────────┘   │    └────────────────────┘      │
│  ┌──────────────────┐   │                                │
│  │  MU微服务        │   │                                │
│  │mumu_service.py   │   │                                │
│  ├──────────────────┤   │                                │
│  │- ADB截图        │   │                                │
│  │- WebSocket推流  │   │                                │
│  │- 摄像头Hook注入 │   │                                │
│  └──────────────────┘   │                                │
└───────────────────────────┘    └──────────────────────────────┘
```

---

## 通信协议

### WebSocket消息类型

#### 浏览器 → 服务端
| 消息 | 参数 | 说明 |
|------|------|------|
| `subscribePreview` | `deviceId` | 订阅设备预览 |
| `unsubscribePreview` | `deviceId` | 取消订阅 |
| `setLevel` | `deviceId, level` | 切换流级别 |
| `subscribeWall` | `cols, rows, devices[]` | 订阅监控墙 |
| `keyClick` | `deviceId, key` | 键盘按键 |
| `mouseClick` | `deviceId, x, y, operatorId, operatorName, businessId, businessName` | 鼠标点击（自助登号4参数） |
| `mouseSwipe` | `deviceId, x, y, x2, y2, duration` | 滑动 |
| `mouseScroll` | `deviceId, delta` | 滚轮 |
| `selfServiceInit` | `operatorId, operatorName, businessId, businessName` | 自助登号初始化 |

#### 服务端 → 浏览器
| 消息 | 参数 | 说明 |
|------|------|------|
| `state` | `cells, devices, groups, alarms, favorites` | 初始状态 |
| `deviceList` | `devices[]` | 设备列表更新 |
| `groups` | `groups[]` | 分组列表更新 |
| `powerScenes` | `powerScenes{}` | 开关机场景更新 |
| `devicePreviewStatus` | `deviceId, status` | 预览状态 |
| `wallStateUpdate` | `devices, groups` | 监控墙状态 |
| `screenshotBatch` | `screenshots[]` | 批量截图帧 |
| `alarm` | `alarm` | 新报警 |
| `alarmViewed` | `alarmId` | 标记已查看 |
| `alarmDeleted` | `alarmId` | 删除报警 |
| `latency` | `latency` | 延迟显示 |
| `mumuOffline` | `deviceId` | MUMU微服务离线 |

#### 设备客户端 → 服务端
| 消息 | 参数 | 说明 |
|------|------|------|
| `register` | `deviceId, deviceName, version, screenWidth, screenHeight` | 注册设备 |
| 二进制 `0x01` | `deviceId, width, height, level, data` | 截图帧响应 |
| `cameraClicked` | `deviceId, deviceName, businessId, businessName, x, y, timestamp` | 相机点击通知（自助登号） |

#### 服务端 → 设备客户端
| 消息 | 参数 | 说明 |
|------|------|------|
| `setLevel` | `level` | 设置流级别 |
| `setKeyboardEnabled` | - | 开启键盘远控 |
| `setKeyboardDisabled` | - | 关闭键盘远控 |
| `keyClick` | `key` | 转发键盘 |
| `mouseClick` | `x, y, operatorId, operatorName, businessId, businessName` | 转发点击（携带4参数） |
| `mouseSwipe` | `x, y, x2, y2, duration` | 转发滑动 |
| `requestHdScreenshot` | `purpose, timestamp, businessId, businessName, operatorId, operatorName` | 请求高清截图（自助登号5参数） |

#### MU服务 → 服务端
| 消息 | 参数 | 说明 |
|------|------|------|
| `hdScreenshot` | `purpose, timestamp, deviceId, image, businessId, businessName, operatorId, operatorName` | 高清截图（自助登号携带全部6个参数） |

---

## 米家API集成说明

### 开源项目来源

**项目名称**：mijiaAPI  
**原作者/仓库**：https://github.heygears.com/Do1e/mijia-api  
**开源协议**：开源项目，可免费使用  
**安装方式**：`pip install mijiaAPI`

### 集成方式

本项目通过独立的桥接脚本封装米家API，避免直接在 Node.js 服务端中引入 Python 依赖，保持架构清晰：

```
Node.js 服务端（server.js）
    └─ 异步调用 mijia-bridge.py [独立 Python 进程]
       └─ 导入 mijiaAPI 库
          └─ 米家云服务 API
```

### 核心功能

| 功能 | API 接口 | 说明 |
|------|---------|------|
| 扫码登录 | `GET /api/mijia/login` | 获取二维码登录米家账户 |
| 登录状态检查 | `GET /api/mijia/status` | 检查是否已登录米家 |
| 获取家庭列表 | `GET /api/mijia/homes` | 获取米家账户下的家庭列表 |
| 获取设备列表 | `GET /api/mijia/devices?homeId=xxx` | 获取指定家庭下的设备列表 |
| 获取场景列表 | `GET /api/mijia/scenes?homeId=xxx` | 获取家庭下的自动化场景列表 |
| 执行场景 | `POST /api/mijia/run_scene` | 执行指定场景（如批量开关设备） |
| 设置设备属性 | `POST /api/mijia/set_prop` | 直接控制设备属性 |

### 目录结构

```
server/
├── mijia-bridge.py       # 米家API桥接脚本（独立进程）
├── mijia-auth.json       # 米家认证信息（自动生成，不提交Git）
└── server.js            # 服务端，通过 API 调用桥接脚本
```

### 异步架构设计

所有米家 API 调用都是异步的，不会阻塞服务端事件循环：

```javascript
// server.js 中的调用方式
async function callMijiaBridge(args, callback) {
  const { stdout } = await execFileAsync(
    'python', 
    ['mijia-bridge.py', ...args], 
    { timeout: 30000 }
  );
  // ... 处理返回结果
}
```

### 注意事项

- ✅ **开源免费使用**：mijiaAPI 为开源项目，可免费调用
- ✅ **法律合规**：项目仅调用米家官方公开 API，未进行逆向工程
- ✅ **数据隔离**：米家认证信息保存在本地 `mijia-auth.json`，不上传
- ⚠️ **不建议提取商业软件**：如 SplitCam 等闭源商业软件，请勿提取或反向工程

---

## 架构优化报告（v1.10.5）

### 概述

2026-05-23 对 ScreenWall2 项目进行了全面的异步架构审查和优化，确保所有组件在主循环阶段不存在阻塞问题，提升系统响应速度和稳定性。

### 检查范围

| 组件 | 文件路径 | 检查结果 |
|------|---------|---------|
| **服务端** | `server/server.js` | ✅ 架构优秀，无需修改 |
| **电脑客户端** | `client/client.py` | ✅ 优化4处 time.sleep |
| **MU服务** | `server/mumu-service/mumu_service.py` | ✅ 架构优秀，无需修改 |

---

### 服务端架构分析（server/server.js）

#### 状态：✅ 优秀

**优点**：
- ✅ **日志系统已异步化**：使用 `_logQueue` 队列 + `_flushLogQueue()` 异步写入，不会阻塞事件循环
- ✅ **文件持久化已异步化**：所有 `persistXxx()` 函数都使用 `async/await`
- ✅ **帧批处理使用 `setImmediate`**：`_flushWallBatch()` 和 `_flushBrowserBatch()` 使用 `setImmediate()` 安排，不会阻塞
- ✅ **二维码处理已异步化**：`processQrcodeImage()` 全部使用 `async/await`，有超时保护
- ✅ **报警图像处理已异步化**：`processAlarmImage()` 使用 `await sharp()` 处理图片

**初始化阶段同步读取**：
- 仅在服务器启动时读取配置文件（13处 `fs.readFileSync`）
- **不在主循环中调用**，可接受

---

### 电脑客户端架构分析（client/client.py）

#### 状态：✅ 已优化

**优化前问题**：
| 位置 | 原代码 | 问题 | 影响 |
|------|--------|------|------|
| 1543行 | `time.sleep(0.2)` | 在 async 函数中使用同步 sleep | 阻塞事件循环 |
| 1550行 | `time.sleep(0.5)` | 同上 | 阻塞事件循环 |
| 1727行 | `time.sleep(1)` | 同上 | 阻塞事件循环 |
| 1870行 | `time.sleep(0.5)` | 在同步函数中使用同步 sleep | 阻塞事件循环 |

**优化方案**：

| 位置 | 优化后代码 | 说明 |
|------|-----------|------|
| 1543行 | `await asyncio.sleep(0.2)` | 改为异步等待 |
| 1550行 | `await asyncio.sleep(0.5)` | 改为异步等待 |
| 1727行 | `await asyncio.sleep(1)` | 改为异步等待 |
| 1870行 | `loop.run_in_executor(None, lambda: time.sleep(0.5))` | 包装为非阻塞 |

**优化效果**：
- ✅ 消除主循环阻塞风险
- ✅ 提升客户端响应速度
- ✅ 代码风格统一为异步模式

---

### MU服务架构分析（server/mumu-service/mumu_service.py）

#### 状态：✅ 优秀

**优点**：
- ✅ **主循环使用 `asyncio.sleep()`**：所有等待都使用 `await asyncio.sleep()`
- ✅ **ADB 命令使用 `asyncio.create_subprocess_exec`**：所有 ADB 操作都是异步的
- ✅ **帧队列使用 `asyncio.Queue`**：maxsize=3，不会阻塞
- ✅ **初始化流程优化**：先连接 WebSocket 再等待模拟器，避免服务端无法感知

**子线程中的同步操作**：
| 位置 | 代码 | 分析 |
|------|------|------|
| 第 912、941 行 | `time.sleep(0.5)` | 在独立 `threading.Thread` 中运行，无影响 |

**结论**：✅ 无需修改，所有阻塞操作都在子线程中

---

### 二维码处理架构详解（mumu_service.py）

#### 设计原则：集成到 MU 服务

**核心思想**：二维码识别功能已集成到 MU 服务，通过 WebSocket 与服务端通信，支持并发请求和实时处理。

**架构图**：
```
服务端（server.js）
    └─ processQrcodeImage() [async 异步函数]
       └─ 发送 processQrcode 消息给 MU 服务
       └─ 监听 qrcodeResult 响应（requestId 匹配）

MU 服务（mumu_service.py）
       ├─ 接收 Base64 图片
       ├─ 七重增强二维码识别
       ├─ OpenCV 图片裁剪、缩放
       ├─ SplitCam A/B 刷新
       └─ 返回 qrcodeResult 结果
```

#### 七重增强识别策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| 原图识别 | 直接识别原图 | 清晰二维码 |
| 灰度识别 | 转灰度后识别 | 彩色干扰 |
| 1.5倍放大 | 放大1.5倍后识别 | 小尺寸二维码 |
| 2倍放大 | 放大2倍后识别 | 极小二维码 |
| 直方图均衡化 | 增强对比度 | 低对比度 |
| CLAHE | 自适应直方图均衡 | 光照不均 |
| OTSU二值化 | 自动阈值二值化 | 模糊边界 |
| 自适应阈值 | 高斯自适应阈值 | 复杂背景 |
| 高斯模糊 | 降噪后识别 | 噪点干扰 |
| 双边滤波 | 保边降噪 | 边缘模糊 |

**最大尝试次数**：12轮（每轮约100ms）

#### 并发请求支持

- **requestId 匹配**：每个请求携带唯一 requestId，响应时匹配
- **异步处理**：每个请求独立处理，互不干扰
- **超时保护**：服务端5秒超时

#### 调试功能

- **识别失败截图**：保存到 `qrcode/debug/failed_YYYYMMDD_HHMMSS.png`
- **识别日志**：显示耗时和尝试轮数
  ```
  [MUMU] 二维码识别成功: 耗时150ms, 尝试3轮
  [MUMU] 二维码识别失败: 未识别到二维码 (耗时1200ms, 尝试12轮)
  ```

#### A/B 刷新机制

**触发时机**：
- 二维码识别成功 → 刷新 A（显示二维码）
- 相机点击 → 刷新 B（显示白图）

**目的**：解决 SplitCam 虚拟摄像头缓存问题

#### 图片处理流程：
```
原始截图 (1080p/720p)
    ↓
检测二维码位置（七重增强）
    ↓
裁剪二维码区域
    ↓
等比例缩放（宽度200px）
    ↓
创建白色背景画布 (200×360px)
    ↓
居中放置二维码
    ↓
保存到 qrcode/last_qrcode.png
    ↓
刷新 SplitCam 方案 A
```

#### 架构优势：
- ✅ **服务端永不阻塞**：二维码处理在 MU 服务
- ✅ **支持并发**：多个请求可同时处理
- ✅ **易于调试**：失败时保存截图，便于分析
- ✅ **架构简洁**：无需独立进程，减少通信开销

---

### 架构质量评分

| 组件 | 异步架构 | 阻塞风险 | 性能评分 |
|------|---------|---------|---------|
| **server.js** | ⭐⭐⭐⭐⭐ | 无 | 优秀 |
| **client.py** | ⭐⭐⭐⭐⭐ | 已消除 | 优秀 |
| **mumu_service.py** | ⭐⭐⭐⭐⭐ | 无 | 优秀 |

**总体评价**：整个系统的异步架构设计合理，**主循环阶段不存在明显的阻塞问题**。

---

### 技术要点

#### 1. Python asyncio 最佳实践

```python
# ✅ 正确：在 async 函数中使用 asyncio.sleep
async def my_async_function():
    await asyncio.sleep(0.5)  # 非阻塞等待
    await do_something()

# ✅ 正确：在同步函数中使用 run_in_executor 包装阻塞操作
def my_sync_function():
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, lambda: time.sleep(0.5))  # 非阻塞

# ❌ 错误：在 async 函数中使用 time.sleep
async def wrong_example():
    time.sleep(0.5)  # 会阻塞整个事件循环！
```

#### 2. Node.js 异步模式

```javascript
// ✅ 使用 setImmediate 安排异步任务
setImmediate(_flushBatch);

// ✅ 使用 async/await 处理文件操作
async function persistData() {
    await fsWriteFile(path, data);
}

// ✅ 使用队列 + 异步刷新模式
const _logQueue = [];
function serverLog(msg) {
    _logQueue.push(msg);
    _flushLogQueue();  // 内部异步处理
}
```

---

## 最新功能更新（v1.10.0+）

### 自助登号系统重构（v1.10.0 重大更新）

#### 核心问题修复
- **全局变量冲突**：原实现使用全局变量存储自助登号状态，多个设备同时操作时参数混乱
- **超时点击误触发**：旧的点击记录可能因为特殊原因（如BNL）被错误联动

#### 重构方案

##### 1. 状态管理重构
- **移除了全局变量**：
  - `_currentMUMUClient`
  - `_currentOperatorId`
  - `_currentOperatorName`
  - `_currentBusinessId`
  - `_currentBusinessName`
  - `_selfServiceTimeoutId`

- **新增状态管理器**：
  ```javascript
  const selfServiceStateByBusinessId = new Map();
  // 键：businessId（业务设备ID）
  // 值：{
  //   operatorId: 业务发起方ID,
  //   operatorName: 业务发起方名称,
  //   businessName: 业务设备名称,
  //   mumuClient: MU服务连接,
  //   clickTimestamp: 点击时间戳,
  //   timeoutId: 超时定时器ID
  // }
  ```

##### 2. 双层超时保护机制

**6秒超时保护**（`SELF_SERVICE_TIMEOUT_MS = 6000`）：
- 收到 `cameraClicked` 后启动定时器
- 6秒内未收到截图则清理状态，防止状态挂死

**3秒点击时间窗口**（`SELF_SERVICE_CLICK_WINDOW_MS = 3000`）：
- 检查点击时间和收到截图的时间差
- 超过3秒的截图请求被丢弃

**时间戳单位统一**：
- 服务端使用 `Date.now()`（毫秒）
- MU服务使用 `time.time()`（秒）
- `processQrcodeImage()` 自动检测秒级时间戳（>10000000000）并转换为毫秒

##### 3. 完整参数传递链路

```
┌─────────────────────────────────────────────────────────────────┐
│                     自助登号完整流程                             │
└─────────────────────────────────────────────────────────────────┘

1. 自助登号页面初始化（self-service.html）
   ├─ URL参数：auto=1, token=xxx, deviceId=xxx, deviceName=xxx
   │         └─ deviceId = originalDeviceId（业务发起方ID）
   │         └─ deviceName = originalDeviceName（业务发起方名称）
   └─ WebSocket发送 selfServiceInit：
      {
        type: 'selfServiceInit',
        operatorId: originalDeviceId,      // 业务发起方ID
        operatorName: originalDeviceName,  // 业务发起方名称
        businessId: selectedDeviceId,      // 业务设备ID（下拉选择）
        businessName: selectedDeviceName   // 业务设备名称
      }

2. 用户在页面上点击（触发扫码）
   └─ sendMouse('mouseClick', x, y, {
        type: 'mouseClick',
        deviceId: previewDeviceId,         // MU服务ID（操作目标）
        operatorId: originalDeviceId,      // 业务发起方ID
        operatorName: originalDeviceName,   // 业务发起方名称
        businessId: selectedDeviceId,      // 业务设备ID
        businessName: selectedDeviceName,   // 业务设备名称
        x, y,
        previewWidth, previewHeight
      })

3. 服务端收到 mouseClick（server.js）
   └─ 坐标转换（preview → device分辨率）
   └─ 转发给MU服务：
      {
        type: 'mouseClick',
        x: actualX, y: actualY,
        deviceId: mDevId,
        deviceName: dev.deviceName,
        operatorId, operatorName,
        businessId, businessName
      }

4. MU服务收到 mouseClick
   └─ 保存点击信息到本地

5. 相机DLL检测到点击弹窗
   └─ 通过管道发送 CLICKED:timestamp

6. MU服务发送 cameraClicked
   {
     type: 'cameraClicked',
     deviceId: operatorId,             // 业务发起方ID（原样传递）
     deviceName: operatorName,         // 业务发起方名称
     businessId, businessName, x, y, timestamp
   }

7. 服务端收到 cameraClicked（server.js）
   ├─ 验证业务设备在线
   ├─ 保存状态到 selfServiceStateByBusinessId：
   │  {
   │    operatorId, operatorName,
   │    businessName,
   │    mumuClient: ws,
   │    clickTimestamp: timestamp,
   │    timeoutId: setTimeout(...)
   │  }
   ├─ 启动6秒超时定时器
   └─ 向业务设备发送 requestHdScreenshot：
      {
        type: 'requestHdScreenshot',
        purpose: 'selfService',
        timestamp: clickTimestamp,
        businessId,
        businessName,
        operatorId,
        operatorName
      }

8. 业务设备返回 hdScreenshot
   {
     type: 'hdScreenshot',
     purpose: 'selfService',
     timestamp,
     deviceId: businessId,
     image: base64,
     businessId,
     businessName,
     operatorId,
     operatorName
   }

9. 服务端收到 hdScreenshot
   ├─ 从 selfServiceStateByBusinessId 获取状态（或使用消息参数）
   ├─ 检查时间窗口：now - clickTimestamp <= 3000ms
   │  └─ 超过3秒：丢弃，打印超时日志
   └─ 调用 processQrcodeImage() 处理截图

10. processQrcodeImage() 处理
    ├─ 验证图片大小 >= 1000字节
    ├─ 保存到 qrcode/screenshot_original.png
    ├─ 检查文件修改时间（确保更新）
    ├─ 调用 qrcode_processor.py 处理
    │  └─ 识别二维码、裁剪、缩放
    ├─ 打印日志：
    │  └─ 同设备：[自助登号] 设备名使用二维码扫码（结果）
    │  └─ 帮其他设备：[自助登号] 设备A帮助设备B使用二维码扫码（结果）
    └─ 清理状态 clearSelfServiceState(businessId)
```

##### 4. 关键函数列表

| 函数名 | 位置 | 功能 |
|--------|------|------|
| `clearSelfServiceState(businessId)` | server.js | 清理指定业务设备的状态 |
| `processQrcodeImage(buffer, businessId, operatorId, operatorName, businessName, clickTimestamp)` | server.js | 处理二维码图片（含时间窗口检查） |
| `SELF_SERVICE_TIMEOUT_MS` | server.js | 自助登号超时时间（6000ms） |
| `SELF_SERVICE_CLICK_WINDOW_MS` | server.js | 点击时间窗口（3000ms） |
| `selfServiceStateByBusinessId` | server.js | 状态存储Map |

#### 修改的文件
- `server/server.js`：重构自助登号逻辑，移除全局变量

---

### MUMU微服务上下线通知

#### 新增消息类型
- **mumuOffline**：服务端 → 浏览器，当MUMU微服务离线时发送

#### 服务端处理
```javascript
// MUMU连接断开时
if (dev.id === 'MUMU-service') {
  serverLog(`[MUMU] 模拟器微服务已离线`);
  broadcastToBrowsers({ type: 'mumuOffline', deviceId: dev.id });
}

// MUMU连接超时离线时
if (id === 'MUMU-service') {
  serverLog(`[MUMU] 模拟器已超时断开`);
  broadcastToBrowsers({ type: 'mumuOffline', deviceId: id });
}
```

#### 前端处理（self-service.html）
- 收到 `mumuOffline` 后：清空画面，设置全透明
- MUMU上线时：无需任何处理，帧到达后自动恢复

---

### 客户端免登录功能

#### 通过 URL 参数跳过登录
- **权限检查**：客户端右键打开屏幕墙或自助登号时，自动检查权限
- **Token生成**：`base64(deviceId:timestamp)` 格式
- **有效期**：30秒
- **验证流程**：
  1. 客户端检查权限 → 通过后生成token
  2. 打开浏览器访问 `main.html?auto=1&token=xxx`
  3. 服务端验证token有效性
  4. 验证通过后直接连接，跳过登录框

---

### 权限管理完善

#### 权限数据结构
```javascript
// permissions.json
{
  "deviceId": {
    "deviceName": "设备名",
    "allowScreenWall": true/false,
    "allowSelfService": true/false
  }
}
```

#### API接口
- `POST /api/checkPermission`：检查权限
- `POST /api/setPermission`：设置权限

---

## 版本历史（按时间排序）

### 重大重构记录

| 日期 | 重构内容 | 影响 |
|------|---------|------|
| **2026-05-26** | **MU服务架构重构** | |
| | 1. 文件夹迁移：`mumu-client/` → `server/mumu-service/` | MU服务成为服务端子模块 |
| | 2. 文件重命名：`mumu_client.py` → `mumu_service.py` | 统一命名规范 |
| | 3. 类名重命名：`MumuClient` → `MumuService` | 代码层面统一 |
| | 4. 服务端自动启动管理MU服务 | 无需手动启动 |
| | 5. MU服务断开自动重启（3秒延迟） | 提高可用性 |
| | 6. 启动后自动最小化控制台窗口 | 用户体验优化 |
| | 7. 检测已运行则跳过启动 | 避免重复启动 |
| | 8. 初始化流程优化：先连接WebSocket再等待模拟器 | 解决无模拟器时服务端无法感知的问题 |

### 版本更新记录

| 版本 | 日期 | Git提交 | 核心改进 |
|------|------|---------|---------|
| **v1.0早期** | - | b72f95e | 初始版本：Base64传输 |
| **v1.2.6** | - | 5c9adb7 | OCR报警机制；1080p临时高清（已移除） |
| **v1.2.7** | - | 80fca08 | 远程键盘控制功能 |
| **v1.2.8** | - | c02ca27 | 报警机制重构（移除九宫格） |
| **v1.2.9** | - | 663d6c7 | 远控UI优化，列表弹窗 |
| **v1.3.0** | - | 5b3753e | UU远程自动检测与安装 |
| **v1.3.20** | - | a8851c4 | 客户端帧率5fps→**8fps**，心跳150→240帧 |
| **v1.4.0** | - | 629f880 | 监控预览弹窗修复，大版本号更新 |
| **v1.5.0** | - | bd8e9a7 | 移除stopHQ静态帧捕获 |
| **v1.6.0** | - | 8c51328 | 统一截图频率8fps；动态sleep精确控制 |
| **v1.6.2** | - | 4e7d63a | 增加MAC地址识别，设备重装自动继承 |
| **v1.7.0** | - | b877e63 | 服务端globalHQ引用计数重构 |
| **v1.7.4** | - | 3540879 | 720p/1080p质量45，压缩3/5 |
| **v1.7.9** | - | 38059c9 | 统一降帧至**6fps**稳定 |
| **v1.7.12** | - | 3578e3f | 统一所有截图质量为30，优化画质体积平衡 |
| **二进制重构** | - | c37d960 | 改用二进制WebSocket帧传输，取代Base64，节省约33%带宽 |
| **v1.8.x** | - | - | 分离预览页为独立HTML，实现多浏览器预览协同 |
| **v1.8.1** | - | 38e41bb | 删除stopHQ处理器和调试API |
| | | 95c8c27 | 统一所有二进制通道为0x10，废弃0x11/0x12 |
| **v1.9.0** | - | c7399e6 | L1/L2统一16:9比例（853x480/1280x720）|
| **v1.9.1 Step 1** | - | d97af06 | 流级别系统 - 用 setLevel 替代 startHQ/stopHQ |
| **v1.9.1 Step 2** | - | d0d06a2 | 监控墙裁剪 - 按布局裁剪帧减少带宽 |
| **v1.9.1 Step 3** | - | d2cd564 | 视口懒加载和裁剪优化 - 根据视口发送设备帧 |
| **v1.9.1优化阶段1** | - | c472df4 | Promise.all并行处理图像裁剪，大幅提升性能 |
| **v1.9.1优化阶段2** | - | c8072b9 | Worker线程池处理裁剪，利用多核CPU |
| **v1.9.1优化终版** | - | de4013a | 移除服务端裁剪，前端CSS自动缩放，消除调度阻塞 |
| | | d2e577c | 监控墙同样移除裁剪，修复调度阻塞 |
| **v1.9.2** | - | 4c19387 | 自助登号基础功能 |
| **v1.9.3** | - | 4940466 | 自助登号完善 |
| | | 2eb2f82 | 自助登号优化：添加超时机制、完善日志显示 |
| | | d3aa79e | 自助登号优化：简化客户端消息为三种状态，服务端日志显示完整关系 |
| | | 78c906e | 优化二维码处理逻辑：200×360分辨率，白色边框居中 |
| **v1.9.7** | - | 03c36b8 | 修复普通客户端businessId字段缺失问题，支持自助登号流程 |
| | | d17be7d | 重构二维码处理：移除jsqr，改用Python+pyzbar处理 |
| | | 5047f64 | 二维码保存逻辑：使用固定位置+时间判断确保更新成功 |
| | | b48153b | 清理未使用代码：移除QRCODE_OUTPUT_PATH和客户端qrcodeResult处理 |
| | | c41dc58 | 更新README：添加自助登号完整流程和Python依赖说明 |
| **v1.9.8** | - | 9e1ed1f | 重构：创建统一的设备ID迁移和删除函数 |
| | | 3ad23bb | 服务端权限变更日志同时显示设备名和设备ID |
| **v1.9.9** | 2026-05-21 | 733a2a8 | 实现客户端打开屏幕墙免登录功能 |
| | | 6bb7e87 | 修复自助登号页面缺少deviceId和deviceName参数的问题 |
| | | 97f4ebf | 修复自助登号页面URL参数格式错误，并添加token验证 |
| | | 1ce16fd | 打包 v1.9.9 客户端 |
| | | 8c9eae1 | 自助登号：所有设备名显示为名称（ID）格式 |
| | | 41a341f | 自助登号：删除开始使用/退出日志，添加打开屏幕墙/自助登号日志 |
| | | 7b9345f | 统一日志格式：权限和MUMU日志改为标准格式 |
| | | bccccaa | 修改MUMU超时离线日志为「模拟器已超时断开」 |
| | | e645f18 | 修改权限日志标签为[客户端] |
| | | 2eb14da | 简化自助登号日志格式，去掉打开二字 |
| **v1.9.9** | - | a721fa9 | 修复：自动登录时点击权限管理按钮弹窗不显示 |
| | | 6346ce8 | 修复：每次点击权限管理都需要验证，自动登录验证后重置标记 |
| | | 064add5 | 修复：客户端打开时跳过登录但权限管理每次都需要输入密码 |
| | | 138997e | 清理：删除不再使用的自动登录相关代码 |
| | | ccc2889 | 修复：恢复客户端通过auto=1参数跳过登录的功能 |
| **v1.10.0** | - | d2715d3 | 自助登号系统重构：消除全局变量，添加3秒点击时间窗口检查 |
| | | 6c6c984 | MUMU离线遮罩优化：移除多余遮罩层，离线时显示黑色遮罩 |
| | | 46bcbe8 | 自助登号页面自愈逻辑：MUMU恢复后自动通知服务端更新状态 |
| | | bfc31a6 | MU服务自愈和断线重连：心跳机制与自动重连优化 |
| | | c7928be | 点击时间窗口检查：超过3秒的点击操作不生效 |
| | | c440229 | 自助登号并发修复：hdScreenshot携带operatorId，不再依赖全局变量 |
| | | c252238 | 修复时间戳单位不匹配：自动检测秒级时间戳并转换毫秒 |
| | | 56a7cde | 自助登号隐藏启动：--start-minimized启动后由JS显示窗口 |
| | | 3822195 | 自助登号窗口尺寸：1080p基准510×960，更大屏幕按比例放大 |
| **v1.10.1** | - | - | 自助登号修复：时间戳单位检测逻辑（秒级是<10000000000），电脑客户端hdScreenshot补充完整参数（operatorId/operatorName/businessName） |
| **v1.10.2** | - | - | 修复电脑客户端截图异常处理：添加try-except捕获，防止截图失败时主进程中断 |
| **v1.10.3** | - | e33a253 | 完善MU服务异常处理：截图Worker添加异常捕获、主循环发送帧添加try-except、MUMU超时断开不触发mumuOffline、超时时间改为5秒 |
| **v1.10.4** | 2026-05-22 | baeceb0 | MU服务优化：命令队列处理、状态通知队列化、ADB稳定检测(5次x2秒)、优化日志输出；打包客户端 |
| **v1.10.5** | 2026-05-23 | 98c1d46 | 优化：简化设备继承时的冗余日志 |
| | | 2778002 | 完善README：补充设备重装自动继承流程说明 |
| | | 2eb76fb | 完善README：补充二维码处理脚本架构详解 |
| | | 86e1b03 | v1.10.5: 架构优化 - 消除客户端异步阻塞 |
| | | e705fd0 | 重构README：合并版本历史，调整板块顺序 |
| | | e99a87c | 完善README：补充权限管理功能介绍、米家API集成说明 |
| | | c0c09a3 | 优化 client.py 中4处 time.sleep，提升异步架构一致性 |
| **v1.10.6** | 2026-05-24 | 4cb66fb | SplitCam A/B 刷新方案：解决虚拟摄像头缓存问题 |
| | | 396759f | docs: 更新README，补充SplitCam A/B刷新方案说明 |
| | | f2fe42e | 调整二维码生成位置：向下移动40像素 |
| | | 46a4ea5 | 调整超时窗口：2秒→3秒 |
| | | 802f7a7 | 修复自助登号同时报超时和成功的bug：点击时间检查通过后立即取消超时定时器 |
| | | | 调整超时时间：5秒→6秒 |
| **v1.11.0** | 2026-05-24 | 09f9465 | 新增管理员客户端：系统托盘+免验证访问+开机自启 |
| | | 40164f7 | 修复管理员客户端退出问题：使用os._exit完全退出，退出前设置托盘icon.visible=false |
| | | 3ef5b1a | 修复打包脚本文件锁定问题：使用时间戳临时目录，先打包后重命名 |
| | | 0bb6fa0 | 修复管理员客户端配置：移除autoStart配置项 |
| | | e4698e7 | 电脑客户端版本号同步更新到1.11.0 |
| | | 8535a4f | 清理：删除旧版v193打包配置文件 |
| | | 09f9465 | 自助登号页面管理员模式：ADMN不在列表时自动选择第一个设备，展开下拉提示用户 |
| | | 74b9f50 | 管理员客户端移动到client/目录，统一打包流程 |
| | | 74b9f50 | admin_client.spec单文件打包配置 |
| | | 74b9f50 | 默认开启开机自启，与标准客户端保持一致 |
| | | 74b9f50 | 托盘菜单移除版本号显示 |
| | | 74b9f50 | 首次运行自动弹出服务器地址设置 |
| **v1.11.1** | 2026-05-26 | a762947 | MU服务场景切换优化：使用批处理文件启动SplitCam场景，初始化时自动生成绝对路径 |
| | | | 移除相机点击时的场景B刷新，避免重复刷新 |
| | | | 二维码处理后延迟0.5秒自动恢复白图，防止二维码被复用 |
| | | | 修复管道连接句柄判断问题（同时检查-1和c_void_p(-1).value） |
| | | | 服务启动时自动最小化控制台窗口 |
| | | | 服务启动时重置相机状态 |
| **v1.11.2** | 2026-05-27 | fdbfa6a | DLL通信机制重构：从命名管道改为JSON文件轮询 |
| | | | 触发文件固定路径：D:\camera_trigger.json |
| | | | DLL写入随机字符串更新文件，MU服务轮询检测修改时间 |
| | | | 1秒防抖避免频繁写入，0.5秒轮询间隔 |
| | | | 注入器静默模式：只输出最终结果（OK/ERROR） |
| | | | MU服务初始化流程优化：先连接WebSocket再等待模拟器 |
| **v1.11.2+** | 2026-05-27 | - | 自助登号键盘功能全面优化： |
| | | | 数字键（主键盘区+小键盘）、字母键（大小写）、符号键支持 |
| | | | Shift组合键：!@#$%^&*()_+{}|:"&lt;&gt;? 等符号 |
| | | | 方向键（↑↓←→）、ESC键支持 |
| | | | 后端使用Android KeyEvent映射，符号使用input text输入 |
| | | | 解决键盘输入黑屏显示不正常等问题 |
| **v1.11.3** | 2026-05-28 | - | 客户端截图兜底机制 + 预览页面物理键盘支持全面优化： |
| | | | 新增图片有效性检测：检测纯黑/亮度极低的截图并降级处理 |
| | | | DXGI连续失败5次后临时禁用并重置状态，自动重试 |
| | | | 四层兜底机制：DXGI→MSS→PIL ImageGrab→纯软件灰色图 |
| | | | 确保即使所有截图方式失败也能提供基本画面，完全避免黑屏 |
| | | | 使用ImageStat计算平均亮度进行黑屏检测 |
| | | | 新增完整物理键盘监听：支持所有常用键（方向键、功能键、字母、数字、符号等） |
| | | | Shift键支持：Shift+字母输入大写，Shift+数字/符号输入上档符号 |
| | | | 只在远控开启时才监听键盘事件 |
| | | | 键值完全匹配keyclient.py的VK_CODES表：ENTER、CAPITAL、PAGEUP、PAGEDOWN、SCROLL、NUMPAD0-9等 |
| | | | 取消PrintScreen、Win键、Fn键的映射（真实键盘上读不到键值） |
| | | | 修复Enter键返回R、Win键返回L、CapsLock返回C等问题 |
| **v1.11.4** | 2026-05-29 | - | 网关反向代理功能： |
| | | | 集成 http-proxy 库实现多服务反向代理 |
| | | | NAS 路由完成：简单透传模式，正常运行 |
| | | | 禁用缓存机制：移除 if-none-match/if-modified-since headers |
| | | | 报警面板修复：清除报警后立即刷新面板（添加 alarmsCleared 消息处理） |
| | | | 上传功能集成：集成到主服务 `/_upload` 路径，删除独立 upload.js |
| | | | 密码验证优化：改为每次请求验证，不使用 session |
| | | | formidable v3 兼容：解构导入 `{ formidable }`，修复上传卡住问题 |
| | | | Alist 看门狗：提供启动/停止脚本，自动重启 alist.exe |
| | | | stderr 过滤：屏蔽 DEP0060/DEP0169 警告 |
| **v1.12.0** | 2026-06-01 | - | 帧发送完全异步架构重构： |
| | | | 全新3协程架构：主线程（纯节拍器）+ 截图协程 + 发送协程 |
| | | | 完全异步发送：截图、压缩、发送完全解耦，互不阻塞 |
| | | | 网络感知评分：滑动窗口30帧实时评估网络质量（成功率 > 90% / 60-90% / < 60%） |
| | | | 自适应帧率：网络好时6fps，一般时4fps，差时2fps |
| | | | 动态超时调整：网络好500ms，一般800ms，差时1000ms |
| | | | 队列长度限制：最大3帧，自动丢弃旧帧 |
| | | | 累积延迟追赶：延迟过大时自动跳帧追赶 |
| | | | 60分钟兜底重置：彻底防止长期时间漂移 |
| | | | 右键菜单新增「调整1080P分辨率」功能 |
| | | | 二维码/报警/收藏截图改为原尺寸，保持清晰度 |
| | | | 删除废弃的 hq_1080 变量 |

---

## 管理员客户端 (v1.11.0)

### 功能特性

1. **系统托盘图标**
   - 蓝色圆形图标，显示AD字样
   - 常驻运行，右键菜单操作

2. **免验证访问**
   - 固定设备ID：`ADMN`
   - 设备名称：`屏幕墙管理员`
   - 生成特殊token格式：`base64(deviceId:timestamp:admin)`
   - 服务端识别token后缀`:admin`，无需密码验证

3. **主要功能**
   - 打开屏幕墙（免验证）
   - 自助登号（免验证）
   - 设置服务器地址
   - 开机自启开关

4. **配置文件**
   - 存储位置：`%APPDATA%\ScreenWallAdmin\config.json`
   - 包含：服务器地址、端口、开机自启状态

5. **首次运行**
   - 自动弹出服务器地址设置对话框
   - 默认值：`localhost:3000`
   - 支持自定义IP和端口

### 核心实现

**关键常量** ([admin_client.py](file:///D:/ScreenWall2/client/admin_client.py))：
```python
ADMIN_VERSION = "1.0.0"
ADMIN_DEVICE_ID = "ADMN"
ADMIN_DEVICE_NAME = "屏幕墙管理员"
APP_NAME = "ScreenWallAdmin"
EXE_PATH = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__)
```

**管理员Token生成**：
```python
def generate_admin_token():
    timestamp = str(int(time.time()))
    token_str = f"{ADMIN_DEVICE_ID}:{timestamp}:admin"
    token = base64.b64encode(token_str.encode('utf-8')).decode('utf-8')
    return token
```

**开机自启配置**：
```python
# 与标准客户端保持一致的注册表配置
def set_auto_start(enabled):
    key = winreg.OpenKey(...)
    if enabled:
        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, f'"{EXE_PATH}" --minimized')
    else:
        winreg.DeleteValue(key, APP_NAME)
```

**退出处理逻辑**：
```python
def _tray_on_quit(icon, item):
    global _tray_icon
    if _tray_icon:
        try:
            _tray_icon.visible = False  # 先隐藏图标
            time.sleep(0.1)             # 给图标隐藏留时间
            _tray_icon.stop()
        except Exception:
            pass
    os._exit(0)  # 确保进程完全退出，不残留
```

### 打包配置

**单文件打包** ([admin_client.spec](file:///D:/ScreenWall2/client/admin_client.spec))：
- 使用PyInstaller单文件模式
- 集成pystray和PIL依赖
- 控制台隐藏（`console=False`）
- 输出文件名：`ScreenWallAdmin.exe`

**打包脚本** ([build_admin_client.py](file:///D:/ScreenWall2/client/build_admin_client.py))：
```python
# 位于 client/ 目录
# 使用时间戳临时目录避免文件锁定问题
timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
dist_dir = f'dist_admin_{timestamp}'
# 先打包到临时目录，再重命名为最终目录
```

**打包命令**：
```powershell
cd client
python build_admin_client.py
```

### 服务端验证逻辑

**服务端识别管理员Token** ([server.js](file:///D:/ScreenWall2/server/server.js))：
```javascript
// 检查token是否以:admin结尾
const isAdminToken = token.endsWith(':admin');
if (isAdminToken) {
    // 管理员身份，免验证
    return { deviceId: 'ADMN', deviceName: '屏幕墙管理员', isAdmin: true };
}
```

### 自助登号管理员模式

**自助登号页面处理逻辑** ([self-service.html](file:///D:/ScreenWall2/server/public/self-service.html))：
- 检测到管理员token时设置 `_isAdminUser = true`
- 当 `ADMN` 不在业务设备列表中时，自动选择第一个在线设备
- 短暂展开下拉列表提示用户选择（2秒后收起）
- 确保 `selfServiceInit` 消息正确传递两个ID：
  - `operatorId=ADMN`（管理员，业务发起方）
  - `businessId=设备ID`（业务设备，需要截图的设备）

**完整登录流程**：
```
管理员客户端打开自助登号页
    ↓
页面检测到管理员token → 设置 _isAdminUser = true
    ↓
收到state消息 → 更新设备列表
    ↓
检测到 ADMN 不在列表 → 默认选中第一个设备
    ↓
发送 selfServiceInit → operatorId=ADMN, businessId=设备ID
    ↓
服务端对比两个ID → 识别管理员帮别人登录的场景
```

---

## v1.10.0 详细更新说明

### 自助登号系统重构

#### 问题背景
1. **全局变量冲突**：原实现使用多个全局变量存储自助登号状态，当多个设备同时操作时，后一个操作会覆盖前一个操作的参数
2. **超时点击误触发**：旧的点击记录可能因为特殊原因（如BNL）被错误联动

#### 重构方案

##### 状态管理重构
- **移除全局变量**：
  - `_currentMUMUClient`
  - `_currentOperatorId`
  - `_currentOperatorName`
  - `_currentBusinessId`
  - `_currentBusinessName`
  - `_selfServiceTimeoutId`

- **新增按业务设备ID存储状态**：
  ```javascript
  const selfServiceStateByBusinessId = new Map();
  // businessId -> { operatorId, operatorName, businessName, mumuClient, clickTimestamp, timeoutId }
  ```

##### 点击时间窗口检查（双层保护）

**6秒超时保护**：
- `SELF_SERVICE_TIMEOUT_MS = 6000`
- 收到 `cameraClicked` 后启动定时器，6秒内未收到截图则清理状态

**3秒点击时间窗口**：
- `SELF_SERVICE_CLICK_WINDOW_MS = 3000`
- 检查点击时间和收到截图的时间差

**时间戳单位修复**：
- 服务端 `Date.now()` 返回毫秒
- MU服务 `time.time()` 返回秒
- `processQrcodeImage()` 自动检测并转换单位（>10000000000 视为秒）

##### 完整参数传递链路

```
1. 自助登号页面发送 selfServiceInit（4参数）
   └─ operatorId, operatorName, businessId, businessName

2. 用户点击 → 发送 mouseClick（4参数）
   └─ 服务端转发给MU服务（保持4参数）

3. MUMU相机点击 → 发送 cameraClicked（4参数）
   └─ 服务端保存状态到 selfServiceStateByBusinessId

4. 服务端 → 业务设备发送 requestHdScreenshot（5参数）
   └─ businessId, businessName, operatorId, operatorName, timestamp

5. 业务设备 → 服务端发送 hdScreenshot（6参数）
   └─ businessId, businessName, operatorId, operatorName, timestamp, image

6. 服务端检查时间窗口 → processQrcodeImage（6参数）
   └─ 验证通过后处理二维码
```

##### 关键函数修改

| 函数 | 修改内容 |
|------|----------|
| `clearSelfServiceState(businessId)` | 改为按businessId清理 |
| `processQrcodeImage(...)` | 新增operatorName、businessName、clickTimestamp参数 |
| `cameraClicked`处理 | 状态保存到Map，启动超时定时器 |
| `hdScreenshot`处理 | 从Map或消息获取参数，检查时间窗口 |

---

### MU服务自愈机制完善

#### 服务端自愈逻辑
- **离线时画面保持**：设备离线时不更新画面，只做自愈计数
- **连续帧判断**：达到阈值（2帧）后才恢复在线状态并更新画面
- **离线图显示**：使用服务端发送的 screenshot 字段，显示灰度离线水印

#### MU服务断线重连
- **心跳机制**：定时发送心跳检测连接状态
- **自动重连**：连接断开后自动尝试重连，避免长时间离线
- **时间窗口验证**：点击操作需在3秒内完成，超时操作不生效

---

### 自助登号页面优化

#### 尺寸调整
- **窗口宽度**：缩进至490-520像素
- **窗口高度**：根据屏幕分辨率动态调整，最小960像素，按60%屏幕高度计算
- **居中显示**：窗口启动时自动居中，并强制移动到屏幕右侧

#### 隐藏启动模式
- 支持 `--start-minimized` 参数启动后最小化
- 由JavaScript控制窗口显示时机

---

### 点击时间窗口机制

#### 服务端限制
- 点击时间窗口调整为**3秒**
- 超过3秒的点击信息不再处理

#### 客户端限制
- 点击操作超过**3秒**的记录不发送
- 确保操作实时性

---

## v1.10.1 详细更新说明

### 时间戳单位不匹配问题修复

#### 问题背景
- MU服务发送秒级时间戳（`time.time()`）
- 服务端使用毫秒级时间戳（`Date.now()`）
- 导致计算时间差时差值约为17亿毫秒，永远超过3秒窗口

#### 修复方案
```javascript
// 判断是否是秒级时间戳：小于10000000000（2001年左右），或者不是整数（带小数）
const isSeconds = normalizedTimestamp && (normalizedTimestamp < 10000000000 || !Number.isInteger(normalizedTimestamp));

if (isSeconds) {
    normalizedTimestamp = normalizedTimestamp * 1000;
}
```

#### 关键逻辑
- 秒级时间戳通常在1.7e9左右，远小于1e10
- 毫秒级时间戳通常在1.7e12左右，远大于1e10
- 通过检测时间戳是否小于1e10，或者是否带小数（`time.time()`返回浮点数）来自动判断

---

### 电脑客户端hdScreenshot参数补全

#### 问题背景
- 电脑客户端在发送`hdScreenshot`时只传递了`businessId`
- 缺少`operatorId`、`operatorName`、`businessName`
- 导致自助登号日志无法显示完整信息

#### 修复方案
```python
# 在requestHdScreenshot处理中
operator_id = data.get("operatorId")
operator_name = data.get("operatorName")
business_name = data.get("businessName")

# 构造payload时补充
if business_id:
    payload["businessId"] = business_id
if business_name:
    payload["businessName"] = business_name
if operator_id:
    payload["operatorId"] = operator_id
if operator_name:
    payload["operatorName"] = operator_name
```

---

## v1.10.2 详细更新说明

### 电脑客户端截图异常处理修复

#### 问题背景
- 电脑客户端在截图过程中如果出现异常（如PIL处理错误、ADB截图失败），会直接中断主进程
- 没有异常捕获机制，导致程序崩溃无法恢复

#### 修复方案
```python
# 在主循环截图代码中添加try-except
capt = ScreenCapturer(cfg["quality"], cfg["resizeW"], cfg["resizeH"], monitor_index=_current_monitor_index)
img_bytes = None
try:
    img_bytes = capt.capture(hq=hq, hq_limit=hq_limit, hq_quality=30)
except Exception as e:
    print(f"[截图] 异常: {e}")
finally:
    capt.close()
```

#### 关键逻辑
- 添加`img_bytes = None`初始化，防止异常后变量未定义
- 捕获所有异常并打印日志
- 异常发生后程序继续运行，不会中断主进程
- `finally`确保`capt.close()`始终被调用

---

## v1.10.3 详细更新说明

### MU服务异常处理完善

#### 问题背景
- MU服务在ADB截图失败时会中断主进程
- 发送帧失败时没有异常捕获
- 缺少详细的日志输出，难以排查问题

#### 修复内容

1. **ADB截图函数异常处理**
   - 分离`Image.open()`的异常处理
   - 添加`asyncio.TimeoutError`专门捕获
   - 添加详细的日志输出，包含数据长度

2. **截图Worker异常捕获**
   - 双层`try-except`保护
   - 添加失败间隔`sleep(0.5)`，防止CPU空转
   - 添加详细的日志输出

3. **主循环发送帧异常处理**
   - 为`_send_binary_frame()`添加`try-except`
   - 发送失败时打印日志并`continue`，不会中断连接
   - 只有`ConnectionClosed`才会`break`

4. **服务端MUMU超时断开优化**
   - 超时时间从10秒改为5秒
   - 超时断开时不再发送`mumuOffline`消息
   - 区分"MUMU微服务离线"和"超时断开"两种状态

#### 关键代码

**ADB截图异常处理**
```python
async def _adb_screenshot(self, compress=True):
    try:
        # ... ADB调用 ...
        if stdout and len(stdout) > 0:
            try:
                img = Image.open(io.BytesIO(stdout))
                # ... 处理图片 ...
                return img_bytes
            except Exception as pil_error:
                print(f"[ADB] PIL处理失败: {pil_error}, 数据长度={len(stdout)}")
                return None
    except asyncio.TimeoutError:
        print("[ADB] 截图超时")
        return None
    except Exception as e:
        print(f"[ADB] 截图异常: {e}")
        return None
```

**截图Worker优化**
```python
async def _screenshot_worker(self):
    consecutive_errors = 0
    while self.running:
        try:
            try:
                img_bytes = await self._adb_screenshot(compress=True)
            except Exception as screenshot_error:
                print(f"[MUMU] 截图Worker异常: {screenshot_error}")
                img_bytes = None
            # ... 处理图片 ...
            else:
                consecutive_errors += 1
                if consecutive_errors < 3:
                    await asyncio.sleep(0.5)
        except Exception as e:
            consecutive_errors += 1
            print(f"[MUMU] ScreenshotWorker错误: {e}")
            await asyncio.sleep(1)
        # ... 重连逻辑 ...
```

**主循环发送帧保护**
```python
try:
    timestamp, img_bytes = await asyncio.wait_for(
        self._frame_queue.get(), timeout=self._send_timeout
    )
    age = time.time() - timestamp
    if age > 2.0:
        continue
    try:
        await self._send_binary_frame(ws, img_bytes)
    except websockets.exceptions.ConnectionClosed:
        break
    except Exception as send_error:
        print(f"[MUMU] 发送帧失败: {send_error}")
        continue
except asyncio.TimeoutError:
    continue
except websockets.exceptions.ConnectionClosed:
    break
except Exception as e:
    print(f"[MUMU] 主循环异常: {e}")
    break
```

---

## v1.10.4 详细更新说明

### MU服务优化

#### 问题背景
1. 鼠标滚轮和滑动操作会阻塞主循环，多次点击会拉长执行时间
2. ADB断开时没有立即通知服务端，而是等待服务端超时
3. 重连成功后通知服务端时出现协程未await的错误
4. ADB稳定检测时间不足，导致重复注入DLL
5. 日志输出不够友好

#### 修复内容

1. **命令队列处理**
   - 新增`_cmd_queue`队列和`_cmd_worker`工作线程
   - 鼠标点击、滑动、滚轮、按键操作都放入队列异步执行
   - 超过3秒的命令自动丢弃
   - 不再阻塞WebSocket消息接收

2. **状态通知队列化**
   - 新增`_status_notify_queue`队列
   - ADB断开时立即发送`deviceOffline`通知
   - ADB稳定重连后发送`deviceOnline`通知
   - 使用`asyncio.wait()`同时监听帧队列和状态队列

3. **ADB稳定检测优化**
   - 检测条件：连续5次成功，每次间隔2秒（总耗时10秒）
   - 确保ADB真正稳定后再注入DLL

4. **日志输出优化**
   - 移除PIL处理失败日志（模拟器断连会有后续报告）
   - 服务端断开时显示`[MUMU] 服务端已断开，重试中...`

#### 关键代码

**命令队列Worker**
```python
async def _cmd_worker(self):
    while self.running:
        try:
            cmd = await asyncio.wait_for(self._cmd_queue.get(), timeout=1.0)
            cmd_type = cmd.get("type")
            cmd_time = cmd.get("time", 0)
            
            if time.time() - cmd_time > 3:
                continue
            
            if cmd_type == "click":
                await self._adb_click(cmd["x"], cmd["y"])
            elif cmd_type == "swipe":
                await self._adb_swipe(cmd["x1"], cmd["y1"], cmd["x2"], cmd["y2"], cmd["duration"])
            # ...
```

**状态通知队列**
```python
# ADB断开时
self._status_notify_queue.put_nowait({"type": "deviceOffline"})

# ADB稳定重连后
self._status_notify_queue.put_nowait({"type": "deviceOnline"})

# 主循环同时监听两个队列
done, pending = await asyncio.wait(
    [
        asyncio.create_task(self._frame_queue.get()),
        asyncio.create_task(self._status_notify_queue.get())
    ],
    timeout=self._send_timeout,
    return_when=asyncio.FIRST_COMPLETED
)
```

**ADB稳定检测**
```python
stable_count = 0
while self.running and stable_count < 5:
    await asyncio.sleep(2)
    # ... ADB连接检测 ...
    if 'connected' in result.lower():
        stable_count += 1
    else:
        stable_count = 0

if stable_count >= 5:
    print("[MUMU] ADB已稳定重连")
    self._status_notify_queue.put_nowait({"type": "deviceOnline"})
    print("[MUMU] 尝试重新注入DLL...")
    self._inject_camera_hook()
```

---

## v1.10.6 详细更新说明

### SplitCam A/B 刷新机制

#### 问题背景
- SplitCam 等虚拟摄像头软件存在图片缓存问题
- 二维码图片文件更新后，虚拟摄像头仍然显示旧图片
- 需要强制刷新机制来确保显示最新二维码

#### 解决方案
1. **双项目切换机制**
   - `Project_A.scproject`：显示 `last_qrcode.png`（二维码）
   - `Project_B.scproject`：显示 `blank.png`（空白图）
2. **A/B 切换流程**
   - 二维码处理成功后，先启动方案A
   - 等待3秒，再启动方案B
   - 通过切换不同项目，让 SplitCam 重新从磁盘加载图片
3. **集成到 `qrcode_processor.py`**
   - 新增 `launch_splitcam()` 函数启动项目
   - 新增 `trigger_ab_refresh()` 函数执行完整 A/B 刷新
   - 二维码处理成功后自动调用刷新机制

#### 关键代码
```python
def trigger_ab_refresh():
    """触发 A/B 刷新流程：方案A → 3秒 → 方案B"""
    # 1. 启动方案A
    launch_splitcam(project_a)
    # 2. 等待3秒
    time.sleep(3)
    # 3. 启动方案B
    launch_splitcam(project_b)
```

#### 文件变更
- `server/qrcode_processor.py`：集成 A/B 刷新功能
- `server/qrcode/Project_A.scproject`：方案A项目
- `server/qrcode/Project_B.scproject`：方案B项目
- `server/qrcode/blank.png`：空白占位图
- `server/qrcode/backup.scproject`：备份方案
- `server/qrcode/README.md`：子目录说明文档

---

## 部署指南

### 环境要求
- Node.js 16+
- Python 3.8+
- ADB（Android Debug Bridge，MUMU需要）
- 推荐宽屏显示器（9/10列布局）

### 启动服务端
```bash
cd D:\ScreenWall2\server
npm install
node server.js
```
服务地址：`http://localhost:3000`

### 启动电脑客户端
```bash
cd D:\ScreenWall2\client
python client.py
```

### 启动MU服务
1. 先启动MUMU模拟器（推荐540×960）
2. 启动服务端时会自动启动MU服务（无需手动启动）
   ```bash
   cd D:\ScreenWall2\server
   node server.js
   ```
- 启动时会自动检测并注入摄像头Hook v49
- 如未检测到模拟器会等待连接
- MU服务断开后会自动重启（3秒延迟）
- 启动成功后控制台窗口会自动最小化

### 自助登号完整流程

#### 前置准备
1. **MUMU摄像头Hook注入**
   - 启动MUMU模拟器
   - 启动服务端会自动注入（或手动运行 `injector49.exe`）
   - 注入成功后会返回提示

2. **Python环境准备**
   ```bash
   pip install pyzbar pillow numpy opencv-python
   ```

#### 完整操作步骤
1. **启动服务端**（MU服务会自动启动）
   ```bash
   cd D:\ScreenWall2\server
   node server.js
   ```

2. **启动业务设备**（要扫码的游戏账号所在设备）

3. **启动MUMU模拟器**（服务端会自动连接）

4. **打开自助登号页面**
   - 在电脑客户端右键菜单中点击「自助登号」
   - 会自动打开浏览器访问自助登号页面
   - 页面URL会携带当前电脑的设备ID（业务发起方）

5. **选择业务设备**
   - 在自助登号页面下拉列表中选择要扫码的设备（业务设备）
   - 默认选中当前打开页面的电脑设备
   - 列表会自动排除MU服务设备

6. **触发扫码操作**
   - 在自助登号页面中点击对应位置
   - 鼠标点击会传递到MUMU模拟器

7. **自动处理流程**
   ```
   用户点击 → 自助登号页面发送 mouseClick（带4参数）
   服务端转发 → MU服务收到 mouseClick（带4参数）
   相机弹窗 → DLL通过管道发送 CLICKED:时间戳
   MU服务 → 发送 cameraClicked 消息给服务端
   服务端保存 → 业务发起方和业务设备信息到 Map
   请求截图 → 向业务设备发送 requestHdScreenshot（带5参数）
   业务设备返回 → hdScreenshot (selfService目的，带6参数)
   服务端检查时间窗口 → 超过3秒丢弃
   处理二维码 → 保存原始截图、调用Python处理
   二维码处理 → 识别、裁剪、缩放、添加边框（200×360）
   验证文件更新 → 通过修改时间戳确认
   SplitCam A/B轮询 → 启动方案A→3秒→方案B，刷新虚拟摄像头
   服务端日志 → 记录成功/失败/超时
   ```

8. **扫码显示**
   - 使用虚拟摄像头软件（如SplitCam、OBS Virtual Camera）
   - 将 `qrcode/last_qrcode.png` 设置为虚拟摄像头源
   - 在实际扫码框中选择该虚拟摄像头即可完成登录

9. **SplitCam A/B 刷新机制**（强制刷新图片，解决缓存问题）
   - 二维码处理成功后，`qrcode_processor.py` 会自动执行 A/B 切换
   - **流程**：启动 `Project_A.scproject` → 等待3秒 → 启动 `Project_B.scproject`
   - 通过切换不同项目文件，让 SplitCam 重新从磁盘加载图片，避免缓存
   - 详细说明见 `server/qrcode/README.md`

#### 日志查看
- 同一设备操作：`[自助登号] 设备名使用二维码扫码（成功/失败/超时）`
- 帮助其他设备操作：`[自助登号] 设备名A帮助设备名B使用二维码扫码（成功/失败/超时）`

---

## 前端UI修复记录

### 配置中心输入框稳定性修复

**问题描述**：配置中心的三个输入框在设备列表热刷新时会出现状态丢失问题：
- 分组名编辑输入框：微刷新会导致输入框被弹出或内容丢失
- 未分组设备复选框：选中状态会在刷新后消失
- 开关机场景输入框：编辑内容会被刷新覆盖

**修复方案**：
1. **状态持久化**：使用 JavaScript 变量保存当前编辑状态，不依赖 DOM
2. **保存/恢复机制**：渲染前保存焦点元素、输入值和光标位置，渲染后恢复
3. **微刷新锁定**：输入框获得焦点时锁定自动刷新30秒，避免操作被打断
4. **复选框状态管理**：使用 Set 集合保存选中的设备ID，渲染时恢复选中状态

**涉及文件**：
- `server/public/main.html`：`renderConfigGroupList()`、`renderConfigUngroupedList()`、`renderConfigPowerList()` 函数

---

## 服务端异步化优化

### 异步处理改造记录

| 功能模块 | 优化内容 | 涉及函数 |
|---------|---------|---------|
| **日志系统** | 将同步文件写入改为异步队列模式，避免阻塞主事件循环 | `serverLog()`、`serverError()` |
| **配置热加载** | 配置文件重新加载和自更新过程改为异步操作 | `reloadServerConfigAsync()` |
| **报警截图清理** | 运行时的截图清理任务改为异步执行 | `cleanupOrphaned1080pScreenshotsAsync()` |
| **二维码处理** | 完整异步化，调用 Python 脚本处理二维码 | `processQrcodeImage()` |
| **持久化函数** | 所有持久化操作改为 async/await | `persistTasks()`、`persistGrid()`、`persistGroups()` 等 |

### 关键技术点

1. **Promise 包装**：使用 `util.promisify` 包装 Node.js 同步 API：
   ```javascript
   const fsWriteFile = promisify(fs.writeFile);
   const fsStat = promisify(fs.stat);
   const fsMkdir = promisify(fs.mkdir);
   const fsReadFile = promisify(fs.readFile);
   const execFileAsync = promisify(execFile);
   ```

2. **异步 IIFE**：对于无法直接改为 async 的回调函数，使用异步立即执行函数表达式：
   ```javascript
   (async () => {
     await asyncOperation();
   })();
   ```

3. **异常处理**：全局异常拦截防止服务端崩溃：
   ```javascript
   process.on('uncaughtException', (err) => { ... });
   process.on('unhandledRejection', (reason) => { ... });
   ```

---

## 内存管理与优化

### 前端优化
| 优化项 | 说明 |
|--------|------|
| Blob URL释放 | `beforeunload`时回收，防止内存累积 |
| 定时器清理 | 页面关闭时清理所有定时器 |
| 帧超时丢弃 | 超过2秒的旧帧自动忽略 |
| 帧节流 | 自助登号页面300ms间隔更新，减少Blob创建 |

### 服务端优化
| 优化项 | 说明 |
|--------|------|
| 帧批量推送 | `_browserBatch`减少IPC压力 |
| 连接清理 | `ws.on('close')`时自动清理Map/Set |
| 帧过期清理 | 过期帧自动移除缓冲 |
| 自助登号状态Map | 按业务设备ID存储，避免全局变量冲突 |

### MU服务优化
| 优化项 | 说明 |
|--------|------|
| 帧队列限制 | maxsize=3，防止内存膨胀 |
| 异步队列 | 截图Worker独立线程，主循环只处理发送 |
| 点击时间窗口 | 3秒内的截图请求有效，超时被丢弃 |

---

## 注意事项

1. **MUMU模拟器必须先启动**，MU服务才会正常运行
2. **推荐模拟器分辨率**：540×960（最佳帧率3-4fps）
3. **设备ID需全局唯一**，避免冲突
4. **9列/10列布局**需要宽屏显示器（带鱼屏/双屏）
5. **报警记录**24小时后自动删除
6. **收藏状态**持久化到服务端，刷新页面不丢失
7. **帧超时**设置为2秒，防止网络波动累积旧帧
8. **历史帧率**：早期逐步调整（1fps→3fps→5fps→8fps），v1.7.9 后稳定为**6fps**
9. **自助登号超时机制**：6秒超时保护 + 3秒点击时间窗口

---

## 前端技术债务与重构建议

### 当前问题分析

**状态管理 Bug**：主页面采用"全量重新渲染"模式，每次数据更新时整个 DOM 区域被完全替换（`innerHTML = ...`），导致：
- 滚动位置丢失（任务弹窗聊天区、任务列表）
- 输入框内容丢失（配置中心、任务弹窗）
- 复选框选中状态丢失（未分组设备列表）
- 用户操作被打断

**触发场景**：服务端推送设备状态更新、任务列表变化等事件时，触发渲染函数导致 DOM 重建。

### 前端微刷新方案（已实施）

当前采用**状态锁定 + 状态保存/恢复**双机制：

**1. 状态锁定机制**（长期重构建议方案三，已实施）：
- 用户操作期间暂停自动刷新，避免输入被打断
- `isMicroRefreshLocked()` 检查，焦点获得时锁定 30 秒
- 收到配置广播时临时禁用锁 → 强制刷新 → 恢复锁

**2. 状态保存/恢复机制**（同步实施）：
- 渲染前保存当前状态（焦点元素、光标位置）
- 渲染后恢复之前保存的状态（但不恢复输入值，让新数据正确显示）
- 关闭弹窗时重置到默认位置

**涉及文件**：
- `server/public/main.html`：`isMicroRefreshLocked()`、`renderConfigGroupList()` 等函数

### 长期重构建议

当页面变得更复杂或需要重大调整时，建议采用以下方案：

| 方案 | 描述 | 适用场景 | 状态 |
|------|------|---------|------|
| **增量 DOM 更新** | 只更新变化的部分，而非整个区域 | 中等复杂度，不想引入框架 | 待实施 |
| **引入前端框架** | 使用 Vue/React 等框架的响应式系统 | 高复杂度，需要组件化 | 待实施 |
| **状态锁定机制** | 用户操作期间暂停自动刷新 | 简单场景，快速修复 | ✅ 已实施 |

### 重构时机建议

建议在以下情况考虑重构：
- 页面功能模块超过 5 个
- 单文件代码量超过 10000 行
- 需要实现复杂的状态共享
- 团队规模扩大，需要更好的代码组织

### 当前方案说明

**状态锁定 + 状态保存/恢复**：
| 维度 | 优点 | 缺点 |
|------|------|------|
| 实现难度 | 简单直接，改动小 | - |
| 兼容性 | 兼容所有浏览器 | - |
| 性能 | 不影响渲染性能 | - |
| 代码复杂度 | 增加了状态变量和保存/恢复逻辑 | 代码量增加 |
| 可维护性 | 逻辑清晰，易于理解 | 需要维护状态同步 |

> **结论**：当前方案是合理的解决方案，通过状态锁定和状态保存/恢复机制解决了用户体验问题。后续可根据需求考虑增量 DOM 更新重构。

### 统一广播函数 `broadcastAllConfigUpdates()`

为解决配置中心修改后前端微刷新失效问题，服务端实现了统一的广播函数：

**函数定义**（`server/server.js`）：
```javascript
function broadcastAllConfigUpdates() {
  const deviceListPayload = getDeviceListPayload();
  broadcastToBrowsers({ type: 'deviceList', devices: deviceListPayload });
  broadcastToBrowsers({ type: 'groups', groups: groups });
  broadcastToBrowsers({ type: 'powerScenes', powerScenes: powerScenes });
  notifyWallClients('configChanged', {});
}
```

**调用场景**：
| 场景 | 调用位置 |
|------|----------|
| 添加分组 | `addGroup()` |
| 移除分组 | `removeGroup()` |
| 修改分组 | `updateGroupName()` |

**设计特点**（按此方法实现）：
1. **统一广播**：一次性发送 `deviceList`、`groups`、`powerScenes` 三种消息
2. **模块化拆分**：`broadcastToBrowsers()` 支持单独发送任意类型消息
3. **前端按需订阅**：其他前端页面可单独订阅需要的消息类型，不受统一广播影响
4. **微刷新支持**：前端收到广播后，根据消息类型强制刷新对应区域（忽略锁机制）

**前端处理逻辑**（`server/public/main.html`）：
- `groups` 消息 → 更新分组数据 + 强制刷新格子/侧边栏 + 刷新配置中心
- `powerScenes` 消息 → 更新开关机数据 + 强制刷新格子/侧边栏 + 刷新配置中心
- `deviceList` 消息 → 同步设备数据（无需强制刷新）

---

## 权限管理与弹窗优化（v1.9.9）

### 版本信息
- **客户端版本**：v1.9.9 → v1.10.0
- **更新日期**：2026-05-22

### 新增功能

#### 1. 权限管理系统
- **服务端权限API**：新增 /api/checkPermission 和 /api/setPermission 接口
- **权限数据结构**：permissions.json 文件持久化存储设备权限
- **两种权限类型**：
  - allowScreenWall：屏幕墙访问权限
  - allowSelfService：自助登号访问权限
- **前端权限管理页面**：
  - 独立登录入口（管理员验证）
  - 设备列表展示与搜索
  - 屏幕墙/自助登号两个开关独立控制
  - 开关状态实时同步到服务端

#### 2. 客户端权限检查
- 托盘菜单"打开屏幕墙"和"自助登号"点击时自动检查权限
- 无权限时弹出提示弹窗，不打开目标页面
- 权限检查通过后正常打开页面

### 修复内容

#### 1. 权限弹窗可点击性问题
- **问题**：原生的 Windows MessageBox 在某些情况下无法点击确定按钮
- **原因**：窗口焦点问题，需要先将小弹窗切换为选中状态才能点击
- **解决方案**：改用 Tkinter 的 messagebox.showwarning() 实现弹窗
  - 设置 topmost 确保窗口始终在最前
  - 使用 lift() 和 focus_force() 获取窗口焦点
  - 确保弹窗显示后确定按钮可以直接点击
  - 提供回退机制：Tkinter 不可用时自动回退到原生 MessageBox

#### 2. 监控上墙弹窗背景颜色
- **问题**：监控上墙弹窗的背景蒙版颜色比其他弹窗更深
- **修复**：统一调整为 rgba(0,0,0,0.6)，保持视觉一致性

#### 3. 权限管理页面布局优化
- **登录页面**：保持 400px 固定宽度不变
- **权限管理页面**：
  - 宽度调整为 650px，高度固定为 600px（最大 85vh）
  - 使用 flex 布局确保内容区域可滚动
  - 设备列表支持垂直滚动，内容较多时显示正常滚动条

#### 4. 主页面动物锁相关修复
- 修复了主页面中动物锁（游戏掉线报警）相关的问题
- 确保报警检测和显示功能正常工作

### 技术实现

#### 服务端权限管理
```javascript
// 权限检查接口
POST /api/checkPermission
Request: { deviceId: string, type: 'screenWall' | 'selfService' }
Response: { allowed: boolean }

// 权限设置接口
POST /api/setPermission
Request: { deviceId: string, allowScreenWall: boolean, allowSelfService: boolean }
Response: { ok: true }
```

#### 客户端权限检查流程
```
用户点击托盘菜单 → _tray_on_open_screenwall() / _tray_on_open_self_service()
  ↓
调用 _check_permission_and_open()
  ↓
请求服务端 /api/checkPermission
  ↓
├─ 有权限 → _open_browser_with_page() 打开目标页面
└─ 无权限 → Tkinter messagebox.showwarning() 显示提示
```

#### 弹窗实现核心代码
```python
# 使用 Tkinter 显示弹窗 - 更可靠的方式
root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
root.lift()
root.focus_force()

messagebox.showwarning(
    "权限不足",
    f"没有{permission_name}权限，请联系管理员"
)
```

### 权限默认策略
- **新设备**：默认没有任何权限（allowScreenWall = false, allowSelfService = false）
- **管理员需要在权限管理页面手动开启**相应权限后，设备才能使用对应功能

---

### 设备重装自动继承流程

**触发场景**：设备重装系统后重新上线，客户端会生成新的 deviceId

**匹配机制**：
- MAC地址：网卡MAC地址（重装后一般不变）
- 设备名：完全匹配或包含关系（允许设备名略有变化）

**继承流程图**：
```
1. 客户端重装后首次注册
   ↓
2. 服务端先尝试按 deviceId 查找（没找到）
   ↓
3. 服务端通过 MAC地址 + 设备名 匹配旧设备
   ↓
4. 找到旧设备记录 → 继承其所有数据
   ↓
5. 迁移所有关联数据到新 deviceId
   ↓
6. 删除旧设备记录
   ↓
7. 新设备上线（打印 [继承] 日志）
```

**继承的数据项（完整列表）**：
1. 格子位置映射 (gridLayout)
2. 分组关系 (groups)
3. 截图集合 (collections)
4. 监控墙配置 (wallDevices, monitorWallDevices)
5. 历史报警记录 (alarmRecords)
6. 收藏状态 (favorites)
7. 开关机场景 (powerScenes)
8. 任务记录 (tasks)
9. 权限配置 (devicePermissions)

**日志示例**（优化后，简洁）：
```
[+] 上线: 9UXW干一天刚过同感同感 (aeawtmgwtiau3yfl-admin2) ...
[继承] 9UXW干一天刚过同感同感 (aeawtmgwtiau3yfl-admin) → 9UXW干一天刚过同感同感 (aeawtmgwtiau3yfl-admin2)（含权限）
```

---

### 统一的设备ID迁移和删除接口函数

为了确保在设备重装或删除时，所有相关数据（包括权限）都能被正确处理，新增了两个统一的接口函数：

#### `migrateDeviceId(oldDeviceId, newDeviceId)`

**用途**：设备重装上线时，将旧设备的所有关联数据迁移到新设备ID

**处理的数据项**：
1. `gridLayout` - 格子位置映射
2. `groups` - 分组的 deviceIds 数组
3. `collections` - 截图集合
4. `wallDevices` - 监控墙持久化追踪
5. `monitorWallDevices` - 监控墙白名单
6. `alarmRecords` - 历史报警记录
7. `lastAlarmTime` - 报警时间 Map
8. `favorites` - 格子上收藏的星星图标
9. `powerScenes` - 开关机场景
10. `tasks` - 任务记录
11. `devicePermissions` - 设备权限配置（包含屏幕墙和自助登号权限）

**调用场景**：设备注册时，通过 MAC 地址 + 设备名匹配到旧设备后自动调用

**代码位置**：[server/server.js#L305-L391](file:///d:/ScreenWall2/server/server.js#L305-L391)

---

#### `deleteDeviceCompletely(deviceId)`

**用途**：从所有持久化数据和内存数据中彻底删除该设备

**处理的数据项**（与迁移函数一致，12项）：
1. `gridLayout` - 格子位置映射
2. `groups` - 分组的 deviceIds 数组
3. `collections` - 截图集合标记为已删除
4. `wallDevices` - 监控墙持久化追踪
5. `monitorWallDevices` - 监控墙白名单
6. `alarmRecords` - 历史报警记录
7. `lastAlarmTime` / `alarmStates` / `pending_alarms` - 报警相关状态
8. `favorites` - 格子上收藏的星星图标
9. `powerScenes` - 开关机场景
10. `tasks` - 任务记录（标记为 deviceDeleted）
11. `devicePermissions` - 设备权限配置
12. ALARM_SCREENSHOTS_DIR 下的报警截图文件

**调用场景**：配置中心删除离线设备时调用

**返回值**：`{ deviceName, deviceId }` - 删除的设备名和设备ID

**代码位置**：[server/server.js#L397-L487](file:///d:/ScreenWall2/server/server.js#L397-L487)

---

### 相关文件
- **服务端**：
  - server/server.js：权限 API、权限管理逻辑、统一迁移/删除函数、管理员 Token 验证
  - server/permissions.json：权限数据持久化文件
- **前端**：
  - server/public/main.html：权限管理页面 UI 和交互、支持管理员 Token 免验证登录
  - server/public/self-service.html：自助登号页面、管理员模式逻辑
- **客户端**：
  - client/client.py：权限检查和弹窗显示逻辑
  - client/dist2/ScreenWallClient/：标准客户端打包输出目录
  - client/admin_client.py：管理员客户端主程序
  - client/admin_client.spec：管理员客户端打包配置
  - client/build_admin_client.py：管理员客户端打包脚本
  - client/dist_admin/ScreenWallAdmin.exe：管理员客户端打包输出
  - server/mumu-service/mumu_service.py：MU 微服务
  - server/mumu-service/config.json：MU 服务配置文件
