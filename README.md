# ScreenWall2 项目文档

## 项目概述

ScreenWall2 是一个多设备屏幕监控系统，支持同时监控多台安卓设备，实时显示画面并进行远程控制。

---

## 目录结构

```
D:\ScreenWall2\
├── server/                          # 服务端
│   ├── server.js                    # 主服务程序（Node.js）
│   ├── public/                      # 前端静态资源
│   │   ├── index.html              # 主页面（设备格子视图）
│   │   ├── main.html               # 主页面完整版
│   │   ├── monitor-wall.html       # 监控墙页面
│   │   ├── preview.html            # 预览弹窗页面
│   │   ├── self-service.html       # 自助登号页面
│   │   ├── style.css               # 样式文件
│   │   ├── config.json             # 配置文件
│   │   └── devices.json            # 设备数据持久化
│   ├── logs/                       # 日志目录
│   └── package.json                # 依赖配置
│
├── client/                          # 电脑客户端
│   ├── client.py                   # 客户端主程序
│   ├── config.json                 # 配置文件
│   ├── build_client.py             # 打包脚本
│   └── dist/                       # 打包输出
│
├── mumu-client/                     # MUMU模拟器客户端
│   ├── mumu_client.py              # 主程序
│   ├── injector49.exe              # 摄像头Hook注入器
│   └── config.json                 # 配置文件
│
├── mumu_camera_hook/               # MUMU摄像头Hook模块
│   ├── camera_hook49.cpp           # Hook DLL源码
│   ├── camera_hook49.dll           # Hook DLL
│   ├── injector49.cpp              # 注入器源码
│   ├── injector49.exe              # 注入器
│   ├── README.md                    # Hook模块文档
│   └── ANALYSIS_REPORT.md          # 技术分析报告
│
└── .trae/rules/                    # 项目规则
    ├── OFFLINE_HEAL_SPEC.md        # 离线自愈规范
    └── project_rules.md             # 项目规则
```

---

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              浏览器端                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
│  │  main.html   │ │monitor-wall  │ │ preview.html │ │self-service  │     │
│  │  (格子视图)  │ │  (监控墙)   │ │  (预览弹窗)  │ │ (自助登号)   │     │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘     │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                              │ WebSocket                                   │
└──────────────────────────────┼────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            服务端 (server.js)                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        WebSocket Server                              │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │browserClients│ │wallClients │ │previewClients│ │wssClient   │   │   │
│  │  │  (浏览器)   │ │ (监控墙)   │ │ (预览)     │ │ (设备)    │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                               │                                              │
│         ┌─────────────────────┼─────────────────────┐                        │
│         ▼                     ▼                     ▼                        │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐                  │
│  │  devices    │      │ 帧缓存      │      │ 业务逻辑    │                  │
│  │  (设备状态) │      │ _browserBatch│      │ 截图/报警   │                  │
│  └─────────────┘      │ _wallBatch  │      └─────────────┘                  │
│                       └─────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            设备客户端                                       │
│  ┌──────────────────────┐              ┌──────────────────────┐            │
│  │    电脑客户端         │              │   MUMU模拟器客户端    │            │
│  │    client.py         │              │   mumu_client.py     │            │
│  │                      │              │                      │            │
│  │  - 屏幕截图           │              │  - ADB截图(540P)    │            │
│  │  - 键盘鼠标控制       │              │  - WebSocket推流     │            │
│  │  - UU远程控制         │              │  - 摄像头Hook注入    │            │
│  └──────────────────────┘              └──────────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 技术规格

### 画面分辨率与帧率

| 场景 | Level | 分辨率 | 说明 |
|------|-------|--------|------|
| 格子视图（main.html） | 0 | 480×270 | 最低画质，用于格子缩略图 |
| 监控墙格子（monitor-wall.html） | 1 | 853×720 | 中等画质 |
| 预览画面（preview.html） | 2 | 1280×720 | 高清画质 |
| 自助登号（self-service.html） | 2 | 1280×720 | 高清画质 |

### 帧类型定义

| 类型 | 值 | 方向 | 说明 |
|------|---|------|------|
| 0x01 | 客户端→服务端 | 客户端发送截图请求 | 用于获取指定level的截图 |
| 0x10 | 服务端→浏览器 | 实时画面帧 | WebP格式二进制帧 |

### 前端页面规格

