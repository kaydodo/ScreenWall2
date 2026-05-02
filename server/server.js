// Set timezone to Shanghai (UTC+8) for all Date operations
process.env.TZ = 'Asia/Shanghai';

// 全局异常拦截（防止未知路径导致服务端崩溃）
process.on('uncaughtException', (err) => {
  serverError('[未捕获异常]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  serverError('[未处理Promise拒绝]', String(reason));
});

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { spawn } = require('child_process');

// 服务端版本从 config.json 的 serverVersion 字段读取，无需硬编码

// ========== 静态资源缓存版本（基于内容 hash）==========
const STATIC_ASSETS = ['style.css'];
const assetHashes = {};
try {
  for (const asset of STATIC_ASSETS) {
    const assetPath = path.join(__dirname, 'public', asset);
    if (fs.existsSync(assetPath)) {
      const content = fs.readFileSync(assetPath);
      assetHashes[asset] = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
    }
  }
} catch(e) {}

// ========== 日志模块 ==========
const LOGS_DIR = path.join(__dirname, 'logs');
let _logFd = null;
let _logDate = null;

function _openLog() {
    const today = new Date().toISOString().slice(0, 10);
    if (_logFd && _logDate === today) return;
    if (_logFd) { try { fs.closeSync(_logFd); } catch(e) {} _logFd = null; }
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const logPath = path.join(LOGS_DIR, `${today}.log`);
    _logFd = fs.openSync(logPath, 'a');
    _logDate = today;
}

function serverLog(...args) {
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${ts}] ${msg}\n`;
    process.stdout.write(line);
    try {
        _openLog();
        fs.writeSync(_logFd, line);
    } catch(e) { process.stderr.write('[日志写入失败] ' + e.message + '\n'); }
}

// ========== 公共配置文件（网页和客户端共享）==========
let SERVER_CONFIG = {};
function loadServerConfig() {
  try {
    const configPath = path.join(__dirname, 'public', 'config.json');
    if (fs.existsSync(configPath)) {
      SERVER_CONFIG = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // 从下载文件名中自动提取版本号，格式如 UURemote_Setup_4.20.903.7641_0421115832_jf031.exe
      if (SERVER_CONFIG.uuDownloadUrl && !SERVER_CONFIG.uuVersion) {
        const fileName = SERVER_CONFIG.uuDownloadUrl.replace(/^\//, '');
        const m = fileName.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m) SERVER_CONFIG.uuVersion = m[1];
      }
      serverLog(`[配置] 已加载 config.json: UU版本=${SERVER_CONFIG.uuVersion || '未知'}`);
    } else {
      serverLog('[配置] config.json 不存在，使用默认配置');
    }
  } catch (err) {
    serverError('[配置] 加载 config.json 失败:', err.message);
  }
}
loadServerConfig();
_lastServerVersion = SERVER_CONFIG.serverVersion || null;

// 热更新：监听 config.json 变化，无需重启自动重载
const SERVER_CONFIG_PATH = path.join(__dirname, 'public', 'config.json');
function reloadServerConfig() {
  try {
    if (fs.existsSync(SERVER_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf8'));
      SERVER_CONFIG = raw;
      if (SERVER_CONFIG.uuDownloadUrl && !SERVER_CONFIG.uuVersion) {
        const fileName = SERVER_CONFIG.uuDownloadUrl.replace(/^\//, '');
        const m = fileName.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m) SERVER_CONFIG.uuVersion = m[1];
      }
      serverLog(`[配置] config.json 已重新加载: 屏幕墙版本=${SERVER_CONFIG.serverVersion || '未知'} | UU版本=${SERVER_CONFIG.uuVersion || '未知'}`);

      // serverVersion 变化时广播给浏览器更新版本显示
      if (SERVER_CONFIG.serverVersion && SERVER_CONFIG.serverVersion !== _lastServerVersion) {
        _lastServerVersion = SERVER_CONFIG.serverVersion;
        broadcastToBrowsers({ type: 'serverVersionUpdate', serverVersion: SERVER_CONFIG.serverVersion });
      }
    }
  } catch (err) {
    serverError('[配置] 重载 config.json 失败:', err.message);
  }
}
fs.watch(SERVER_CONFIG_PATH, { persistent: false }, (eventType) => {
  if (eventType === 'change') reloadServerConfig();
});

function serverError(...args) {
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${ts}] [ERROR] ${msg}\n`;
    process.stderr.write(line);
    try {
        _openLog();
        fs.writeSync(_logFd, line);
    } catch(e) {}
}

// ========== 配置加载 ==========
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
  serverError('配置文件加载失败:', e.message);
  process.exit(1);
}

const {
  server: SERVER_CFG,
  auth: AUTH_CFG,
  security: SEC_CFG,
  client: CLIENT_CFG
} = config;

// ========== 全局追踪（高效计数器） ==========
// 1080p追踪：deviceId → count
const global1080p = new Map();

// HQ高清流追踪：deviceId → count
const globalHQ = new Map();

// ========== 辅助函数（已被全局计数器替代，保留兼容） ==========
function hasOtherPreview(deviceId, excludeWs) {
  // 使用全局计数器替代
  return globalHQ.has(deviceId) && globalHQ.get(deviceId) > 0;
}

function hasOtherWallSubscription(deviceId, excludeWs) {
  return hdRequests.has(deviceId) && hdRequests.get(deviceId).size > 0;
}

// ========== MJPEG 流服务（已禁用，新架构使用 WebSocket 三通道推送）==========
/*
const deviceFrames = new Map();
const MJPEG_FRAME_RATE = 10;
const MJPEG_BOUNDARY = 'frame';

async function decodeImageToJpeg(base64Data, deviceId) {
  if (!base64Data) return null;
  try {
    const base64Str = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Str, 'base64');
    if (!buffer || buffer.length < 100) return null;
    if (base64Data.startsWith('data:image/webp')) {
      return buffer;
    }
    const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    if (!isJpeg) {
      return await sharp(buffer).jpeg({ quality: 80 }).toBuffer();
    }
    return buffer;
  } catch (e) {
    return null;
  }
}

function updateDeviceFrame(deviceId, jpegBuffer) {
  deviceFrames.set(deviceId, {
    jpeg: jpegBuffer,
    timestamp: Date.now()
  });
}

function createMjpegStream(deviceId, req, res) {
  // 已禁用
}
*/

// ========== 简单内存数据库 ==========
const sessions = new Map();
const loginAttempts = new Map();
const devices = new Map();

const browserClients = new Set();
const wallClients = new Map(); // ws -> { devices: Set<deviceId>, interval: ms }
const wallDevices = new Map(); // deviceId -> interval (持久化追踪哪些设备应该接收高清流)
// 每个窗口独立的高清通道追踪：window ws -> Set<deviceId>
const wallHDChannels = new Map(); // ws -> Set<deviceId>
// 全局高清请求追踪（兼容旧逻辑）
const hdRequests = new Map(); // deviceId -> Set<ws>  ref counting
// 浏览器预览高清通道追踪：browser ws -> Set<deviceId>
const browserPreviewHD = new Map(); // ws -> Set<deviceId>
// 格子预览独立通道（不受帧缓存去重影响）
const previewClients = new Map(); // ws -> { deviceId, interval }
// 浏览器 1080p 预览模式追踪：browser ws -> Set<deviceId>（哪些设备正在该浏览器预览中启用1080p）
const browser1080p = new Map(); // ws -> Set<deviceId>
// 全局1080p追踪：deviceId -> 使用该设备的浏览器数量（只有所有浏览器都不用时才通知设备关闭）
// 每个浏览器独立管理已上墙设备，同一浏览器的不同窗口共享 localStorage 同步

// ========== 渲染优化 ==========
// 视口追踪：浏览器上报当前可见格子
const browserViewport = new Map(); // ws -> Set<deviceId>
// 监控墙白名单：始终推送截图
const monitorWallDevices = new Set(); // deviceId 集合
// 截图推送队列（报警专用，不阻塞正常帧）
const alarmQueue = []; // { deviceId, image, timestamp }
// 上次推送时间追踪（用于节流）
const lastPushTime = new Map(); // deviceId -> timestamp(ms)

// Grid 布局
let gridLayout = {};
let gridSizeSetting = 4;  // 默认布局大小

// ========== 帧缓存（MD5 去重推送）==========
const frameCache = new Map(); // deviceId -> { md5, time }
// 截图路径统计（用于诊断 JPEG 快速路径 vs sharp 慢速路径）
let screenshotPathStats = null; // { fast, slow, lastLog }
// deviceFrames 写入统计
let updateFrameLogCache = null; // { last, interval }
// 333ms内相同 MD5 的帧不重复推送（约3fps，减少重复传输）
const FRAME_CACHE_TTL = 333;

