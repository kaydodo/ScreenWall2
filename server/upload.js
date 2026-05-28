const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const app = express();

const UPLOAD_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, 'public', 'config.json');
const sessions = new Map();

function generateSessionId() {
    return crypto.randomBytes(32).toString('hex');
}

async function getAuthConfig() {
    try {
        const raw = await fs.readFile(CONFIG_PATH, 'utf8');
        const config = JSON.parse(raw);
        return {
            username: config.auth?.username || 'admin',
            password: config.auth?.password || 'admin'
        };
    } catch (e) {
        return { username: 'admin', password: 'admin' };
    }
}

app.use(fileUpload({
    limits: { fileSize: 2 * 1024 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: path.join(__dirname, 'tmp'),
    abortOnLimit: true,
    responseOnLimit: '文件大小超过限制（最大2GB）'
}));

function getLoginPage(error = '') {
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
        ${error ? `<div class="error">${error}</div>` : ''}
        <form method="post" action="/login">
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
        .upload-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .upload-text {
            color: var(--text-secondary);
            font-size: 16px;
            margin-bottom: 8px;
        }
        .upload-hint {
            color: var(--text-muted);
            font-size: 13px;
        }
        #fileInput { display: none; }
        .file-list {
            margin-top: 16px;
            text-align: left;
        }
        .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: var(--bg-page);
            border-radius: var(--radius-sm);
            margin-bottom: 8px;
        }
        .file-name {
            font-size: 14px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .file-size {
            color: var(--text-muted);
            font-size: 12px;
        }
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
        .upload-btn:hover:not(:disabled) {
            background: var(--accent-dark);
        }
        .upload-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .progress-container {
            margin-top: 16px;
            display: none;
        }
        .progress-bar {
            width: 100%;
            height: 6px;
            background: var(--border);
            border-radius: 3px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--accent);
            width: 0%;
            transition: width 0.3s;
        }
        .progress-text {
            text-align: center;
            margin-top: 8px;
            color: var(--text-secondary);
            font-size: 13px;
        }
        .result {
            margin-top: 16px;
            padding: 14px;
            border-radius: var(--radius-sm);
            text-align: center;
            font-size: 14px;
        }
        .result.success {
            background: #f0fdf4;
            color: #16a34a;
            border: 1px solid #bbf7d0;
        }
        .result.error {
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fecaca;
        }
        .existing-files {
            max-height: 350px;
            overflow-y: auto;
        }
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
        .existing-file-item:hover {
            background: var(--bg-hover);
        }
        .existing-file-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .existing-file-icon {
            font-size: 20px;
        }
        .existing-file-name {
            font-weight: 500;
            color: var(--text-primary);
        }
        .existing-file-meta {
            font-size: 12px;
            color: var(--text-muted);
        }
        .delete-btn {
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fecaca;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.2s;
        }
        .delete-btn:hover { background: #fee2e2; }
        .empty-state {
            text-align: center;
            padding: 30px;
            color: var(--text-muted);
        }
        .empty-icon { font-size: 40px; margin-bottom: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📁 文件上传服务</h1>
        <button class="logout-btn" onclick="fetch('/logout').then(() => location.reload())">退出登录</button>
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
            fileList.innerHTML = selectedFiles.map((f, i) => \`
                <div class="file-item">
                    <div class="file-name">📄 \${f.name} <span class="file-size">(\${formatSize(f.size)})</span></div>
                    <button class="remove-btn" onclick="removeFile(\${i})">移除</button>
                </div>
            \`).join('');
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
            xhr.open('POST', '/upload');
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
            const res = await fetch('/files');
            const data = await res.json();
            const container = document.getElementById('existingFiles');
            document.getElementById('fileCount').textContent = '(' + data.length + ')';
            if (data.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div>暂无文件</div></div>';
                return;
            }
            container.innerHTML = data.map(f => \`
                <div class="existing-file-item">
                    <div class="existing-file-info">
                        <div class="existing-file-icon">📄</div>
                        <div>
                            <div class="existing-file-name">\${f.name}</div>
                            <div class="existing-file-meta">\${formatSize(f.size)} · \${f.time}</div>
                        </div>
                    </div>
                    <button class="delete-btn" onclick="deleteFile('\${f.name}')">删除</button>
                </div>
            \`).join('');
        }

        async function deleteFile(name) {
            if (!confirm('确定删除 ' + name + ' ?')) return;
            await fetch('/delete?name=' + encodeURIComponent(name));
            loadExistingFiles();
        }

        loadExistingFiles();
    </script>
</body>
</html>`;
}

function checkAuth(req) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/upload_session=([^;]+)/);
    if (!match) return false;
    return sessions.has(match[1]);
}

app.get('/', async (req, res) => {
    if (!checkAuth(req)) {
        res.send(getLoginPage());
        return;
    }
    res.send(getUploadPage());
});

app.post('/login', express.urlencoded({ extended: true }), async (req, res) => {
    const { username, password } = req.body;
    const auth = await getAuthConfig();
    
    if (username === auth.username && password === auth.password) {
        const sessionId = generateSessionId();
        sessions.set(sessionId, { username, time: Date.now() });
        res.setHeader('Set-Cookie', `upload_session=${sessionId}; Path=/; HttpOnly; Max-Age=86400`);
        const prefix = req.headers['x-forwarded-prefix'] || '';
        res.redirect(prefix + '/');
    } else {
        res.send(getLoginPage('用户名或密码错误'));
    }
});

app.get('/logout', (req, res) => {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/upload_session=([^;]+)/);
    if (match) sessions.delete(match[1]);
    res.setHeader('Set-Cookie', 'upload_session=; Path=/; Max-Age=0');
    res.redirect('/');
});

app.get('/files', async (req, res) => {
    if (!checkAuth(req)) return res.status(401).json([]);
    try {
        const files = await fs.readdir(UPLOAD_DIR);
        const list = [];
        for (const name of files) {
            if (name.startsWith('.') || name.endsWith('.json')) continue;
            const stat = await fs.stat(path.join(UPLOAD_DIR, name));
            if (stat.isFile()) {
                list.push({
                    name,
                    size: stat.size,
                    time: stat.mtime.toLocaleString('zh-CN')
                });
            }
        }
        list.sort((a, b) => b.time.localeCompare(a.time));
        res.json(list);
    } catch (e) {
        res.json([]);
    }
});

app.delete('/delete', async (req, res) => {
    if (!checkAuth(req)) return res.status(401).send('未授权');
    const name = req.query.name;
    if (!name) return res.status(400).send('缺少文件名');
    try {
        await fs.unlink(path.join(UPLOAD_DIR, name));
        res.send('ok');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.post('/upload', async (req, res) => {
    if (!checkAuth(req)) return res.status(401).send('未授权');
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).send('请选择文件');
        }
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        const file = req.files.file;
        const savePath = path.join(UPLOAD_DIR, file.name);
        await file.mv(savePath);
        res.send(`${file.name} 上传成功`);
    } catch (err) {
        console.error('上传错误：', err);
        res.status(500).send('上传失败：' + err.message);
    }
});

app.listen(3030, () => {
    console.log('上传服务已启动：http://localhost:3030');
});
