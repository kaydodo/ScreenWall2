# ScreenWall2 屏幕墙监控系统

## 项目概述

ScreenWall2 是一套多设备屏幕监控与远控系统，支持同时监控多台电脑设备，实时显示屏幕画面、远程控制、一键启动UU远程、设备开关机管理、设备分组、收藏截图、游戏掉线报警等完整功能。

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
- 专属视频流通道
- 安卓三键控制（返回/主页/任务）
- 摄像头Hook自动选择
- 业务ID指定（URL参数传入）
- Python二维码处理（pyzbar）
- 自动裁剪与200×360输出
- 时间戳验证确保文件更新

---

## 目录结构

```
D:\ScreenWall2\
├── server/                          # 服务端
│   ├── server.js                    # 主服务程序
│   ├── qrcode_processor.py          # 二维码处理脚本
│   ├── qrcode/                      # 二维码输出目录
│   │   ├── screenshot_original.png  # 原始截图
│   │   └── last_qrcode.png         # 处理后的二维码
│   ├── public/                      # 前端静态资源
│   │   ├── main.html                # 主页面
│   │   ├── monitor-wall.html        # 监控墙页面
│   │   ├── preview.html            # 预览弹窗页面
│   │   ├── self-service.html        # 自助登号页面
│   │   ├── style.css                # 样式文件
│   │   ├── config.json              # 配置文件
│   │   └── devices.json             # 设备数据持久化
│   ├── logs/                        # 日志目录
│   └── package.json                 # 依赖配置
│
├── client/                          # 电脑客户端
│   ├── client.py                    # 主程序
│   ├── config.json                  # 配置文件
│   ├── build_client.py              # 打包脚本
│   └── dist/                        # 打包输出目录
│
├── mumu-client/                     # MUMU模拟器客户端
│   ├── mumu_client.py              # 主程序
│   ├── injector49.exe               # 摄像头Hook注入器
│   └── config.json                  # 配置文件
│
└── mumu_camera_hook/               # MUMU摄像头Hook模块
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
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │ WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      设备客户端                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐         │
│  │   电脑客户端         │      │   MUMU客户端         │         │
│  │   client.py          │      │   mumu_client.py     │         │
│  │                      │      │                      │         │
│  │  - 屏幕截图(MSS)     │      │  - ADB截图          │         │
│  │  - 键盘鼠标远控      │      │  - WebSocket推流    │         │
│  │  - 远控开关/多显示器 │      │  - 摄像头Hook注入   │         │
│  │  - 心跳/报警截图     │      │  - 自动注入检测     │         │
│  └──────────────────────┘      └──────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
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

#### MUMU客户端 → 服务端
| 消息 | 参数 | 说明 |
|------|------|------|
| `hdScreenshot` | `purpose, timestamp, deviceId, image, businessId, businessName, operatorId, operatorName` | 高清截图（自助登号携带全部6个参数） |

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
  //   mumuClient: MUMU客户端连接,
  //   clickTimestamp: 点击时间戳,
  //   timeoutId: 超时定时器ID
  // }
  ```

##### 2. 双层超时保护机制

**5秒超时保护**（`SELF_SERVICE_TIMEOUT_MS = 5000`）：
- 收到 `cameraClicked` 后启动定时器
- 5秒内未收到截图则清理状态，防止状态挂死

**2秒点击时间窗口**（`SELF_SERVICE_CLICK_WINDOW_MS = 2000`）：
- 检查点击时间和收到截图的时间差
- 超过2秒的截图请求被丢弃

**时间戳单位统一**：
- 服务端使用 `Date.now()`（毫秒）
- MUMU客户端使用 `time.time()`（秒）
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
        deviceId: previewDeviceId,         // MUMU客户端ID（操作目标）
        operatorId: originalDeviceId,      // 业务发起方ID
        operatorName: originalDeviceName,   // 业务发起方名称
        businessId: selectedDeviceId,      // 业务设备ID
        businessName: selectedDeviceName,   // 业务设备名称
        x, y,
        previewWidth, previewHeight
      })

3. 服务端收到 mouseClick（server.js）
   └─ 坐标转换（preview → device分辨率）
   └─ 转发给MUMU客户端：
      {
        type: 'mouseClick',
        x: actualX, y: actualY,
        deviceId: mDevId,
        deviceName: dev.deviceName,
        operatorId, operatorName,
        businessId, businessName
      }

4. MUMU客户端收到 mouseClick
   └─ 保存点击信息到本地

5. 相机DLL检测到点击弹窗
   └─ 通过管道发送 CLICKED:timestamp