// 报警截图查重缓存（存储最近一张 640×360 截图）
const alarmPrevCache = new Map(); // deviceId -> { md5, time }
const GRID_PERSIST_PATH = path.join(__dirname, 'grid-layout.json');
const GRID_SIZE_PATH = path.join(__dirname, 'grid-size.json');
try {
  const raw = fs.readFileSync(GRID_PERSIST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  // 兼容旧格式（嵌套 gridSize -> cellIndex -> deviceId）
  // 新格式：扁平化 cellIndex -> deviceId
  const firstVal = Object.values(parsed)[0];
  if (firstVal && typeof firstVal === 'object' && !Array.isArray(firstVal)) {
    // 旧格式：合并所有 gridSize 的格子（取最后写入的）
    serverLog('[ScreenWall] 检测到旧格式 grid-layout.json，自动迁移...');
    for (const [gs, layout] of Object.entries(parsed)) {
      for (const [idx, devId] of Object.entries(layout)) {
        if (devId) gridLayout[idx] = devId;
      }
    }
    // 保存新格式
    fs.writeFileSync(GRID_PERSIST_PATH, JSON.stringify(gridLayout), 'utf8');
    serverLog('[ScreenWall] 迁移完成，格子数:', Object.keys(gridLayout).length);
  } else {
    gridLayout = parsed;
  }
} catch (e) {}
try {
  const raw = fs.readFileSync(GRID_SIZE_PATH, 'utf8');
  gridSizeSetting = parseInt(JSON.parse(raw)) || 4;
} catch (e) {}

// 分组数据
let groups = [];  // [{ id, name, deviceIds: [] }]
const GROUPS_PERSIST_PATH = path.join(__dirname, 'groups.json');
const DEVICES_PERSIST_PATH = path.join(__dirname, 'devices.json');

// 报警记录数据
let alarmRecords = [];  // [{ id, deviceId, deviceName, screenshot, timestamp, groupName, cellStr, occurrenceCount }]
const ALARM_RECORDS_PATH = path.join(__dirname, 'alarm-records.json');
// 同设备1分钟内去重：deviceId -> 最后报警时间戳
let lastAlarmTime = new Map();  // deviceId -> timestamp(ms)，重启后从 alarmRecords 恢复
const ALARM_DEDUP_MS = 60 * 1000; // 1分钟去重窗口（严格小于，大于等于1分钟算新事件）
// 二次确认 pending 状态：deviceId -> { x, y, occurrenceCount, firstPendingTime }
let pending_alarms = new Map();

// ========== 新报警系统：状态机 ==========
// alarmStates: deviceId -> { state, matchCount, templateRegion, templateBuffer, lastImage, occurrenceCount, firstPendingTime, alarmRecord }
// state: 'idle' | 'matching' | 'verifying' | 'confirmed'
// templateRegion: { x1, y1, x2, y2 } 报警时截取的区域坐标（相对于640×360图片）
// templateBuffer: 报警时截取的150x60区域的Buffer（用于查重对比）
// lastImage: 报警时的原始截图（base64）
// occurrenceCount: 本日报警次数
let alarmStates = new Map();
// 报警图片存储目录
const ALARM_SCREENSHOTS_DIR = path.join(__dirname, 'alarm-screenshots');
if (!fs.existsSync(ALARM_SCREENSHOTS_DIR)) {
  fs.mkdirSync(ALARM_SCREENSHOTS_DIR, { recursive: true });
}
// 报警关键词（2字关键词，匹配到2个才触发）
const ALARM_KEYWORDS_2CHAR = [
  '网络', '络错', '请重', '新登', '络有', '有问', '检测', '检查', '一下', '下吧',
];

// 三字词（单匹配直接触发报警）
const ALARM_KEYWORDS_3CHAR = [
  '网络错', '请重新', '网络有', '检测一', '查一下', '检测吧',
];
// 模板图片路径
const ALARM_TEMPLATE_PATH = path.join(__dirname, 'diao.png');
// 查重间隔（30秒）
const ALARM_VERIFY_INTERVAL_MS = 30000;
// 服务器迁移配置：每个设备的待执行迁移指令（仅内存，网关退出即销毁）
let migrationCommands = {};  // { deviceId: { host, port } }
const ALARM_RETENTION_MS = 24 * 60 * 60 * 1000; // 24小时保留

// ========== 任务系统 ==========
// tasks: 所有任务记录
// task: { id, deviceId, deviceName, groupName, content, timestamp, accepted, acceptedAt, revoked, deleted, deviceDeleted }
let tasks = [];
const TASKS_PERSIST_PATH = path.join(__dirname, 'tasks.json');
try {
  const raw = fs.readFileSync(TASKS_PERSIST_PATH, 'utf8');
  tasks = JSON.parse(raw);
  serverLog(`[任务] 从 tasks.json 恢复了 ${tasks.length} 条记录`);
} catch (e) {}

function persistTasks() {
  try {
    fs.writeFileSync(TASKS_PERSIST_PATH, JSON.stringify(tasks, null, 2), 'utf8');
  } catch (e) { serverError('[任务] 持久化失败:', e.message); }
}

// 获取任务系统的完整 payload（含设备名、分组名实时更新）
function getTasksPayload() {
  return tasks.map(t => {
    const dev = devices.get(t.deviceId);
    const deviceName = dev ? dev.deviceName : t.deviceName;
    const groupId = dev ? dev.groupId : null;
    const grp = groupId ? groups.find(g => g.id === groupId) : null;
    const groupName = grp ? grp.name : t.groupName || '';
    return { ...t, deviceName, groupName };
  });
}

// 开关机场景配置
let powerScenes = {};  // { deviceId: sceneName }
const POWER_SCENES_PATH = path.join(__dirname, 'power-scenes.json');
try {
  const raw = fs.readFileSync(POWER_SCENES_PATH, 'utf8');
  powerScenes = JSON.parse(raw);
} catch (e) {}

try {
  const raw = fs.readFileSync(ALARM_RECORDS_PATH, 'utf8');
  alarmRecords = JSON.parse(raw);
  // 清理超过24小时的旧记录
  const cutoff = Date.now() - ALARM_RETENTION_MS;
  alarmRecords = alarmRecords.filter(r => r.timestamp > cutoff);
  // 清理孤儿截图文件（不在 alarmRecords 中的截图）
  if (fs.existsSync(ALARM_SCREENSHOTS_DIR)) {
    const validScreenshotIds = new Set(alarmRecords.map(r => r.screenshotId).filter(Boolean));
    const files = fs.readdirSync(ALARM_SCREENSHOTS_DIR);
    for (const file of files) {
      // 只清理报警截图和OCR区域截图
      if (file.endsWith('.png')) {
        const isMainScreenshot = !file.startsWith('ocr_region_');
        const screenshotId = file.replace('.png', '');
        if (isMainScreenshot && !validScreenshotIds.has(screenshotId)) {
          try {
            fs.unlinkSync(path.join(ALARM_SCREENSHOTS_DIR, file));
          } catch (e) {}
        }
        // OCR区域截图：超过24小时的清理
        const ocrMatch = file.match(/^ocr_region_(.+)\.png$/);
        if (ocrMatch) {
          // OCR截图命名是uuid，没有时间戳，简单起见全部清理（会在下次报警时重新生成）
          // 或者检查文件修改时间
          try {
            const stat = fs.statSync(path.join(ALARM_SCREENSHOTS_DIR, file));
            if (stat.mtimeMs < cutoff) {
              fs.unlinkSync(path.join(ALARM_SCREENSHOTS_DIR, file));
            }
          } catch (e) {}
        }
      }
    }
  }
  // 恢复 lastAlarmTime：只恢复"已超出查重窗口"的记录（说明该设备至少1分钟没报警了）
  // 窗口内的记录不恢复，防止重启前后的短时报警被错误去重
  lastAlarmTime = new Map();
  const now = Date.now();
  for (const rec of alarmRecords) {
    if (now - rec.timestamp >= ALARM_DEDUP_MS) {  // 只接续超出窗口的
      const prev = lastAlarmTime.get(rec.deviceId);
      if (!prev || rec.timestamp > prev) lastAlarmTime.set(rec.deviceId, rec.timestamp);
    }
  }
  serverLog(`[报警] 从 alarm-records.json 恢复了 ${alarmRecords.length} 条记录，lastAlarmTime 已重建`);
} catch (e) {}

// ========== 收藏截图数据 ==========
// favorites: 标记的设备列表 [{ deviceId, deviceName, groupId, cellIndex }]
let favorites = [];
const FAVORITES_PATH = path.join(__dirname, 'favorites.json');

// collections: 截图集合 Map(timestamp -> items[])
// item: { deviceId, screenshot, hdScreenshot, deviceName, groupId, cellIndex, online, deleted }
let collections = new Map();
const COLLECTIONS_PATH = path.join(__dirname, 'collections.json');

try {
  const raw = fs.readFileSync(FAVORITES_PATH, 'utf8');
  favorites = JSON.parse(raw);
} catch (e) {}
try {
  const raw = fs.readFileSync(COLLECTIONS_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  // 确保 timestamp 键是数字类型（JSON 对象键是字符串）
  collections = new Map(Object.entries(parsed).map(([k, v]) => [Number(k), v]));
} catch (e) {}

// 保存收藏数据
function saveFavorites() {
  try {
    fs.writeFileSync(FAVORITES_PATH, JSON.stringify(favorites, null, 2), 'utf8');
  } catch (e) {
    serverError('[ScreenWall] 保存收藏数据失败:', e.message);
  }
}

// 保存截图集合
function saveCollections() {
  try {
    const obj = Object.fromEntries(collections);
    fs.writeFileSync(COLLECTIONS_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    serverError('[ScreenWall] 保存截图集合失败:', e.message);
  }
}

// 更新收藏项的设备信息（改名、分组、格位置变化时调用）
function updateFavoriteDeviceInfo(deviceId, updates) {
  let changed = false;
  favorites.forEach(f => {
    if (f.deviceId === deviceId) {
      Object.assign(f, updates);
      changed = true;
    }
  });
  if (changed) saveFavorites();
}

// 更新集合项的设备信息
function updateCollectionDeviceInfo(deviceId, updates) {
  let changed = false;
  collections.forEach((items, timestamp) => {
    items.forEach(item => {
      if (item.deviceId === deviceId) {
        Object.assign(item, updates);
        changed = true;
      }
    });
  });
  if (changed) saveCollections();
}

// 设备删除时清理收藏和集合
function cleanupDeviceFromFavorites(deviceId) {
  // 从收藏移除
  const oldLen = favorites.length;
  favorites = favorites.filter(f => f.deviceId !== deviceId);
  if (favorites.length !== oldLen) saveFavorites();
  
  // 集合中标记为"已删除"
  let changed = false;
  collections.forEach((items, timestamp) => {
    items.forEach(item => {
      if (item.deviceId === deviceId) {
        item.deleted = true;
        changed = true;
      }
    });
  });
  if (changed) saveCollections();
}

// 更新集合中设备的状态信息（名字、分组、格子位置、上下线）
function updateCollectionsDeviceStatus(deviceId, updates) {
  let changed = false;
  
  // 查找设备的最新信息
  const device = devices.get(deviceId);
  const deviceName = device ? device.deviceName : (updates.deviceName || '未知设备');
  const groupId = device && device.groupId ? device.groupId : '';
  const groupName = groupId ? (groups.find(g => g.id === groupId) || {}).name : '';
  
  // 找出设备当前所在的格子位置
  let cellIndex = -1;
  for (const [idx, devId] of Object.entries(gridLayout)) {
    if (devId === deviceId) {
      cellIndex = Number(idx);
      break;
    }
  }
  
  const isOnline = device ? device.online : false;
  
  // 更新所有 collections 中该设备的状态
  collections.forEach((items, timestamp) => {
    items.forEach(item => {
      if (item.deviceId === deviceId) {
        const needUpdate = 
          item.deviceName !== deviceName ||
          item.groupId !== groupId ||
          item.groupName !== groupName ||
          item.cellIndex !== cellIndex ||
          item.online !== isOnline ||
          (item.deleted && updates.deleted === false);
        
        if (needUpdate) {
          item.deviceName = deviceName;
          item.groupId = groupId;
          item.groupName = groupName;
          item.cellIndex = cellIndex;
          item.online = isOnline;
          if (updates.deleted === false) item.deleted = false;
          if (updates.deleted === true) item.deleted = true;
          changed = true;
        }
      }
    });
  });
  
  // 同时更新 favorites 中该设备的信息
  const favIndex = favorites.findIndex(f => f.deviceId === deviceId);
  if (favIndex >= 0) {
    const needUpdate = 
      favorites[favIndex].deviceName !== deviceName ||
      favorites[favIndex].groupId !== groupId ||
      favorites[favIndex].cellIndex !== cellIndex;
    
    if (needUpdate) {
      favorites[favIndex].deviceName = deviceName;
      favorites[favIndex].groupId = groupId;
      favorites[favIndex].cellIndex = cellIndex;
      saveFavorites();
      // 广播 favorites 更新（让所有浏览器同步星星按钮状态）
      broadcastToBrowsers({ type: 'favorites', favorites });
      changed = true;
    }
  }
  
  if (changed) {
    saveCollections();
    // 转换为数组格式发送给客户端
    const collectionsArr = [];
    collections.forEach((items, timestamp) => {
      collectionsArr.push({ timestamp, items });
    });
    collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
    broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
  }
}

try {
  const raw = fs.readFileSync(GROUPS_PERSIST_PATH, 'utf8');
  groups = JSON.parse(raw);
} catch (e) {}

// 加载设备列表（服务器重启后恢复离线设备）
try {
  const rawDevices = fs.readFileSync(DEVICES_PERSIST_PATH, 'utf8');
  const savedDevices = JSON.parse(rawDevices);
  for (const d of savedDevices) {
    d.online = false;  // 重启后所有设备视为离线
    d.lastSeen = d.lastSeen || Date.now();
    devices.set(d.deviceId, d);
  }
  // 服务端重启时无法判断哪些设备当时在线，统一标记离线，等客户端重连时自然触发上线
  for (const d of devices.values()) { d.online = false; }
} catch (e) {}

// ========== 工具函数 ==========
function persistGrid() {
  try {
    fs.writeFileSync(GRID_PERSIST_PATH, JSON.stringify(gridLayout, null, 2), 'utf8');
  } catch (e) { serverError('Grid布局持久化失败:', e.message); }
}

function persistGridSize() {
  try {
    fs.writeFileSync(GRID_SIZE_PATH, JSON.stringify(gridSizeSetting), 'utf8');
  } catch (e) { serverError('布局大小持久化失败:', e.message); }
}

function persistGroups() {
  try {
    fs.writeFileSync(GROUPS_PERSIST_PATH, JSON.stringify(groups, null, 2), 'utf8');
  } catch (e) { serverError('分组持久化失败:', e.message); }
}

function persistDevices() {
  try {
    const arr = Array.from(devices.values()).map(d => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      uuDeviceId: d.uuDeviceId,
      lastSeen: d.lastSeen,
      groupId: d.groupId || null,
      screenshot: d.screenshot || null,
    }));
    fs.writeFileSync(DEVICES_PERSIST_PATH, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) { serverError('[设备] 持久化失败:', e.message); }
}

function persistAlarmRecords() {
  try {
    fs.writeFileSync(ALARM_RECORDS_PATH, JSON.stringify(alarmRecords, null, 2), 'utf8');
  } catch (e) { serverError('[报警] 持久化失败:', e.message); }
}

// 获取设备所在的分组名
function getGroupNameForDevice(deviceId) {
  for (const g of groups) {
    if (g.deviceIds && g.deviceIds.includes(deviceId)) {
      return g.name;
    }
  }
  return '';
}

// 获取设备所在的格子位置（1-based）
function getCellIndexForDevice(deviceId) {
  for (const [idx, devId] of Object.entries(gridLayout)) {
    if (devId === deviceId) {
      return parseInt(idx);
    }
  }
  return -1;
}

function persistPowerScenes() {
  try {
    fs.writeFileSync(POWER_SCENES_PATH, JSON.stringify(powerScenes, null, 2), 'utf8');
  } catch (e) { serverError('[开关机场景] 持久化失败:', e.message); }
}

function cleanupOldAlarmRecords() {
  // 删除超过24小时的记录（每次清理一条，直到全部在窗口内）
  const cutoff = Date.now() - ALARM_RETENTION_MS;
  let removed = false;
  for (let i = 0; i < alarmRecords.length; i++) {
    if (alarmRecords[i].timestamp <= cutoff) {
      const rec = alarmRecords[i];
      // 删除对应的报警截图文件
      if (rec.screenshotId) {
        const screenshotPath = path.join(ALARM_SCREENSHOTS_DIR, `${rec.screenshotId}.png`);
        try {
          if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
          }
        } catch (e) {}
      }
      const deletedId = rec.id;
      alarmRecords.splice(i, 1);
      removed = true;
      persistAlarmRecords();
      broadcastToBrowsers({ type: 'alarmDeleted', alarmId: deletedId });
      break; // 每次只删一条，减少 splice 开销
    }
  }
  // 清理独立保存的 1080P 截图（不在 alarmRecords 中的）
  cleanupOrphaned1080pScreenshots();
}

// 清理不在 alarmRecords 中的独立 1080P 截图文件
function cleanupOrphaned1080pScreenshots() {
  try {
    if (!fs.existsSync(ALARM_SCREENSHOTS_DIR)) return;
    const validScreenshotIds = new Set(alarmRecords.map(r => r.screenshotId).filter(Boolean));
    const files = fs.readdirSync(ALARM_SCREENSHOTS_DIR);
    for (const file of files) {
      // 只清理不在 alarmRecords 中的截图文件（这些是延迟到达的1080P截图）
      if (!validScreenshotIds.has(file.replace('.png', ''))) {
        try {
          const filePath = path.join(ALARM_SCREENSHOTS_DIR, file);
          const stat = fs.statSync(filePath);
          // 超过 2 小时仍未被 alarmRecords 引用的文件，删除（说明匹配失败）
          if (Date.now() - stat.mtimeMs > 2 * 60 * 60 * 1000) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}

// ========== 新报警系统辅助函数 ==========

/**
 * 提取图片中心九宫格的中间一格（1/3 x 1/3）
 * 返回 { data, width, height, channels }
 */
async function extractCenterGrid(imageBuffer) {
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width;
  const height = metadata.height;
  const cellWidth = Math.floor(width / 3);
  const cellHeight = Math.floor(height / 3);
  const left = cellWidth;
  const top = cellHeight;
  const result = await sharp(imageBuffer)
    .extract({ left, top, width: cellWidth, height: cellHeight })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data: result.data,
    width: result.info.width,
    height: result.info.height,
    channels: result.info.channels
  };
}

/**
 * 多尺度模板匹配（0.8-1.2倍，可配置步进）
 * imageData: { data, width, height, channels } - 原始像素数据
 * templateBuffer: 模板图片buffer
 * options: { step: 步进值(默认0.02), earlyExitThreshold: 提前退出阈值(默认0.95) }
 * 返回最佳匹配结果 { score, scale, x, y, durationMs }
 */
async function multiScaleTemplateMatch(imageData, templateBuffer, options = {}) {
  const startTime = Date.now();
  const step = options.step || 0.02;
  const earlyExitThreshold = options.earlyExitThreshold || 0.95;
  
  // 获取模板原始尺寸
  const tplMetadata = await sharp(templateBuffer).metadata();
  const tplOrigWidth = tplMetadata.width;
  const tplOrigHeight = tplMetadata.height;
  
  const scales = [];
  for (let s = 0.95; s <= 1.05; s += step) {
    scales.push(parseFloat(s.toFixed(3)));
  }
  
  let bestMatch = { score: 0, scale: 1, x: 0, y: 0 };
  
  // 并行处理所有尺度
  const promises = scales.map(async (scale) => {
    try {
      // 将模板转换为raw像素数据进行匹配
      const resizedTemplate = await sharp(templateBuffer)
        .resize(Math.round(tplOrigWidth * scale), Math.round(tplOrigHeight * scale))
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // 直接使用传入的原始像素数据
      const data = imageData.data;
      const imgWidth = imageData.width;
      const imgHeight = imageData.height;
      const channels = imageData.channels;
      
      const tplWidth = Math.round(tplOrigWidth * scale);
      const tplHeight = Math.round(tplOrigHeight * scale);
      const tplData = resizedTemplate.data;
      const tplChannels = resizedTemplate.info.channels;
      
      // 简单的模板匹配（归一化互相关）
      let bestScore = 0;
      let bestX = 0;
      let bestY = 0;
      
      // 在中心区域搜索（避免边缘）
      const searchMargin = 20;
      const startX = Math.max(0, Math.floor(imgWidth / 2 - tplWidth / 2) - searchMargin);
      const endX = Math.min(imgWidth - tplWidth, Math.floor(imgWidth / 2 - tplWidth / 2) + searchMargin);
      const startY = Math.max(0, Math.floor(imgHeight / 2 - tplHeight / 2) - searchMargin);
      const endY = Math.min(imgHeight - tplHeight, Math.floor(imgHeight / 2 - tplHeight / 2) + searchMargin);
      
      for (let y = startY; y <= endY; y += 2) {
        for (let x = startX; x <= endX; x += 2) {
          let sumImg = 0, sumTpl = 0, sumImgSq = 0, sumTplSq = 0, sumProduct = 0;
          let count = 0;
          
          for (let ty = 0; ty < tplHeight; ty += 2) {
            for (let tx = 0; tx < tplWidth; tx += 2) {
              const imgIdx = ((y + ty) * imgWidth + (x + tx)) * channels;
              const tplIdx = (ty * tplWidth + tx) * tplChannels;
              
              // 使用灰度值（只取RGB前3通道）
              const imgVal = (data[imgIdx] + data[imgIdx + 1] + data[imgIdx + 2]) / 3;
              const tplVal = (tplData[tplIdx] + tplData[tplIdx + 1] + tplData[tplIdx + 2]) / 3;
              
              sumImg += imgVal;
              sumTpl += tplVal;
              sumImgSq += imgVal * imgVal;
              sumTplSq += tplVal * tplVal;
              sumProduct += imgVal * tplVal;
              count++;
            }
          }
          
          if (count > 0) {
            const meanImg = sumImg / count;
            const meanTpl = sumTpl / count;
            const numerator = sumProduct - count * meanImg * meanTpl;
            const denominator = Math.sqrt((sumImgSq - count * meanImg * meanImg) * (sumTplSq - count * meanTpl * meanTpl));
            
            const score = denominator > 0 ? numerator / denominator : 0;
            if (score > bestScore) {
              bestScore = score;
              bestX = x;
              bestY = y;
            }
          }
        }
      }
      
      return { scale, score: bestScore, x: bestX, y: bestY };
    } catch (e) {
      return { scale, score: 0, x: 0, y: 0 };
    }
  });
  
  const results = await Promise.all(promises);

  for (const result of results) {
    if (result.score > bestMatch.score) {
      bestMatch = result;
    }
  }

  bestMatch.durationMs = Date.now() - startTime;
  bestMatch.scalesTested = scales.length;
  return bestMatch;
}

/**
 * 从图片中提取指定区域
 */
async function extractRegion(imageBuffer, x, y, width, height) {
  return await sharp(imageBuffer)
    .extract({ left: x, top: y, width, height })
    .png()
    .toBuffer();
}

/**
 * 比较两张图片的相似度（基于像素差异）
 * 返回 0-1 之间的相似度分数
 */
async function compareImages(buffer1, buffer2) {
  try {
    // 将两张图片调整为相同尺寸并转换为原始像素
    const img1 = await sharp(buffer1).resize(150, 60).raw().toBuffer({ resolveWithObject: true });
    const img2 = await sharp(buffer2).resize(150, 60).raw().toBuffer({ resolveWithObject: true });

    const data1 = img1.data;
    const data2 = img2.data;

    // 计算像素差异
    let totalDiff = 0;
    const pixelCount = data1.length;

    for (let i = 0; i < pixelCount; i++) {
      totalDiff += Math.abs(data1[i] - data2[i]);
    }

    // 最大可能差异 = 255 * 像素数
    const maxDiff = 255 * pixelCount;
    const similarity = 1 - (totalDiff / maxDiff);

    return similarity;
  } catch (e) {
    serverError('[图片对比] 对比失败:', e.message);
    return 0;
  }
}

/**
 * OCR识别图片中的文字
 * @param {Buffer} imageBuffer - 图片数据
 * @param {Object} deviceInfo - 设备信息，包含 screenWidth/screenHeight
 */
async function ocrRegion(imageBuffer) {
  try {
    // 客户端送来的 640×360 图片，直接识别不放大
    const result = await Tesseract.recognize(imageBuffer, 'chi_sim', {
      logger: (m) => {
        if (m.status === 'loading language traineddata') {
          // 下载进度不打印
        }
      },
      errorHandler: (err) => {
        serverError('[OCR] 训练数据加载错误:', err.message);
      },
    });
    return result.data.text.trim();
  } catch (e) {
    serverError('[OCR] 识别失败:', e.message);
    return '';
  }
}

/**
 * 预处理OCR文本：去除空格、换行、标点，统一为小写
 */
function preprocessOcrText(text) {
  return text
    .replace(/\s+/g, '')           // 去除所有空白字符（空格、换行、制表符）
    .replace(/[，。？！.,?!]/g, '') // 去除常见标点
    .toLowerCase();                 // 统一小写（英文部分）
}

/**
 * 检查文字是否包含报警关键词
 * - 2字关键词：匹配到2个才触发
 * - 3字关键词：匹配到1个就触发
 */
function matchAlarmKeywords(text) {
  const processedText = preprocessOcrText(text);

  // 先检查3字词（单匹配直接触发）
  for (const keyword of ALARM_KEYWORDS_3CHAR) {
    if (processedText.includes(keyword)) {
      return keyword; // 直接返回匹配的3字词
    }
  }

  // 再检查2字词（需匹配到2个才触发）
  let matchCount = 0;
  const matchedKeywords = [];
  for (const keyword of ALARM_KEYWORDS_2CHAR) {
    if (processedText.includes(keyword)) {
      matchedKeywords.push(keyword);
      matchCount++;
      if (matchCount >= 2) {
        return matchedKeywords[0]; // 返回第一个匹配的词
      }
    }
  }

  return null;
}

/**
 * 在图片上绘制亮色框
 */
async function drawAlarmBox(imageBuffer, x1, y1, x2, y2) {
  const svgOverlay = `
    <svg width="100%" height="100%">
      <rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" 
            fill="none" stroke="#ff0000" stroke-width="3"/>
    </svg>
  `;
  
  return await sharp(imageBuffer)
    .composite([{ input: Buffer.from(svgOverlay), blend: 'over' }])
    .png()
    .toBuffer();
}

/**
 * 处理报警图片（主流程 - 新算法）
 * 1. 九宫格取中心区域
 * 2. 颜色匹配 #F0F0F0 浅灰色
 * 3. 二值化 → 连通域分块
 * 4. 尺寸过滤：173x160 和 173x130（容差5%）
 * 5. 坐标换算 → OCR区域
 * 6. OCR识别
 */
async function processAlarmImage(deviceId, imageBuffer, deviceInfo) {
  const now = Date.now();
  const state = alarmStates.get(deviceId) || {
    state: 'idle',
    verifyCount: 0,  // 连续不符合查重的次数
    templateRegion: null,
    templateBuffer: null,
    lastImage: null,
    occurrenceCount: 1,
  };

  // ========== 查重阶段 ==========
  if (state.state === 'verifying' && state.templateBuffer && state.templateRegion) {
    const { x1, y1, x2, y2 } = state.templateRegion;
    const metadata = await sharp(imageBuffer).metadata();

    const clampedX1 = Math.max(0, Math.min(x1, metadata.width));
    const clampedY1 = Math.max(0, Math.min(y1, metadata.height));
    const clampedX2 = Math.max(0, Math.min(x2, metadata.width));
    const clampedY2 = Math.max(0, Math.min(y2, metadata.height));

    const newRegionBuffer = await extractRegion(imageBuffer, clampedX1, clampedY1, clampedX2 - clampedX1, clampedY2 - clampedY1);
    const similarity = await compareImages(state.templateBuffer, newRegionBuffer);

    if (similarity < 0.9) {
      // 相似度不符合，计数器+1
      state.verifyCount++;
      if (state.verifyCount >= 2) {
        // 连续2次不符合，本轮报警结束
        alarmStates.set(deviceId, {
          state: 'idle',
          verifyCount: 0,
          templateRegion: null,
          templateBuffer: null,
          lastImage: null,
          occurrenceCount: state.occurrenceCount,
        });
        return false;
      }
      // 继续等待下一帧
      alarmStates.set(deviceId, state);
      return false;
    }

    // 相似度符合，重置计数器，继续等待
    state.verifyCount = 0;
    alarmStates.set(deviceId, state);
    return false;
  }
  
  // 获取原图尺寸（客户端已固定为 640×360）
  const metadata = await sharp(imageBuffer).metadata();
  const imgW = metadata.width;
  const imgH = metadata.height;
  
  // 客户端已截取中心 640×360，直接使用原图进行分析
  const centerW = imgW;
  const centerH = imgH;
  
  // 将图片转为 RGB 原始数据
  const { data: centerData } = await sharp(imageBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  // 详细日志已移除，仅在报警确认时输出日志
  
  // 2. 颜色匹配 #F0F0F0 浅灰色 (容差30)
  const tolerance = 30;
  const targetR = 240, targetG = 240, targetB = 240;
  const mask = new Uint8Array(centerW * centerH);
  let maskCount = 0;
  
  for (let y = 0; y < centerH; y++) {
    for (let x = 0; x < centerW; x++) {
      const idx = (y * centerW + x) * 3;
      const r = centerData[idx];
      const g = centerData[idx + 1];
      const b = centerData[idx + 2];
      if (Math.abs(r - targetR) <= tolerance && 
          Math.abs(g - targetG) <= tolerance && 
          Math.abs(b - targetB) <= tolerance) {
        mask[y * centerW + x] = 1;
        maskCount++;
      }
    }
  }
  

  
  if (maskCount < 100) {

    return false;
  }
  
  // 3. 连通域分块 (BFS 4连通)
  const regions = findConnectedRegions(mask, centerW, centerH);

  
  // 4. 尺寸过滤：173x160 和 173x130（容差5%）
  const targetSizes = [
    { w: 173, h: 160 },
    { w: 173, h: 130 }
  ];
  const sizeTolerance = 0.10;  // 10%（640×360固定尺寸，容差可降低）
  
  const validRegions = [];
  for (const reg of regions) {
    for (const target of targetSizes) {
      const wMin = target.w * (1 - sizeTolerance);
      const wMax = target.w * (1 + sizeTolerance);
      const hMin = target.h * (1 - sizeTolerance);
      const hMax = target.h * (1 + sizeTolerance);
      if (reg.w >= wMin && reg.w <= wMax && reg.h >= hMin && reg.h <= hMax) {
        validRegions.push({ ...reg, targetSize: target });
        break;
      }
    }
  }
  

  
  if (validRegions.length === 0) {

    return false;
  }
  
  // 5. 坐标换算：客户端送来的 640×360 图片，直接在里面找连通域
  const reg = validRegions[0];
  const x1 = reg.x;
  const y1 = reg.y;
  const x2 = Math.min(imgW, reg.x + reg.w);
  const y2 = Math.min(imgH, reg.y + reg.h);
  
  // 提取OCR区域
  const regionBuffer = await extractRegion(imageBuffer, x1, y1, x2 - x1, y2 - y1);
  
  // 6. OCR识别（固定1倍大小，不放大）
  let ocrText = '';

  try {
    ocrText = await ocrRegion(regionBuffer, null);

  } catch (ocrErr) {
    // OCR异常静默，不打印
  }
  
  // 7. 关键词匹配
  const matchedKeyword = matchAlarmKeywords(ocrText);
  if (!matchedKeyword) {

    return false;
  }
  
  // 8. 查重：计算与上一帧的相似度，过滤连续相似帧
  const imageMd5 = crypto.createHash('md5').update(imageBuffer).digest('hex');
  const prev = alarmPrevCache.get(deviceId);
  if (prev && prev.md5 === imageMd5) {
    // 与上一帧完全相同，跳过
    return false;
  }
  alarmPrevCache.set(deviceId, { md5: imageMd5, time: now });
  
  // 9. 向客户端请求 1080P 截图（真正报警时才请求）
  const dev = devices.get(deviceId);
  if (dev) {
    for (const client of wssClient.clients) {
      if (client._deviceId === deviceId && client.readyState === 1) {
        client.send(JSON.stringify({ type: 'requestAlarmFullScreenshot', alarmTimestamp: now }));
        break;
      }
    }
  }
  
  // 10. 临时保存 640×360 截图（等 1080P 回来后替换）
  const screenshotId = crypto.randomUUID();
  const screenshotPath = path.join(ALARM_SCREENSHOTS_DIR, `${screenshotId}.png`);
  fs.writeFileSync(screenshotPath, imageBuffer);
  
  // 11. 计算本日报警次数
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  let occurrenceCount = 1;
  for (const rec of alarmRecords) {
    if (rec.deviceId === deviceId && rec.timestamp >= dayStart) {
      if (rec.occurrenceCount && rec.occurrenceCount >= occurrenceCount) {
        occurrenceCount = rec.occurrenceCount + 1;
      }
    }
  }
  
  // 10. 创建报警记录（使用 URL 路径）
  const record = {
    id: crypto.randomUUID(),
    deviceId,
    deviceName: deviceInfo.deviceName,
    uuDeviceId: deviceInfo.uuDeviceId,
    screenshot: `/alarm-screenshots/${screenshotId}.png`,
    screenshotId,
    screenshotPath,
    timestamp: now,
    groupName: deviceInfo.groupName,
    cellStr: deviceInfo.cellStr,
    occurrenceCount,
    status: 'confirmed',
    matchedKeyword,
    region: { x1, y1, x2, y2 },
    regionSize: { w: reg.w, h: reg.h },
    isFullScreenshot: false,  // 标记是否已收到1080P截图
  };
  
  alarmRecords.push(record);
  persistAlarmRecords();
  
  serverLog(`[报警] ${deviceInfo.deviceName} 触发报警 (第${occurrenceCount}次)`);
  
  // 11. 更新状态为查重阶段
  alarmStates.set(deviceId, {
    state: 'verifying',
    verifyCount: 0,
    templateRegion: { x1, y1, x2, y2 },
    templateBuffer: regionBuffer,
    lastImage: imageBuffer,
    occurrenceCount,
  });
  
  // 12. 广播报警
  broadcastToBrowsers({ type: 'alarm', alarm: record });
  
  return true;
}

/**
 * 连通域检测 (BFS 4连通)
 */
function findConnectedRegions(mask, w, h) {
  const visited = new Uint8Array(w * h);
  const regions = [];
  
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx;
      if (!mask[si] || visited[si]) continue;
      
      // BFS
      const queue = [si];
      const pixels = [si];
      visited[si] = 1;
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      
      while (queue.length > 0) {
        const ci = queue.shift();
        const cx = ci % w;
        const cy = Math.floor(ci / w);
        
        // 4邻居
        const neighbors = [
          ci - 1,  // 左
          ci + 1,  // 右
          ci - w,  // 上
          ci + w   // 下
        ];
        
        for (const ni of neighbors) {
          if (ni < 0 || ni >= w * h) continue;
          const ny = Math.floor(ni / w);
          // 检查左右邻居是否跨行
          if ((ni === ci - 1 || ni === ci + 1) && ny !== cy) continue;
          if (!visited[ni] && mask[ni]) {
            visited[ni] = 1;
            queue.push(ni);
            pixels.push(ni);
            const nx = ni % w;
            if (nx < minX) minX = nx;
            if (nx > maxX) maxX = nx;
            if (ny < minY) minY = ny;
            if (ny > maxY) maxY = ny;
          }
        }
      }
      
      regions.push({
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        area: pixels.length,
        pixels
      });
    }
  }
  
  return regions;
}

function getDeviceListPayload() {
  return Array.from(devices.values())
    .sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'zh-CN'))
    .map(d => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      uuDeviceId: d.uuDeviceId,
      online: d.online,
      lastSeen: d.lastSeen,
      screenshot: d.screenshot || null,
      hqScreenshot: d.hqScreenshot || null,
      groupId: d.groupId || null,
      supportsKeyClient: d.supportsKeyClient || false,
      monitorIndex: d.monitorIndex || 1,
      monitorCount: d.monitorCount || 1,
      screenWidth: d.screenWidth || null,
      screenHeight: d.screenHeight || null,
      monitorOffsetX: d.monitorOffsetX || 0,
      monitorOffsetY: d.monitorOffsetY || 0,
      version: d.version || null,
      uuVersion: d.uuVersion || null,
    }));
}

