const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs/promises');
const app = express();

// 上传目录（自动创建）
const UPLOAD_DIR = path.join(__dirname, 'public');

// 中间件：文件上传配置（适合大文件）
app.use(fileUpload({
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
    useTempFiles: true,
    tempFileDir: path.join(__dirname, 'tmp'),
    abortOnLimit: true,
    responseOnLimit: '文件大小超过限制（最大2GB）'
}));

// 首页上传表单（带进度条 + JS）
app.get('/', (req, res) => {
    res.send(`
    <h1>Node.js 大文件上传</h1>
    <form id="uploadForm" method="post" action="/upload" enctype="multipart/form-data">
        <input type="file" name="file" multiple><br><br>
        <button type="submit">开始上传</button>
    </form>

    <!-- 进度条 -->
    <div style="margin-top:20px; display:none;" id="progressContainer">
        <div style="width:100%; background:#eee; height:20px; border-radius:5px;">
            <div id="progressBar" style="width:0%; height:100%; background:#4CAF50; border-radius:5px;"></div>
        </div>
        <p id="progressText">0%</p>
    </div>

    <script>
        // 上传进度条逻辑
        const form = document.getElementById('uploadForm');
        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            progressContainer.style.display = 'block';

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/upload');

            // 实时进度
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    progressBar.style.width = percent + '%';
                    progressText.innerText = percent.toFixed(1) + '%';
                }
            };

            // 上传完成
            xhr.onload = () => {
                if (xhr.status === 200) {
                    document.body.innerHTML = xhr.responseText;
                } else {
                    alert('上传出错');
                }
            };

            xhr.send(formData);
        });
    </script>
    `);
});

// 上传接口
app.post('/upload', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.send(`
                请选择要上传的文件<br><br>
                <button onclick="window.location.href='/'">← 返回上传页面</button>
            `);
        }

        // 自动创建目录
        await fs.mkdir(UPLOAD_DIR, { recursive: true });

        const file = req.files.file;
        const savePath = path.join(UPLOAD_DIR, file.name);
        await file.mv(savePath);

        // 上传成功 + 返回按钮
        res.send(`
            ✅ 上传成功：${file.name} 已存入 public 目录<br><br>
            <button onclick="window.location.href='/'">← 返回上传页面</button>
        `);

    } catch (err) {
        console.error('上传错误：', err);
        // 上传失败 + 返回按钮
        res.send(`
            ❌ 上传失败：${err.message}<br><br>
            <button onclick="window.location.href='/'">← 返回上传页面</button>
        `);
    }
});

// 启动服务
app.listen(3030, () => {
    console.log('上传服务已启动：http://localhost:3030');
});