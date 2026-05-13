# 离线图与自愈逻辑统一规范

## 一、Screenshot 缓存更新规则

### 统一规则
所有页面在接收 `deviceList`、`wallStateUpdate`、`state` 等消息时，**只有当 screenshot 有值时才更新本地缓存**，避免 `null` 覆盖已有截图。

### 代码模式
```javascript
// 正确
if (dev.screenshot) {
  localCache.screenshot = dev.screenshot;
}

// 错误（会被 null 覆盖）
if (dev.screenshot !== undefined) {
  localCache.screenshot = dev.screenshot;
}
```

### 涉及文件
- `main.html`：`gridCells[c].screenshot`
- `monitor-wall.html`：`devices[deviceId].screenshot`
- `preview.html`：`screenshot` 变量、`allDevices[deviceId].screenshot`

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
| 场景 | 二进制帧 | JSON帧 |
|------|----------|--------|
| main.html 格子 | ✅ 自愈 | N/A |
| monitor-wall.html 格子 | ✅ 自愈 | N/A |
| preview.html | ✅ 自愈 | ✅ 自愈 |

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
- 数据来源：`devices[deviceId].screenshot` 或 `gridCells[c].screenshot`

#### 预览模式（preview.html）
- 灰度：CSS `filter`
- 水印文字：旋转大字"设备已离线"
- 数据来源：`screenshot` 变量

### 离线图优先级
1. 服务器发送的截图（`data.screenshot`）
2. 本地缓存的截图（`devices[deviceId].screenshot`）

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

- [ ] **Screenshot 缓存**：使用 `if (screenshot)` 而非 `if (screenshot !== undefined)`
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