function getGridPayload(gridSize) {
  // 统一存储：所有布局共用同一套 01-100 格子，gridSize 只影响显示列数
  const total = 100;
  const cells = [];
  for (let i = 0; i < total; i++) {
    const deviceId = gridLayout[i] || null;
    const dev = deviceId ? devices.get(deviceId) : null;
    cells.push({
      index: i,
      deviceId: deviceId || null,
      deviceName: dev ? dev.deviceName : null,
      uuDeviceId: dev ? dev.uuDeviceId : null,
      online: dev ? dev.online : false,
      screenshot: dev ? (dev.screenshot || null) : null,
    });
  }
  return cells;
}

// 渲染优化：批量发送（16ms批次）
let renderBatch = []; // 待发送消息队列
let renderTimer = null;

function broadcastToBrowsers(data, forceAll = false) {
  // 截图消息根据视口过滤
  if (data.type === 'screenshot' && !forceAll) {
    const deviceId = data.deviceId;
    // 监控墙白名单始终推送
    if (!monitorWallDevices.has(deviceId)) {
      // 检查是否有任意浏览器上报过视口
      let hasAnyViewport = browserViewport.size > 0;
      if (!hasAnyViewport) {
        // 无视口数据时，使用后备模式：推送到所有浏览器
        // 不跳过，让后续逻辑处理
      } else {
        // 检查是否在任意浏览器的视口内
        let inViewport = false;
        for (const viewportDevices of browserViewport.values()) {
          if (viewportDevices.has(deviceId)) { inViewport = true; break; }
        }
        if (!inViewport) return; // 不在视口内，跳过
      }
    }
  }
  
  // 加入批次队列
  renderBatch.push(data);
  if (!renderTimer) {
    renderTimer = setTimeout(flushRenderBatch, 16); // 16ms批次（约60fps）
  }
}