| 页面 | 设备ID来源 | 流级别 | 主要功能 |
|------|-----------|--------|----------|
| main.html | 设备注册 | 动态（0/1/2） | 格子视图、UU控制 |
| monitor-wall.html | 设备注册 | 1（格子）/2（预览） | 监控墙、浮动预览 |
| preview.html | URL参数/initData | 2 | 独立预览弹窗 |
| self-service.html | URL参数 | 2 | 自助登号、MUMU控制 |

### MUMU客户端规格

| 参数 | 值 |
|------|-----|
| 模拟器分辨率 | 540×960（推荐）或 720×1280 |
| 客户端输出分辨率 | 360×640 |
| 压缩格式 | WEBP（质量30） |
| 帧队列大小 | 3帧 |
| 帧超时 | 2秒 |
| 理论帧率 | 3-4 fps |

---

## 通信协议

### WebSocket消息类型

#### 浏览器 → 服务端

| 消息类型 | 参数 | 说明 |
|----------|------|------|
| subscribePreview | deviceId | 订阅设备预览 |
| unsubscribePreview | deviceId | 取消订阅预览 |
| setLevel | deviceId, level | 设置流级别（0/1/2） |
| subscribeWall | cols, rows, cellW, cellH | 订阅监控墙 |
| unsubscribeWall | - | 取消监控墙订阅 |
| keyClick | deviceId, key | 发送按键 |
| mouseClick | deviceId, x, y | 鼠标点击 |
| mouseSwipe | deviceId, x, y, x2, y2, duration | 鼠标滑动 |
| mouseScroll | deviceId, delta | 鼠标滚轮 |
| selfServiceInit | deviceId, deviceName | 自助登号初始化 |

#### 服务端 → 浏览器

| 消息类型 | 参数 | 说明 |
|----------|------|------|
| state | devices[], groups[] | 初始状态 |
| deviceList | devices[] | 设备列表更新 |
| devicePreviewStatus | deviceId, status | 设备预览状态 |
| wallStateUpdate | devices[], groups[] | 监控墙状态更新 |
| screenshotBatch | screenshots[] | 截图批量推送 |
| latency | latency | 网络延迟 |

#### 设备客户端 → 服务端

| 消息类型 | 参数 | 说明 |
|----------|------|------|
| register | deviceId, deviceName, version, screenWidth, screenHeight... | 设备注册 |
| binary (0x01) | deviceId, width, height, level, data | 截图请求响应 |

#### 服务端 → 设备客户端

| 消息类型 | 参数 | 说明 |
|----------|------|------|
| setLevel | level | 设置流级别 |
| keyClick | key | 按键事件 |
| mouseClick | x, y | 点击事件 |
| mouseSwipe | x, y, x2, y2, duration | 滑动事件 |

### 二进制帧格式

```
┌─────────────────────────────────────────┐
│  Header (8 bytes)                       │
├─────────────────────────────────────────┤
│ [0] 0x10 (frame type)                  │
│ [1] deviceId length                     │
│ [2] flags (bit0=HQ)                   │
│ [3] reserved                           │
│ [4-5] screen width (big-endian)        │
│ [6-7] screen height (big-endian)       │
├─────────────────────────────────────────┤
│ [8..8+n-1] deviceId (UTF-8)            │
├─────────────────────────────────────────┤
│ [8+n..] image data (WEBP)              │
└─────────────────────────────────────────┘
```

---

## 离线自愈机制

### 阈值定义

- **自愈阈值**：`FRAME_HEAL_THRESHOLD = 2`
- 设备离线后，收到连续2帧才恢复在线状态

### 自愈流程

```
设备离线 → 不更新画面 → 帧计数器++
                          ↓
                    计数器 ≥ 2?
                    ↓是          ↓否
               恢复在线      继续计数
               更新画面
```

### 自愈实现位置

| 文件 | 变量 | 类型 |
|------|------|------|
| main.html | frameHealCount | Map<deviceId, count> |
| monitor-wall.html | frameHealCount | Map<deviceId, count> |
| preview.html | frameHealCount | number |
| self-service.html | frameHealCount | number |

---

## 功能模块

### 1. 主页面 (main.html)

**功能**：
- 设备格子视图显示
- 设备在线/离线状态管理
- UU远程控制
- 设备预览弹窗

**关键变量**：
```javascript
var FRAME_HEAL_THRESHOLD = 2;
var devices = {}; // deviceId -> device info
var frameHealCount = new Map(); // deviceId -> count
```

### 2. 监控墙 (monitor-wall.html)

