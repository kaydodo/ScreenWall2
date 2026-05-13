# 离线图与自愈逻辑统一规范

## 一、Screenshot 来源

### 统一规则
**所有离线图都来自服务端，不使用前端本地缓存。**

服务端存储：
- `dev.screenshot`：设备最后一帧（二进制 webp Buffer）
- 持久化到 `devices.json`（base64 格式）

服务端发送：
- `state` 消息：`cells[].screenshot` 和 `devices[].screenshot`
- `deviceList` 消息：`devices[].screenshot`
- `devicePreviewStatus` 消息：`screenshot` 字段
- `wallStateUpdate` 消息（deviceOffline）：`screenshot` 字段

### Buffer -> base64 转换
服务端发送给前端时，需要将 Buffer 转为 base64 字符串：
```javascript
// getDeviceListPayload() 中
screenshot: d.screenshot ? (Buffer.isBuffer(d.screenshot) ? 'data:image/webp;base64,' + d.screenshot.toString('base64') : d.screenshot) : null

// notifyWallClients() 中
if (processedData.screenshot && Buffer.isBuffer(processedData.screenshot)) {
  processedData.screenshot = 'data:image/webp;base64,' + processedData.screenshot.toString('base64');
}

// devicePreviewStatus 中
const offlineScreenshot = dev.screenshot ? (Buffer.isBuffer(dev.screenshot) ? 'data:image/webp;base64,' + dev.screenshot.toString('base64') : dev.screenshot) : null;
```

---

## 二、自愈机制

### 统一规则
1. 设备离线时，收到帧**不更新画面**，只做自愈计数
2. 达到阈值（2帧）后才恢复在线状态并更新画面
3. 自愈计数在设备明确离线时清零

### 阈值
```javascript
const FRAME_HEAL_THRESHOLD = 2;
```

### 数据结构
- **格子页面**（main.html, monitor-wall.html）：`Map<deviceId, count>`（多设备）
- **预览页面**（preview.html）：简单变量 `frameHealCount`（单设备）

### 涉及场景
| 场景 | 二进制帧 |
|------|----------|
| main.html 格子 | ✅ 自愈 |
| monitor-wall.html 格子 | ✅ 自愈 |
| preview.html | ✅ 自愈 |

**注意：前端只接收二进制帧（0x01/0x10），不存在 JSON 帧用于实时画面。**

---

## 三、Level 级别管理

### 级别定义
- `level 0`：480p，最低画质
- `level 1`：720p，监控墙格子画质
- `level 2`：1080p，预览画质

### 各场景 Level 需求
| 场景 | 默认 Level | 恢复在线时 |
|------|-----------|-----------|
| main.html 格子 | 0/1（服务端推送） | 无需发送 |
| main.html 预览 | 2 | `setLevel 2`（preview.html 发送） |
| monitor-wall.html 格子 | 1 | 无需发送 |
| monitor-wall.html 预览 | 2 | `setLevel 2`（通过 postMessage） |

### 预览页面 Level 发送规则
```javascript
// preview.html setOnline() 函数
if (fromWall) {
  // 监控墙预览：通知父页面发送
  window.parent.postMessage({ type: 'previewOnline', deviceId: deviceId }, '*');
} else if (ws && ws.readyState === WebSocket.OPEN) {
  // 主页面预览：自己发送
  ws.send(JSON.stringify({ type: 'setLevel', deviceId: deviceId, level: 2 }));
}
```

### 监控墙接收预览上线消息
```javascript
// monitor-wall.html
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'previewOnline' && e.data.deviceId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'setLevel', deviceId: e.data.deviceId, level: 2 }));
    }
  }
});
```

---

## 四、离线图显示

### 两种显示模式

#### 格子模式（main.html, monitor-wall.html）
- 灰度：`.grayscale` class 或 `filter: grayscale(100%)`
- 中央文字："设备已离线"
- 数据来源：服务端发送的 `screenshot` 字段

#### 预览模式（preview.html）
- 灰度：CSS `filter`
- 水印文字：旋转大字"设备已离线"
- 数据来源：服务端发送的 `screenshot` 字段

### 离线图来源优先级
**只有一个来源：服务端发送的 `screenshot` 字段。**

---

## 五、上线恢复

### 格子恢复
1. 移除 `offline` 类和灰度样式
2. 隐藏离线标签
3. 恢复 UU 按钮
4. 等待帧到达后显示画面

### 预览恢复
1. 调用 `setOnline()` 隐藏水印
2. 发送 `setLevel 2` 请求高清流
3. 等待帧到达后显示画面

---

## 六、新增页面检查清单

新增显示设备画面的页面时，需确保：

- [ ] **Screenshot 来源**：只从服务端获取，不使用本地缓存
- [ ] **自愈机制**：离线时不更新画面，达到阈值才恢复
- [ ] **Level 管理**：根据场景选择正确的 level
- [ ] **离线图显示**：使用灰度 + 离线提示
- [ ] **上线恢复**：正确发送 setLevel（预览场景）

---

## 七、相关文件

- `server/public/main.html`：主页面格子
- `server/public/monitor-wall.html`：监控墙
- `server/public/preview.html`：预览页面
- `server/server.js`：服务端帧推送和 level 管理

---

## 八、帧类型说明

### 二进制帧（实时画面）
- `0x01`：**客户端 → 服务端**，Python客户端发送截图给服务端（前端不可见）
- `0x10`：**服务端 → 浏览器**，服务端转发截图给前端（前端只接收这个）

### JSON 消息（非实时画面）
- `state`：初始化状态，包含 `screenshot`（最后一帧）
- `deviceList`：设备列表，包含 `screenshot`
- `devicePreviewStatus`：设备状态变更，包含 `screenshot`
- `wallStateUpdate`：监控墙状态更新，包含 `screenshot`

**实时画面只通过二进制帧 `0x10` 传输到前端，JSON 消息中的 screenshot 只用于离线图显示。**
