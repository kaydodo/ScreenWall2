// Set timezone to Shanghai (UTC+8) for all Date operations
process.env.TZ = 'Asia/Shanghai';

// 屏蔽 Tesseract.js 的 DPI 警告
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function(chunk, encoding, callback) {
  if (typeof chunk === 'string' && chunk.includes('Invalid resolution') && chunk.includes('dpi')) {
    if (callback) callback();
    return true;
  }
  if (typeof chunk === 'string' && (chunk.includes('DEP0060') || chunk.includes('DEP0169'))) {
    if (callback) callback();
    return true;
  }
  return originalStderrWrite(chunk, encoding, callback);
};

const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const httpProxy = require('http-proxy');
const { formidable } = require('formidable');
const { Worker } = require('worker_threads');

const UPLOAD_DIR = path.join(__dirname, 'public');

// ========== 服务健康自检机制 ==========
let lastHeartbeat = Date.now();
let heartbeatInterval = null;
let alarmWorker = null;
let alarmWorkerReady = false;
const alarmWorkerQueue = [];
const HEARTBEAT_INTERVAL_MS = 1000;
const HEARTBEAT_TIMEOUT_MS = 10000;

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    lastHeartbeat = Date.now();
  }, HEARTBEAT_INTERVAL_MS);
  serverLog('[健康] 心跳自检已启动');
}

function checkHealth() {
  const now = Date.now();
  const elapsed = now - lastHeartbeat;
  return {
    healthy: elapsed < HEARTBEAT_TIMEOUT_MS,
    elapsed,
    lastHeartbeat
  };
}

function initAlarmWorker() {
  if (alarmWorker) return;
  
  const workerPath = path.join(__dirname, 'alarm-worker.js');
  if (!fs.existsSync(workerPath)) {
    serverError('[Worker] alarm-worker.js 不存在，报警处理将在主线程执行');
    return;
  }
  
  alarmWorker = new Worker(workerPath);
  
  alarmWorker.on('message', (msg) => {
    if (msg.type === 'workerReady') {
      alarmWorkerReady = true;
      serverLog('[Worker] 报警处理线程已就绪');
      while (alarmWorkerQueue.length > 0) {
        const task = alarmWorkerQueue.shift();
        alarmWorker.postMessage(task);
      }
    } else if (msg.type === 'alarmResult') {
      handleAlarmResult(msg.deviceId, msg.imageBuffer, msg.result);
    } else if (msg.type === 'alarmError') {
      serverError(`[Worker] ${msg.deviceId} 报警处理失败: ${msg.error}`);
    }
  });
  
  alarmWorker.on('error', (err) => {
    serverError('[Worker] 报警线程错误:', err.message);
    alarmWorker = null;
    alarmWorkerReady = false;
    setTimeout(() => initAlarmWorker(), 1000);
  });
  
  alarmWorker.on('exit', (code) => {
    if (code !== 0) {
      serverError(`[Worker] 报警线程异常退出 (code=${code})`);
    }
    alarmWorker = null;
    alarmWorkerReady = false;
    setTimeout(() => initAlarmWorker(), 1000);
  });
}

function sendAlarmToWorker(deviceId, imageBuffer, templateBuffer, templateRegion) {
  const task = {
    type: 'processAlarm',
    deviceId,
    imageBuffer,
    templateBuffer,
    templateRegion
  };
  
  if (alarmWorkerReady && alarmWorker) {
    alarmWorker.postMessage(task);
  } else {
    alarmWorkerQueue.push(task);
    if (!alarmWorker) {
      initAlarmWorker();
    }
  }
}

function handleAlarmResult(deviceId, imageBuffer, result) {
  if (result.type === 'verify') {
    const state = alarmStates.get(deviceId);
    if (!state) return;
    
    if (result.shouldEnd) {
      state.verifyCount++;
      if (state.verifyCount >= 2) {
        alarmStates.set(deviceId, {
          state: 'idle',
          verifyCount: 0,
          templateRegion: null,
          templateBuffer: null,
          lastImage: null,
          occurrenceCount: state.occurrenceCount,
        });
      } else {
        alarmStates.set(deviceId, state);
      }
    } else {
      state.verifyCount = 0;
      alarmStates.set(deviceId, state);
    }
  } else if (result.type === 'detect' && result.alarm) {
    createAlarmRecord(deviceId, imageBuffer, result);
  }
}

function createAlarmRecord(deviceId, imageBuffer, result) {
  const dev = devices.get(deviceId);
  if (!dev) return;
  
  const deviceName = dev.deviceName;
  const groupName = getGroupNameForDevice(deviceId);
  const cellStr = getCellStrForDevice(deviceId);
  
  const imageMd5 = result.imageMd5;
  const prev = alarmPrevCache.get(deviceId);
  if (prev && prev.md5 === imageMd5) return;
  alarmPrevCache.set(deviceId, { md5: imageMd5, time: result.timestamp });
  
  for (const client of wssClient.clients) {
    if (client._deviceId === deviceId && client.readyState === 1) {
      client.send(JSON.stringify({ type: 'requestHdScreenshot', purpose: 'alarm', timestamp: result.timestamp }));
      break;
    }
  }
  
  const screenshotId = crypto.randomUUID();
  const screenshotPath = path.join(ALARM_SCREENSHOTS_DIR, `${screenshotId}.png`);
  
  // 保存截图文件（异步，不阻塞）
  fsWriteFile(screenshotPath, imageBuffer).catch(e => {
    serverError('[报警] 保存截图失败:', e.message);
  });
  
  const dayStart = new Date(result.timestamp).setHours(0, 0, 0, 0);
  let occurrenceCount = 1;
  for (const rec of alarmRecords) {
    if (rec.deviceId === deviceId && rec.timestamp >= dayStart) {
      if (rec.occurrenceCount && rec.occurrenceCount >= occurrenceCount) {
        occurrenceCount = rec.occurrenceCount + 1;
      }
    }
  }
  
  const record = {
    id: crypto.randomUUID(),
    deviceId,
    deviceName,
    uuDeviceId: dev.uuDeviceId || null,
    screenshot: `/alarm-screenshots/${screenshotId}.png`,
    screenshotId,
    screenshotPath,
    timestamp: result.timestamp,
    groupName,
    cellStr,
    occurrenceCount,
    status: 'confirmed',
    matchedKeyword: result.matchedKeyword,
    region: result.region,
    regionSize: result.regionSize,
    isFullScreenshot: false,
  };
  
  alarmRecords.push(record);
  persistAlarmRecords();
  
  serverLog(`[报警] ${deviceName} 触发报警 (第${occurrenceCount}次)`);
  
  alarmStates.set(deviceId, {
    state: 'verifying',
    verifyCount: 0,
    templateRegion: result.templateRegion,
    templateBuffer: result.templateBuffer,
    lastImage: null,
    occurrenceCount,
  });
  
  broadcastToBrowsers({ type: 'alarm', alarm: record });
}

function getCellStrForDevice(deviceId) {
  for (const [idx, devId] of Object.entries(gridLayout)) {
    if (devId === deviceId) {
      return ' 格:' + String(parseInt(idx) + 1).padStart(2, '0');
    }
  }
  return '';
}

function checkUploadAuth(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/upload_auth=([^;]+)/);
    if (!match) return false;
    const token = Buffer.from(match[1], 'base64').toString('utf8');
    try {
        const { u, p } = JSON.parse(token);
        return u === AUTH_CFG.username && p === AUTH_CFG.password;
    } catch (e) {
        return false;
    }
}