function flushRenderBatch() {
  if (renderBatch.length === 0) { renderTimer = null; return; }
  
  // 按类型分组，减少消息数量
  const screenshots = {};
  const others = [];
  
  for (const data of renderBatch) {
    if (data.type === 'screenshot') {
      // 同一设备保留最新截图
      screenshots[data.deviceId] = data;
    } else {
      others.push(data);
    }
  }
  
  // 发送截图批量消息
  const screenshotList = Object.values(screenshots);
  if (screenshotList.length > 0) {
    try {
      const msg = JSON.stringify({ type: 'screenshotBatch', screenshots: screenshotList });
      for (const ws of browserClients) {
        try {
          if (ws.readyState === 1) ws.send(msg);
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      logger.error(`[Batch] screenshotBatch stringify failed: ${e.message}`);
    }
  }
  
  // 发送其他消息
  for (const data of others) {
    try {
      const msg = JSON.stringify(data);
      for (const ws of browserClients) {
        try {
          if (ws.readyState === 1) ws.send(msg);
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      logger.error(`[Batch] broadcast stringify failed: ${e.message}`);
    }
  }
  
  renderBatch = [];
  renderTimer = null;
}

// 处理浏览器上报视口（当前可见格子）
function handleViewportUpdate(ws, deviceIds) {
  browserViewport.set(ws, new Set(deviceIds || []));
}

// 添加监控墙白名单设备
function addMonitorWall(deviceId) {
  monitorWallDevices.add(deviceId);
}

// 移除监控墙白名单设备
function removeMonitorWall(deviceId) {
  monitorWallDevices.delete(deviceId);
}

function broadcastToClients(data) {
  const msg = JSON.stringify(data);
  for (const client of wssClient.clients) {
    try {
      if (client.readyState === 1) client.send(msg);
    } catch (e) { /* ignore */ }
  }
}

// 向指定 deviceId 的客户端发送消息
function sendToClient(deviceId, data) {
  const msg = JSON.stringify(data);
  for (const client of wssClient.clients) {
    try {
      if (client._deviceId === deviceId && client.readyState === 1) {
        client.send(msg);
        return true;
      }
    } catch (e) { /* ignore */ }
  }
  return false;
}

// 通知所有监控墙窗口状态变化
function notifyWallClients(eventType, data) {
  let msg;
  try {
    msg = JSON.stringify({ type: 'wallStateUpdate', eventType, ...data, devices: getDeviceListPayload(), groups: groups });
  } catch (e) {
    logger.error(`[Wall] notifyWallClients stringify failed: ${e.message}`);
    return;
  }
  for (const [ws, subscription] of wallClients) {
    try {
      if (ws.readyState === 1) ws.send(msg);
    } catch (e) { /* ignore individual client errors */ }
  }
}

// 在所有格子中查找指定设备的格子索引（不含 deviceId=null 的空槽）
function findDeviceCell(deviceId) {
  // 统一存储：扁平化查找 cellIndex -> deviceId
  for (const [idx, devId] of Object.entries(gridLayout)) {
    if (devId === deviceId) return { gridSize: null, cellIndex: parseInt(idx) };
  }
  return null;
}

// ========== WebSocket 服务器 ==========
// permessage-deflate：自动压缩 WebSocket 消息（base64 截图流量可减少 30-40%）
const { WebSocketServer } = require('ws');
const wsDeflateOptions = { perMessageDeflate: { threshold: 1024 } };

const wssClient = new WebSocketServer({ noServer: true });
const wssBrowser = new WebSocketServer({ noServer: true, ...wsDeflateOptions });

// Python 客户端连接
wssClient.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ws._ip = ip;
  let deviceId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { 
      serverLog(`[设备消息] JSON解析失败: ${e.message}, raw长度: ${raw.length}`);
      return; 
    }
    
    try {
    
    // 调试：打印截图消息的接收情况
    if (msg.type === 'screenshot') {
      const imgLen = msg.image ? msg.image.length : 0;
      
    }

    if (msg.type === 'register') {
      const incomingUU = String(msg.uuDeviceId || '');
      const incomingDeviceId = String(msg.deviceId || '');

      // deviceId 为空：不创建设备，只发安装指令，等UU装完重新上线
      if (!incomingDeviceId) {
        serverLog(`[UU升级] 设备 ${msg.deviceName} deviceId为空，通知客户端安装UU v${SERVER_CONFIG.uuVersion || '?'}`);
        ws.send(JSON.stringify({ type: 'registered', deviceId: '', installUU: true, uuDownloadUrl: SERVER_CONFIG.uuDownloadUrl || '' }));
        return;
      }

      // deviceId 不为空：正常创建设备逻辑
      // 唯一标识：只用 deviceId 查找已有设备（避免 uuDeviceId 相同导致设备混淆）
      let existing = null;
      if (incomingDeviceId) {
        existing = devices.get(incomingDeviceId) || null;
      }

      // 确定最终 deviceId
      deviceId = incomingDeviceId;

      // 服务器端 deviceName 优先；客户端名字只在服务器没有记录时使用
      const serverName = existing && existing.deviceName;
      const clientName = String(msg.deviceName || '');
      const finalName = serverName || clientName || `设备-${deviceId.slice(0, 6)}`;

      const newDev = {
        ...(existing || {}),
        deviceId,
        deviceName: finalName,
        uuDeviceId: incomingUU || (existing && existing.uuDeviceId) || '',
        screenshot: (existing && existing.screenshot) || null,
        lastSeen: Date.now(),
        online: true,
        groupId: (existing && existing.groupId) || null,
        supportsKeyClient: msg.supportsKeyClient || false,
        monitorIndex: msg.monitorIndex || 1,
        monitorCount: msg.monitorCount || 1,
        screenWidth: msg.screenWidth || null,
        screenHeight: msg.screenHeight || null,
        monitorOffsetX: (msg.monitorOffsetX !== undefined) ? msg.monitorOffsetX : 0,
        monitorOffsetY: (msg.monitorOffsetY !== undefined) ? msg.monitorOffsetY : 0,
        // 版本号（首次注册时就保存，避免首次心跳响应里 dev.version 为 undefined）
        version: msg.version || null,
        // UU远程安装状态
        uuInstalled: msg.uuInstalled !== undefined ? msg.uuInstalled : (existing && existing.uuInstalled),
        uuVersion: msg.uuVersion || (existing && existing.uuVersion) || '',
      };
      devices.set(deviceId, newDev);
      ws._deviceId = deviceId;
      const wasOffline = !existing || !existing.online;
      if (wasOffline) {
        const kbTag = msg.supportsKeyClient ? '远控' : '—';
        serverLog(`[+] 上线: ${newDev.deviceName} (${deviceId}) uuId=${newDev.uuDeviceId} | IP: ${ip} | ${kbTag} | 显示器${newDev.monitorIndex} | ${newDev.screenWidth || '?'}×${newDev.screenHeight || '?'}`);
      }
      persistDevices();  // 持久化设备列表
      broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
      // 广播设备预览状态变更（让所有浏览器刷新预览大图，移除离线/删除状态）
      broadcastToBrowsers({ type: 'devicePreviewStatus', deviceId, status: 'online' });
      if (wasOffline) {
        notifyWallClients('deviceOnline', { deviceId, deviceName: newDev.deviceName });
      }
      updateCollectionsDeviceStatus(deviceId, {});
      ws.send(JSON.stringify({ type: 'registered', deviceId }));

      // 广播设备名同步给所有浏览器（确保标题/角标实时更新）
      broadcastToBrowsers({
        type: 'deviceNameSync',
        deviceId,
        deviceName: newDev.deviceName,
        groupId: newDev.groupId,
      });

      // 如果设备在监控墙上（之前被订阅过），自动恢复高清流
      if (wallDevices.has(deviceId)) {
        const interval = 125; // 125ms = 8fps，覆盖旧值（可能是333ms）
        wallDevices.set(deviceId, interval); // 更新为新值
        ws.send(JSON.stringify({ type: 'startHQ', interval }));
      }

      // 检查是否有浏览器正在预览该设备，如果有则自动恢复高清流
      for (const [browserWs, previewDevices] of browserPreviewHD) {
        if (previewDevices.has(deviceId)) {
          ws.send(JSON.stringify({ type: 'startHQ', interval: 125 })); // 125ms = 8fps
          break;
        }
      }

      // 如果有该设备的迁移指令，发送给它
      if (migrationCommands[deviceId]) {
        const cmd = migrationCommands[deviceId];
        serverLog(`[迁移] 向 ${newDev.deviceName} 发送迁移指令: ${cmd.host}:${cmd.port}`);
        ws.send(JSON.stringify({ type: 'migrateOffline', host: cmd.host, port: cmd.port }));
        // 该设备执行完，勾掉
        delete migrationCommands[deviceId];
        serverLog(`[迁移] 剩余待迁移设备: ${Object.keys(migrationCommands).length}`);
      }

      // 下发该设备的待接受任务（未撤回、未接受）
      const pendingTasks = tasks.filter(t => t.deviceId === deviceId && !t.accepted && !t.revoked && !t.deleted);
      if (pendingTasks.length > 0) {
        ws.send(JSON.stringify({
          type: 'pendingTasks',
          tasks: pendingTasks.map(t => ({ id: t.id, content: t.content, timestamp: t.timestamp }))
        }));
      }

      // 通知客户端服务器上存储的设备名（供本地持久化）
      ws.send(JSON.stringify({ type: 'deviceNameSync', deviceName: newDev.deviceName }));
    }

    if (msg.type === 'screenshot' && msg.deviceId) {
      const receiveTime = Date.now();
      const dev = devices.get(msg.deviceId);
      if (dev) {
        dev.lastSeen = receiveTime;
        dev.online = true;

        // 实时同步分辨率（防止人工修改后坐标映射错误）
        if (msg.screenWidth && msg.screenHeight) {
          dev.screenWidth = msg.screenWidth;
          dev.screenHeight = msg.screenHeight;
        }

        // ========== 收藏截图处理（不受 667ms 延迟限制）==========
        if (msg.collectionTimestamp) {
          // 收到收藏截图请求的响应
          const { collectionTimestamp, deviceId, image } = msg;
          // 检查设备是否真的在收藏列表中
          const fav = favorites.find(f => f.deviceId === deviceId);
          if (!fav) {
            serverLog(`[收藏] 收到未收藏设备 ${deviceId} 的截图，忽略`);
          } else if (image && image.length >= 100) {
            // 检查截图是否有效
            const groupName = getGroupNameForDevice(deviceId);
            const cellIndex = getCellIndexForDevice(deviceId);
            const online = dev.online;
            
            // 生成缩略图（压缩成 480x270 webp）
            (async () => {
              try {
                const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');
                const compressed = await sharp(buffer)
                  .resize(480, 270, { fit: 'cover' })
                  .webp({ quality: 30, effort: 4 })
                  .toBuffer();
                const thumbnail = 'data:image/webp;base64,' + compressed.toString('base64');
                if (!collections.has(collectionTimestamp)) {
                  collections.set(collectionTimestamp, []);
                }
                const items = collections.get(collectionTimestamp);
                const existingIdx = items.findIndex(item => item.deviceId === deviceId);
                const newItem = {
                  deviceId,
                  screenshot: thumbnail || image,
                  hdScreenshot: image,
                  deviceName: dev.deviceName,
                  groupName,
                  cellIndex,
                  online,
                  deleted: false,
                  timestamp: collectionTimestamp
                };
                if (existingIdx >= 0) {
                  items[existingIdx] = newItem;
                } else {
                  items.push(newItem);
                }
                saveCollections();
                // 广播更新后的截图集合给所有浏览器
                const collectionsArr = [];
                collections.forEach((its, ts) => {
                  collectionsArr.push({ timestamp: ts, items: its });
                });
                collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
                broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
              } catch (e) {}
            })();
          }
        }

        // 注：移除 667ms 延迟检查，因为客户端时间戳与服务端不同步会导致误判
        // 帧缓存去重（MD5）已经能保证不重复渲染相同内容

        // MJPEG 帧缓冲区更新已禁用（新架构使用 WebSocket 三通道推送）

        // ===== 统一截图推送（HQ/标准 共用）=====
        // 更新设备状态
        if (msg.hq) {
          dev.hqScreenshot = msg.image;
          dev.screenshot = msg.image;
        } else {
          dev.screenshot = msg.image;
          dev.hqScreenshot = null;
        }

        const now = Date.now();

        // ── browserScreenshot：推送给所有浏览器（格子页面 + 监控预览弹窗）──────
        // 标准模式用 MD5 去重节流，HQ 模式直接推送
        let shouldSendBrowser = true;
        if (!msg.hq) {
          // 从 msg.image 提取 buffer 用于 MD5 去重
          const base64Data = msg.image.replace(/^data:image\/\w+;base64,/, '');
          const buf = Buffer.from(base64Data, 'base64');
          const md5 = crypto.createHash('md5').update(buf).digest('hex');
          const cached = frameCache.get(msg.deviceId);
          if (cached && cached.md5 === md5 && (now - cached.time < 100)) {
            shouldSendBrowser = false;
          } else {
            frameCache.set(msg.deviceId, { md5, time: now });
          }
        }

        if (shouldSendBrowser) {
          const browserMsg = JSON.stringify({
            type: 'browserScreenshot',
            deviceId: msg.deviceId,
            image: msg.image,
            timestamp: now
          });
          for (const browserWs of browserClients) {
            if (browserWs.readyState === 1 && !wallClients.has(browserWs)) {
              browserWs.send(browserMsg);
            }
          }
        }

        // ── wallScreenshot：推送给监控墙 ────────────────
        // 标准模式 200ms 节流，HQ 模式直接推送
        let shouldSendWall = true;
        if (!msg.hq) {
          if (dev._lastWallPush && now - dev._lastWallPush <= 200) {
            shouldSendWall = false;
          } else {
            dev._lastWallPush = now;
          }
        }
        if (shouldSendWall) {
          for (const [wallWs, subscription] of wallClients) {
            if (subscription.devices.has(msg.deviceId) && wallWs.readyState === 1) {
              wallWs.send(JSON.stringify({
                type: 'wallScreenshot',
                deviceId: msg.deviceId,
                screenshot: msg.image,
                timestamp: now
              }));
            }
          }
        }

        // ── previewScreenshot：仅 HQ 模式，推送给大图预览 ─────
        if (msg.hq) {
          const previewMsg = JSON.stringify({
            type: 'previewScreenshot',
            deviceId: msg.deviceId,
            image: msg.image,
            timestamp: now,
            screenWidth: dev.screenWidth || 1920,
            screenHeight: dev.screenHeight || 1080
          });
          for (const [previewWs, previewInfo] of previewClients) {
            if (previewInfo.deviceId === msg.deviceId && previewWs.readyState === 1) {
              previewWs.send(previewMsg);
            }
          }
        }
      }
    }

    if (msg.type === 'heartbeat' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      if (dev) {
        dev.lastSeen = Date.now();
        dev.online = true;

        // 心跳日志


        // 保存设备版本号和显示器信息
        if (msg.version) {
          dev.version = msg.version;
        }
        if (msg.monitorIndex) {
          dev.monitorIndex = msg.monitorIndex;
        }
        if (msg.monitorCount) {
          dev.monitorCount = msg.monitorCount;
        }
        if (msg.screenWidth && msg.screenHeight) {
          dev.screenWidth = msg.screenWidth;
          dev.screenHeight = msg.screenHeight;
        }
        if (msg.monitorOffsetX !== undefined) {
          dev.monitorOffsetX = msg.monitorOffsetX;
        }
        if (msg.monitorOffsetY !== undefined) {
          dev.monitorOffsetY = msg.monitorOffsetY;
        }

        // 保存设备能力标志（键盘支持）
        if (msg.supportsKeyClient) {
          dev.supportsKeyClient = true;
          // 广播键盘支持状态变更
          broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
        }
        
        // 保存屏幕分辨率（统一获取，不判断键盘状态）
        if (msg.screenWidth && msg.screenHeight) {
          dev.screenWidth = msg.screenWidth;
          dev.screenHeight = msg.screenHeight;
        }
        
        // 【修复】心跳时推送截图给监控墙（解决静止画面不刷新问题）
        // 优先使用心跳中的截图（客户端实时截取的），否则用存储的
        const heartbeatScreenshot = msg.screenshot;
        const latestScreenshot = heartbeatScreenshot || dev.hqScreenshot || dev.screenshot;
        if (latestScreenshot) {
          dev.screenshot = latestScreenshot; // 心跳截图也要存，让离线广播有最新截图
          const timestamp = Date.now();
          for (const [client, sub] of wallClients) {
            if (sub.devices.has(msg.deviceId)) {
              client.send(JSON.stringify({
                type: 'wallScreenshot',
                deviceId: msg.deviceId,
                screenshot: latestScreenshot,
                timestamp: timestamp
              }));
            }
          }
        }

        // 心跳响应：告诉客户端是否有新版本（只在有升级时打日志）
        const clientVersion = dev.version || '0.0.0';
        const [cMajor, cMinor, cPatch] = clientVersion.split('.').map(Number);
        const [sMajor, sMinor, sPatch] = (SERVER_CONFIG.serverVersion || '').split('.').map(Number);
        const needsUpdate = cMajor < sMajor || (cMajor === sMajor && cMinor < sMinor) || (cMajor === sMajor && cMinor === sMinor && cPatch < sPatch);
        if (needsUpdate) {
          serverLog(`[升级] ${dev.deviceName} 有新版本 ${SERVER_CONFIG.serverVersion || '未知'}（当前 ${clientVersion}），通知客户端下载...`);
        }

        // 保存UU版本和安装状态
        if (msg.uuVersion !== undefined) dev.uuVersion = msg.uuVersion;
        if (msg.uuInstalled !== undefined) dev.uuInstalled = msg.uuInstalled;

        // 检查是否需要安装/更新UU远程
        let needsInstallUU = false;
        if (SERVER_CONFIG.uuVersion && SERVER_CONFIG.uuDownloadUrl) {
          const cfgUUVer = SERVER_CONFIG.uuVersion;
          const devUUVer = dev.uuVersion || '';
          const devUUInstalled = dev.uuInstalled;
          
          // uuVersion 为空（未知）时不推送升级，等设备自行重启刷新版本后再检查
          if (devUUVer && (!devUUInstalled || devUUVer !== cfgUUVer)) {
            needsInstallUU = true;
            serverLog(`[UU升级] 设备 ${dev.deviceName} UU未安装或版本不匹配(${devUUVer}→${cfgUUVer})，通知升级`);
          }
        }

        // 【合并修复】心跳中附带的报警截图，走 processAlarmImage 处理
        const alarmImgData = msg.alarmScreenshot;
        if (alarmImgData) {

          const imgBuffer = Buffer.from(alarmImgData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          
          processAlarmImage(dev.deviceId, imgBuffer, {
            deviceName: dev.deviceName,
            uuDeviceId: dev.uuDeviceId || null,
            groupName: '',
            cellStr: '',
            screenWidth: dev.screenWidth || 1920,
            screenHeight: dev.screenHeight || 1080,
          }).catch(err => {
            serverError(`[报警] ${dev.deviceName} 处理失败:`, err.message);
          });
        }

        ws.send(JSON.stringify({
          type: 'heartbeat',
          latestVersion: SERVER_CONFIG.serverVersion || '未知',
          updateAvailable: needsUpdate,
          version: dev.version || '0.0.0',
          serverConfig: SERVER_CONFIG,
          installUU: needsInstallUU,
          uuDownloadUrl: needsInstallUU ? SERVER_CONFIG.uuDownloadUrl : undefined,
          uuFileName: needsInstallUU ? (SERVER_CONFIG.uuDownloadUrl || '').replace(/^\//, '') : undefined,
        }));
      }
    }

    // 处理客户端返回的 1080P 报警截图（用于保存）
    if (msg.type === 'alarmFullScreenshot' && msg.deviceId && msg.image) {
      const alarmTimestamp = msg.alarmTimestamp;
      const deviceId = msg.deviceId;
      const imageData = msg.image;

      // 实时同步分辨率
      const dev = devices.get(deviceId);
      if (dev && msg.screenWidth && msg.screenHeight) {
        dev.screenWidth = msg.screenWidth;
        dev.screenHeight = msg.screenHeight;
      }

      // 方法1：查找 30 秒窗口内的记录
      let matchedRecord = alarmRecords.find(r =>
        r.deviceId === deviceId && Math.abs(r.timestamp - alarmTimestamp) < 30000 && !r.isFullScreenshot
      );

      if (matchedRecord) {
        // 更新报警记录的截图
        const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        fs.writeFileSync(matchedRecord.screenshotPath, imgBuffer);
        matchedRecord.isFullScreenshot = true;
        serverLog(`[报警] ${matchedRecord.deviceName} 1080P截图已保存`);
      } else {
        // 方法2：查找最近一个未完成1080P的记录
        matchedRecord = alarmRecords.find(r =>
          r.deviceId === deviceId && !r.isFullScreenshot
        );
        
        if (matchedRecord) {
          const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          fs.writeFileSync(matchedRecord.screenshotPath, imgBuffer);
          matchedRecord.isFullScreenshot = true;
          serverLog(`[报警] ${matchedRecord.deviceName} 1080P截图已保存（延迟到达）`);
        } else {
          // 没有匹配到记录，保存为独立文件
          const screenshotId = crypto.randomUUID();
          const screenshotPath = path.join(ALARM_SCREENSHOTS_DIR, `${screenshotId}.png`);
          const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          fs.writeFileSync(screenshotPath, imgBuffer);
          serverLog(`[报警] ${deviceId} 1080P截图保存失败（无匹配记录），独立保存为 ${screenshotId}.png`);
        }
      }
    }

    if (msg.type === 'alarm' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      const deviceName = dev ? dev.deviceName : (msg.deviceName || '未知设备');
      
      // 查找设备所在格子号和分组名
      let cellStr = '';
      let groupName = '';
      for (const [idx, devId] of Object.entries(gridLayout)) {
        if (devId === msg.deviceId) {
          cellStr = ' 格:' + String(parseInt(idx) + 1).padStart(2, '0');
          break;
        }
      }
      if (dev && dev.groupId) {
        const grp = groups.find(g => g.id === dev.groupId);
        if (grp) groupName = '(' + grp.name + ')';
      }
      
      // 获取图片数据
      const imageData = msg.image;
      if (!imageData) {
        // 无图片数据不打印
        return;
      }
      
      // 转换 base64 为 buffer
      const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      
      // 处理报警图片
      const deviceInfo = {
        deviceName,
        uuDeviceId: msg.uuDeviceId || dev?.uuDeviceId || null,
        groupName,
        cellStr,
        screenWidth: dev?.screenWidth || msg.screenWidth || 1920,
        screenHeight: dev?.screenHeight || msg.screenHeight || 1080,
      };
      
      processAlarmImage(msg.deviceId, imageBuffer, deviceInfo).catch(err => {
        serverError(`[报警] ${deviceName} 处理失败:`, err.message);
      });
    }  // end if alarm

    if (msg.type === 'acceptTask' && msg.taskId) {
      // 客户端接受任务：{ taskId, deviceId }
      const task = tasks.find(t => t.id === msg.taskId);
      if (task && !task.accepted && !task.revoked) {
        task.accepted = true;
        task.acceptedAt = Date.now();
        persistTasks();
        broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
      }
    }
    } catch (err) {
      serverError(`[设备消息] 处理消息 ${msg.type} 时发生未捕获错误: ${err.message}`, err.stack);
    }
  });

  ws.on('close', () => {
    try {
      if (deviceId && devices.has(deviceId)) {
        const dev = devices.get(deviceId);
        dev.online = false;
        serverLog(`[-] 离线: ${dev.deviceName}`);
        persistDevices();  // 设备离线时持久化
        broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
        // 广播设备预览状态变更（让所有浏览器刷新预览大图），带上最新截图避免批次延迟问题
        broadcastToBrowsers({ type: 'devicePreviewStatus', deviceId, status: 'offline', screenshot: dev.screenshot || null });
        notifyWallClients('deviceOffline', { deviceId });
        updateCollectionsDeviceStatus(deviceId, {});
      }
    } catch (err) {
      serverError(`[设备离线] ws.on('close') 未捕获错误: ${err.message}`);
    }
  });

  ws.on('error', () => ws.close());
});

// 浏览器连接
wssBrowser.on('connection', (ws) => {
  browserClients.add(ws);
  ws._lastPing = Date.now();  // 用于计算延迟

  // 立即发送第一个 ping
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
  }

  // 定期向浏览器发送 ping，浏览器响应 pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }
  }, 5000);

  ws.on('close', () => {
    clearInterval(pingInterval);
    browserClients.delete(ws);
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {

    // 浏览器响应 pong，计算延迟
    if (msg.type === 'pong' && msg.clientTimestamp) {
      const latency = Date.now() - msg.clientTimestamp;
      ws._latency = latency;
      ws._lastPing = Date.now();
      // 将延迟信息广播给所有浏览器
      broadcastToBrowsers({ type: 'latency', latency, timestamp: Date.now() });
      return;
    }

    // ========== 键盘控制 ==========
    if (msg.type === 'keyClick') {
      // 键盘按键：{ deviceId, key }
      const { deviceId: kDevId, key } = msg;
      if (!kDevId || !key) return;
      const dev = devices.get(kDevId);
      if (!dev || !dev.online) return;
      // 转发给客户端
      for (const client of wssClient.clients) {
        if (client._deviceId === kDevId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'keyClick', key }));
          break;
        }
      }
    }

    if (msg.type === 'mouseClick') {
      // 鼠标点击：{ deviceId, x, y, previewWidth, previewHeight }
      // x,y 是浏览器预览画面坐标，previewWidth/Height 是预览时的分辨率（可能已过时）
      // 服务端用自己最新的 dev.screenWidth/screenHeight（心跳频繁更新）校正坐标
      const { deviceId: mDevId, x, y, previewWidth, previewHeight } = msg;
      if (!mDevId) return;
      const dev = devices.get(mDevId);
      if (!dev || !dev.online) return;

      let actualX, actualY;
      const devW = dev.screenWidth || 1920;
      const devH = dev.screenHeight || 1080;

      // 如果预览分辨率与服务端分辨率一致（正常情况），直接用坐标
      if (previewWidth === devW && previewHeight === devH) {
        actualX = x;
        actualY = y;
      } else {
        // 分辨率可能已变化，用比例重新映射到服务端当前分辨率
        const pw = previewWidth || devW;
        const ph = previewHeight || devH;
        actualX = Math.round((x / pw) * devW);
        actualY = Math.round((y / ph) * devH);
      }

      // 加显示器偏移量得到虚拟桌面坐标
      actualX += dev.monitorOffsetX || 0;
      actualY += dev.monitorOffsetY || 0;

      for (const client of wssClient.clients) {
        if (client._deviceId === mDevId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'mouseClick', x: actualX, y: actualY }));
          break;
        }
      }
    }

    // Shift+点击 → 右键
    if (msg.type === 'mouseRight') {
      const { deviceId: mDevId, x, y, previewWidth, previewHeight } = msg;
      if (!mDevId) return;
      const dev = devices.get(mDevId);
      if (!dev || !dev.online) return;

      let actualX, actualY;
      const devW = dev.screenWidth || 1920;
      const devH = dev.screenHeight || 1080;

      if (previewWidth === devW && previewHeight === devH) {
        actualX = x;
        actualY = y;
      } else {
        const pw = previewWidth || devW;
        const ph = previewHeight || devH;
        actualX = Math.round((x / pw) * devW);
        actualY = Math.round((y / ph) * devH);
      }

      actualX += dev.monitorOffsetX || 0;
      actualY += dev.monitorOffsetY || 0;

      for (const client of wssClient.clients) {
        if (client._deviceId === mDevId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'mouseRight', x: actualX, y: actualY }));
          break;
        }
      }
    }

    // Ctrl+点击 → 滚轮上，Alt+点击 → 滚轮下
    if (msg.type === 'mouseScroll') {
      const { deviceId: mDevId, delta } = msg;
      if (!mDevId) return;
      const dev = devices.get(mDevId);
      if (!dev || !dev.online) return;
      for (const client of wssClient.clients) {
        if (client._deviceId === mDevId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'mouseScroll', delta: delta || 120 }));
          break;
        }
      }
    }


    // ========== 1080p 预览模式切换 ==========
    // 浏览器请求开启 1080p 预览
    if (msg.type === 'hq1080On') {
      // 优先使用消息中指定的deviceId（格子预览用），否则从previewClients获取
      const deviceId = msg.deviceId || (previewClients.get(ws) && previewClients.get(ws).deviceId);
      if (deviceId) {
        // 追踪该浏览器的 1080p 设备
        if (!browser1080p.has(ws)) browser1080p.set(ws, new Set());
        browser1080p.get(ws).add(deviceId);
        // 更新全局追踪（每开启一次加1，与globalHQ保持一致）
        global1080p.set(deviceId, (global1080p.get(deviceId) || 0) + 1);
        // 转发给设备客户端
        for (const client of wssClient.clients) {
          if (client._deviceId === deviceId && client.readyState === 1) {
            client.send(JSON.stringify({ type: 'hq1080On' }));
            break;
          }
        }
      }
    }

    // 浏览器请求关闭 1080p 预览
    if (msg.type === 'hq1080Off') {
      const my1080pDevices = browser1080p.get(ws);
      // 优先使用消息中指定的deviceId，否则从追踪Map中获取所有设备
      if (msg.deviceId) {
        // 从浏览器追踪Map中移除
        if (my1080pDevices) my1080pDevices.delete(msg.deviceId);
        // 从全局追踪中减1
        if (global1080p.has(msg.deviceId)) {
          const newCount = global1080p.get(msg.deviceId) - 1;
          if (newCount <= 0) {
            global1080p.delete(msg.deviceId);
            // 所有浏览器都没有使用1080p，通知设备关闭
            for (const client of wssClient.clients) {
              if (client._deviceId === msg.deviceId && client.readyState === 1) {
                client.send(JSON.stringify({ type: 'hq1080Off' }));
                break;
              }
            }
          } else {
            global1080p.set(msg.deviceId, newCount);
          }
        }
      } else {
        // 关闭所有追踪的设备
        if (my1080pDevices) {
          for (const deviceId of my1080pDevices) {
            // 从全局追踪中减1
            if (global1080p.has(deviceId)) {
              const newCount = global1080p.get(deviceId) - 1;
              if (newCount <= 0) {
                global1080p.delete(deviceId);
                // 所有浏览器都没有使用1080p，通知设备关闭
                for (const client of wssClient.clients) {
                  if (client._deviceId === deviceId && client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'hq1080Off' }));
                    break;
                  }
                }
              } else {
                global1080p.set(deviceId, newCount);
              }
            }
          }
          browser1080p.delete(ws);
        }
      }
    }

    if (msg.type === 'getState') {
      // 转换 collections 为数组格式
      const collectionsArr = [];
      collections.forEach((items, timestamp) => {
        collectionsArr.push({ timestamp, items });
      });
      collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
      
      ws.send(JSON.stringify({
        type: 'state',
        serverVersion: SERVER_CONFIG.serverVersion || '未知',
        gridSize: gridSizeSetting,
        cells: getGridPayload(gridSizeSetting),
        devices: getDeviceListPayload(),
        groups,
        alarms: alarmRecords,
        powerScenes,
        favorites,
        collections: collectionsArr,
        tasks: getTasksPayload(),
      }));
    }

    if (msg.type === 'clearAlarms') {
      // 清除所有报警记录
      alarmRecords = [];
      lastAlarmTime = new Map(); // 清除去重状态，重置计数
      pending_alarms = new Map(); // 清除所有 pending
      persistAlarmRecords();
      
      // 清除所有报警截图文件
      if (fs.existsSync(ALARM_SCREENSHOTS_DIR)) {
        const files = fs.readdirSync(ALARM_SCREENSHOTS_DIR);
        let deletedCount = 0;
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(ALARM_SCREENSHOTS_DIR, file));
            deletedCount++;
          } catch (e) {
            serverError(`[报警] 删除截图失败: ${file}`, e.message);
          }
        }
      }
      
      broadcastToBrowsers({ type: 'alarmsCleared' });
    }

    if (msg.type === 'viewAlarm') {
      // 标记报警记录为已查看，并广播给所有浏览器
      const { alarmId } = msg;
      const rec = alarmRecords.find(r => r.id === alarmId);
      if (rec) {
        rec.viewed = true;
        persistAlarmRecords();
        broadcastToBrowsers({ type: 'alarmViewed', alarmId });
      }
    }

    // ========== 任务系统消息处理 ==========

    if (msg.type === 'publishTask') {
      // 发布任务：{ deviceId, content }
      const { deviceId: tDevId, content } = msg;
      if (!tDevId || !content || !content.trim()) return;
      const dev = devices.get(tDevId);
      if (!dev) return;
      // 设备必须在线
      if (!dev.online) {
        ws.send(JSON.stringify({ type: 'taskError', error: '设备已离线，无法发布任务' }));
        return;
      }
      const groupId = dev.groupId || null;
      const grp = groupId ? groups.find(g => g.id === groupId) : null;
      const task = {
        id: crypto.randomUUID(),
        deviceId: tDevId,
        deviceName: dev.deviceName,
        groupName: grp ? grp.name : '',
        content: content.trim(),
        timestamp: Date.now(),
        accepted: false,
        acceptedAt: null,
        revoked: false,
        deleted: false,
        deviceDeleted: false,
      };
      tasks.push(task);
      persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
      // 推送给对应客户端
      for (const client of wssClient.clients) {
        if (client._deviceId === tDevId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'newTask', task: { id: task.id, content: task.content, timestamp: task.timestamp } }));
          break;
        }
      }
    }

    if (msg.type === 'revokeTask') {
      // 撤回任务（删除客户端泡泡，不影响历史记录）：{ taskId }
      const { taskId } = msg;
      const task = tasks.find(t => t.id === taskId);
      if (!task || task.revoked || task.accepted) return;
      task.revoked = true;
      persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
      // 通知客户端撤回泡泡
      for (const client of wssClient.clients) {
        if (client._deviceId === task.deviceId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'revokeTask', taskId }));
          break;
        }
      }
    }

    if (msg.type === 'deleteTask') {
      // 删除单条任务记录（彻底删除）：{ taskId }
      const { taskId } = msg;
      const idx = tasks.findIndex(t => t.id === taskId);
      if (idx < 0) return;
      tasks.splice(idx, 1);
      persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
    }

    if (msg.type === 'deleteDeviceTasks') {
      // 删除某设备所有任务记录：{ deviceId }
      const { deviceId: tDevId } = msg;
      tasks = tasks.filter(t => t.deviceId !== tDevId);
      persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
    }

    if (msg.type === 'deleteAllTasks') {
      // 删除所有任务记录
      tasks = [];
      persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: [] });
    }

    if (msg.type === 'serverMigrate') {
      const { host, port, groupIds } = msg;
      if (!host) {
        serverLog('[迁移] 未提供 host，忽略');
        return;
      }
      const targetPort = Number(port) || 3000;
      if (host === config.server.host && targetPort === config.server.port) {
        serverLog('[迁移] 目标服务器与当前服务器相同，忽略');
        return;
      }
      // groupIds: 要迁移的分组 id 数组，'' 表示未分组
      const targets = Array.isArray(groupIds) ? groupIds : [];
      serverLog(`[迁移] 收到请求 → host=${host}:${targetPort}, groupIds=${JSON.stringify(targets)}`);

      // 1. 给每个目标设备生成离线指令（仅内存，网关退出即销毁）
      migrationCommands = {};
      let genCount = 0;
      for (const [deviceId, dev] of devices) {
        if (targets.includes(dev.groupId || '')) {
          migrationCommands[deviceId] = { host: String(host), port: targetPort };
          genCount++;
          serverLog(`[迁移] 离线指令写入设备: ${deviceId} (groupId=${dev.groupId || '(空)'})`);
        }
      }
      serverLog(`[迁移] 已为 ${genCount} 个设备生成离线指令`);

      // 2. 通知目标设备的在线客户端：立即迁移（带 host/port）
      let pushCount = 0;
      for (const client of wssClient.clients) {
        if (client.readyState === 1 && client._deviceId) {
          const dev = devices.get(client._deviceId);
          const devGroupId = dev ? (dev.groupId || '') : '';
          if (targets.includes(devGroupId)) {
            try {
              client.send(JSON.stringify({ type: 'serverMigrate', host: String(host), port: targetPort }));
              pushCount++;
              serverLog(`[迁移] 在线推送: ${client._deviceId} (groupId=${devGroupId || '(空)'})`);
            } catch(e) {
              serverLog(`[迁移] 推送失败 ${client._deviceId}: ${e.message}`);
            }
          }
        }
      }
      serverLog(`[迁移] 已通知 ${pushCount} 个在线设备`);
    }

    if (msg.type === 'setGridSize') {
      // 仅记录当前显示列数，不影响格子内容（统一 01-100 存储）
      if (msg.gridSize) {
        gridSizeSetting = msg.gridSize;
        try { require('fs').writeFileSync(GRID_SIZE_PATH, JSON.stringify({ gridSize: gridSizeSetting }), 'utf8'); } catch(e) {}
      }
    }

    if (msg.type === 'setCell') {
      const { gridSize, cellIndex, deviceId } = msg;

      // 统一存储：所有布局共用同一套 01-100 格子
      // 设备已经被占用在别的格子，先清除旧格子（1对1）
      let oldDeviceId = gridLayout[cellIndex]; // 记录当前格子的旧设备（可能是null）
      if (deviceId !== null) {
        // 找出设备当前在哪个格子（扁平化查找）
        for (const [idx, devId] of Object.entries(gridLayout)) {
          if (devId === deviceId && Number(idx) !== cellIndex) {
            delete gridLayout[idx];
            break;
          }
        }
      }

      // 设置新格子
      if (deviceId === null) {
        delete gridLayout[cellIndex];
      } else {
        gridLayout[cellIndex] = deviceId;
      }
      
      // 如果格子从有设备变成空，或者被新设备替换，清理旧设备的收藏状态
      if (oldDeviceId && deviceId !== oldDeviceId) {
        cleanupDeviceFromFavorites(oldDeviceId);
        updateCollectionsDeviceStatus(oldDeviceId, {});
        broadcastToBrowsers({ type: 'favorites', favorites });
      }
      
      // 更新新设备的格子位置状态
      if (deviceId !== null) {
        updateCollectionsDeviceStatus(deviceId, {});
      }
      
      persistGrid();

      // 广播给所有浏览器，让所有客户端同步格子变更
      broadcastToBrowsers({
        type: 'grid',
        gridSize,
        cells: getGridPayload(gridSize),
      });
      // 【修复】通知所有浏览器重置视口过滤，确保格子截图继续推送
      broadcastToBrowsers({ type: 'viewportRefresh' });
      notifyWallClients('gridChanged', {});
    }

    if (msg.type === 'clearGrid') {
      // 清空所有100个格子（扁平化存储，与布局无关）
      for (let i = 0; i < 100; i++) {
        delete gridLayout[i];
      }
      persistGrid();
      broadcastToBrowsers({
        type: 'grid',
        gridSize: msg.gridSize,
        cells: getGridPayload(msg.gridSize),
      });
      // 【修复】通知所有浏览器重置视口过滤
      broadcastToBrowsers({ type: 'viewportRefresh' });
    }

    // 处理浏览器通过 WebSocket 发送的 HTTP 请求
    if (msg.type === 'GET' && msg.path) {
      // GET 请求处理
      if (msg.path === '/api/favorites') {
        ws.send(JSON.stringify({ type: 'favorites', favorites }));
      } else if (msg.path === '/api/collections') {
        const result = [];
        collections.forEach((items, timestamp) => {
          result.push({ timestamp, items });
        });
        result.sort((a, b) => b.timestamp - a.timestamp);
        ws.send(JSON.stringify({ type: 'collections', collections: result }));
      }
    }

    if (msg.type === 'POST' && msg.path) {
      // POST 请求处理
      if (msg.path === '/api/favorites') {
        const { deviceId, deviceName, groupId, cellIndex, action } = msg.body || {};
        if (deviceId) {
          const idx = favorites.findIndex(f => f.deviceId === deviceId);
          if (action === 'remove') {
            // 删除收藏
            if (idx >= 0) {
              favorites.splice(idx, 1);
              saveFavorites();
              broadcastToBrowsers({ type: 'favorites', favorites });
            }
          } else {
            // 添加或更新收藏
            if (idx >= 0) {
              favorites[idx] = { deviceId, deviceName, groupId, cellIndex };
            } else {
              favorites.push({ deviceId, deviceName, groupId, cellIndex });
            }
            saveFavorites();
            broadcastToBrowsers({ type: 'favorites', favorites });
          }
        }
      } else if (msg.path === '/api/collections/screenshot') {
        // 生成时间戳（不立即创建空分组，等收到截图后再创建）
        const timestamp = Date.now();
        // 不在这里创建空分组，只发送请求给客户端
        // 广播截图请求给所有客户端（只有被收藏的在线设备会响应）
        const favoriteDeviceIds = favorites.map(f => f.deviceId);
        // 如果没有收藏设备，直接返回失败
        if (favoriteDeviceIds.length === 0) {
          ws.send(JSON.stringify({ ok: false, error: '没有收藏的设备' }));
          return;
        }
        // 检查是否有在线的收藏设备
        const onlineFavoriteDeviceIds = favoriteDeviceIds.filter(deviceId => {
          for (const client of wssClient.clients) {
            if (client.readyState === 1 && client._deviceId === deviceId) {
              return true;
            }
          }
          return false;
        });
        if (onlineFavoriteDeviceIds.length === 0) {
          ws.send(JSON.stringify({ ok: false, error: '所有收藏设备都离线' }));
          return;
        }
        // 只发送给在线的收藏设备
        for (const client of wssClient.clients) {
          if (client.readyState === 1 && onlineFavoriteDeviceIds.includes(client._deviceId)) {
            client.send(JSON.stringify({
              type: 'requestCollectionScreenshot',
              timestamp,
              deviceIds: onlineFavoriteDeviceIds
            }));
          }
        }
        ws.send(JSON.stringify({ ok: true, timestamp }));
        // 不广播空分组，等收到截图再广播
      }
    }

    if (msg.type === 'DELETE' && msg.path) {
      // DELETE 请求处理
      const matchTimestamp = msg.path.match(/^\/api\/collections\/(\d+)$/);
      const matchDevice = msg.path.match(/^\/api\/collections\/(\d+)\/(.+)$/);
      if (matchTimestamp) {
        const timestamp = parseInt(matchTimestamp[1]);
        if (collections.has(timestamp)) {
          collections.delete(timestamp);
          saveCollections();
          // 广播更新后的截图集合
          const collectionsArr = [];
          collections.forEach((items, ts) => {
            collectionsArr.push({ timestamp: ts, items });
          });
          collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
          broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
        }
        ws.send(JSON.stringify({ ok: true }));
      } else if (matchDevice) {
        const timestamp = parseInt(matchDevice[1]);
        const deviceId = matchDevice[2];
        if (collections.has(timestamp)) {
          const items = collections.get(timestamp);
          const newItems = items.filter(item => item.deviceId !== deviceId);
          if (newItems.length !== items.length) {
            if (newItems.length === 0) {
              collections.delete(timestamp);
            } else {
              collections.set(timestamp, newItems);
            }
            saveCollections();
            // 广播更新后的截图集合
            const collectionsArr = [];
            collections.forEach((its, ts) => {
              collectionsArr.push({ timestamp: ts, items: its });
            });
            collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
            broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
          }
        }
        ws.send(JSON.stringify({ ok: true }));
      }
    }

    if (msg.type === 'groupUpdate') {
      // 浏览器发来分组数据更新（颜色、名称等变更）
      if (Array.isArray(msg.groups)) {
        groups = msg.groups;
        persistGroups();
        // 广播给所有浏览器
        broadcastToClients({ type: 'groupUpdate', groups: groups });
      }
    }

    if (msg.type === 'deviceGroupUpdate') {
      // 浏览器发来单个设备的分组更新
      const { deviceId, groupId } = msg;
      const dev = devices.get(deviceId);
      if (dev) {
        dev.groupId = groupId || null;
      }
      // 不需要广播，groups 消息会统一处理
    }

    if (msg.type === 'renameDevice') {
      // 重命名设备
      const { deviceId, deviceName } = msg;
      const dev = devices.get(deviceId);
      if (dev && deviceName) {
        dev.deviceName = deviceName;
        persistDevices();
        // 同步更新报警记录里的设备名
        for (const r of alarmRecords) {
          if (r.deviceId === deviceId) r.deviceName = deviceName;
        }
        persistAlarmRecords();
        // 同步更新任务记录里的设备名
        let taskChanged = false;
        for (const t of tasks) {
          if (t.deviceId === deviceId) { t.deviceName = deviceName; taskChanged = true; }
        }
        if (taskChanged) {
          persistTasks();
          broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
        }
        broadcastToBrowsers({ type: 'deviceRenamed', deviceId, deviceName });
        // 通知监控墙
        notifyWallClients('deviceRenamed', { deviceId, deviceName });
        updateCollectionsDeviceStatus(deviceId, {});
        // 通知对应客户端：将新名字写入配置文件
        for (const client of wssClient.clients) {
          if (client._deviceId === deviceId && client.readyState === 1) {
            client.send(JSON.stringify({ type: 'deviceNameSync', deviceName }));
            serverLog(`[设备重命名] 已通知客户端 ${deviceId} 更新配置: ${deviceName}`);
            break;
          }
        }
      }
    }

    if (msg.type === 'deleteDevice') {
      // 删除单个离线设备
      const { deviceId } = msg;
      if (deviceId && devices.has(deviceId)) {
        // 删除前保存设备名，用于广播
        const deletedDeviceName = devices.get(deviceId).deviceName;
        devices.delete(deviceId);
        // 清理该设备的收藏状态
        cleanupDeviceFromFavorites(deviceId);
        updateCollectionsDeviceStatus(deviceId, { deleted: true });
        // 从格子布局中移除该设备
        for (let i = 0; i < 100; i++) {
          if (gridLayout[i] === deviceId) {
            delete gridLayout[i];
          }
        }
        // 从所有分组的 deviceIds 中移除
        for (const g of groups) {
          if (g.deviceIds && Array.isArray(g.deviceIds)) {
            g.deviceIds = g.deviceIds.filter(id => id !== deviceId);
          }
        }
        persistDevices();
        persistGrid();
        persistGroups();
        // 广播完整的设备列表和格子布局
        broadcastToBrowsers({
          type: 'deviceList',
          devices: getDeviceListPayload()
        });
        broadcastToBrowsers({
          type: 'grid',
          gridSize: gridSizeSetting,
          cells: getGridPayload(gridSizeSetting)
        });
        broadcastToBrowsers({ type: 'groups', groups });
        broadcastToBrowsers({ type: 'favorites', favorites });
        // 广播删除状态更新
        const collectionsArr = [];
        collections.forEach((items, timestamp) => {
          collectionsArr.push({ timestamp, items });
        });
        collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
        broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
        // 广播设备预览状态变更（让所有浏览器刷新预览大图）
        broadcastToBrowsers({ type: 'devicePreviewStatus', deviceId, status: 'deleted', deviceName: deletedDeviceName });
        notifyWallClients('deviceDeleted', { deviceId });
        // 标记该设备任务记录为 deviceDeleted
        let taskDelChanged = false;
        for (const t of tasks) {
          if (t.deviceId === deviceId && !t.deviceDeleted) {
            t.deviceDeleted = true;
            taskDelChanged = true;
          }
        }
        if (taskDelChanged) {
          persistTasks();
          broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
        }
      }
    }

    if (msg.type === 'switchMonitor') {
      try {
        const targetId = msg.deviceId;
        const monitorIdx = parseInt(msg.monitorIndex, 10) || 1;
        const dev = devices.get(targetId);
        if (dev) {
          const sent = sendToClient(targetId, { type: 'switchMonitor', monitorIndex: monitorIdx });
          if (sent) {
            dev.monitorIndex = monitorIdx;
            logger.info(`[Monitor] 服务端切换 ${dev.deviceName} → 显示器 ${monitorIdx}`);
            broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
            notifyWallClients('monitorSwitched', { deviceId: targetId, monitorIndex: monitorIdx });
          } else {
            ws.send(JSON.stringify({ type: 'switchMonitorResult', success: false, reason: 'device offline' }));
          }
        } else {
          ws.send(JSON.stringify({ type: 'switchMonitorResult', success: false, reason: 'device not found' }));
        }
      } catch (err) {
        logger.error(`[Monitor] switchMonitor error: ${err.message}`);
        ws.send(JSON.stringify({ type: 'switchMonitorResult', success: false, reason: 'server error' }));
      }
    }

    // 客户端主动上报当前显示器偏移量（切换后/心跳时）
    if (msg.type === 'monitorOffsetUpdate') {
      try {
        const targetId = msg.deviceId;
        const offsetX = (msg.monitorOffsetX !== undefined) ? msg.monitorOffsetX : 0;
        const offsetY = (msg.monitorOffsetY !== undefined) ? msg.monitorOffsetY : 0;
        const dev = devices.get(targetId);
        if (dev) {
          dev.monitorOffsetX = offsetX;
          dev.monitorOffsetY = offsetY;
          logger.info(`[Monitor] ${dev.deviceName} 偏移量更新 → (${offsetX}, ${offsetY})`);
        }
      } catch (err) {
        logger.error(`[Monitor] monitorOffsetUpdate error: ${err.message}`);
      }
    }

    if (msg.type === 'batchDeleteOffline') {
      // 批量删除所有离线设备
      const offlineDeviceIds = [];
      for (const [id, dev] of devices.entries()) {
        if (!dev.online) offlineDeviceIds.push(id);
      }
      for (const deviceId of offlineDeviceIds) {
        devices.delete(deviceId);
        // 从格子布局中移除
        for (let i = 0; i < 100; i++) {
          if (gridLayout[i] === deviceId) {
            delete gridLayout[i];
          }
        }
        // 从所有分组的 deviceIds 中移除
        for (const g of groups) {
          if (g.deviceIds && Array.isArray(g.deviceIds)) {
            g.deviceIds = g.deviceIds.filter(id => id !== deviceId);
          }
        }
      }
      persistDevices();
      persistGrid();
      persistGroups();
      // 广播完整的设备列表和格子布局
      broadcastToBrowsers({
        type: 'deviceList',
        devices: getDeviceListPayload()
      });
      broadcastToBrowsers({
        type: 'grid',
        gridSize: gridSizeSetting,
        cells: getGridPayload(gridSizeSetting)
      });
      broadcastToBrowsers({ type: 'groups', groups });
      let batchTaskChanged = false;
      for (const t of tasks) {
        if (offlineDeviceIds.includes(t.deviceId) && !t.deviceDeleted) {
          t.deviceDeleted = true;
          batchTaskChanged = true;
        }
      }
      if (batchTaskChanged) {
        persistTasks();
        broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
      }
    }

    // 处理收藏截图请求
    if (msg.type === 'requestCollectionScreenshot') {
      // 客户端收到服务器请求，发送1帧截图
    }

    // ── 格子预览独立通道订阅 ──────────────────────────
    if (msg.type === 'subscribePreview') {
      const deviceId = msg.deviceId;
      if (deviceId) {
        // 记录预览订阅
        previewClients.set(ws, { deviceId, interval: msg.interval || 333 });

        // startHQ 已由 openPreview 发送（确保立即开启），此处只推送最新截图
        const dev = devices.get(deviceId);
        if (dev && dev.hqScreenshot) {
          ws.send(JSON.stringify({
            type: 'previewScreenshot',
            deviceId: deviceId,
            image: dev.hqScreenshot,
            timestamp: Date.now(),
            screenWidth: dev.screenWidth || 1920,
            screenHeight: dev.screenHeight || 1080
          }));
        }
      }
    }

    // ── 格子预览独立通道取消订阅 ──────────────────────
    if (msg.type === 'unsubscribePreview') {
      previewClients.delete(ws);

      // 1. 清理 1080p 追踪（从 browser1080p 和 global1080p 中移除）
      const my1080p = browser1080p.get(ws);
      if (msg.deviceId) {
        if (my1080p) my1080p.delete(msg.deviceId);
        if (global1080p.has(msg.deviceId)) {
          const new1080Count = global1080p.get(msg.deviceId) - 1;
          if (new1080Count <= 0) {
            global1080p.delete(msg.deviceId);
            // 所有浏览器都没有使用1080p，通知设备关闭
            for (const client of wssClient.clients) {
              if (client._deviceId === msg.deviceId && client.readyState === 1) {
                client.send(JSON.stringify({ type: 'hq1080Off' }));
                break;
              }
            }
          } else {
            global1080p.set(msg.deviceId, new1080Count);
          }
        }
      }

      // 2. 清理 startHQ 追踪（从 browserPreviewHD 和 globalHQ 中移除）
      const myHD = browserPreviewHD.get(ws);
      if (msg.deviceId) {
        if (myHD) myHD.delete(msg.deviceId);
        if (globalHQ.has(msg.deviceId)) {
          const newCount = globalHQ.get(msg.deviceId) - 1;
          if (newCount <= 0) {
            globalHQ.delete(msg.deviceId);
            // 没有其他浏览器需要，检查墙上是否有人需要
            let needHQ = false;
            for (const [wallWs, hdChannels] of wallHDChannels) {
              if (hdChannels.has(msg.deviceId)) { needHQ = true; break; }
            }
            if (!needHQ) {
              for (const client of wssClient.clients) {
                if (client._deviceId === msg.deviceId) {
                  client.send(JSON.stringify({ type: 'stopHQ' }));
                  break;
                }
              }
            }
          } else {
            globalHQ.set(msg.deviceId, newCount);
          }
        }
      }
    }

    if (msg.type === 'startHQ') {
      // 追踪浏览器预览高清通道
      if (!browserPreviewHD.has(ws)) browserPreviewHD.set(ws, new Set());
      browserPreviewHD.get(ws).add(msg.deviceId);
      // 全局计数器
      globalHQ.set(msg.deviceId, (globalHQ.get(msg.deviceId) || 0) + 1);

      for (const client of wssClient.clients) {
        if (client._deviceId === msg.deviceId) {

          client.send(JSON.stringify({ type: 'startHQ' }));
          break;
        }
      }
      // 【修复】立即推送设备最新截图给预览浏览器（格子预览无画面问题）
      const dev = devices.get(msg.deviceId);
      if (dev) {
        // 优先推送 HQ 截图，其次普通截图
        const latestScreenshot = dev.hqScreenshot || dev.screenshot;
        if (latestScreenshot) {
          ws.send(JSON.stringify({
            type: 'screenshot',
            deviceId: msg.deviceId,
            image: latestScreenshot,
            hq: !!dev.hqScreenshot,
            hqImage: dev.hqScreenshot || null
          }));
        }
      }
    }

    // 视口更新：浏览器上报当前可见格子
    if (msg.type === 'viewportUpdate') {
      handleViewportUpdate(ws, msg.deviceIds || []);
    }
    
    // 添加监控墙白名单设备
    if (msg.type === 'addMonitorWall') {
      if (msg.deviceId) addMonitorWall(msg.deviceId);
    }
    
    // 移除监控墙白名单设备
    if (msg.type === 'removeMonitorWall') {
      if (msg.deviceId) removeMonitorWall(msg.deviceId);
    }
    
    if (msg.type === 'stopHQ') {
      // 从浏览器追踪Map中移除
      if (browserPreviewHD.has(ws)) {
        browserPreviewHD.get(ws).delete(msg.deviceId);
      }

      // 从全局计数器中减1
      if (globalHQ.has(msg.deviceId)) {
        const newCount = globalHQ.get(msg.deviceId) - 1;
        if (newCount <= 0) {
          globalHQ.delete(msg.deviceId);
          // 发stopHQ前检查墙上是否还有人在用该设备的HQ
          let wallStillNeedsHQ = false;
          for (const [wallWs, hdChannels] of wallHDChannels) {
            if (hdChannels.has(msg.deviceId)) { wallStillNeedsHQ = true; break; }
          }
          if (!wallStillNeedsHQ) {
            hdRequests.delete(msg.deviceId);
            wallDevices.delete(msg.deviceId);
            for (const client of wssClient.clients) {
              if (client._deviceId === msg.deviceId) {
                client.send(JSON.stringify({ type: 'stopHQ' }));
                break;
              }
            }
          }
        } else {
          globalHQ.set(msg.deviceId, newCount);
        }
      }
    }

    if (msg.type === 'groups') {
      // 浏览器发来分组更新
      groups = msg.groups || [];
      // 同步 groupId 到 devices Map
      for (const dev of devices.values()) { dev.groupId = null; }
      for (const g of groups) {
        if (g.deviceIds && Array.isArray(g.deviceIds)) {
          for (const devId of g.deviceIds) {
            const dev = devices.get(devId);
            if (dev) dev.groupId = g.id;
          }
        }
      }
      persistGroups();
      persistDevices();  // 分组变化时同步更新设备列表
      broadcastToBrowsers({ type: 'groups', groups });
      notifyWallClients('groupsChanged', { groups });
      
      // 更新所有设备的集合状态（分组信息可能影响多个设备）
      for (const deviceId of devices.keys()) {
        updateCollectionsDeviceStatus(deviceId, {});
      }
    }

    if (msg.type === 'setPowerScene') {
      // 设置设备开关机场景
      const { deviceId, sceneName } = msg;
      if (sceneName && sceneName.trim()) {
        powerScenes[deviceId] = sceneName.trim();
      } else {
        delete powerScenes[deviceId];
      }
      persistPowerScenes();
      broadcastToBrowsers({ type: 'powerScenes', powerScenes });
    }

    if (msg.type === 'executePowerScene') {
      // 执行设备开关机场景
      const { deviceId } = msg;
      const sceneName = powerScenes[deviceId];
      if (!sceneName) {
        ws.send(JSON.stringify({ type: 'powerSceneResult', success: false, error: '该设备未配置开关机场景' }));
        return;
      }
      const { exec } = require('child_process');
      const cmd = `mijiaAPI --run_scene "${sceneName}"`;
      serverLog(`[场景执行] 设备 ${deviceId} -> ${sceneName}`);
      exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) {
          serverError(`[场景执行失败] ${sceneName}: ${error.message}`);
          ws.send(JSON.stringify({ type: 'powerSceneResult', success: false, error: error.message }));
        } else {
          serverLog(`[场景执行成功] ${sceneName}`);
          ws.send(JSON.stringify({ type: 'powerSceneResult', success: true, sceneName }));
        }
      });
    }

    if (msg.type === 'subscribeWall') {
      // 监控墙订阅高清截图（每个窗口独立通道）
      const deviceList = msg.devices || [];
      const interval = msg.interval || 125; // 125ms = 8fps
      
      // 获取该窗口当前的高清通道
      const existingHD = wallHDChannels.get(ws) || new Set();
      const newHDChannels = new Set(existingHD);
      
      // 合并设备列表
      const existing = wallClients.get(ws);
      const existingDevices = existing ? existing.devices : new Set();
      const newDevices = new Set(existingDevices);
      
      for (const deviceId of deviceList) {
        newDevices.add(deviceId);
        newHDChannels.add(deviceId); // 每个设备只开启一次高清通道
        wallDevices.set(deviceId, interval); // 持久化追踪，设备重连后自动恢复

        // 每次订阅都尝试发送 startHQ（幂等，设备客户端会处理重复）
        // 记录高清请求引用（用于 unsubscribe 时计数）
        if (!hdRequests.has(deviceId)) hdRequests.set(deviceId, new Set());
        hdRequests.get(deviceId).add(ws);

        // 遍历设备客户端，找到对应设备并发送 startHQ
        for (const client of wssClient.clients) {
          if (client._deviceId === deviceId) {
            client.send(JSON.stringify({ type: 'startHQ', interval }));
            break;
          }
        }
      }
      
      wallClients.set(ws, { devices: newDevices, interval });
      wallHDChannels.set(ws, newHDChannels);
      
      // 【修复】立即推送所有设备的最新截图给监控墙（监控上墙无画面问题）
      for (const deviceId of deviceList) {
        const dev = devices.get(deviceId);
        if (dev) {
          const latestScreenshot = dev.hqScreenshot || dev.screenshot;
          if (latestScreenshot) {
            ws.send(JSON.stringify({
              type: 'wallScreenshot',
              deviceId: deviceId,
              screenshot: latestScreenshot,
              timestamp: Date.now()
            }));
          }
        }
      }
      
      // 返回该浏览器已上墙设备列表（仅自己）
      ws.send(JSON.stringify({ type: 'walledDevices', devices: Array.from(newDevices) }));
      
      // serverLog(`[监控墙] 订阅 ${newDevices.size} 设备`);
    }

    if (msg.type === 'unsubscribeWall') {
      // 取消监控墙订阅（手动关闭单个设备）
      const devicesToUnsubscribe = msg.devices || [];
      
      const subscription = wallClients.get(ws);
      const hdChannels = wallHDChannels.get(ws);
      if (subscription) {
        // 从该浏览器的已上墙集合中移除
        for (const deviceId of devicesToUnsubscribe) {
          subscription.devices.delete(deviceId);
          // 只关闭本窗口的高清通道
          if (hdChannels) hdChannels.delete(deviceId);
          // 从hdRequests中移除本浏览器
          if (hdRequests.has(deviceId)) {
            hdRequests.get(deviceId).delete(ws);
          }
          // 递减globalHQ，检查是否需要真正停止设备高清流
          if (globalHQ.has(deviceId)) {
            const newCount = globalHQ.get(deviceId) - 1;
            if (newCount <= 0) {
              globalHQ.delete(deviceId);
              // 发stopHQ前检查墙上是否还有其他人需要该设备的HQ
              let wallStillNeedsHQ = false;
              for (const [wWs, wHd] of wallHDChannels) {
                if (wHd.has(deviceId)) { wallStillNeedsHQ = true; break; }
              }
              if (!wallStillNeedsHQ) {
                hdRequests.delete(deviceId);
                wallDevices.delete(deviceId);
                for (const client of wssClient.clients) {
                  if (client._deviceId === deviceId) {
                    client.send(JSON.stringify({ type: 'stopHQ' }));
                    break;
                  }
                }
              }
            } else {
              globalHQ.set(deviceId, newCount);
            }
          }
        }

        // 返回该浏览器已上墙设备列表
        ws.send(JSON.stringify({ type: 'walledDevices', devices: Array.from(subscription.devices) }));
      }
    }

    if (msg.type === 'getWalledDevices') {
      // 返回该浏览器已上墙设备列表
      const subscription = wallClients.get(ws);
      const myDevices = subscription ? Array.from(subscription.devices) : [];
      ws.send(JSON.stringify({ type: 'walledDevices', devices: myDevices }));
    }

    // 客户端动态切换键盘状态（用户通过托盘菜单启动/关闭键盘）
    if (msg.type === 'keyboardState' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      if (dev) {
        dev.supportsKeyClient = !!msg.supportsKeyClient;
        serverLog(`[远控] ${dev.deviceName} ${dev.supportsKeyClient ? '启动远控' : '关闭远控'}`);
        // 广播设备列表更新 + 强制刷新预览状态
        broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
        broadcastToBrowsers({ type: 'devicePreviewStatus', deviceId: msg.deviceId, status: 'refresh' });
      }
    }

    // 页面端切换远控指令（服务转发给客户端）
    if ((msg.type === 'setKeyboardEnabled' || msg.type === 'setKeyboardDisabled') && msg.deviceId) {
      const enable = msg.type === 'setKeyboardEnabled';
      for (const client of wssClient.clients) {
        if (client._deviceId === msg.deviceId && client.readyState === 1) {
          client.send(JSON.stringify({ type: enable ? 'setKeyboardEnabled' : 'setKeyboardDisabled' }));
          serverLog(`[远控] ${enable ? '启动远控' : '关闭远控'} -> ${msg.deviceId}`);
          break;
        }
      }
    }
    } catch (err) {
      serverError(`[浏览器消息] 处理消息 ${msg.type} 时发生未捕获错误: ${err.message}`);
    }
  });

  ws.on('close', () => {
    browserClients.delete(ws);
    browserViewport.delete(ws); // 清理视口追踪，防止浏览器关闭后残留

    // ── 清理监控墙订阅（防止 close 后残留导致 wallStillNeedsHQ 误判）──
    wallClients.delete(ws);
    wallHDChannels.delete(ws);

    // ── 清理格子预览独立通道订阅 ──────────────────────
    const previewInfo = previewClients.get(ws);
    previewClients.delete(ws);

    // ── 清理 1080p 预览模式 ──────────────────────
    const my1080pDevices = browser1080p.get(ws);
    browser1080p.delete(ws);
    if (my1080pDevices && my1080pDevices.size > 0) {
      for (const deviceId of my1080pDevices) {
        if (global1080p.has(deviceId)) {
          const newCount = global1080p.get(deviceId) - 1;
          if (newCount <= 0) {
            global1080p.delete(deviceId);
            // 发hq1080Off前检查墙上是否还有人在用该设备的1080p
            let wallStillNeeds1080 = false;
            for (const [wallWs, hdChannels] of wallHDChannels) {
              if (hdChannels.has(deviceId)) { wallStillNeeds1080 = true; break; }
            }
            if (!wallStillNeeds1080) {
              for (const client of wssClient.clients) {
                if (client._deviceId === deviceId && client.readyState === 1) {
                  client.send(JSON.stringify({ type: 'hq1080Off' }));
                  break;
                }
              }
            }
          } else {
            global1080p.set(deviceId, newCount);
          }
        }
      }
    }

    // ── 清理 startHQ 追踪（browserPreviewHD + wallHDChannels）─────────
    const myPreviewHD = browserPreviewHD.get(ws);
    browserPreviewHD.delete(ws);
    if (myPreviewHD) {
      for (const deviceId of myPreviewHD) {
        if (globalHQ.has(deviceId)) {
          const newCount = globalHQ.get(deviceId) - 1;
          if (newCount <= 0) {
            globalHQ.delete(deviceId);
            // 发stopHQ前检查墙上是否还有人在用该设备的HQ
            let wallStillNeedsHQ = false;
            for (const [wallWs, hdChannels] of wallHDChannels) {
              if (hdChannels.has(deviceId)) { wallStillNeedsHQ = true; break; }
            }
            if (!wallStillNeedsHQ) {
              hdRequests.delete(deviceId);
              wallDevices.delete(deviceId);
              for (const client of wssClient.clients) {
                if (client._deviceId === deviceId) {
                  client.send(JSON.stringify({ type: 'stopHQ' }));
                  break;
                }
              }
            }
          } else {
            globalHQ.set(deviceId, newCount);
          }
        }
      }
    }

    // ── 清理监控墙订阅（页面关闭）────────────────────
    const subscription = wallClients.get(ws);
    const hdChannels = wallHDChannels.get(ws);
    wallClients.delete(ws);
    wallHDChannels.delete(ws);
    if (subscription) {
      for (const deviceId of subscription.devices) {
        if (globalHQ.has(deviceId)) {
          const newCount = globalHQ.get(deviceId) - 1;
          if (newCount <= 0) {
            globalHQ.delete(deviceId);
            hdRequests.delete(deviceId);
            wallDevices.delete(deviceId);
            for (const client of wssClient.clients) {
              if (client._deviceId === deviceId) {
                client.send(JSON.stringify({ type: 'stopHQ' }));
                break;
              }
            }
          } else {
            globalHQ.set(deviceId, newCount);
          }
        }
        // 同步清理 wallHDChannels 引用（格子预览关闭时也走这里）
        for (const [wWs, wHd] of wallHDChannels) {
          wHd.delete(deviceId);
        }
      }
    }

    // 清理格子预览独立通道订阅中的 wallHDChannels 引用
    if (previewInfo) {
      const previewDeviceId = previewInfo.deviceId;
      for (const [wallWs, hdChannels] of wallHDChannels) {
        hdChannels.delete(previewDeviceId);
      }
    }
  });
  ws.on('error', () => {
    // error 时触发 close，close handler 已做完整清理
    ws.close();
  });
});