6. MUMU客户端发送 cameraClicked
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
   ├─ 启动5秒超时定时器
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
   ├─ 检查时间窗口：now - clickTimestamp <= 2000ms
   │  └─ 超过2秒：丢弃，打印超时日志
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
| `SELF_SERVICE_TIMEOUT_MS` | server.js | 自助登号超时时间（5000ms） |
| `SELF_SERVICE_CLICK_WINDOW_MS` | server.js | 点击时间窗口（2000ms） |
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

## 关键版本历史

| 版本 | Git提交 | 核心改进 |
|------|---------|---------|
| **v1.0早期** | b72f95e | 初始版本：Base64传输 |
| **v1.2.6** | 5c9adb7 | OCR报警机制；1080p临时高清（已移除） |
| **v1.2.7** | 80fca08 | 远程键盘控制功能 |
| **v1.2.8** | c02ca27 | 报警机制重构（移除九宫格） |
| **v1.2.9** | 663d6c7 | 远控UI优化，列表弹窗 |
| **v1.3.0** | 5b3753e | UU远程自动检测与安装 |
| **v1.3.20** | a8851c4 | 客户端帧率5fps→**8fps**，心跳150→240帧 |
| **v1.4.0** | 629f880 | 监控预览弹窗修复，大版本号更新 |
| **v1.5.0** | bd8e9a7 | 移除stopHQ静态帧捕获 |
| **v1.6.0** | 8c51328 | 统一截图频率8fps；动态sleep精确控制 |
| **v1.6.2** | 4e7d63a | 增加MAC地址识别，设备重装自动继承 |
| **v1.7.0** | b877e63 | 服务端globalHQ引用计数重构 |
| **v1.7.4** | 3540879 | 720p/1080p质量45，压缩3/5 |
| **v1.7.9** | 38059c9 | 统一降帧至**6fps**稳定 |
| **v1.7.12** | 3578e3f | 统一所有截图质量为30，优化画质体积平衡 |
| **二进制重构** | c37d960 | 改用二进制WebSocket帧传输，取代Base64，节省约33%带宽 |
| **v1.8.x** | - | 分离预览页为独立HTML，实现多浏览器预览协同 |
| **v1.8.1** | 38e41bb | 删除stopHQ处理器和调试API |
| | 95c8c27 | 统一所有二进制通道为0x10，废弃0x11/0x12 |
| **v1.9.0** | c7399e6 | L1/L2统一16:9比例（853x480/1280x720）|
| **v1.9.1 Step 1** | d97af06 | 流级别系统 - 用 setLevel 替代 startHQ/stopHQ |
| **v1.9.1 Step 2** | d0d06a2 | 监控墙裁剪 - 按布局裁剪帧减少带宽 |
| **v1.9.1 Step 3** | d2cd564 | 视口懒加载和裁剪优化 - 根据视口发送设备帧 |
| **v1.9.1优化阶段1** | c472df4 | Promise.all并行处理图像裁剪，大幅提升性能 |
| **v1.9.1优化阶段2** | c8072b9 | Worker线程池处理裁剪，利用多核CPU |
| **v1.9.1优化终版** | de4013a | 移除服务端裁剪，前端CSS自动缩放，消除调度阻塞 |
| | d2e577c | 监控墙同样移除裁剪，修复调度阻塞 |
| **v1.9.2** | 4c19387 | 自助登号基础功能 |
| **v1.9.3** | 4940466 | 自助登号完善 |
| | 2eb2f82 | 自助登号优化：添加超时机制、完善日志显示 |
| | d3aa79e | 自助登号优化：简化客户端消息为三种状态，服务端日志显示完整关系 |
| | 78c906e | 优化二维码处理逻辑：200×360分辨率，白色边框居中 |
| **v1.9.7** | 03c36b8 | 修复普通客户端businessId字段缺失问题，支持自助登号流程 |
| | d17be7d | 重构二维码处理：移除jsqr，改用Python+pyzbar处理 |
| | 5047f64 | 二维码保存逻辑：使用固定位置+时间判断确保更新成功 |
| | b48153b | 清理未使用代码：移除QRCODE_OUTPUT_PATH和客户端qrcodeResult处理 |
| | c41dc58 | 更新README：添加自助登号完整流程和Python依赖说明 |
| **v1.9.8** | 9e1ed1f | 重构：创建统一的设备ID迁移和删除函数 |
| | 3ad23bb | 服务端权限变更日志同时显示设备名和设备ID |
| **v1.9.9** | 733a2a8 | 实现客户端打开屏幕墙免登录功能 |
| | 6bb7e87 | 修复自助登号页面缺少deviceId和deviceName参数的问题 |
| | 97f4ebf | 修复自助登号页面URL参数格式错误，并添加token验证 |
| | 1ce16fd | 打包 v1.9.9 客户端 |
| | 8c9eae1 | 自助登号：所有设备名显示为名称（ID）格式 |
| | 41a341f | 自助登号：删除开始使用/退出日志，添加打开屏幕墙/自助登号日志 |
| | 7b9345f | 统一日志格式：权限和MUMU日志改为标准格式 |
| | bccccaa | 修改MUMU超时离线日志为「模拟器已超时断开」 |
| | e645f18 | 修改权限日志标签为[客户端] |
| | 2eb14da | 简化自助登号日志格式，去掉打开二字 |
| **v1.9.9+** | a721fa9 | 修复：自动登录时点击权限管理按钮弹窗不显示 |
| | 6346ce8 | 修复：每次点击权限管理都需要验证，自动登录验证后重置标记 |
| | 064add5 | 修复：客户端打开时跳过登录但权限管理每次都需要输入密码 |
| | 138997e | 清理：删除不再使用的自动登录相关代码 |
| | ccc2889 | 修复：恢复客户端通过auto=1参数跳过登录的功能 |
| **v1.10.0** | d2715d3 | 自助登号系统重构：消除全局变量，添加2秒点击时间窗口检查 |
| | 6c6c984 | MUMU离线遮罩优化：移除多余遮罩层，离线时显示黑色遮罩 |
| | 46bcbe8 | 自助登号页面自愈逻辑：MUMU恢复后自动通知服务端更新状态 |
| | bfc31a6 | MUMU客户端自愈和断线重连：心跳机制与自动重连优化 |
| | c7928be | 点击时间窗口检查：超过2秒的点击操作不生效 |
| | c440229 | 自助登号并发修复：hdScreenshot携带operatorId，不再依赖全局变量 |
| | c252238 | 修复时间戳单位不匹配：自动检测秒级时间戳并转换毫秒 |
| | 56a7cde | 自助登号隐藏启动：--start-minimized启动后由JS显示窗口 |
| | 3822195 | 自助登号窗口尺寸：1080p基准510×960，更大屏幕按比例放大 |
| **v1.10.1** | - | 自助登号修复：时间戳单位检测逻辑（秒级是<10000000000），电脑客户端hdScreenshot补充完整参数（operatorId/operatorName/businessName） |
| **v1.10.2** | - | 修复电脑客户端截图异常处理：添加try-except捕获，防止截图失败时主进程中断 |
| **v1.10.3** | e33a253 | 完善MUMU客户端异常处理：截图Worker添加异常捕获、主循环发送帧添加try-except、MUMU超时断开不触发mumuOffline、超时时间改为5秒 |
| **v1.10.4** | baeceb0 | MUMU客户端优化：命令队列处理、状态通知队列化、ADB稳定检测(5次x2秒)、优化日志输出 |

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