function getUploadLoginPage(error = '') {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件上传服务 - 登录</title>
    <style>
        :root {
            --bg-page: #f0f2f8;
            --bg-card: #ffffff;
            --border: #dce3f5;
            --text-primary: #1a2332;
            --text-secondary: #4a5568;
            --text-muted: #8896b0;
            --accent: #4f7ef7;
            --accent-dark: #3b62d8;
            --accent-light: #eef2ff;
            --shadow-md: 0 4px 16px rgba(80,100,180,0.12);
            --radius-md: 14px;
            --radius-sm: 8px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            background: var(--bg-page);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-container {
            background: var(--bg-card);
            padding: 40px;
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-md);
            width: 400px;
            max-width: 90%;
            border: 1px solid var(--border);
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo-icon {
            width: 64px;
            height: 64px;
            background: var(--accent-light);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 15px;
            font-size: 28px;
        }
        h1 {
            font-size: 22px;
            color: var(--text-primary);
            font-weight: 600;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: var(--text-secondary);
            font-size: 14px;
            font-weight: 500;
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px 14px;
            border: 1.5px solid var(--border);
            border-radius: var(--radius-sm);
            font-size: 15px;
            transition: border-color 0.2s, box-shadow 0.2s;
            background: var(--bg-card);
            color: var(--text-primary);
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-light);
        }
        button[type="submit"] {
            width: 100%;
            padding: 14px;
            background: var(--accent);
            border: none;
            border-radius: var(--radius-sm);
            color: white;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        button[type="submit"]:hover {
            background: var(--accent-dark);
        }
        .error {
            background: #fef2f2;
            color: #dc2626;
            padding: 12px;
            border-radius: var(--radius-sm);
            margin-bottom: 20px;
            text-align: center;
            font-size: 14px;
            border: 1px solid #fecaca;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <div class="logo-icon">📁</div>
            <h1>文件上传服务</h1>
        </div>
        ${error ? '<div class="error">' + error + '</div>' : ''}
        <form method="post" action="/_upload/login">
            <div class="form-group">
                <label>用户名</label>
                <input type="text" name="username" required placeholder="请输入用户名">
            </div>
            <div class="form-group">
                <label>密码</label>
                <input type="password" name="password" required placeholder="请输入密码">
            </div>
            <button type="submit">登 录</button>
        </form>
    </div>
</body>
</html>`;
}

function getUploadPage() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>文件上传服务</title>
    <style>
        :root {
            --bg-page: #f0f2f8;
            --bg-card: #ffffff;
            --bg-hover: #eef1fa;
            --border: #dce3f5;
            --text-primary: #1a2332;
            --text-secondary: #4a5568;
            --text-muted: #8896b0;
            --accent: #4f7ef7;
            --accent-dark: #3b62d8;
            --accent-light: #eef2ff;
            --shadow-sm: 0 1px 4px rgba(80,100,180,0.08);
            --shadow-md: 0 4px 16px rgba(80,100,180,0.12);
            --radius-md: 14px;
            --radius-sm: 8px;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
            background: var(--bg-page);
            min-height: 100vh;
            color: var(--text-primary);
        }
        .header {
            background: var(--bg-card);
            padding: 16px 40px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1.5px solid var(--border);
            box-shadow: var(--shadow-sm);
        }
        .header h1 {
            color: var(--text-primary);
            font-size: 20px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .logout-btn {
            background: var(--bg-hover);
            border: 1px solid var(--border);
            color: var(--text-secondary);
            padding: 8px 16px;
            border-radius: var(--radius-sm);
            cursor: pointer;
            font-size: 14px;
            transition: background 0.2s;
        }
        .logout-btn:hover { background: var(--border); }
        .container {
            max-width: 1000px;
            margin: 30px auto;
            padding: 0 20px;
        }
        .card {
            background: var(--bg-card);
            border-radius: var(--radius-md);
            padding: 24px;
            box-shadow: var(--shadow-sm);
            margin-bottom: 24px;
            border: 1px solid var(--border);
        }
        .card-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .upload-area {
            border: 2px dashed var(--border);
            border-radius: var(--radius-md);
            padding: 50px 30px;
            text-align: center;
            transition: border-color 0.2s, background 0.2s;
            cursor: pointer;
        }
        .upload-area:hover, .upload-area.dragover {
            border-color: var(--accent);
            background: var(--accent-light);
        }
        .upload-icon { font-size: 48px; margin-bottom: 16px; }
        .upload-text { color: var(--text-secondary); font-size: 16px; margin-bottom: 8px; }
        .upload-hint { color: var(--text-muted); font-size: 13px; }
        #fileInput { display: none; }
        .file-list { margin-top: 16px; text-align: left; }
        .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: var(--bg-page);
            border-radius: var(--radius-sm);
            margin-bottom: 8px;
        }
        .file-name { font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
        .file-size { color: var(--text-muted); font-size: 12px; }
        .remove-btn {
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fecaca;
            padding: 5px 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }
        .remove-btn:hover { background: #fee2e2; }
        .upload-btn {
            width: 100%;
            padding: 14px;
            background: var(--accent);
            border: none;
            border-radius: var(--radius-sm);
            color: white;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            margin-top: 16px;
            transition: background 0.2s;
        }
        .upload-btn:hover:not(:disabled) { background: var(--accent-dark); }
        .upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .progress-container { margin-top: 16px; display: none; }
        .progress-bar {
            width: 100%;
            height: 6px;
            background: var(--border);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-fill { height: 100%; background: var(--accent); width: 0%; transition: width 0.3s; }
        .progress-text { text-align: center; margin-top: 8px; color: var(--text-secondary); font-size: 13px; }
        .result { margin-top: 16px; padding: 14px; border-radius: var(--radius-sm); text-align: center; font-size: 14px; }
        .result.success { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
        .result.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
        .existing-files { max-height: 350px; overflow-y: auto; }
        .existing-file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            background: var(--bg-page);
            border-radius: var(--radius-sm);
            margin-bottom: 8px;
            transition: background 0.2s;
        }
        .existing-file-item:hover { background: var(--bg-hover); }
        .existing-file-info { display: flex; align-items: center; gap: 10px; }
        .existing-file-icon { font-size: 20px; }
        .existing-file-name { font-weight: 500; color: var(--text-primary); }
        .existing-file-meta { font-size: 12px; color: var(--text-muted); }
        .file-status { font-size: 12px; padding: 4px 8px; border-radius: 4px; background: #f0fdf4; color: #16a34a; }
        .empty-state { text-align: center; padding: 30px; color: var(--text-muted); }
        .empty-icon { font-size: 40px; margin-bottom: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📁 文件上传服务</h1>
        <button class="logout-btn" onclick="fetch('/_upload/logout').then(() => location.reload())">退出登录</button>
    </div>
    <div class="container">
        <div class="card">
            <div class="card-title">📤 上传文件</div>
            <div class="upload-area" id="uploadArea">
                <div class="upload-icon">☁️</div>
                <div class="upload-text">拖拽文件到此处，或点击选择文件</div>
                <div class="upload-hint">支持多文件上传，单个文件最大 2GB</div>
            </div>
            <input type="file" id="fileInput" multiple>
            <div class="file-list" id="fileList"></div>
            <button class="upload-btn" id="uploadBtn" disabled onclick="uploadFiles()">开始上传</button>
            <div class="progress-container" id="progressContainer">
                <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
                <div class="progress-text" id="progressText">0%</div>
            </div>
            <div class="result" id="result" style="display:none;"></div>
        </div>
        <div class="card">
            <div class="card-title">📂 已上传文件 <span id="fileCount"></span></div>
            <div class="existing-files" id="existingFiles"></div>
        </div>
    </div>
    <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const fileList = document.getElementById('fileList');
        const uploadBtn = document.getElementById('uploadBtn');
        let selectedFiles = [];

        uploadArea.onclick = () => fileInput.click();
        uploadArea.ondragover = (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); };
        uploadArea.ondragleave = () => uploadArea.classList.remove('dragover');
        uploadArea.ondrop = (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            addFiles(e.dataTransfer.files);
        };
        fileInput.onchange = () => addFiles(fileInput.files);

        function addFiles(files) {
            selectedFiles = [...selectedFiles, ...files];
            renderFileList();
        }

        function renderFileList() {
            fileList.innerHTML = selectedFiles.map((f, i) =>
                '<div class="file-item"><div class="file-name">📄 ' + f.name + ' <span class="file-size">(' + formatSize(f.size) + ')</span></div><button class="remove-btn" onclick="removeFile(' + i + ')">移除</button></div>'
            ).join('');
            uploadBtn.disabled = selectedFiles.length === 0;
        }

        function removeFile(i) {
            selectedFiles.splice(i, 1);
            renderFileList();
        }

        function formatSize(b) {
            if (b < 1024) return b + ' B';
            if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
            if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
            return (b/1024/1024/1024).toFixed(2) + ' GB';
        }

        async function uploadFiles() {
            if (selectedFiles.length === 0) return;
            const formData = new FormData();
            selectedFiles.forEach(f => formData.append('file', f));

            const progressContainer = document.getElementById('progressContainer');
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            const result = document.getElementById('result');

            progressContainer.style.display = 'block';
            result.style.display = 'none';
            uploadBtn.disabled = true;

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/_upload/upload');
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = (e.loaded / e.total * 100).toFixed(1);
                    progressFill.style.width = pct + '%';
                    progressText.textContent = pct + '%';
                }
            };
            xhr.onload = () => {
                progressContainer.style.display = 'none';
                result.style.display = 'block';
                if (xhr.status === 200) {
                    result.className = 'result success';
                    result.textContent = '✅ ' + xhr.responseText;
                    selectedFiles = [];
                    renderFileList();
                    loadExistingFiles();
                } else {
                    result.className = 'result error';
                    result.textContent = '❌ 上传失败';
                }
                uploadBtn.disabled = false;
            };
            xhr.send(formData);
        }

        async function loadExistingFiles() {
            const res = await fetch('/_upload/files');
            const data = await res.json();
            const container = document.getElementById('existingFiles');
            document.getElementById('fileCount').textContent = '(' + data.length + ')';
            if (data.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div>暂无文件</div></div>';
                return;
            }
            container.innerHTML = data.map(f =>
                '<div class="existing-file-item"><div class="existing-file-info"><div class="existing-file-icon">📄</div><div><div class="existing-file-name">' + f.name + '</div><div class="existing-file-meta">' + formatSize(f.size) + ' · ' + f.time + '</div></div></div><span class="file-status">已上传</span></div>'
            ).join('');
        }

        loadExistingFiles();
    </script>
</body>
</html>`;
}

// 异步函数包装
const fsWriteFile = promisify(fs.writeFile);
const fsStat = promisify(fs.stat);
const fsMkdir = promisify(fs.mkdir);
const fsReadFile = promisify(fs.readFile);
const fsCopyFile = promisify(fs.copyFile);
const fsUnlink = promisify(fs.unlink);
const fsReaddir = promisify(fs.readdir);
const execFileAsync = promisify(execFile);

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

// ========== 异步日志模块 ==========
const LOGS_DIR = path.join(__dirname, 'logs');
let _logQueue = [];
let _logWriting = false;
let _logFileHandle = null;
let _logDate = null;
const fsAppendFile = promisify(fs.appendFile);

async function _ensureLogFile() {
    const today = new Date().toISOString().slice(0, 10);
    if (_logFileHandle && _logDate === today) return _logFileHandle;
    
    if (_logFileHandle) {
        try { _logFileHandle.close(); } catch(e) {}
        _logFileHandle = null;
    }
    
    try {
        await fsMkdir(LOGS_DIR, { recursive: true });
    } catch(e) {}
    
    const logPath = path.join(LOGS_DIR, `${today}.log`);
    _logDate = today;
    return logPath;
}

async function _flushLogQueue() {
    if (_logWriting || _logQueue.length === 0) return;
    _logWriting = true;
    
    try {
        const lines = _logQueue.splice(0, _logQueue.length);
        const content = lines.join('');
        const logPath = await _ensureLogFile();
        await fsAppendFile(logPath, content);
    } catch(e) {
        process.stderr.write('[日志写入失败] ' + e.message + '\n');
    } finally {
        _logWriting = false;
        if (_logQueue.length > 0) {
            _flushLogQueue();
        }
    }
}

function serverLog(...args) {
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${ts}] ${msg}\n`;
    try {
        process.stdout.write(line);  // 自动处理Windows控制台编码
    } catch(e) { /* ignore */ }
    _logQueue.push(line);
    _flushLogQueue();
}

function serverError(...args) {
    const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    const line = `[${ts}] [ERROR] ${msg}\n`;
    process.stderr.write(line);
    _logQueue.push(line);
    _flushLogQueue();
}

// 全局异常拦截（防止未知路径导致服务端崩溃）
process.on('uncaughtException', (err) => {
  serverError('[未捕获异常]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  serverError('[未处理Promise拒绝]', String(reason));
});

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
async function reloadServerConfigAsync() {
  try {
    let raw;
    try {
      raw = await fsReadFile(SERVER_CONFIG_PATH, 'utf8');
    } catch (e) {
      return;
    }
    SERVER_CONFIG = JSON.parse(raw);
    if (SERVER_CONFIG.uuDownloadUrl && !SERVER_CONFIG.uuVersion) {
      const fileName = SERVER_CONFIG.uuDownloadUrl.replace(/^\//, '');
      const m = fileName.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) SERVER_CONFIG.uuVersion = m[1];
    }
    serverLog(`[配置] config.json 已重新加载: 屏幕墙版本=${SERVER_CONFIG.serverVersion || '未知'} | UU版本=${SERVER_CONFIG.uuVersion || '未知'}`);


    // 服务端自更新检测
    if (SERVER_CONFIG.serverSelfUpdate === '1') {
      serverLog(`[自更新] 检测到自更新指令，从 public/server.js 更新服务端...`);
      try {
        const serverJsSrc = path.join(__dirname, 'public', 'server.js');
        const serverJsDest = path.join(__dirname, 'server.js');
        let srcExists = true;
        try {
          await fsStat(serverJsSrc);
        } catch (e) {
          srcExists = false;
        }
        if (srcExists) {
          await fsCopyFile(serverJsSrc, serverJsDest);
          await fsUnlink(serverJsSrc);
          // 写入配置时只保留原始字段，不写入动态添加的 uuVersion
          const configToSave = {
            serverSelfUpdate: '0',
            serverVersion: SERVER_CONFIG.serverVersion,
            uuDownloadUrl: SERVER_CONFIG.uuDownloadUrl
          };
          await fsWriteFile(SERVER_CONFIG_PATH, JSON.stringify(configToSave, null, 2), 'utf8');
          serverLog('[自更新] 更新完成，即将退出（看门狗会自动重启）...');
          setTimeout(() => { process.exit(0); }, 1000);
        } else {
          serverError('[自更新] public/server.js 不存在，跳过');
        }
      } catch (err) {
        serverError('[自更新] 失败:', err.message);
      }
    }
    // serverVersion 变化时广播给浏览器更新版本显示
    if (SERVER_CONFIG.serverVersion && SERVER_CONFIG.serverVersion !== _lastServerVersion) {
      _lastServerVersion = SERVER_CONFIG.serverVersion;
      broadcastToBrowsers({ type: 'serverVersionUpdate', serverVersion: SERVER_CONFIG.serverVersion });
    }
  } catch (err) {
    serverError('[配置] 重载 config.json 失败:', err.message);
  }
}
function reloadServerConfig() {
  reloadServerConfigAsync();
}
// 使用 fs.watchFile 轮询监听（兼容 FTP/SFTP 上传场景）
// FTP 上传常用「删除旧文件 → 写入新文件」或「重命名临时文件」方式，fs.watch 会丢失事件
fs.watchFile(SERVER_CONFIG_PATH, { interval: 5000 }, (curr, prev) => {
  if (curr.mtimeMs !== prev.mtimeMs) {
    serverLog('[配置] 检测到 config.json 文件变化，重新加载...');
    reloadServerConfig();
  }
});



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

// ========== 网关代理配置 ==========
const GATEWAY_CONFIG_PATH = path.join(__dirname, 'gateway.json');
let gatewayServices = [];

function loadGatewayConfig() {
  if (fs.existsSync(GATEWAY_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(GATEWAY_CONFIG_PATH, 'utf8');
      gatewayServices = JSON.parse(raw);
      serverLog(`[网关] 已加载 ${gatewayServices.length} 个代理服务配置`);
    } catch (e) {
      serverError('[网关] 加载配置失败:', e.message);
      gatewayServices = [];
    }
  } else {
    gatewayServices = [];
  }
}

function saveGatewayConfig() {
  try {
    fs.writeFileSync(GATEWAY_CONFIG_PATH, JSON.stringify(gatewayServices, null, 2), 'utf8');
    serverLog('[网关] 配置已保存');
  } catch (e) {
    serverError('[网关] 保存配置失败:', e.message);
  }
}

loadGatewayConfig();

const proxy = httpProxy.createProxyServer({});
proxy.on('error', (err, req, res) => {
  serverError('[网关代理错误]', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('网关代理错误');
  }
});
proxy.on('proxyRes', (proxyRes, req, res) => {
  if (req._gatewayRoute === '/nas' || (req._originalUrl && req._originalUrl.startsWith('/nas'))) {
    res._savedWriteHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
    return;
  }
  if (res.headersSent) return;
  const route = req._gatewayRoute;

  if (route && proxyRes.headers['location']) {
    let location = proxyRes.headers['location'];
    if (location.startsWith('/') && !location.startsWith('//')) {
      if (!location.startsWith(route + '/') && location !== route) {
        proxyRes.headers['location'] = route + location;
      }
    }
  }

  const contentType = proxyRes.headers['content-type'] || '';
  const isHtml = contentType.includes('text/html');
  const isJs = contentType.includes('javascript');
  const isCss = contentType.includes('text/css');

  if (!isHtml && !isJs && !isCss) {
    proxyRes.pipe(res);
    return;
  }

  let chunks = [];
  proxyRes.on('data', (chunk) => chunks.push(chunk));
  proxyRes.on('end', () => {
    if (res.headersSent) return;
    let body = Buffer.concat(chunks).toString('utf8');
    
    if (route && route !== '/nas') {
      body = body.replace(/(src|href|action)="\/([^"]+)"/g, `$1="${route}/$2"`);
      body = body.replace(/(src|href|action)="\/"/g, `$1="${route}"`);
      body = body.replace(/window\.location\.href\s*=\s*'\/([^']+)'/g, `window.location.href='${route}/$1'`);
      body = body.replace(/window\.location\.href\s*=\s*"\/([^"]+)"/g, `window.location.href="${route}/$1"`);
      body = body.replace(/window\.location\.pathname\s*=\s*'\/([^']+)'/g, `window.location.pathname='${route}/$1'`);
      body = body.replace(/window\.location\.pathname\s*=\s*"\/([^"]+)"/g, `window.location.pathname="${route}/$1"`);
      body = body.replace(/window\.location\s*=\s*'\/([^']+)'/g, `window.location='${route}/$1'`);
      body = body.replace(/window\.location\s*=\s*"\/([^"]+)"/g, `window.location="${route}/$1"`);
      body = body.replace(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=\/([^"]+)"[^>]*>/gi, (match, path) => match.replace(`url=/${path}`, `url=${route}/${path}`));
    }
    
    res.setHeader('content-length', Buffer.byteLength(body));
    res.end(body);
  });
});

function checkGatewayAuth(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/gateway_auth=([^;]+)/);
    if (!match) return false;
    const token = Buffer.from(match[1], 'base64').toString('utf8');
    try {
        const { u, p } = JSON.parse(token);
        return u === AUTH_CFG.username && p === AUTH_CFG.password;
    } catch (e) {
        return false;
    }
}

// ========== 设备权限管理配置 ==========
const PERMISSIONS_PATH = path.join(__dirname, 'permissions.json');

// 设备权限配置: deviceId -> { allowScreenWall: boolean, allowSelfService: boolean }
let devicePermissions = {};

// 加载权限配置
function loadPermissions() {
  if (fs.existsSync(PERMISSIONS_PATH)) {
    try {
      const raw = fs.readFileSync(PERMISSIONS_PATH, 'utf8');
      devicePermissions = JSON.parse(raw);
      serverLog(`[权限] 已加载 ${Object.keys(devicePermissions).length} 个设备权限配置`);
    } catch (e) {
      serverError('[权限] 加载权限配置失败:', e.message);
    }
  }
}

// 保存权限配置
async function persistPermissions() {
  try {
    await fsWriteFile(PERMISSIONS_PATH, JSON.stringify(devicePermissions, null, 2), 'utf8');
  } catch (e) {
    serverError('[权限] 保存权限配置失败:', e.message);
  }
}

// 检查设备是否有打开屏幕墙权限
function hasScreenWallPermission(deviceId) {
  return devicePermissions[deviceId]?.allowScreenWall === true;
}

// 检查设备是否有自助登号权限
function hasSelfServicePermission(deviceId) {
  return devicePermissions[deviceId]?.allowSelfService === true;
}

// 设置设备权限
async function setDevicePermission(deviceId, allowScreenWall, allowSelfService) {
  devicePermissions[deviceId] = {
    allowScreenWall: allowScreenWall === true,
    allowSelfService: allowSelfService === true
  };
  await persistPermissions();
  const deviceInfo = devices.get(deviceId);
  const deviceName = deviceInfo?.deviceName || deviceInfo?.name || deviceId;
  serverLog(`[权限] 设备 ${deviceName} (${deviceId}) 权限已更新: 屏幕墙=${allowScreenWall}, 自助登号=${allowSelfService}`);
}

// 删除设备权限（删除设备时调用）
async function removeDevicePermission(deviceId) {
  if (devicePermissions[deviceId]) {
    delete devicePermissions[deviceId];
    await persistPermissions();
    const deviceInfo = devices.get(deviceId);
    const deviceName = deviceInfo?.deviceName || deviceInfo?.name || deviceId;
    serverLog(`[权限] 已删除设备 ${deviceName} (${deviceId}) 的权限配置`);
  }
}

// 迁移设备权限（设备继承时调用）
async function migrateDevicePermission(oldDeviceId, newDeviceId) {
  if (devicePermissions[oldDeviceId]) {
    devicePermissions[newDeviceId] = { ...devicePermissions[oldDeviceId] };
    delete devicePermissions[oldDeviceId];
    await persistPermissions();
    return true; // 返回是否迁移了权限
  }
  return false;
}

loadPermissions();

// ========== 设备ID迁移和删除的统一处理函数 ==========

/**
 * 统一的设备ID迁移函数：将所有持久化数据中的旧 deviceId 替换为新 deviceId
 * @param {string} oldDeviceId - 旧设备ID
 * @param {string} newDeviceId - 新设备ID
 */
async function migrateDeviceId(oldDeviceId, newDeviceId) {
  if (oldDeviceId === newDeviceId) return;

  const oldDeviceInfo = devices.get(oldDeviceId);
  const newDeviceInfo = devices.get(newDeviceId);
  const oldDeviceName = oldDeviceInfo?.deviceName || oldDeviceInfo?.name || oldDeviceId;
  const newDeviceName = newDeviceInfo?.deviceName || newDeviceInfo?.name || newDeviceId;

  // 1. gridLayout：格子位置映射，旧 deviceId → 新 deviceId
  for (const idx of Object.keys(gridLayout)) {
    if (gridLayout[idx] === oldDeviceId) {
      gridLayout[idx] = newDeviceId;
    }
  }
  await persistGrid();

  // 2. groups：分组的 deviceIds 数组，旧 → 新
  for (const group of groups) {
    const pos = group.deviceIds.indexOf(oldDeviceId);
    if (pos !== -1) {
      group.deviceIds[pos] = newDeviceId;
    }
  }
  await persistGroups();

  // 3. collections：截图集合的 deviceId，旧 → 新
  collections.forEach((items) => {
    for (const item of items) {
      if (item.deviceId === oldDeviceId) {
        item.deviceId = newDeviceId;
      }
    }
  });
  await saveCollections();

  // 4. wallDevices：监控墙持久化追踪
  if (wallDevices.has(oldDeviceId)) {
    wallDevices.delete(oldDeviceId);
    wallDevices.set(newDeviceId, true);
  }

  // 5. monitorWallDevices：监控墙白名单
  if (monitorWallDevices.delete(oldDeviceId) && monitorWallDevices.add(newDeviceId));

  // 6. alarmRecords：历史报警记录
  for (const rec of alarmRecords) {
    if (rec.deviceId === oldDeviceId) {
      rec.deviceId = newDeviceId;
    }
  }
  await persistAlarmRecords();

  // 7. lastAlarmTime：报警时间 Map
  if (lastAlarmTime.has(oldDeviceId) && lastAlarmTime.set(newDeviceId, lastAlarmTime.get(oldDeviceId)) && lastAlarmTime.delete(oldDeviceId));

  // 8. favorites：格子上收藏的星星图标
  for (const fav of favorites) {
    if (fav.deviceId === oldDeviceId) {
      fav.deviceId = newDeviceId;
    }
  }
  if (favorites.some(f => f.deviceId === newDeviceId)) await saveFavorites();

  // 9. powerScenes：开关机场景（旧 deviceId → 新 deviceId）
  if (powerScenes[oldDeviceId]) {
    powerScenes[newDeviceId] = powerScenes[oldDeviceId];
    delete powerScenes[oldDeviceId];
    await persistPowerScenes();
  }

  // 10. tasks：任务记录（旧 deviceId → 新 deviceId
  let taskChanged = false;
  for (const task of tasks) {
    if (task.deviceId === oldDeviceId) {
      task.deviceId = newDeviceId;
      taskChanged = true;
    }
  }
  if (taskChanged) await persistTasks();

  // 11. devicePermissions：设备权限配置（旧 deviceId → 新 deviceId）
  const hasPermissionMigrated = await migrateDevicePermission(oldDeviceId, newDeviceId);

  // 一条简洁的总结日志
  const permissionNote = hasPermissionMigrated ? '（含权限）' : '';
  serverLog(`[继承] ${oldDeviceName} (${oldDeviceId}) → ${newDeviceName} (${newDeviceId})${permissionNote}`);
}

/**
 * 统一的设备删除函数：从所有持久化数据和内存数据中彻底删除该设备
 * @param {string} deviceId - 要删除的设备ID
 */
async function deleteDeviceCompletely(deviceId) {
  const deviceInfo = devices.get(deviceId);
  const deviceName = deviceInfo?.deviceName || deviceInfo?.name || deviceId;

  serverLog(`[删除] 开始彻底删除设备: ${deviceName} (${deviceId})`);

  // 从 devices Map
  if (devices.delete(deviceId));

  // 1. gridLayout：格子位置映射
  for (const idx of Object.keys(gridLayout)) {
    if (gridLayout[idx] === deviceId) {
      delete gridLayout[idx];
    }
  }
  await persistGrid();

  // 2. groups：分组的 deviceIds 数组
  for (const g of groups) {
    if (g.deviceIds && Array.isArray(g.deviceIds)) {
      g.deviceIds = g.deviceIds.filter(id => id !== deviceId);
    }
  }
  await persistGroups();

  // 3. collections：截图集合标记为已删除
  updateCollectionsDeviceStatus(deviceId, { deleted: true });

  // 4. wallDevices：监控墙持久化追踪
  wallDevices.delete(deviceId);

  // 5. monitorWallDevices：监控墙白名单
  monitorWallDevices.delete(deviceId);

  // 6. alarmRecords：历史报警记录
  const oldAlarmLen = alarmRecords.length;
  alarmRecords = alarmRecords.filter(r => r.deviceId !== deviceId);
  if (alarmRecords.length !== oldAlarmLen) await persistAlarmRecords();

  // 7. 清理报警状态
  alarmStates.delete(deviceId);
  pending_alarms.delete(deviceId);
  lastAlarmTime.delete(deviceId);

  // 8. favorites：清理收藏状态
  cleanupDeviceFromFavorites(deviceId);

  // 9. powerScenes：开关机场景
  if (powerScenes[deviceId]) {
    delete powerScenes[deviceId];
    await persistPowerScenes();
  }

  // 10. tasks：任务记录标记为 deviceDeleted
  let taskDelChanged = false;
  for (const t of tasks) {
    if (t.deviceId === deviceId && !t.deviceDeleted) {
      t.deviceDeleted = true;
      taskDelChanged = true;
    }
  }
  if (taskDelChanged) await persistTasks();

  // 11. devicePermissions：设备权限配置
  await removeDevicePermission(deviceId);

  // 12. 清理报警截图文件
  (async () => {
    try {
      const screenshotFiles = await fsReaddir(ALARM_SCREENSHOTS_DIR);
      for (const file of screenshotFiles) {
        if (file.startsWith(deviceId + '_')) {
          try {
            await fsUnlink(path.join(ALARM_SCREENSHOTS_DIR, file));
          } catch (e) {
            serverError(`[清理] 删除报警截图失败: ${file} - ${e.message}`);
          }
        }
      }
    } catch (e) {
      serverError(`[清理] 读取报警截图目录失败: ${e.message}`);
    }
  })();

  // 持久化设备列表
  await persistDevices();

  serverLog(`[删除] 完成彻底删除设备: ${deviceName} (${deviceId})`);

  return { deviceName, deviceId };
}

function formatDeviceName(name, id) {
  if (!name) return id;
  if (!id) return name;
  return `${name}（${id}）`;
}

// 自助登号超时时间（毫秒）
const SELF_SERVICE_TIMEOUT_MS = 6000;

// 自助登号点击时间窗口（毫秒）
const SELF_SERVICE_CLICK_WINDOW_MS = 3000;

// 自助登号状态管理器（按业务设备ID存储状态，避免多个连接混淆）
const selfServiceStateByBusinessId = new Map(); // businessId -> { operatorId, operatorName, businessName, mumuClient, timeoutId, clickTimestamp }

// 自助登号超时清理函数
function clearSelfServiceState(businessId) {
  const state = selfServiceStateByBusinessId.get(businessId);
  if (state) {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
    }
    selfServiceStateByBusinessId.delete(businessId);
  }
}

async function processQrcodeImage(imageBuffer, businessId, operatorId, operatorName, businessName, clickTimestamp) {
  try {
    const now = Date.now();
    let normalizedTimestamp = clickTimestamp;
    const isSeconds = normalizedTimestamp && (normalizedTimestamp < 10000000000 || !Number.isInteger(normalizedTimestamp));
    if (isSeconds) {
      normalizedTimestamp = normalizedTimestamp * 1000;
    }
    if (normalizedTimestamp && now - normalizedTimestamp > SELF_SERVICE_CLICK_WINDOW_MS) {
      clearSelfServiceState(businessId);
      return;
    }
    
    const state = selfServiceStateByBusinessId.get(businessId);
    
    if (state && state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
    
    const operatorDevName = operatorName || operatorId;
    const businessDevName = businessName || businessId;
    const isSameDevice = businessId === operatorId;

    const logResult = (result) => {
      if (isSameDevice) {
        serverLog(`[自助登号] ${formatDeviceName(operatorDevName, operatorId)}使用二维码扫码（${result}）`);
      } else {
        serverLog(`[自助登号] ${formatDeviceName(operatorDevName, operatorId)}帮助${formatDeviceName(businessDevName, businessId)}使用二维码扫码（${result}）`);
      }
    };

    if (!imageBuffer || imageBuffer.length < 1000) {
      logResult('失败');
      clearSelfServiceState(businessId);
      return;
    }

    const mumuClient = state ? state.mumuClient : null;
    
    if (!mumuClient || mumuClient.readyState !== 1) {
      logResult('失败');
      clearSelfServiceState(businessId);
      return;
    }

    const screenshotBase64 = 'data:image/webp;base64,' + imageBuffer.toString('base64');
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    
    const result = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        mumuClient.removeListener('message', handleMessage);
        resolve({ status: 'failed', error: '处理超时' });
      }, 5000);

      const handleMessage = (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'qrcodeResult' && msg.requestId === requestId) {
            clearTimeout(timeoutId);
            mumuClient.removeListener('message', handleMessage);
            resolve(msg);
          }
        } catch (e) {}
      };

      mumuClient.on('message', handleMessage);
      mumuClient.send(JSON.stringify({
        type: 'processQrcode',
        requestId,
        screenshot: screenshotBase64
      }));
    });

    if (result.status === 'success') {
      logResult('成功');
    } else {
      logResult('失败');
    }
    
  } catch (err) {
    serverError('[二维码] 处理异常:', err.message);
  } finally {
    clearSelfServiceState(businessId);
  }
}

// ========== 辅助函数 ==========
function hasOtherPreview(deviceId, excludeWs) {
  return deviceMaxLevel.has(deviceId) && deviceMaxLevel.get(deviceId) >= 1;
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
// 格子预览独立通道（不受帧缓存去重影响）
const previewClients = new Map(); // ws -> { deviceId, interval }
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
// Step 2: 监控墙裁剪 - 每个监控墙连接的布局信息
const wallLayouts = new Map(); // ws -> { cols, rows, cellW, cellH, deviceIds }
// Step 3: 视口懒加载 - 每个浏览器连接的视口订阅
const viewportSubscriptions = new Map(); // ws -> { deviceIds: Set, cropCols: number, cropSize: { w, h } }

// ========== Step 1: 流级别系统 - 全局变量 ==========
const deviceMaxLevel = new Map(); // deviceId -> 0|1|2 (0=480x270, 1=853x720, 2=1280x1080)
const deviceSubscribers = new Map(); // deviceId -> Map(ws -> level)

// ========== Step 1: 流级别系统 - 函数 ==========
function updateLevel(deviceId) {
  if (!deviceSubscribers.has(deviceId)) {
    const oldLevel = deviceMaxLevel.get(deviceId);
    deviceMaxLevel.delete(deviceId);
    if (oldLevel !== undefined) {
      notifyDeviceLevel(deviceId, 0);
    }
    return;
  }

  const subs = deviceSubscribers.get(deviceId);
  if (subs.size === 0) {
    const oldLevel = deviceMaxLevel.get(deviceId);
    deviceMaxLevel.delete(deviceId);
    if (oldLevel !== undefined) {
      notifyDeviceLevel(deviceId, 0);
    }
    return;
  }

  let maxLevel = 0;
  for (const level of subs.values()) {
    if (level > maxLevel) maxLevel = level;
  }

  const oldLevel = deviceMaxLevel.get(deviceId);
  deviceMaxLevel.set(deviceId, maxLevel);

  if (maxLevel !== oldLevel) {
    notifyDeviceLevel(deviceId, maxLevel);
  }
}

function notifyDeviceLevel(deviceId, level) {
  for (const client of wssClient.clients) {
    if (client._deviceId === deviceId && client.readyState === 1) {
      client.send(JSON.stringify({ type: 'setLevel', level: level }));
      break;
    }
  }
}

function subscribeLevel(deviceId, ws, level) {
  if (!deviceSubscribers.has(deviceId)) {
    deviceSubscribers.set(deviceId, new Map());
  }
  deviceSubscribers.get(deviceId).set(ws, level);
  updateLevel(deviceId);
}

function unsubscribeLevel(deviceId, ws) {
  if (!deviceSubscribers.has(deviceId)) return;
  deviceSubscribers.get(deviceId).delete(ws);
  updateLevel(deviceId);
}

function unsubscribeAllLevel(ws) {
  for (const [deviceId, subs] of deviceSubscribers) {
    if (subs.delete(ws)) {
      updateLevel(deviceId);
    }
  }
}

function sendBinaryScreenshot(ws, frameType, deviceId, webpBuffer, screenWidth, screenHeight, isHQ) {
  if (ws.readyState !== 1 || !webpBuffer || webpBuffer.length === 0) return;
  try {
    const devIdBytes = Buffer.from(deviceId, 'utf8');
    const header = Buffer.alloc(8 + devIdBytes.length);
    header[0] = frameType;
    header[1] = devIdBytes.length;
    header[2] = isHQ ? 0x01 : 0x00;
    header[3] = 0x00;
    header.writeUInt16BE(screenWidth || 0, 4);
    header.writeUInt16BE(screenHeight || 0, 6);
    devIdBytes.copy(header, 8);
    ws.send(Buffer.concat([header, webpBuffer]));
  } catch(e) {}
}

// 帧率间隔（毫秒）
const FRAME_INTERVAL_MOBILE = 500; // 2fps
const FRAME_INTERVAL_INTERNAL = 83;  // ~12fps（内网节流）
const FRAME_INTERVAL_EXTERNAL = 333; // ~3fps

// 报警截图查重缓存（存储最近一张 640×360 截图）
const alarmPrevCache = new Map(); // deviceId -> { md5, time }
const GRID_PERSIST_PATH = path.join(__dirname, 'grid-layout.json');
const GRID_SIZE_PATH = path.join(__dirname, 'grid-size.json');
try {
  const raw = fs.readFileSync(GRID_PERSIST_PATH, 'utf8');
  gridLayout = JSON.parse(raw);
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

async function persistTasks() {
  try {
    await fsWriteFile(TASKS_PERSIST_PATH, JSON.stringify(tasks, null, 2), 'utf8');
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
async function saveFavorites() {
  try {
    await fsWriteFile(FAVORITES_PATH, JSON.stringify(favorites, null, 2), 'utf8');
  } catch (e) {
    serverError('[ScreenWall] 保存收藏数据失败:', e.message);
  }
}

// 保存截图集合
async function saveCollections() {
  try {
    const obj = Object.fromEntries(collections);
    await fsWriteFile(COLLECTIONS_PATH, JSON.stringify(obj, null, 2), 'utf8');
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
    // MUMU后台微服务：持久化时忽略，不加载到设备列表
    if (d.deviceId === 'MUMU-service') {
      continue;
    }
    d.online = false;  // 重启后所有设备视为离线
    d.lastSeen = d.lastSeen || Date.now();
    devices.set(d.deviceId, d);
  }
  // 服务端重启时无法判断哪些设备当时在线，统一标记离线，等客户端重连时自然触发上线
  for (const d of devices.values()) { d.online = false; }
} catch (e) {}

// ========== 工具函数 ==========
async function persistGrid() {
  try {
    await fsWriteFile(GRID_PERSIST_PATH, JSON.stringify(gridLayout, null, 2), 'utf8');
  } catch (e) { serverError('Grid布局持久化失败:', e.message); }
}

async function persistGridSize() {
  try {
    await fsWriteFile(GRID_SIZE_PATH, JSON.stringify(gridSizeSetting), 'utf8');
  } catch (e) { serverError('布局大小持久化失败:', e.message); }
}

async function persistGroups() {
  try {
    await fsWriteFile(GROUPS_PERSIST_PATH, JSON.stringify(groups, null, 2), 'utf8');
  } catch (e) { serverError('分组持久化失败:', e.message); }
}

async function persistDevices() {
  try {
    const arr = Array.from(devices.values())
      .filter(d => d.deviceId !== 'MUMU-service')  // 排除MUMU，不持久化
      .map(d => ({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        uuDeviceId: d.uuDeviceId,
        macAddress: d.macAddress || null,
        lastSeen: d.lastSeen,
        groupId: d.groupId || null,
        monitorIndex: d.monitorIndex || 1,
        monitorCount: d.monitorCount || 1,
        screenWidth: d.screenWidth || null,
        screenHeight: d.screenHeight || null,
        // 持久化时 Buffer 转 base64（避免存成巨大数组），加载后直接可用
        screenshot: d.screenshot ? (Buffer.isBuffer(d.screenshot) ? 'data:image/webp;base64,' + d.screenshot.toString('base64') : d.screenshot) : null,
      }));
    await fsWriteFile(DEVICES_PERSIST_PATH, JSON.stringify(arr, null, 2), 'utf8');
  } catch (e) { serverError('[设备] 持久化失败:', e.message); }
}

async function persistAlarmRecords() {
  try {
    await fsWriteFile(ALARM_RECORDS_PATH, JSON.stringify(alarmRecords, null, 2), 'utf8');
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

async function persistPowerScenes() {
  try {
    await fsWriteFile(POWER_SCENES_PATH, JSON.stringify(powerScenes, null, 2), 'utf8');
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
async function cleanupOrphaned1080pScreenshotsAsync() {
  try {
    let files;
    try {
      files = await fsReaddir(ALARM_SCREENSHOTS_DIR);
    } catch (e) {
      return;
    }
    const validScreenshotIds = new Set(alarmRecords.map(r => r.screenshotId).filter(Boolean));
    for (const file of files) {
      // 只清理不在 alarmRecords 中的截图文件（这些是延迟到达的1080P截图）
      if (!validScreenshotIds.has(file.replace('.png', ''))) {
        try {
          const filePath = path.join(ALARM_SCREENSHOTS_DIR, file);
          const stat = await fsStat(filePath);
          // 超过 2 小时仍未被 alarmRecords 引用的文件，删除（说明匹配失败）
          if (Date.now() - stat.mtimeMs > 2 * 60 * 60 * 1000) {
            await fsUnlink(filePath);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
}
function cleanupOrphaned1080pScreenshots() {
  cleanupOrphaned1080pScreenshotsAsync();
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
    const fixedBuffer = await sharp(imageBuffer)
      .withMetadata({ density: 72 })
      .png()
      .toBuffer();
    
    const result = await Tesseract.recognize(fixedBuffer, 'chi_sim', {
      logger: (m) => {
        if (m.status === 'loading language traineddata') {
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
        client.send(JSON.stringify({ type: 'requestHdScreenshot', purpose: 'alarm', timestamp: now }));
        break;
      }
    }
  }
  
  // 10. 临时保存 640×360 截图（等 1080P 回来后替换）
  const screenshotId = crypto.randomUUID();
  const screenshotPath = path.join(ALARM_SCREENSHOTS_DIR, `${screenshotId}.png`);
  await fsWriteFile(screenshotPath, imageBuffer);
  
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
  await persistAlarmRecords();
  
  serverLog(`[报警] ${deviceInfo.deviceName} 触发报警 (第${occurrenceCount}次)`);
  
  // 更新状态为查重阶段
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
    .filter(d => d.deviceId !== 'MUMU-service')  // 排除MUMU，不显示在浏览器中
    .sort((a, b) => a.deviceName.localeCompare(b.deviceName, 'zh-CN'))
    .map(d => {
      const perms = devicePermissions[d.deviceId] || { allowScreenWall: false, allowSelfService: false };
      return {
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        uuDeviceId: d.uuDeviceId,
        macAddress: d.macAddress || null,
        online: d.online,
        lastSeen: d.lastSeen,
        screenshot: d.screenshot ? (Buffer.isBuffer(d.screenshot) ? 'data:image/webp;base64,' + d.screenshot.toString('base64') : d.screenshot) : null,
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
        permissions: perms,
      };
    });
}

function getGridPayload(gridSize) {
  const total = 200;
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
      screenshot: dev && dev.screenshot ? (Buffer.isBuffer(dev.screenshot) ? 'data:image/webp;base64,' + dev.screenshot.toString('base64') : dev.screenshot) : null,
    });
  }
  return cells;
}

// 渲染优化：批量发送（16ms批次）
let renderBatch = []; // 待发送消息队列
let renderTimer = null;

function broadcastToBrowsers(data, forceAll = false) {
  // 非截图消息也需要检查浏览器连接状态
  if (data.type !== 'screenshot') {
    if (browserClients.size === 0) {
      return;
    }
  }
  
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
  renderTimer = null;
  if (renderBatch.length === 0) return;
  
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
  
  renderBatch = [];
  
  // 发送截图批量消息
  const screenshotList = Object.values(screenshots);
  if (screenshotList.length > 0) {
    const msg = JSON.stringify({ type: 'screenshotBatch', screenshots: screenshotList });
    for (const ws of browserClients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch (e) { /* ignore */ }
      }
    }
  }
  
  // 发送其他消息（非截图消息直接发送，确保及时性）
  for (const data of others) {
    const msg = JSON.stringify(data);
    for (const ws of browserClients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch (e) { /* ignore */ }
      }
    }
  }
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

// 统一广播所有配置中心相关数据（分组、开关机、设备列表）
function broadcastAllConfigUpdates() {
  const deviceListPayload = getDeviceListPayload();
  broadcastToBrowsers({ type: 'deviceList', devices: deviceListPayload });
  broadcastToBrowsers({ type: 'groups', groups: groups });
  broadcastToBrowsers({ type: 'powerScenes', powerScenes: powerScenes });
  notifyWallClients('configChanged', {});
}

// 通知所有监控墙窗口状态变化
function notifyWallClients(eventType, data) {
  // 处理 screenshot Buffer -> base64
  const processedData = { ...data };
  if (processedData.screenshot && Buffer.isBuffer(processedData.screenshot)) {
    processedData.screenshot = 'data:image/webp;base64,' + processedData.screenshot.toString('base64');
  }
  let msg;
  try {
    msg = JSON.stringify({ type: 'wallStateUpdate', eventType, ...processedData, devices: getDeviceListPayload(), groups: groups });
  } catch (e) {
    serverError(`[Wall] notifyWallClients stringify failed: ${e.message}`);
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
  // 不再需要内层定义 sendBinaryScreenshot，统一使用顶层函数

  ws.on('message', async (raw) => {
  // ── 二进制截图帧（客户端直接发 WebP Buffer，无 Base64）──
    if (Buffer.isBuffer(raw) && raw.length > 8) {
      const frameType = raw[0];
      if (frameType === 0x01 && raw[1] > 0) {
        try {
          const devIdLen = raw[1];
          const flags = raw[2];
          const isHQ = (flags & 0x01) !== 0;
          const screenWidth = raw.readUInt16BE(4);
          const screenHeight = raw.readUInt16BE(6);
          const deviceId = raw.slice(8, 8 + devIdLen).toString('utf8');
          const webpBuffer = raw.slice(8 + devIdLen);
          let dev = devices.get(deviceId);
          if (!dev) return;
          dev.screenshot = webpBuffer;
          dev.screenWidth = screenWidth;
          dev.screenHeight = screenHeight;
          dev._frameCount = (dev._frameCount || 0) + 1;
          const now = Date.now();
          dev.lastSeen = now;
          if (!dev.online) { dev.online = true; broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() }); }
          
          // 立即转发：废弃批量推送，收到帧后直接转发给所有订阅的浏览器
          for (const browserWs of browserClients) {
            if (browserWs.readyState !== 1) continue;
            
            // 帧率节流检查（每个连接独立）
            let frameInterval = FRAME_INTERVAL_INTERNAL;
            if (browserWs._isMobile) {
              frameInterval = FRAME_INTERVAL_MOBILE;
            } else if (!browserWs._isInternal) {
              frameInterval = FRAME_INTERVAL_EXTERNAL;
            }
            
            const lastTime = browserWs._lastFrameTime.get(deviceId) || 0;
            if (now - lastTime < frameInterval) continue;
            browserWs._lastFrameTime.set(deviceId, now);
            
            // 检查视口订阅
            const vpData = viewportSubscriptions.get(browserWs);
            if (vpData && !wallClients.has(browserWs)) {
              if (!vpData.deviceIds.has(deviceId)) continue;
            }
            
            // 非预览、非监控墙的普通浏览器才推送
            if (!previewClients.has(browserWs) && !wallClients.has(browserWs)) {
              sendBinaryScreenshot(browserWs, 0x10, deviceId, webpBuffer, screenWidth, screenHeight, isHQ);
            }
          }
          
          // 监控墙立即推送
          if (monitorWallDevices.has(deviceId)) {
            for (const wallWs of wallClients) {
              if (wallWs.readyState !== 1) continue;
              const lastTime = wallWs._lastFrameTime.get(deviceId) || 0;
              if (now - lastTime < FRAME_INTERVAL_INTERNAL) continue;
              wallWs._lastFrameTime.set(deviceId, now);
              sendBinaryScreenshot(wallWs, 0x10, deviceId, webpBuffer, screenWidth, screenHeight, isHQ);
            }
          }
          
          // 预览客户端立即推送
          for (const [pw, pi] of previewClients) {
            if (pi.deviceId === deviceId && pw.readyState === 1) {
              sendBinaryScreenshot(pw, 0x10, deviceId, webpBuffer, screenWidth, screenHeight, isHQ);
            }
          }
        } catch(e) { serverError('[二进制帧] 解析失败:', e.message); }
        return;
      }
    }
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { 
      serverLog(`[设备消息] JSON解析失败: ${e.message}, raw长度: ${raw.length}`);
      return; 
    }
    
    try {
      await (async () => {
        
        if (msg.type === 'register') {
      const incomingUU = String(msg.uuDeviceId || '');
      const incomingDeviceId = String(msg.deviceId || '');

      // MUMU后台微服务：正常处理，只是不持久化和不显示在浏览器设备列表中
      const isMUMU = incomingDeviceId === 'MUMU-service';
      if (isMUMU) {
        serverLog(`[MUMU] 模拟器微服务已上线`);
        muServiceOnline = true;
      }

      // deviceId 为空：不创建设备，只发安装指令，等UU装完重新上线
      if (!incomingDeviceId) {
        serverLog(`[UU升级] 设备 ${msg.deviceName} deviceId为空，通知客户端安装UU v${SERVER_CONFIG.uuVersion || '?'}`);
        ws.send(JSON.stringify({ type: 'registered', deviceId: '', installUU: true, uuDownloadUrl: SERVER_CONFIG.uuDownloadUrl || '' }));
        return;
      }

      // deviceId 不为空：正常创建设备逻辑
      // 唯一标识：先用 deviceId 查找，找不到则尝试 deviceName + MAC 地址匹配
      let existing = null;
      let matchedOldDeviceId = null;  // 记录匹配到的旧设备ID（用于删除旧记录）
      if (incomingDeviceId) {
        existing = devices.get(incomingDeviceId) || null;
      }

      // 如果没找到，尝试用 deviceName + MAC 地址查找（用于设备重装后识别同一设备）
      const incomingMac = String(msg.macAddress || '').trim().toLowerCase();
      const incomingName = String(msg.deviceName || '').trim();
      if (!existing && incomingMac && incomingName) {
        for (const [devId, devInfo] of devices) {
          const devMac = String(devInfo.macAddress || '').trim().toLowerCase();
          const devName = String(devInfo.deviceName || '').trim();
          // MAC 地址匹配且设备名相同（或设备名包含关系）
          if (devMac === incomingMac && (devName === incomingName || devName.includes(incomingName) || incomingName.includes(devName))) {
            existing = devInfo;  // 继承旧设备的所有信息
            matchedOldDeviceId = devId;  // 记录旧设备ID，后面要删除
            break;
          }
        }
      }

      // 确定最终 deviceId（始终使用客户端上报的新 deviceId）
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
        macAddress: incomingMac || (existing && existing.macAddress) || '',
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
      ws._isMUMU = isMUMU;  // 标记是否是MUMU设备
      const wasOffline = !existing || !existing.online;
      if (wasOffline && !isMUMU) {  // MUMU已经打印了上线日志
        const kbTag = msg.supportsKeyClient ? '远控' : '—';
        serverLog(`[+] 上线: ${newDev.deviceName} (${deviceId}) uuId=${newDev.uuDeviceId} | IP: ${ip} | ${kbTag} | 显示器${newDev.monitorIndex} | ${newDev.screenWidth || '?'}×${newDev.screenHeight || '?'}`);
      }
      // 如果匹配到了旧设备，统一迁移所有关联数据，然后删除旧记录
      if (matchedOldDeviceId && matchedOldDeviceId !== deviceId) {
        devices.delete(matchedOldDeviceId);
        await migrateDeviceId(matchedOldDeviceId, deviceId);
      }

      await persistDevices();  // 持久化设备列表
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
      broadcastToBrowsers({ type: 'grid', cells: getGridPayload() });
      broadcastToBrowsers({ type: 'groups', groups });
      broadcastToBrowsers({ type: 'powerScenes', powerScenes });
      // 广播 collections（截图集合），格式与 saveCollections() 保持一致
      const _migCollectionsArr = [];
      for (const [timestamp, items] of collections) {
        _migCollectionsArr.push({ timestamp, items });
      }
      _migCollectionsArr.sort((a, b) => b.timestamp - a.timestamp);
      broadcastToBrowsers({ type: 'collectionsUpdate', collections: _migCollectionsArr });
      broadcastToBrowsers({ type: 'favorites', favorites });

      // 设备上线时，根据 deviceSubscribers 中保存的订阅关系恢复正确的 level
      if (deviceSubscribers.has(deviceId)) {
        const subs = deviceSubscribers.get(deviceId);
        let maxLevel = 0;
        for (const level of subs.values()) {
          if (level > maxLevel) maxLevel = level;
        }
        if (maxLevel > 0) {
          notifyDeviceLevel(deviceId, maxLevel);
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

    // MUMU设备断开通知
    if (msg.type === 'deviceOffline' && msg.deviceId) {
      serverLog(`[MUMU] 模拟器已断开连接`);
    }

    // MUMU设备重连上线通知
    if (msg.type === 'deviceOnline' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      if (dev) {
        if (msg.screenWidth) dev.screenWidth = msg.screenWidth;
        if (msg.screenHeight) dev.screenHeight = msg.screenHeight;
        dev.online = true;
        dev.lastSeen = Date.now();
        serverLog(`[MUMU] 模拟器已重新连接 (${dev.screenWidth}x${dev.screenHeight})`);
      } else {
        serverLog(`[MUMU] 模拟器已重新连接`);
      }
    }

    // 高清截图（统一消息类型，根据 purpose 分发）
    if (msg.type === 'hdScreenshot' && msg.deviceId && msg.image) {
      const dev = devices.get(msg.deviceId);
      if (!dev) return;
      
      const { purpose, timestamp, deviceId, image, businessId, businessName, operatorId, operatorName } = msg;
      
      if (purpose === 'selfService') {
        (async () => {
          try {
            const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            // 从保存的状态中获取参数，或者使用消息中携带的参数
            const state = selfServiceStateByBusinessId.get(businessId || deviceId);
            const actualBusinessId = businessId || deviceId;
            const actualOperatorId = operatorId || (state ? state.operatorId : null);
            const actualOperatorName = operatorName || (state ? state.operatorName : null);
            const actualBusinessName = businessName || (state ? state.businessName : null);
            const actualClickTimestamp = timestamp || (state ? state.clickTimestamp : null);
            
            await processQrcodeImage(buffer, actualBusinessId, actualOperatorId, actualOperatorName, actualBusinessName, actualClickTimestamp);
          } catch (e) {
            serverError('[二维码] 处理自助登号截图失败:', e.message);
          }
        })();
        return;
      }
      
      if (purpose === 'collection') {
        // 收藏截图
        const fav = favorites.find(f => f.deviceId === deviceId);
        if (!fav) {
          serverLog(`[收藏] 收到未收藏设备 ${deviceId} 的截图，忽略`);
        } else if (image && image.length >= 100) {
          const groupName = getGroupNameForDevice(deviceId);
          const cellIndex = getCellIndexForDevice(deviceId);
          const online = dev.online;
          
          (async () => {
            try {
              const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              const compressed = await sharp(buffer)
                .resize(480, 270, { fit: 'cover' })
                .webp({ quality: 30, effort: 4 })
                .toBuffer();
              const thumbnail = 'data:image/webp;base64,' + compressed.toString('base64');
              if (!collections.has(timestamp)) {
                collections.set(timestamp, []);
              }
              const items = collections.get(timestamp);
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
                timestamp: timestamp
              };
              if (existingIdx >= 0) {
                items[existingIdx] = newItem;
              } else {
                items.push(newItem);
              }
              await saveCollections();
              const collectionsArr = [];
              collections.forEach((its, ts) => {
                collectionsArr.push({ timestamp: ts, items: its });
              });
              collectionsArr.sort((a, b) => b.timestamp - a.timestamp);
              broadcastToBrowsers({ type: 'collectionsUpdate', collections: collectionsArr });
            } catch (e) {}
          })();
        }
      } else if (purpose === 'alarm') {
        // 高清报警截图
        (async () => {
          const imageData = image;
          let matchedRecord = alarmRecords.find(r =>
            r.deviceId === deviceId && r.timestamp === timestamp
          );
          
          if (matchedRecord) {
            const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            await fsWriteFile(matchedRecord.screenshotPath, imgBuffer);
            matchedRecord.isFullScreenshot = true;
          } else {
            matchedRecord = alarmRecords.find(r =>
              r.deviceId === deviceId && !r.isFullScreenshot
            );
            
            if (matchedRecord) {
              const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
              await fsWriteFile(matchedRecord.screenshotPath, imgBuffer);
              matchedRecord.isFullScreenshot = true;
            } else {
              const screenshotId = crypto.randomUUID();
              const screenshotPath = path.join(ALARM_SCREENSHOTS_DIR, `${screenshotId}.png`);
              const imgBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
              await fsWriteFile(screenshotPath, imgBuffer);
            }
          }
        })();
      }
    }

    if (msg.type === 'heartbeat' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      if (dev) {
        dev.lastSeen = Date.now();
        dev.online = true;
        const now = Date.now();

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
        dev.supportsKeyClient = !!msg.supportsKeyClient;
        // 广播键盘支持状态变更
        broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
        
        // 保存屏幕分辨率（统一获取，不判断键盘状态）
        if (msg.screenWidth && msg.screenHeight) {
          dev.screenWidth = msg.screenWidth;
          dev.screenHeight = msg.screenHeight;
        }
        
        // 心跳响应：告诉客户端是否有新版本 / 降级通知
        const clientVersion = dev.version || '0.0.0';
        let needsUpdate = false;
        
        // 检测是否为降级版本（版本号以 L 结尾，例如 "1.9.2L"）
        const serverVersionRaw = SERVER_CONFIG.serverVersion || '';
        const isDowngrade = serverVersionRaw.endsWith('L');
        const cleanServerVersion = isDowngrade ? serverVersionRaw.slice(0, -1) : serverVersionRaw;
        
        if (isDowngrade) {
          // 降级逻辑：客户端 == 降级版本才执行降级
          //  客户端 > 降级版本 → 不降级（可能在测试新版）
          //  客户端 < 降级版本 → 不降级（已经降级了）
          //  客户端 == 降级版本 → 执行降级
          needsUpdate = clientVersion === cleanServerVersion;
          if (needsUpdate) {
            serverLog(`[降级] ${dev.deviceName} 降级到 ${cleanServerVersion}以下（当前 ${clientVersion}），通知客户端下载...`);
          }
        } else {
          // 正常升级逻辑
          const [cMajor, cMinor, cPatch] = clientVersion.split('.').map(Number);
          const [sMajor, sMinor, sPatch] = cleanServerVersion.split('.').map(Number);
          needsUpdate = cMajor < sMajor || (cMajor === sMajor && cMinor < sMinor) || (cMajor === sMajor && cMinor === sMinor && cPatch < sPatch);
          if (needsUpdate) {
            serverLog(`[升级] ${dev.deviceName} 有新版本 ${serverVersionRaw}（当前 ${clientVersion}），通知客户端下载...`);
          }
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

        // 【合并修复】心跳中附带的报警截图，发送到 Worker Thread 处理
        const alarmImgData = msg.alarmScreenshot;
        if (alarmImgData) {
          const imgBuffer = Buffer.from(alarmImgData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
          const state = alarmStates.get(dev.deviceId);
          const templateBuffer = state?.templateBuffer || null;
          const templateRegion = state?.templateRegion || null;
          sendAlarmToWorker(dev.deviceId, imgBuffer, templateBuffer, templateRegion);
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

    if (msg.type === 'alarm' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      
      // 获取图片数据
      const imageData = msg.image;
      if (!imageData) return;
      
      // 转换 base64 为 buffer，发送到 Worker Thread 处理
      const imageBuffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const state = alarmStates.get(msg.deviceId);
      const templateBuffer = state?.templateBuffer || null;
      const templateRegion = state?.templateRegion || null;
      sendAlarmToWorker(msg.deviceId, imageBuffer, templateBuffer, templateRegion);
    }  // end if alarm

    if (msg.type === 'cameraClicked') {
      const { businessId, businessName, x, y, timestamp, deviceId: operatorId, deviceName: operatorName } = msg;
      
      if (!businessId) {
        return;
      }
      
      const businessDev = devices.get(businessId);
      if (!businessDev) {
        serverLog(`[自助登号] 找不到业务ID对应的设备: ${businessId}`);
        return;
      }
      
      if (!businessDev.online) {
        serverLog(`[自助登号] 业务设备不在线: ${formatDeviceName(businessDev.deviceName, businessId)}`);
        return;
      }
      
      // 从devices字典中获取设备名称，确保即使收到的名称为空也能正确显示
      const operatorDev = operatorId ? devices.get(operatorId) : null;
      const finalOperatorName = operatorName || (operatorDev ? operatorDev.deviceName : operatorId);
      const finalBusinessName = businessName || businessDev.deviceName;
      
      const clickTimestamp = timestamp || Date.now();
      
      // 清除之前可能存在的该业务设备的状态
      clearSelfServiceState(businessId);
      
      // 保存当前状态（按业务设备ID存储）
      const state = {
        operatorId: operatorId,
        operatorName: finalOperatorName,
        businessName: finalBusinessName,
        mumuClient: ws,
        clickTimestamp: clickTimestamp,
        timeoutId: null
      };
      selfServiceStateByBusinessId.set(businessId, state);
      
      // 设置超时
      state.timeoutId = setTimeout(() => {
        const isSameDevice = state.operatorId === businessId;
        
        serverLog(isSameDevice 
          ? `[自助登号] ${formatDeviceName(state.operatorName, state.operatorId)}使用二维码扫码（超时）` 
          : `[自助登号] ${formatDeviceName(state.operatorName, state.operatorId)}帮助${formatDeviceName(state.businessName, businessId)}使用二维码扫码（超时）`);
        
        clearSelfServiceState(businessId);
      }, SELF_SERVICE_TIMEOUT_MS);
      
      // 向业务设备请求1080P截图（携带所有四个参数）
      for (const client of wssClient.clients) {
        if (client._deviceId === businessId && client.readyState === 1) {
          client.send(JSON.stringify({ 
            type: 'requestHdScreenshot', 
            purpose: 'selfService',
            timestamp: clickTimestamp,
            businessId: businessId,
            businessName: finalBusinessName,
            operatorId: operatorId,
            operatorName: finalOperatorName
          }));
          break;
        }
      }
    }

    if (msg.type === 'acceptTask' && msg.taskId) {
      // 客户端接受任务：{ taskId, deviceId }
      const task = tasks.find(t => t.id === msg.taskId);
      if (task && !task.accepted && !task.revoked) {
        task.accepted = true;
        task.acceptedAt = Date.now();
        await persistTasks();
        broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
      }
    }
      })();
    } catch (err) {
      serverError(`[设备消息] 处理消息 ${msg.type} 时发生未捕获错误: ${err.message}`, err.stack);
    }
  });

  ws.on('close', () => {
    try {
      // 如果是MUMU服务
      if (ws._isMUMU) {
        const deviceId = ws._deviceId;
        if (deviceId && devices.has(deviceId)) {
          const dev = devices.get(deviceId);
          dev.online = false;
          serverLog(`[MUMU] 模拟器微服务已离线`);
          broadcastToBrowsers({ type: 'mumuOffline', deviceId });
          devices.delete(deviceId);
        }
        muServiceOnline = false;
        restartMuService();
        return;
      }
      
      // 正常设备离线处理
      const deviceId = ws._deviceId;
      if (deviceId && devices.has(deviceId)) {
        const dev = devices.get(deviceId);
        dev.online = false;
        serverLog(`[-] 离线: ${dev.deviceName}`);
        persistDevices();  // 设备离线时持久化
        broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
        // 广播设备预览状态变更（让所有浏览器刷新预览大图），带上最新截图避免批次延迟问题
        const offlineScreenshot = dev.screenshot ? (Buffer.isBuffer(dev.screenshot) ? 'data:image/webp;base64,' + dev.screenshot.toString('base64') : dev.screenshot) : null;
        broadcastToBrowsers({ type: 'devicePreviewStatus', deviceId, status: 'offline', screenshot: offlineScreenshot });
        // 通知监控墙设备离线，带上截图
        notifyWallClients('deviceOffline', { deviceId, screenshot: dev.screenshot || null, supportsKeyClient: dev.supportsKeyClient || false });
        updateCollectionsDeviceStatus(deviceId, {});
      }
    } catch (err) {
      serverError(`[设备离线] ws.on('close') 未捕获错误: ${err.message}`);
    }
  });

  ws.on('error', () => ws.close());
});

// 检测是否为内网IP
function isInternalIP(ip) {
  if (!ip) return false;
  // 10.x.x.x
  if (ip.startsWith('10.')) return true;
  // 192.168.x.x
  if (ip.startsWith('192.168.')) return true;
  // 172.16.x.x - 172.31.x.x
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    const second = parseInt(parts[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // 127.x.x.x (本地)
  if (ip.startsWith('127.')) return true;
  return false;
}

// 浏览器连接
wssBrowser.on('connection', (ws, req) => {
  browserClients.add(ws);
  ws._lastPing = Date.now();  // 用于计算延迟
  ws._lastPingTs = 0; // 记录最新发出的 ping timestamp，防止旧 pong 乱序导致延迟虚高

  // 获取客户端IP并存储
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  ws._clientIp = ip;
  ws._isInternal = isInternalIP(ip);
  ws._isMobile = false; // 移动端模式标记
  ws._lastFrameTime = new Map(); // deviceId -> last push timestamp(ms)

  // 立即发送第一个 ping
  if (ws.readyState === 1) {
    ws._lastPingTs = Date.now();
    ws.send(JSON.stringify({ type: 'ping', timestamp: ws._lastPingTs }));
  }

  // 定期向浏览器发送 ping，浏览器响应 pong
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws._lastPingTs = Date.now();
      ws.send(JSON.stringify({ type: 'ping', timestamp: ws._lastPingTs }));
    }
  }, 5000);

  ws.on('close', () => {
    clearInterval(pingInterval);
    browserClients.delete(ws);
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {

    // 浏览器响应 pong，计算延迟（忽略过期pong，防止乱序导致延迟虚高）
    if (msg.type === 'pong' && msg.clientTimestamp) {
      // 如果 pong 的 timestamp 和上次发出的 ping 对不上，说明是旧 pong，直接丢弃
      if (msg.clientTimestamp !== ws._lastPingTs) return;
      const latency = Date.now() - msg.clientTimestamp;
      ws._latency = latency;
      ws._lastPing = Date.now();
      // 将延迟信息广播给所有浏览器
      broadcastToBrowsers({ type: 'latency', latency });
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
      // 鼠标点击：{ deviceId, operatorId, operatorName, businessId, businessName, x, y, previewWidth, previewHeight }
      // x,y 是浏览器预览画面坐标，previewWidth/Height 是预览时的分辨率（可能已过时）
      // 服务端用自己最新的 dev.screenWidth/screenHeight（心跳频繁更新）校正坐标
      const { deviceId: mDevId, operatorId, operatorName, businessId, businessName, x, y, previewWidth, previewHeight } = msg;
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

      // MU服务不加显示器偏移量
      if (mDevId !== 'MUMU-service') {
        // 加显示器偏移量得到虚拟桌面坐标
        actualX += dev.monitorOffsetX || 0;
        actualY += dev.monitorOffsetY || 0;
      }

      // 获取业务设备名称
      const businessDev = devices.get(businessId);
      const finalBusinessName = businessDev ? businessDev.deviceName : (businessName || businessId || '');

      for (const client of wssClient.clients) {
        if (client._deviceId === mDevId && client.readyState === 1) {
          client.send(JSON.stringify({ 
            type: 'mouseClick', 
            x: actualX, 
            y: actualY, 
            deviceId: mDevId, 
            deviceName: dev.deviceName,
            operatorId: operatorId,
            operatorName: operatorName,
            businessId: businessId,
            businessName: finalBusinessName
          }));
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

      // MU服务不加显示器偏移量
      if (mDevId !== 'MUMU-service') {
        actualX += dev.monitorOffsetX || 0;
        actualY += dev.monitorOffsetY || 0;
      }

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

    // 鼠标滑动操作
    if (msg.type === 'mouseSwipe') {
      const { deviceId: mDevId, x, y, x2, y2, previewWidth, previewHeight, duration } = msg;
      if (!mDevId) return;
      const dev = devices.get(mDevId);
      if (!dev || !dev.online) return;

      let actualX, actualY, actualX2, actualY2;
      const devW = dev.screenWidth || 1920;
      const devH = dev.screenHeight || 1080;

      if (previewWidth === devW && previewHeight === devH) {
        actualX = x;
        actualY = y;
        actualX2 = x2;
        actualY2 = y2;
      } else {
        const pw = previewWidth || devW;
        const ph = previewHeight || devH;
        actualX = Math.round((x / pw) * devW);
        actualY = Math.round((y / ph) * devH);
        actualX2 = Math.round((x2 / pw) * devW);
        actualY2 = Math.round((y2 / ph) * devH);
      }

      // MU服务不加显示器偏移量
      if (mDevId !== 'MUMU-service') {
        actualX += dev.monitorOffsetX || 0;
        actualY += dev.monitorOffsetY || 0;
        actualX2 += dev.monitorOffsetX || 0;
        actualY2 += dev.monitorOffsetY || 0;
      }

      for (const client of wssClient.clients) {
        if (client._deviceId === mDevId && client.readyState === 1) {
          client.send(JSON.stringify({ type: 'mouseSwipe', x: actualX, y: actualY, x2: actualX2, y2: actualY2, duration: duration || 300 }));
          break;
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
      await persistAlarmRecords();
      
      // 清除所有报警截图文件
      (async () => {
        try {
          let files;
          try {
            files = await fsReaddir(ALARM_SCREENSHOTS_DIR);
          } catch (e) {
            return;
          }
          for (const file of files) {
            try {
              await fsUnlink(path.join(ALARM_SCREENSHOTS_DIR, file));
            } catch (e) {
              serverError(`[报警] 删除截图失败: ${file}`, e.message);
            }
          }
        } catch (e) {}
      })();
      
      broadcastToBrowsers({ type: 'alarmsCleared' });
    }

    if (msg.type === 'viewAlarm') {
      // 标记报警记录为已查看，并广播给所有浏览器
      const { alarmId } = msg;
      const rec = alarmRecords.find(r => r.id === alarmId);
      if (rec) {
        rec.viewed = true;
        await persistAlarmRecords();
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
      await persistTasks();
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
      await persistTasks();
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
      await persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
    }

    if (msg.type === 'deleteDeviceTasks') {
      // 删除某设备所有任务记录：{ deviceId }
      const { deviceId: tDevId } = msg;
      tasks = tasks.filter(t => t.deviceId !== tDevId);
      await persistTasks();
      broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
    }

    if (msg.type === 'deleteAllTasks') {
      // 删除所有任务记录
      tasks = [];
      await persistTasks();
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
        await persistGridSize();
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
      
      await persistGrid();

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
      await persistGrid();
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
              await saveFavorites();
              broadcastToBrowsers({ type: 'favorites', favorites });
            }
          } else {
            // 添加或更新收藏
            if (idx >= 0) {
              favorites[idx] = { deviceId, deviceName, groupId, cellIndex };
            } else {
              favorites.push({ deviceId, deviceName, groupId, cellIndex });
            }
            await saveFavorites();
            broadcastToBrowsers({ type: 'favorites', favorites });
          }
        }
      } else if (msg.path === '/api/collections/screenshot') {
        const timestamp = Date.now();
        const favoriteDeviceIds = favorites.map(f => f.deviceId);
        if (favoriteDeviceIds.length === 0) {
          ws.send(JSON.stringify({ ok: false, error: '没有收藏的设备' }));
          return;
        }
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
        for (const client of wssClient.clients) {
          if (client.readyState === 1 && onlineFavoriteDeviceIds.includes(client._deviceId)) {
            client.send(JSON.stringify({
              type: 'requestHdScreenshot',
              purpose: 'collection',
              timestamp
            }));
          }
        }
        ws.send(JSON.stringify({ ok: true, timestamp }));
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
          await saveCollections();
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
            await saveCollections();
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
        // 同步更新 devices 中的 groupId
        for (const dev of devices.values()) {
          let found = false;
          for (const g of groups) {
            if (g.deviceIds && g.deviceIds.includes(dev.deviceId)) {
              dev.groupId = g.id;
              found = true;
              break;
            }
          }
          if (!found) {
            dev.groupId = null;
          }
        }
        await persistGroups();
        await persistDevices();
        broadcastAllConfigUpdates();
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
        await persistDevices();
        // 同步更新报警记录里的设备名
        for (const r of alarmRecords) {
          if (r.deviceId === deviceId) r.deviceName = deviceName;
        }
        await persistAlarmRecords();
        // 同步更新任务记录里的设备名
        let taskChanged = false;
        for (const t of tasks) {
          if (t.deviceId === deviceId) { t.deviceName = deviceName; taskChanged = true; }
        }
        if (taskChanged) {
          await persistTasks();
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
        // 使用统一的删除函数
        const { deviceName: deletedDeviceName } = await deleteDeviceCompletely(deviceId);
        
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
        // 广播任务更新
        broadcastToBrowsers({ type: 'tasksUpdate', tasks: getTasksPayload() });
        broadcastToBrowsers({ type: 'powerScenes', powerScenes });
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
            serverLog(`[Monitor] 服务端切换 ${dev.deviceName} → 显示器 ${monitorIdx}`);
            broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
            notifyWallClients('monitorSwitched', { deviceId: targetId, monitorIndex: monitorIdx });
          } else {
            ws.send(JSON.stringify({ type: 'switchMonitorResult', success: false, reason: 'device offline' }));
          }
        } else {
          ws.send(JSON.stringify({ type: 'switchMonitorResult', success: false, reason: 'device not found' }));
        }
      } catch (err) {
        serverError(`[Monitor] switchMonitor error: ${err.message}`);
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
          serverLog(`[Monitor] ${dev.deviceName} 偏移量更新 → (${offsetX}, ${offsetY})`);
        }
      } catch (err) {
        serverError(`[Monitor] monitorOffsetUpdate error: ${err.message}`);
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
      await persistDevices();
      await persistGrid();
      await persistGroups();
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
        await persistTasks();
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
        // 记录预览订阅（interval 已废弃，客户端统一8fps）
        previewClients.set(ws, { deviceId });

        // 立即发送完整设备列表
        ws.send(JSON.stringify({ type: 'deviceList', devices: getDeviceListPayload() }));
      }
    }

    // ── 格子预览独立通道取消订阅 ──────────────────────
    if (msg.type === 'unsubscribePreview') {
      previewClients.delete(ws);
      if (msg.deviceId) {
        unsubscribeLevel(msg.deviceId, ws);
      }
    }

    // Step 1: 流级别系统 - 统一使用 setLevel
    if (msg.type === 'setLevel') {
      if (msg.deviceId && msg.level !== undefined) {
        subscribeLevel(msg.deviceId, ws, msg.level);
      }
    }

    // 移动端模式：浏览器上报是否为移动端
    if (msg.type === 'setMobileMode') {
      ws._isMobile = !!msg.isMobile;
      ws._lastFrameTime.clear();
    }

    // 格子拖拽排序更新
    if (msg.type === 'updateGrid') {
      if (msg.layout) {
        gridLayout = msg.layout;
        await persistGrid();
        broadcastToBrowsers({ type: 'grid', cells: getGridPayload() });
      }
    }

    // Step 3: 视口懒加载 - 浏览器上报当前可见格子和裁剪参数
    if (msg.type === 'setViewport') {
      viewportSubscriptions.set(ws, {
        deviceIds: new Set(msg.deviceIds || []),
        cropCols: msg.cropCols || 4,
        cropSize: msg.cropSize || { w: 480, h: 270 }
      });
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
      await persistGroups();
      await persistDevices();
      
      // 更新所有设备的集合状态（分组信息可能影响多个设备）
      for (const deviceId of devices.keys()) {
        updateCollectionsDeviceStatus(deviceId, {});
      }
      
      broadcastAllConfigUpdates();
    }

    if (msg.type === 'setPowerScene') {
      // 设置设备开关机场景
      const { deviceId, sceneName } = msg;
      if (sceneName && sceneName.trim()) {
        powerScenes[deviceId] = sceneName.trim();
      } else {
        delete powerScenes[deviceId];
      }
      await persistPowerScenes();
      broadcastAllConfigUpdates();
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
      const deviceList = msg.devices || [];
      
      const cols = msg.cols || 4;
      const rows = msg.rows || 4;
      const cellW = Math.floor((854 * 2) / cols);
      const cellH = Math.floor((480 * 2) / rows);
      
      wallLayouts.set(ws, {
        cols: cols,
        rows: rows,
        cellW: cellW,
        cellH: cellH,
        deviceIds: deviceList
      });
      
      const existing = wallClients.get(ws);
      const existingDevices = existing ? existing.devices : new Set();
      const newDevices = new Set(existingDevices);
      
      for (const deviceId of deviceList) {
        newDevices.add(deviceId);
        addMonitorWall(deviceId);
        wallDevices.set(deviceId, true);

        subscribeLevel(deviceId, ws, 1);
      }
      
      wallClients.set(ws, { devices: newDevices });
      serverLog(`[监控墙] 订阅 ${deviceList.length} 个设备`);
      
      ws.send(JSON.stringify({ type: 'walledDevices', devices: Array.from(newDevices) }));
    }

    if (msg.type === 'unsubscribeWall') {
      const devicesToUnsubscribe = msg.devices || [];
      const isPageClosing = msg.pageClosing === true;
      
      if (isPageClosing) {
        if (devicesToUnsubscribe.length > 0) {
          ws._wallUnsubscribing = true;
        }
      } else {
        const subscription = wallClients.get(ws);
        if (subscription) {
          for (const deviceId of devicesToUnsubscribe) {
            subscription.devices.delete(deviceId);
            removeMonitorWall(deviceId);
            unsubscribeLevel(deviceId, ws);
          }
          serverLog(`[监控墙] 取消订阅 ${devicesToUnsubscribe.length} 个设备`);
          ws.send(JSON.stringify({ type: 'walledDevices', devices: Array.from(subscription.devices) }));
        }
      }
    }

    if (msg.type === 'selfServiceInit') {
      ws._isSelfService = true;
      ws._selfServiceDeviceId = msg.operatorId;
      ws._selfServiceDeviceName = msg.operatorName;
      
      if (msg.operatorId === 'ADMN') {
        serverLog(`[客户端] 管理员（${msg.operatorId}） 自助登号`);
      }
    }

    if (msg.type === 'getWalledDevices') {
      const subscription = wallClients.get(ws);
      const myDevices = subscription ? Array.from(subscription.devices) : [];
      ws.send(JSON.stringify({ type: 'walledDevices', devices: myDevices }));
    }

    if (msg.type === 'keyboardState' && msg.deviceId) {
      const dev = devices.get(msg.deviceId);
      if (dev) {
        dev.supportsKeyClient = !!msg.supportsKeyClient;
        serverLog(`[远控] ${dev.deviceName} ${dev.supportsKeyClient ? '启动远控' : '关闭远控'}`);
        broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });
        broadcastToBrowsers({ type: 'devicePreviewStatus', deviceId: msg.deviceId, status: 'refresh' });
      }
    }

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
    const wallSubscription = wallClients.get(ws);
    if (wallSubscription) {
      serverLog(`[监控墙] 断开连接`);
    }
    browserClients.delete(ws);
    browserViewport.delete(ws);
    previewClients.delete(ws);
    wallLayouts.delete(ws);
    viewportSubscriptions.delete(ws);
    unsubscribeAllLevel(ws);

    // 清理 per-ws 追踪变量
    wallClients.delete(ws);
  });
  ws.on('error', () => {
    // error 时触发 close，close handler 已做完整清理
    ws.close();
  });
});

// ========== HTTP 服务器 ==========
const httpServer = http.createServer();

httpServer.on('upgrade', (req, socket, head) => {
  const pathname = url.parse(req.url).pathname;

  for (const service of gatewayServices) {
    const routeBase = service.route;
    if (pathname === routeBase || pathname.startsWith(routeBase + '/')) {
      const newPath = pathname.slice(routeBase.length) || '/';
      req.url = newPath;
      
      const options = {
        target: service.target,
        changeOrigin: true,
        ws: true,
        headers: {
          host: new URL(service.target).host,
          'x-forwarded-prefix': routeBase
        }
      };
      proxy.ws(req, socket, head, options);
      return;
    }
  }

  if (pathname === '/ws/client') {
    socket.setNoDelay(true);
    wssClient.handleUpgrade(req, socket, head, (ws) => {
      wssClient.emit('connection', ws, req);
    });
    return;
  }
  if (pathname === '/ws/browser') {
    socket.setNoDelay(true);
    wssBrowser.handleUpgrade(req, socket, head, (ws) => {
      wssBrowser.emit('connection', ws, req);
    });
    return;
  }

  socket.destroy();
});

async function handleUploadRequest(req, res, cleanPath) {
    if (cleanPath === '/_upload') {
        if (!checkUploadAuth(req)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(getUploadLoginPage());
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getUploadPage());
        return;
    }

    if (cleanPath === '/_upload/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const params = new URLSearchParams(body);
            const username = params.get('username') || '';
            const password = params.get('password') || '';
            if (username === AUTH_CFG.username && password === AUTH_CFG.password) {
                const token = Buffer.from(JSON.stringify({ u: username, p: password })).toString('base64');
                res.writeHead(302, {
                    'Set-Cookie': `upload_auth=${token}; Path=/; Max-Age=86400`,
                    'Location': '/_upload'
                });
                res.end();
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(getUploadLoginPage('用户名或密码错误'));
            }
        });
        return;
    }

    if (cleanPath === '/_upload/logout') {
        res.writeHead(302, {
            'Set-Cookie': 'upload_auth=; Path=/; Max-Age=0',
            'Location': '/_upload'
        });
        res.end();
        return;
    }

    if (cleanPath === '/_upload/files') {
        if (!checkUploadAuth(req)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end('[]');
            return;
        }
        try {
            const files = await fsReaddir(UPLOAD_DIR);
            const list = [];
            for (const name of files) {
                if (name.startsWith('.') || name.endsWith('.json')) continue;
                const stat = await fsStat(path.join(UPLOAD_DIR, name));
                if (stat.isFile()) {
                    list.push({
                        name,
                        size: stat.size,
                        time: stat.mtime.toLocaleString('zh-CN')
                    });
                }
            }
            list.sort((a, b) => b.time.localeCompare(a.time));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
        }
        return;
    }

    if (cleanPath === '/_upload/upload' && req.method === 'POST') {
        if (!checkUploadAuth(req)) {
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('未授权');
            return;
        }
        const form = formidable({
            maxFileSize: 2 * 1024 * 1024 * 1024,
            uploadDir: UPLOAD_DIR,
            keepExtensions: true
        });
        form.parse(req, (err, fields, files) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('上传失败：' + err.message);
                return;
            }
            const fileArr = files.file;
            if (!fileArr || !fileArr.length) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('请选择文件');
                return;
            }
            const uploadedFile = fileArr[0];
            const targetPath = path.join(UPLOAD_DIR, uploadedFile.originalFilename);
            fs.renameSync(uploadedFile.filepath, targetPath);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(uploadedFile.originalFilename + ' 上传成功');
        });
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
}

httpServer.on('request', async (req, res) => {
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

  const cleanPath = pathname.replace(/\/$/, '');

  // ========== 健康检查端点（看门狗使用）==========
  if (cleanPath === '/_health') {
    const health = checkHealth();
    if (health.healthy) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } else {
      serverError(`[健康] 事件循环阻塞 ${health.elapsed}ms`);
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('blocked');
    }
    return;
  }

  if (cleanPath === '/_upload' || cleanPath.startsWith('/_upload/')) {
    handleUploadRequest(req, res, cleanPath);
    return;
  }

  for (const service of gatewayServices) {
    const routeBase = service.route;
    if (cleanPath === routeBase || cleanPath.startsWith(routeBase + '/')) {
      req._originalUrl = req.url;
      req._gatewayRoute = routeBase;
      
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
      
      if (routeBase === '/nas') {
        req.url = req.url;
      } else {
        req.url = req.url.replace(routeBase, '') || '/';
      }
      
      const _origWriteHead = res.writeHead.bind(res);
      res._savedWriteHead = _origWriteHead;
      res.writeHead = function(statusCode, headers) {
        if (req._gatewayRoute === '/nas') {
          return res;
        }
        return _origWriteHead(statusCode, headers);
      };

      const options = {
        target: service.target,
        changeOrigin: true,
        followRedirects: true,
        ws: true,
        autoRewrite: true,
        selfHandleResponse: routeBase === '/nas',
        headers: {
          host: new URL(service.target).host,
          'x-forwarded-prefix': routeBase,
          'cache-control': 'no-cache',
          'pragma': 'no-cache'
        }
      };

      if (res._origWriteHead) {
        res.writeHead = res._origWriteHead;
      }

      proxy.web(req, res, options);
      return;
    }
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
    if (pathname === '/preview.html') {
      securityHeaders['Content-Security-Policy'] = "frame-ancestors 'self'";
    } else {
      securityHeaders['Content-Security-Policy'] = "frame-ancestors 'none'";
    }
  }
  const _origWriteHead = res.writeHead.bind(res);
  let _headersSent = false;
  res.writeHead = function(statusCode, headers) {
    if (_headersSent) return res;
    _headersSent = true;
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

  // 网关管理页面登录
  if (cleanPath === '/_gateway/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body || '{}');
        if (username === AUTH_CFG.username && password === AUTH_CFG.password) {
          const token = Buffer.from(JSON.stringify({ u: username, p: password })).toString('base64');
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, token }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // 网关管理页面（需要验证）
  if (cleanPath === '/_gateway' || cleanPath === '/_gateway/') {
    if (!checkGatewayAuth(req)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getGatewayLoginPage());
      return;
    }
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getGatewayManagePage());
    return;
  }

  // 网关API：获取配置
  if (cleanPath === '/_gateway/config' && req.method === 'GET') {
    if (!checkGatewayAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '未授权' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, services: gatewayServices }));
    return;
  }

  // 网关API：添加服务
  if (cleanPath === '/_gateway/service' && req.method === 'POST') {
    if (!checkGatewayAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '未授权' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { route, target } = JSON.parse(body || '{}');
        if (!route || !target) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: '参数不完整' }));
          return;
        }
        gatewayServices = gatewayServices.filter(s => s.route !== route);
        gatewayServices.push({ route, target });
        saveGatewayConfig();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, services: gatewayServices }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }

  // 网关API：删除服务
  if (cleanPath === '/_gateway/service' && req.method === 'DELETE') {
    if (!checkGatewayAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '未授权' }));
      return;
    }
    const route = urlObj.searchParams.get('route');
    if (!route) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '缺少route参数' }));
      return;
    }
    const beforeLen = gatewayServices.length;
    gatewayServices = gatewayServices.filter(s => s.route !== route);
    if (gatewayServices.length === beforeLen) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: '未找到该服务' }));
      return;
    }
    saveGatewayConfig();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, services: gatewayServices }));
    return;
  }

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
      req.on('end', async () => {
        const data = JSON.parse(body || '{}');
        gridSizeSetting = parseInt(data.gridSize) || 4;
        await persistGridSize();
        if (data.layout) {
          const key = String(gridSizeSetting);
          gridLayout[key] = data.layout;
          await persistGrid();
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
      req.on('end', async () => {
        const data = JSON.parse(body || '{}');
        groups = data.groups || [];
        await persistGroups();
        broadcastToBrowsers({ type: 'groups', groups });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (cleanPath === '/api/devices' && req.method === 'GET') {
      res.end(JSON.stringify(getDeviceListPayload()));
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
      let groupChanged = false;
      for (const g of groups) {
        if (g.deviceIds && g.deviceIds.includes(deviceIdToDelete)) {
          g.deviceIds = g.deviceIds.filter(id => id !== deviceIdToDelete);
          groupChanged = true;
        }
      }
      if (groupChanged) await persistGroups();
      for (const idx of Object.keys(gridLayout)) {
        if (gridLayout[idx] === deviceIdToDelete) {
          delete gridLayout[idx];
        }
      }
      await persistGrid();
      await persistDevices();
      const beforeAlarmLen = alarmRecords.length;
      alarmRecords = alarmRecords.filter(r => r.deviceId !== deviceIdToDelete);
      if (alarmRecords.length !== beforeAlarmLen) await persistAlarmRecords();
      lastAlarmTime.delete(deviceIdToDelete);
      if (powerScenes[deviceIdToDelete]) {
        delete powerScenes[deviceIdToDelete];
        await persistPowerScenes();
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
      req.on('end', async () => {
        const data = JSON.parse(body || '{}');
        const { deviceId, deviceName, groupId, cellIndex } = data;
        if (!deviceId) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, msg: '缺少 deviceId' }));
          return;
        }
        const idx = favorites.findIndex(f => f.deviceId === deviceId);
        if (idx >= 0) {
          favorites[idx] = { deviceId, deviceName, groupId, cellIndex };
        } else {
          favorites.push({ deviceId, deviceName, groupId, cellIndex });
        }
        await saveFavorites();
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
        await saveFavorites();
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
      const timestamp = Date.now();
      if (!collections.has(timestamp)) {
        collections.set(timestamp, []);
      }
      await saveCollections();
      const favoriteDeviceIds = favorites.map(f => f.deviceId);
      broadcastToClients({
        type: 'requestCollectionScreenshot',
        timestamp,
        deviceIds: favoriteDeviceIds
      });
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
        await saveCollections();
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
          await saveCollections();
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
      const TIMEOUT_MS = CLIENT_CFG.timeoutMs || 10000;
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
        await persistDevices();
        await persistGroups();
        await persistGrid();
        await persistAlarmRecords();
        await persistPowerScenes();
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

    // POST /api/wall-close - 监控墙页面关闭通知（sendBeacon 调用）
    // 注意：实际资源清理由 WebSocket close 延迟清理统一处理，此接口仅做日志记录
    // 避免 sendBeacon 和 close 延迟清理双重减引用计数的问题
    if (cleanPath === '/api/wall-close' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    // POST /api/checkAdmin - 验证管理员密码
    if (cleanPath === '/api/checkAdmin' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { username, password } = JSON.parse(body);
          if (username === AUTH_CFG.username && password === AUTH_CFG.password) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false }));
        }
      });
      return;
    }

    // POST /api/checkPermission - 检查设备权限
    if (cleanPath === '/api/checkPermission' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { deviceId, type } = JSON.parse(body);
          const dev = devices.get(deviceId);
          const deviceName = dev ? dev.deviceName : deviceId;
          const displayName = formatDeviceName(deviceName, deviceId);
          
          let allowed = false;
          let permissionName = '';
          if (type === 'screenWall') {
            allowed = hasScreenWallPermission(deviceId);
            permissionName = '打开屏幕墙';
          } else if (type === 'selfService') {
            allowed = hasSelfServicePermission(deviceId);
            permissionName = '自助登号';
          }
          
          if (allowed) {
            serverLog(`[客户端] ${displayName} ${permissionName}`);
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ allowed: false }));
        }
      });
      return;
    }

    // POST /api/setPermission - 设置设备权限
    if (cleanPath === '/api/setPermission' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { deviceId, allowScreenWall, allowSelfService } = JSON.parse(body);
          const current = devicePermissions[deviceId] || { allowScreenWall: false, allowSelfService: false };
          await setDevicePermission(
            deviceId,
            allowScreenWall !== undefined ? allowScreenWall : current.allowScreenWall,
            allowSelfService !== undefined ? allowSelfService : current.allowSelfService
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
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
const TIMEOUT_MS = CLIENT_CFG.timeoutMs || 5000;
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, dev] of devices) {
    if (dev.online && now - dev.lastSeen > TIMEOUT_MS) {
      dev.online = false;
      lastPushTime.delete(id);
      changed = true;
      if (id === 'MUMU-service') {
        serverLog(`[MUMU] 模拟器已超时断开`);
      } else {
        serverLog(`[!] 超时离线: ${dev.deviceName}`);
      }
    }
  }
  if (changed) broadcastToBrowsers({ type: 'deviceList', devices: getDeviceListPayload() });

  cleanupOldAlarmRecords();
}, 5000);

// ========== 启动 ==========
const PORT = SERVER_CFG.port || 3000;
const HOST = SERVER_CFG.host || '0.0.0.0';

// ========== MU服务自动管理 ==========
let muServiceProcess = null;
let muServiceRestartTimer = null;
let muServiceOnline = false;
const MU_SERVICE_PATH = path.join(__dirname, 'mumu-service', 'mumu_service.py');
const MU_SERVICE_RESTART_DELAY = 3000;

function isMuServiceRunning() {
  return muServiceProcess && !muServiceProcess.killed;
}

async function checkMuServiceRunning() {
  try {
    const { exec } = require('child_process');
    return new Promise((resolve) => {
      exec('wmic process where "name=\'python.exe\' and commandline like \'%mumu_service.py%\'" get processid', 
        (error, stdout) => {
          if (error) {
            resolve(false);
            return;
          }
          const lines = stdout.trim().split('\n').filter(line => line.trim() && !line.includes('ProcessId'));
          resolve(lines.length > 0);
        }
      );
    });
  } catch (e) {
    return false;
  }
}

async function startMuService() {
  if (muServiceOnline) {
    serverLog('[MU服务] 已在线，跳过启动');
    return;
  }
  
  if (!fs.existsSync(MU_SERVICE_PATH)) {
    serverLog('[MU服务] mumu_service.py 不存在，跳过启动');
    return;
  }
  
  // 检查是否已经有 MU 服务进程在运行
  const isRunning = await checkMuServiceRunning();
  if (isRunning) {
    serverLog('[MU服务] 检测到已有进程在运行，跳过启动');
    return;
  }
  
  try {
    serverLog('[MU服务] 正在启动...');
    muServiceProcess = spawn('cmd', [
      '/c', 'start', '"MU服务"', 
      'python', MU_SERVICE_PATH
    ], {
      cwd: path.join(__dirname, 'mumu-service'),
      detached: true,
      stdio: 'ignore'
    });
    muServiceProcess.unref();
    muServiceProcess = null;
    
  } catch (err) {
    serverError(`[MU服务] 启动异常: ${err.message}`);
  }
}

function restartMuService() {
  if (muServiceRestartTimer) {
    clearTimeout(muServiceRestartTimer);
  }
  muServiceRestartTimer = setTimeout(async () => {
    serverLog('[MU服务] 尝试自动重启...');
    await startMuService();
  }, MU_SERVICE_RESTART_DELAY);
}

function getGatewayLoginPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>网关管理 - 登录</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .login-box { background: rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 16px; padding: 40px; width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
    h1 { color: #fff; text-align: center; margin-bottom: 30px; font-size: 24px; }
    .form-group { margin-bottom: 20px; }
    label { display: block; color: #aaa; margin-bottom: 8px; font-size: 14px; }
    input { width: 100%; padding: 12px 16px; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; background: rgba(255,255,255,0.1); color: #fff; font-size: 16px; outline: none; transition: border-color 0.3s; }
    input:focus { border-color: #4a9eff; }
    input::placeholder { color: rgba(255,255,255,0.4); }
    button { width: 100%; padding: 14px; background: linear-gradient(135deg, #4a9eff 0%, #3a7bd5 100%); border: none; border-radius: 8px; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
    button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(74,158,255,0.4); }
    button:active { transform: translateY(0); }
    .error { color: #ff6b6b; text-align: center; margin-top: 16px; font-size: 14px; display: none; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>🔐 网关管理登录</h1>
    <div class="form-group">
      <label>用户名</label>
      <input type="text" id="username" placeholder="请输入用户名" autocomplete="username">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="password" id="password" placeholder="请输入密码" autocomplete="current-password">
    </div>
    <button onclick="login()">登 录</button>
    <div class="error" id="error">用户名或密码错误</div>
  </div>
  <script>
    document.getElementById('password').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
    async function login() {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      if (!username || !password) return;
      try {
        const res = await fetch('/_gateway/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
          document.cookie = 'gateway_auth=' + data.token + '; path=/; max-age=86400';
          location.reload();
        } else {
          document.getElementById('error').style.display = 'block';
        }
      } catch (e) {
        document.getElementById('error').textContent = '网络错误';
        document.getElementById('error').style.display = 'block';
      }
    }
  </script>
</body>
</html>`;
}

function getGatewayManagePage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>网关管理</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); min-height: 100vh; color: #fff; padding: 40px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 30px; display: flex; align-items: center; gap: 12px; }
    .card { background: rgba(255,255,255,0.08); backdrop-filter: blur(10px); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
    .card h2 { font-size: 18px; margin-bottom: 20px; color: #4a9eff; }
    .form-row { display: flex; gap: 16px; margin-bottom: 16px; }
    .form-group { flex: 1; }
    label { display: block; color: #aaa; margin-bottom: 8px; font-size: 14px; }
    input { width: 100%; padding: 10px 14px; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; background: rgba(255,255,255,0.1); color: #fff; font-size: 14px; outline: none; }
    input:focus { border-color: #4a9eff; }
    input::placeholder { color: rgba(255,255,255,0.4); }
    button { padding: 10px 20px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; transition: all 0.2s; }
    .btn-primary { background: linear-gradient(135deg, #4a9eff 0%, #3a7bd5 100%); color: #fff; }
    .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(74,158,255,0.3); }
    .btn-danger { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%); color: #fff; }
    .btn-danger:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(255,107,107,0.3); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.1); }
    th { color: #aaa; font-weight: 500; font-size: 13px; }
    td { font-size: 14px; }
    .empty { text-align: center; color: #666; padding: 40px; }
    .actions { display: flex; gap: 8px; }
    .tip { background: rgba(74,158,255,0.1); border: 1px solid rgba(74,158,255,0.3); border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 14px; line-height: 1.6; }
    .tip code { background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌐 网关管理</h1>
    <div class="tip">
      <strong>使用说明：</strong><br>
      • 路由路径：访问服务的URL路径前缀，如 <code>/nas</code>（自动匹配子路径）<br>
      • 目标地址：服务的完整地址，如 <code>http://127.0.0.1:5244</code><br>
      • 保存后立即生效，无需重启服务
    </div>
    <div class="card">
      <h2>添加代理服务</h2>
      <div class="form-row">
        <div class="form-group">
          <label>路由路径</label>
          <input type="text" id="route" placeholder="/nas">
        </div>
        <div class="form-group">
          <label>目标地址</label>
          <input type="text" id="target" placeholder="http://127.0.0.1:5244">
        </div>
        <div class="form-group" style="flex: 0 0 100px; display: flex; align-items: flex-end;">
          <button class="btn-primary" onclick="addService()">添加</button>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>已配置的服务</h2>
      <table>
        <thead>
          <tr>
            <th>路由路径</th>
            <th>目标地址</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody id="serviceList"></tbody>
      </table>
      <div class="empty" id="empty" style="display:none;">暂无配置的服务</div>
    </div>
  </div>
  <script>
    async function loadServices() {
      const res = await fetch('/_gateway/config');
      const data = await res.json();
      const tbody = document.getElementById('serviceList');
      const empty = document.getElementById('empty');
      if (!data.success || !data.services || data.services.length === 0) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      tbody.innerHTML = data.services.map(s => \`
        <tr>
          <td><code>\${s.route}</code></td>
          <td>\${s.target}</td>
          <td class="actions">
            <button class="btn-danger" onclick="deleteService('\${s.route}')">删除</button>
          </td>
        </tr>
      \`).join('');
    }
    async function addService() {
      const route = document.getElementById('route').value.trim();
      const target = document.getElementById('target').value.trim();
      if (!route || !target) return alert('请填写完整信息');
      if (!route.startsWith('/')) return alert('路由路径必须以 / 开头');
      try {
        const res = await fetch('/_gateway/service', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ route, target })
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('route').value = '';
          document.getElementById('target').value = '';
          loadServices();
        } else {
          alert(data.message || '添加失败');
        }
      } catch (e) {
        alert('网络错误');
      }
    }
    async function deleteService(route) {
      if (!confirm('确定删除该服务？')) return;
      try {
        const res = await fetch('/_gateway/service?route=' + encodeURIComponent(route), { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          loadServices();
        } else {
          alert(data.message || '删除失败');
        }
      } catch (e) {
        alert('网络错误');
      }
    }
    loadServices();
  </script>
</body>
</html>`;
}

httpServer.listen(PORT, HOST, () => {
  serverLog(`  🖥️  屏幕墙服务端 v${SERVER_CONFIG.serverVersion || '未知'} 已启动`);
  serverLog(`   本地访问:     http://localhost:${PORT}`);
  serverLog(`   WebSocket端口: ${PORT}`);
  serverLog(`   健康检查:     http://localhost:${PORT}/_health\n`);
  
  // 启动心跳自检
  startHeartbeat();
  
  // 初始化报警处理 Worker Thread
  initAlarmWorker();
  
  setTimeout(async () => {
    await startMuService();
  }, 500);
});