// ========== HTTP 服务器 ==========
const httpServer = http.createServer();

httpServer.on('upgrade', (req, socket, head) => {
  // 安全解析 URL，防止 host 头为空或无效导致崩溃
  let pathname = '/';
  try {
    const host = req.headers.host || 'localhost';
    const urlObj = new URL(req.url, `http://${host}`);
    pathname = urlObj.pathname.replace(/\/$/, '');
  } catch (e) {
    pathname = req.url.split('?')[0].replace(/\/$/, '');
  }

  if (pathname === '/ws/client') {
    wssClient.handleUpgrade(req, socket, head, (ws) => {
      wssClient.emit('connection', ws, req);
    });
    return;
  }
  if (pathname === '/ws/browser') {
    wssBrowser.handleUpgrade(req, socket, head, (ws) => {
      wssBrowser.emit('connection', ws, req);
    });
    return;
  }
  socket.destroy();
});

httpServer.on('request', (req, res) => {
  // 安全解析 URL，防止 host 头为空或无效导致崩溃
  let pathname = '/';
  let urlObj = null;
  try {
    const host = req.headers.host || 'localhost';
    urlObj = new URL(req.url, `http://${host}`);
    pathname = urlObj.pathname;
  } catch (e) {
    // URL 解析失败，使用默认路径
    pathname = req.url.split('?')[0];
    // 创建默认 urlObj 避免后续引用错误
    try { urlObj = new URL(req.url, 'http://localhost'); } catch(e2) { urlObj = { searchParams: { get: () => null } }; }
  }

  // 安全头 middleware：拦截所有 writeHead，自动注入安全头
  // 静态文件（CSS/JS/图片）不需要 CSP，只对 HTML/API 添加
  const middlewarePath = pathname.replace(/\/$/, '');
  const staticExts = ['.css', '.js', '.ico', '.png', '.jpg', '.webp', '.svg', '.woff2', '.woff', '.ttf', '.map'];
  const ext = path.extname(middlewarePath).toLowerCase();
  const isStaticFile = staticExts.includes(ext);
  const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
  };
  // HTML 页面需要 CSP 防止被嵌入 iframe
  if (!isStaticFile) {
    securityHeaders['Content-Security-Policy'] = "frame-ancestors 'none'";
  }
  const _origWriteHead = res.writeHead.bind(res);
  res.writeHead = function(statusCode, headers) {
    return Reflect.apply(_origWriteHead, this, [statusCode, headers ? { ...headers, ...securityHeaders } : securityHeaders]);
  };

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // 拒绝过长的 URL（可能是 base64 数据被错误地当作 URL 请求）
  if (req.url.length > 2048) {
    res.writeHead(414, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('URI Too Long');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const cleanPath = pathname.replace(/\/$/, '');

  // 客户端升级文件下载（需在 /api/ JSON 路由之前处理）
  if (cleanPath.startsWith('/api/update/')) {
    const exeName = cleanPath.replace('/api/update/', '');
    const exePath = path.join(__dirname, 'public', 'api', 'update', exeName);
    if (fs.existsSync(exePath)) {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exeName}"`,
        'Content-Length': fs.statSync(exePath).size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(exePath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件不存在');
    }
    return;
  }

  if (cleanPath.startsWith('/api/')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });

    if (cleanPath === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const { username, password } = JSON.parse(body || '{}');
        const attempts = loginAttempts.get(ip) || { count: 0, lockoutUntil: 0 };

        if (attempts.lockoutUntil > Date.now()) {
          const mins = Math.ceil((attempts.lockoutUntil - Date.now()) / 60000);
          res.end(JSON.stringify({ ok: false, msg: `请 ${mins} 分钟后再试` }));
          return;
        }

        if (username === AUTH_CFG.username && password === AUTH_CFG.password) {
          const sessionId = crypto.randomUUID();
          sessions.set(sessionId, { username, createdAt: Date.now(), lastActive: Date.now() });
          loginAttempts.delete(ip);
          res.end(JSON.stringify({ ok: true, sessionId }));
        } else {
          const newCount = (attempts.count || 0) + 1;
          if (newCount >= SEC_CFG.maxLoginAttempts) {
            loginAttempts.set(ip, { count: newCount, lockoutUntil: Date.now() + SEC_CFG.lockoutMinutes * 60000 });
            res.end(JSON.stringify({ ok: false, msg: `错误次数过多，锁定 ${SEC_CFG.lockoutMinutes} 分钟` }));
          } else {
            loginAttempts.set(ip, { count: newCount, lockoutUntil: attempts.lockoutUntil });
            res.end(JSON.stringify({ ok: false, msg: `用户名或密码错误（${newCount}/${SEC_CFG.maxLoginAttempts}）` }));
          }
        }
      });
      return;
    }

    if (cleanPath === '/api/check') {
      const sessionId = urlObj.searchParams.get('sessionId');
      const session = sessions.get(sessionId);
      if (session) {
        session.lastActive = Date.now();
        res.end(JSON.stringify({ ok: true, username: session.username }));
      } else {
        res.end(JSON.stringify({ ok: false }));
      }
      return;
    }

    if (cleanPath === '/api/logout' && req.method === 'POST') {
      const sessionId = urlObj.searchParams.get('sessionId');
      sessions.delete(sessionId);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 布局大小 API
    if (cleanPath === '/api/gridSize' && req.method === 'GET') {
      res.end(JSON.stringify({ gridSize: gridSizeSetting }));
      return;
    }

    if (cleanPath === '/api/gridSize' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const data = JSON.parse(body || '{}');
        gridSizeSetting = parseInt(data.gridSize) || 4;
        persistGridSize();
        // 如果同时传了布局数据，也保存
        if (data.layout) {
          const key = String(gridSizeSetting);
          gridLayout[key] = data.layout;
          persistGrid();
        }
        res.end(JSON.stringify({ ok: true, gridSize: gridSizeSetting }));
      });
      return;
    }

    // 分组 API
    if (cleanPath === '/api/groups' && req.method === 'GET') {
      res.end(JSON.stringify(groups));
      return;
    }

    if (cleanPath === '/api/groups' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const data = JSON.parse(body || '{}');
        // data = { groups: [...] }
        groups = data.groups || [];
        persistGroups();
        broadcastToBrowsers({ type: 'groups', groups });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (cleanPath === '/api/devices' && req.method === 'GET') {
      res.end(JSON.stringify(getDeviceListPayload()));
      return;
    }

    // 【调试】POST /api/test-starthq - 手动发送 startHQ 命令给设备
    if (cleanPath === '/api/test-starthq' && req.method === 'POST') {
      const deviceId = urlObj.searchParams.get('deviceId') || 'aeawtmgwtiau3yfl';
      const interval = parseInt(urlObj.searchParams.get('interval')) || 333;
      
      let sent = false;
      for (const client of wssClient.clients) {
        if (client._deviceId === deviceId) {
          client.send(JSON.stringify({ type: 'startHQ', interval }));
          
          sent = true;
          break;
        }
      }
      res.end(JSON.stringify({ ok: sent, msg: sent ? '已发送 startHQ' : '设备未连接', deviceId }));
      return;
    }

    // DELETE /api/devices/:deviceId - 删除指定设备
    const devDeleteMatch = cleanPath.match(/^\/api\/devices\/([^/]+)$/);
    if (devDeleteMatch && req.method === 'DELETE') {
      const deviceIdToDelete = devDeleteMatch[1];
      if (!devices.has(deviceIdToDelete)) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: '设备不存在' }));
        return;
      }
      devices.delete(deviceIdToDelete);
      // 从所有分组的 deviceIds 中移除
      let groupChanged = false;
      for (const g of groups) {
        if (g.deviceIds && g.deviceIds.includes(deviceIdToDelete)) {
          g.deviceIds = g.deviceIds.filter(id => id !== deviceIdToDelete);
          groupChanged = true;
        }
      }
      if (groupChanged) persistGroups();
      // 从 gridLayout 中移除该设备（扁平结构：cellIndex -> deviceId）
      for (const idx of Object.keys(gridLayout)) {
        if (gridLayout[idx] === deviceIdToDelete) {
          delete gridLayout[idx];
        }
      }
      persistGrid();
      persistDevices();
      // 清理报警记录
      const beforeAlarmLen = alarmRecords.length;
      alarmRecords = alarmRecords.filter(r => r.deviceId !== deviceIdToDelete);
      if (alarmRecords.length !== beforeAlarmLen) persistAlarmRecords();
      lastAlarmTime.delete(deviceIdToDelete);
      // 清理开关机场景
      if (powerScenes[deviceIdToDelete]) {
        delete powerScenes[deviceIdToDelete];
        persistPowerScenes();
      }
      broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
      broadcastToBrowsers({ type: 'groups', groups });
      broadcastToBrowsers({ type: 'grid', cells: getGridPayload() });
      broadcastToBrowsers({ type: 'alarmRecords', records: alarmRecords });
      broadcastToBrowsers({ type: 'powerScenes', powerScenes });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // GET /api/uuDevice/:deviceId - 获取指定设备的 UU 设备 ID
    const uuDeviceMatch = cleanPath.match(/^\/api\/uuDevice\/([^/]+)$/);
    if (uuDeviceMatch && req.method === 'GET') {
      const deviceId = uuDeviceMatch[1];
      const dev = devices.get(deviceId);
      if (!dev) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, msg: '设备不存在' }));
        return;
      }
      res.end(JSON.stringify({ ok: true, uuDeviceId: dev.uuDeviceId || '' }));
      return;
    }

    // ========== 收藏截图 API ==========
    // GET /api/favorites - 获取收藏列表
    if (cleanPath === '/api/favorites' && req.method === 'GET') {
      res.end(JSON.stringify(favorites));
      return;
    }

    // POST /api/favorites - 添加/更新收藏
    if (cleanPath === '/api/favorites' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const data = JSON.parse(body || '{}');
        const { deviceId, deviceName, groupId, cellIndex } = data;
        if (!deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, msg: '缺少 deviceId' }));
          return;
        }
        // 查找是否已存在
        const idx = favorites.findIndex(f => f.deviceId === deviceId);
        if (idx >= 0) {
          // 更新
          favorites[idx] = { deviceId, deviceName, groupId, cellIndex };
        } else {
          // 添加
          favorites.push({ deviceId, deviceName, groupId, cellIndex });
        }
        saveFavorites();
        broadcastToBrowsers({ type: 'favorites', favorites });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // DELETE /api/favorites/:deviceId - 取消收藏
    const favDeleteMatch = cleanPath.match(/^\/api\/favorites\/([^/]+)$/);
    if (favDeleteMatch && req.method === 'DELETE') {
      const deviceId = favDeleteMatch[1];
      const oldLen = favorites.length;
      favorites = favorites.filter(f => f.deviceId !== deviceId);
      if (favorites.length !== oldLen) {
        saveFavorites();
        broadcastToBrowsers({ type: 'favorites', favorites });
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // GET /api/collections - 获取所有截图集合
    if (cleanPath === '/api/collections' && req.method === 'GET') {
      // 转换为数组格式
      const result = [];
      collections.forEach((items, timestamp) => {
        result.push({ timestamp, items });
      });
      // 按时间戳倒序（最新在前）
      result.sort((a, b) => b.timestamp - a.timestamp);
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/collections/screenshot - 请求截图（通知客户端发送1帧）
    if (cleanPath === '/api/collections/screenshot' && req.method === 'POST') {
      // 生成时间戳
      const timestamp = Date.now();
      // 确保该时间戳的数组存在
      if (!collections.has(timestamp)) {
        collections.set(timestamp, []);
      }
      saveCollections();
      // 广播截图请求给所有客户端（只有被收藏的在线设备会响应）
      const favoriteDeviceIds = favorites.map(f => f.deviceId);
      broadcastToClients({
        type: 'requestCollectionScreenshot',
        timestamp,
        deviceIds: favoriteDeviceIds
      });
      // 广播更新后的截图集合
      const collectionsArr = [];
      collections.forEach((items, ts) => {
        collectionsArr.push({ timestamp: ts, items });
      });
      collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
      broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
      res.end(JSON.stringify({ ok: true, timestamp }));
      return;
    }

    // DELETE /api/collections/:timestamp - 删除指定时间戳下的所有截图
    const colDeleteMatch = cleanPath.match(/^\/api\/collections\/([^/]+)$/);
    if (colDeleteMatch && req.method === 'DELETE') {
      const timestamp = parseInt(colDeleteMatch[1]);
      if (collections.has(timestamp)) {
        collections.delete(timestamp);
        saveCollections();
        // 广播更新后的截图集合
        const collectionsArr = [];
        collections.forEach((items, ts) => {
          collectionsArr.push({ timestamp: ts, items });
        });
        collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
        broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // DELETE /api/collections/:timestamp/:deviceId - 删除单张截图
    const colDeviceDeleteMatch = cleanPath.match(/^\/api\/collections\/([^/]+)\/([^/]+)$/);
    if (colDeviceDeleteMatch && req.method === 'DELETE') {
      const timestamp = parseInt(colDeviceDeleteMatch[1]);
      const deviceId = colDeviceDeleteMatch[2];
      if (collections.has(timestamp)) {
        const items = collections.get(timestamp);
        const newItems = items.filter(item => item.deviceId !== deviceId);
        if (newItems.length !== items.length) {
          if (newItems.length === 0) {
            collections.delete(timestamp);
          } else {
            collections.set(timestamp, newItems);
          }
          saveCollections();
          // 广播更新后的截图集合
          const collectionsArr = [];
          collections.forEach((its, ts) => {
            collectionsArr.push({ timestamp: ts, items: its });
          });
          collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
          broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
        }
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // DELETE /api/devices?offline=1 - 批量删除所有离线设备
    if (cleanPath === '/api/devices' && req.method === 'DELETE' && urlObj.searchParams.get('offline') === '1') {
      const TIMEOUT_MS = CLIENT_CFG.timeoutMs || 30000;
      const now = Date.now();
      const offlineIds = [];
      for (const [id, dev] of devices) {
        if (!dev.online || (now - dev.lastSeen > TIMEOUT_MS)) {
          offlineIds.push(id);
        }
      }
      for (const id of offlineIds) {
        devices.delete(id);
        for (const g of groups) {
          if (g.deviceIds) g.deviceIds = g.deviceIds.filter(did => did !== id);
        }
        for (const idx of Object.keys(gridLayout)) {
          if (gridLayout[idx] === id) delete gridLayout[idx];
        }
        // 清理报警记录
        alarmRecords = alarmRecords.filter(r => r.deviceId !== id);
        lastAlarmTime.delete(id);
        // 清理开关机场景
        if (powerScenes[id]) delete powerScenes[id];
      }
      if (offlineIds.length > 0) {
        persistDevices();
        persistGroups();
        persistGrid();
        persistAlarmRecords();
        persistPowerScenes();
      }
      broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
      broadcastToBrowsers({ type: 'groups', groups });
      broadcastToBrowsers({ type: 'grid', cells: getGridPayload() });
      broadcastToBrowsers({ type: 'alarmRecords', records: alarmRecords });
      broadcastToBrowsers({ type: 'powerScenes', powerScenes });
      res.end(JSON.stringify({ ok: true, count: offlineIds.length }));
      return;
    }

    if (cleanPath === '/api/grid') {
      const gsStr = urlObj.searchParams.get('gridSize');
      if (gsStr) {
        const gs = parseInt(gsStr);
        res.end(JSON.stringify({ gridSize: gs, cells: getGridPayload(gs) }));
        return;
      }
    }

    // ========== 米家 API ==========
    // 辅助函数：调用 mijia-bridge.py
    function callMijiaBridge(args, callback) {
      const pythonPath = process.env.PYTHON_PATH || 'python';
      const scriptPath = path.join(__dirname, 'mijia-bridge.py');
      const child = spawn(pythonPath, [scriptPath, ...args], {
        encoding: 'utf8',
        timeout: 30000
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('close', (code) => {
        if (code !== 0) {
          callback(new Error(`进程退出码 ${code}: ${stderr}`), null);
        } else {
          try {
            const result = JSON.parse(stdout);
            callback(null, result);
          } catch (e) {
            callback(new Error(`解析结果失败: ${stdout}`), null);
          }
        }
      });
    }

    // GET /api/mijia/status - 检查登录状态
    if (cleanPath === '/api/mijia/status' && req.method === 'GET') {
      callMijiaBridge(['status'], (err, result) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.end(JSON.stringify(result));
        }
      });
      return;
    }

    // POST /api/mijia/login - 扫码登录
    if (cleanPath === '/api/mijia/login' && req.method === 'POST') {
      serverLog('[米家] 开始扫码登录...');
      callMijiaBridge(['login'], (err, result) => {
        if (err) {
          serverError('[米家] 登录失败:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          serverLog('[米家] 登录成功');
          res.end(JSON.stringify(result));
        }
      });
      return;
    }

    // GET /api/mijia/homes - 获取家庭列表
    if (cleanPath === '/api/mijia/homes' && req.method === 'GET') {
      callMijiaBridge(['homes'], (err, result) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.end(JSON.stringify(result));
        }
      });
      return;
    }

    // GET /api/mijia/devices?home_id=xxx - 获取设备列表
    if (cleanPath === '/api/mijia/devices' && req.method === 'GET') {
      const homeId = urlObj.searchParams.get('home_id');
      const args = homeId ? ['devices', homeId] : ['devices'];
      callMijiaBridge(args, (err, result) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.end(JSON.stringify(result));
        }
      });
      return;
    }

    // GET /api/mijia/scenes?home_id=xxx - 获取场景列表
    if (cleanPath === '/api/mijia/scenes' && req.method === 'GET') {
      const homeId = urlObj.searchParams.get('home_id');
      const args = homeId ? ['scenes', homeId] : ['scenes'];
      callMijiaBridge(args, (err, result) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        } else {
          res.end(JSON.stringify(result));
        }
      });
      return;
    }

    // POST /api/mijia/run_scene - 执行场景
    if (cleanPath === '/api/mijia/run_scene' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { scene_id, home_id } = JSON.parse(body);
          if (!scene_id || !home_id) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: '缺少 scene_id 或 home_id' }));
            return;
          }
          serverLog(`[米家] 执行场景: ${scene_id}`);
          callMijiaBridge(['run_scene', scene_id, home_id], (err, result) => {
            if (err) {
              serverError('[米家] 执行场景失败:', err.message);
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } else {
              serverLog('[米家] 执行场景成功');
              res.end(JSON.stringify(result));
            }
          });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
        }
      });
      return;
    }

    // POST /api/mijia/set_prop - 设置设备属性
    if (cleanPath === '/api/mijia/set_prop' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { did, siid, piid, value } = JSON.parse(body);
          if (!did || siid === undefined || piid === undefined || value === undefined) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: '缺少参数' }));
            return;
          }
          callMijiaBridge(['set_prop', did, String(siid), String(piid), String(value)], (err, result) => {
            if (err) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            } else {
              res.end(JSON.stringify(result));
            }
          });
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  // 报警截图服务
  if (cleanPath.startsWith('/alarm-screenshots/')) {
    const fileName = cleanPath.slice('/alarm-screenshots/'.length);
    // 安全检查：只允许文件名，不允许路径遍历
    if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid filename');
      return;
    }
    const filePath = path.join(ALARM_SCREENSHOTS_DIR, fileName);
    serveFile(filePath, res, req);
    return;
  }

  // MJPEG 流端点（已禁用，新架构使用 WebSocket 三通道推送）
  /*
  if (cleanPath.startsWith('/mjpeg/')) {
    const deviceId = cleanPath.slice('/mjpeg/'.length);
    if (!deviceId || deviceId.includes('..') || deviceId.includes('/') || deviceId.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid deviceId');
      return;
    }
    createMjpegStream(deviceId, req, res);
    return;
  }
  */

  if (cleanPath === '' || cleanPath === '/index.html' || cleanPath === '/main.html') {
    const filePath = path.join(__dirname, 'public', cleanPath === '' ? 'index.html' : cleanPath.slice(1));
    serveFile(filePath, res, req);
    return;
  }

  const staticPath = path.join(__dirname, 'public', cleanPath.slice(1));
  serveFile(staticPath, res, req);
});