**5秒超时保护**：
- `SELF_SERVICE_TIMEOUT_MS = 5000`
- 收到 `cameraClicked` 后启动定时器，5秒内未收到截图则清理状态

**2秒点击时间窗口**：
- `SELF_SERVICE_CLICK_WINDOW_MS = 2000`
- 检查点击时间和收到截图的时间差

**时间戳单位修复**：
- 服务端 `Date.now()` 返回毫秒
- MUMU客户端 `time.time()` 返回秒
- `processQrcodeImage()` 自动检测并转换单位（>10000000000 视为秒）

##### 完整参数传递链路

```
1. 自助登号页面发送 selfServiceInit（4参数）
   └─ operatorId, operatorName, businessId, businessName

2. 用户点击 → 发送 mouseClick（4参数）
   └─ 服务端转发给MUMU客户端（保持4参数）

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

### MUMU微服务上下线通知

#### MUMU微服务离线
- **触发时机**：MUMU连接断开或超时
- **服务端日志**：`[MUMU] 模拟器微服务已离线` 或 `[MUMU] 模拟器已超时断开`
- **广播消息**：`{ type: 'mumuOffline', deviceId: 'MUMU-service' }`

#### 前端处理
- **self-service.html**：收到 `mumuOffline` 后清空画面，设置全透明
- **MUMU上线时**：无需处理，帧到达后自动恢复

---

### MUMU客户端自愈机制完善

#### 服务端自愈逻辑
- **离线时画面保持**：设备离线时不更新画面，只做自愈计数
- **连续帧判断**：达到阈值（2帧）后才恢复在线状态并更新画面
- **离线图显示**：使用服务端发送的 screenshot 字段，显示灰度离线水印

#### MUMU客户端断线重连
- **心跳机制**：定时发送心跳检测连接状态
- **自动重连**：连接断开后自动尝试重连，避免长时间离线
- **时间窗口验证**：点击操作需在60秒内完成，超时操作不生效

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
- 点击时间窗口调整为**2秒**
- 超过2秒的点击信息不再处理

#### 客户端限制
- 点击操作超过**60秒**的记录不发送
- 确保操作实时性

---

## v1.10.1 详细更新说明

### 时间戳单位不匹配问题修复

#### 问题背景
- MUMU客户端发送秒级时间戳（`time.time()`）
- 服务端使用毫秒级时间戳（`Date.now()`）
- 导致计算时间差时差值约为17亿毫秒，永远超过2秒窗口

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

### MUMU客户端异常处理完善

#### 问题背景
- MUMU客户端在ADB截图失败时会中断主进程
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

### MUMU客户端优化

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

### 启动MUMU客户端
1. 先启动MUMU模拟器（推荐540×960）
2. 运行MUMU客户端：
```bash
cd D:\ScreenWall2\mumu-client
python mumu_client.py
```
- 启动时会自动检测并注入摄像头Hook v49
- 如未检测到模拟器会弹窗提示

### 自助登号完整流程

#### 前置准备
1. **MUMU摄像头Hook注入**
   - 启动MUMU模拟器
   - 运行注入器 `injector49.exe` 或启动MUMU客户端自动注入
   - 注入成功后会返回提示

2. **Python环境准备**
   ```bash
   pip install pyzbar pillow numpy
   ```

#### 完整操作步骤
1. **启动服务端**
   ```bash
   cd D:\ScreenWall2\server
   node server.js
   ```

2. **启动业务设备**（要扫码的游戏账号所在设备）

3. **启动MUMU模拟器和客户端**
   - 打开MUMU模拟器
   - 运行 `mumu_client.py`

4. **打开自助登号页面**
   - 在电脑客户端右键菜单中点击「自助登号」
   - 会自动打开浏览器访问自助登号页面
   - 页面URL会携带当前电脑的设备ID（业务发起方）

5. **选择业务设备**
   - 在自助登号页面下拉列表中选择要扫码的设备（业务设备）
   - 默认选中当前打开页面的电脑设备
   - 列表会自动排除MUMU客户端设备

6. **触发扫码操作**
   - 在自助登号页面中点击对应位置
   - 鼠标点击会传递到MUMU模拟器

7. **自动处理流程**
   ```
   用户点击 → 自助登号页面发送 mouseClick（带4参数）
   服务端转发 → MU客户端收到 mouseClick（带4参数）
   相机弹窗 → DLL通过管道发送 CLICKED:时间戳
   MU客户端 → 发送 cameraClicked 消息给服务端
   服务端保存 → 业务发起方和业务设备信息到 Map
   请求截图 → 向业务设备发送 requestHdScreenshot（带5参数）
   业务设备返回 → hdScreenshot (selfService目的，带6参数)
   服务端检查时间窗口 → 超过2秒丢弃
   处理二维码 → 保存原始截图、调用Python处理
   二维码处理 → 识别、裁剪、缩放、添加边框（200×360）
   验证文件更新 → 通过修改时间戳确认
   服务端日志 → 记录成功/失败/超时
   ```

8. **扫码显示**
   - 使用虚拟摄像头软件（如SplitCam、OBS Virtual Camera）
   - 将 `qrcode/last_qrcode.png` 设置为虚拟摄像头源
   - 在实际扫码框中选择该虚拟摄像头即可完成登录

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

### MUMU客户端优化
| 优化项 | 说明 |
|--------|------|
| 帧队列限制 | maxsize=3，防止内存膨胀 |
| 异步队列 | 截图Worker独立线程，主循环只处理发送 |
| 点击时间窗口 | 2秒内的截图请求有效，超时被丢弃 |

---

## 注意事项

1. **MUMU模拟器必须先启动**，客户端才会正常运行
2. **推荐模拟器分辨率**：540×960（最佳帧率3-4fps）
3. **设备ID需全局唯一**，避免冲突
4. **9列/10列布局**需要宽屏显示器（带鱼屏/双屏）
5. **报警记录**24小时后自动删除
6. **收藏状态**持久化到服务端，刷新页面不丢失
7. **帧超时**设置为2秒，防止网络波动累积旧帧
8. **历史帧率**：早期逐步调整（1fps→3fps→5fps→8fps），v1.7.9 后稳定为**6fps**
9. **自助登号超时机制**：5秒超时保护 + 2秒点击时间窗口

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
  - server/server.js：权限 API、权限管理逻辑、统一迁移/删除函数
  - server/permissions.json：权限数据持久化文件
- **前端**：
  - server/public/main.html：权限管理页面 UI 和交互
- **客户端**：
  - client/client.py：权限检查和弹窗显示逻辑
  - client/dist2/ScreenWallClient/：打包输出目录