**功能**：
- 监控墙布局显示
- 浮动预览弹窗
- 设备切换

**关键变量**：
```javascript
var FRAME_HEAL_THRESHOLD = 2;
var wallPreviewDeviceId = null;
var wallData = { devices: [], groups: [] };
```

### 3. 预览弹窗 (preview.html)

**功能**：
- 独立设备预览
- 键盘控制
- 设备列表选择

**关键变量**：
```javascript
var FRAME_HEAL_THRESHOLD = 2;
var deviceId = ''; // 从URL参数或sessionStorage获取
var fromWall = false; // 是否从监控墙打开
```

### 4. 自助登号 (self-service.html)

**功能**：
- MUMU模拟器画面预览
- 安卓三键控制（返回、主页、任务）
- 鼠标滑动、点击操作

**URL参数**：
```
?deviceId=xxx&deviceName=xxx
```

**关键变量**：
```javascript
var deviceId = null;        // 业务ID（电脑客户端）
var previewDeviceId = 'MUMU-service'; // MUMU设备ID（固定）
var FRAME_HEAL_THRESHOLD = 2;
```

### 5. MUMU客户端 (mumu_client.py)

**功能**：
- ADB截图（screencap -p）
- 图像压缩（WEBP 360×640）
- WebSocket实时推流
- 摄像头Hook自动注入

**关键参数**：
```python
FRAME_QUEUE_SIZE = 3
FRAME_SEND_TIMEOUT = 1.0  # 秒
FRAME_EXPIRE_TIME = 2.0   # 秒
COMPRESS_QUALITY = 30      # WEBP质量
OUTPUT_SIZE = (360, 640)  # 输出分辨率
```

### 6. 摄像头Hook (camera_hook49)

**功能**：
- 自动检测摄像头选择弹窗（336×316 Qt5窗口）
- 自动点击中心位置
- 命名管道通信

**管道名称**：`\\.\pipe\MuMuCameraHook`

---

## 配置文件

### server/public/config.json

```json
{
  "serverVersion": "1.9.3",
  "serverSelfUpdate": "0",
  "uuDownloadUrl": "/UURemote_Setup_xxx.exe"
}
```

### client/config.json

```json
{
  "server": {
    "host": "localhost",
    "port": 8080
  },
  "device": {
    "deviceId": "PC-001",
    "deviceName": "设备名称"
  },
  "capture": {
    "fps": 6
  }
}
```

### mumu-client/config.json

```json
{
  "adb": {
    "host": "127.0.0.1",
    "port": 16384
  },
  "server": {
    "host": "localhost",
    "port": 8080
  },
  "device": {
    "deviceId": "MUMU-service",
    "deviceName": "MUMU模拟器"
  }
}
```

---

## 部署指南

### 环境要求

- Node.js 16+
- Python 3.8+
- ADB (Android Debug Bridge)
- MUMU模拟器

### 启动服务端

```bash
cd D:\ScreenWall2\server
npm install
node server.js
```

服务地址：`http://localhost:8080`

### 启动电脑客户端

```bash
cd D:\ScreenWall2\client
python client.py
```

### 启动MUMU客户端

1. 启动MUMU模拟器
2. 运行客户端：
```bash
cd D:\ScreenWall2\mumu-client
python mumu_client.py
```

---

## 内存管理

### 前端内存优化

| 优化项 | 实现位置 | 说明 |
|--------|----------|------|
| Blob URL释放 | 各页面 beforeunload | 防止图片缓存累积 |
| 定时器清理 | beforeunload | 防止定时器泄漏 |
| 帧队列限制 | mumu_client.py | maxsize=3，防止内存膨胀 |
| 帧超时丢弃 | 各页面 | age > 2秒丢弃旧帧 |

### 服务端内存优化

| 优化项 | 实现位置 | 说明 |
|--------|----------|------|
| 帧批量推送 | _browserBatch | 减少IPC压力 |
| 帧过期清理 | frameFrames | 超过2秒清理 |
| 连接清理 | ws.on('close') | 断开时清理Map/Set |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.9.3 | 2026-05-19 | 最新版本，自助登号功能 |
| 1.x.x | 2026-05 | 历史版本 |

---

## 注意事项

1. **MUMU模拟器必须先启动**才能运行客户端
2. **摄像头Hook**会在客户端启动时自动注入
3. **设备ID**需全局唯一，避免冲突
4. **帧超时**设置为2秒，防止旧帧堆积