function serveFile(filePath, res, req) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Server Error');
      }
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.ico': 'image/x-icon',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };
    const isStaticAsset = ['.css', '.js', '.ico', '.png', '.jpg', '.webp', '.svg'].includes(ext);
    const isHtml = ext === '.html';
    let content = data;

    // HTML 页面：替换资源引用为 hash 版本
    if (isHtml) {
      let html = data.toString('utf8');
      for (const [asset, hash] of Object.entries(assetHashes)) {
        // 替换 /style.css?v=xxx 为 /style.css?hash=xxx
        html = html.replace(new RegExp(`/${asset}\\?[^"']*`, 'g'), `/${asset}?hash=${hash}`);
      }
      content = Buffer.from(html, 'utf8');
    }

    const headers = {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    };
    // 有版本 hash 的静态资源长期缓存（1个月）
    if (isStaticAsset) {
      headers['Cache-Control'] = 'public, max-age=2592000, immutable';
    } else if (isHtml) {
      // HTML 页面不缓存，每次验证
      headers['Cache-Control'] = 'no-cache';
    }
    // 检查客户端是否支持 gzip（报警截图请求可能不传 req）
    const acceptEncoding = (req && req.headers ? (req.headers['accept-encoding'] || '') : '').toLowerCase();
    if (acceptEncoding.includes('gzip') && ['.css', '.js', '.html', '.json'].includes(ext)) {
      const gzip = zlib.createGzip();
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
      gzip.pipe(res);
      gzip.end(content);
      return;
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}

// ========== 离线检测 ==========
const TIMEOUT_MS = CLIENT_CFG.timeoutMs || 30000;
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, dev] of devices) {
    if (dev.online && now - dev.lastSeen > TIMEOUT_MS) {
      dev.online = false;
      lastPushTime.delete(id); // 清理推送时间追踪
      changed = true;
      // ws.on('close' 会在 disconnection 时打印离线日志，timeout 只在真正超时场景下才打印
      serverLog(`[!] 超时离线: ${dev.deviceName}`);
    }
  }
  if (changed) broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });

  // 定时清理超过48小时的报警记录（每次检查一条）
  cleanupOldAlarmRecords();
}, 5000);

// ========== 启动 ==========
const PORT = SERVER_CFG.port || 3000;
const HOST = SERVER_CFG.host || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  serverLog(`  🖥️  屏幕墙服务端 v${SERVER_CONFIG.serverVersion || '未知'} 已启动`);
  serverLog(`   本地访问:     http://localhost:${PORT}`);
  serverLog(`   WebSocket端口: ${PORT}\n`);
});
