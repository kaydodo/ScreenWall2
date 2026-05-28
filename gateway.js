const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();

// =======================【全部在这里填表即可，新增直接复制一行填写】=======================
// 对外网关端口（主server继续使用3000端口）
const GatewayPort = 8080;

/**
 * 配置格式说明
 * route: 自定义访问前缀路径 例 /panel  /file  /system
 * target: 程序本地内网地址+内部端口
*/
let ServiceList = [
    //主站点（根路径直接访问）
    { route:"/", target:"http://127.0.0.1:3000" },

    //NAS服务（Alist）
    { route:"/nas", target:"http://127.0.0.1:5244" },

    //自行随意新增服务，直接复制下面一行修改就行
    //{ route:"/admin", target:"http://127.0.0.1:3001" },
]
// =========================================================================================


// 保存当前的代理中间件，方便动态更新
let proxyMap = new Map();

// 注册代理中间件
function registerProxies() {
    // 清除旧的路由栈（保留前3层：express自带的）
    let oldLayerCount = app._router ? app._router.stack.length : 0;
    if (oldLayerCount > 3) {
        app._router.stack = app._router.stack.slice(0, 3);
    }
    proxyMap.clear();

    // 重新注册所有代理
    ServiceList.forEach(item=>{
        const proxy = createProxyMiddleware({
            target:item.target,
            changeOrigin:true,
            ws:true,
            pathRewrite:{[`^${item.route}`]:'/'},
            onProxyReq:(proxyReq,req)=>{
                proxyReq.headers.origin = req.headers.origin;
                proxyReq.headers.referer = req.headers.referer;
                proxyReq.headers.cookie = req.headers.cookie ?? '';
            },
            onProxyRes:(proxyRes)=>{
                proxyRes.headers["Access-Control-Allow-Origin"] = "*";
                proxyRes.headers["Access-Control-Allow-Credentials"] = "true";
            }
        });
        app.use(item.route, proxy);
        proxyMap.set(item.route, proxy);
    });

    console.log(`✅ 已重新加载 ${ServiceList.length} 个服务配置`);
}

// 初始注册
registerProxies();

// ======================= 热重载管理接口 =======================
app.use(express.json());

/**
 * 网关管理页面
 * GET /_gateway/
 */
app.get('/_gateway/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>网关管理</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Microsoft YaHei";}
body{background:#f5f7fa;padding:20px;}
.container{max-width:900px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08);overflow:hidden;}
.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:24px 30px;}
.header h1{font-size:24px;font-weight:600;margin-bottom:8px;}
.header p{opacity:0.9;font-size:14px;}
.content{padding:30px;}
.section{margin-bottom:30px;}
.section h2{font-size:16px;font-weight:600;color:#333;margin-bottom:16px;display:flex;align-items:center;gap:8px;}
.service-list{display:flex;flex-direction:column;gap:10px;}
.service-item{display:flex;align-items:center;gap:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;}
.service-route{min-width:120px;font-weight:600;color:#667eea;background:#eef2ff;padding:4px 10px;border-radius:6px;font-size:14px;}
.service-arrow{color:#94a3b8;font-size:18px;}
.service-target{flex:1;font-size:14px;color:#475569;}
.service-actions{display:flex;gap:8px;}
.btn{padding:8px 16px;border-radius:6px;font-size:14px;border:none;cursor:pointer;transition:all 0.2s;}
.btn-primary{background:#667eea;color:#fff;}
.btn-primary:hover{background:#5568d3;}
.btn-danger{background:#ef4444;color:#fff;}
.btn-danger:hover{background:#dc2626;}
.btn-ghost{background:#f1f5f9;color:#475569;}
.btn-ghost:hover{background:#e2e8f0;}
.add-form{display:flex;gap:12px;align-items:flex-end;}
.form-group{flex:1;display:flex;flex-direction:column;gap:6px;}
.form-group label{font-size:13px;color:#64748b;}
.form-group input{padding:10px 14px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;outline:none;transition:border 0.2s;}
.form-group input:focus{border-color:#667eea;}
.info-box{background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:14px 16px;margin-bottom:20px;}
.info-box h3{font-size:14px;color:#1e40af;margin-bottom:8px;}
.info-box ul{margin-left:18px;font-size:13px;color:#3b82f6;line-height:1.8;}
.status{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#dcfce7;color:#166534;border-radius:6px;font-size:13px;font-weight:500;}
.status-dot{width:8px;height:8px;background:#22c55e;border-radius:50%;}
.empty-state{text-align:center;padding:40px 20px;color:#94a3b8;}
.empty-state p{font-size:14px;}
.gateway-link{margin-top:10px;font-size:13px;color:#64748b;}
.gateway-link a{color:#667eea;text-decoration:none;}
.gateway-link a:hover{text-decoration:underline;}
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>🖥️ 单端口聚合网关管理</h1>
        <p>统一端口: <strong>${GatewayPort}</strong> &nbsp;&nbsp; 已挂载服务: <strong id="serviceCount">0</strong> 个</p>
    </div>
    <div class="content">
        <div class="info-box">
            <h3>📌 使用说明</h3>
            <ul>
                <li><strong>对外统一访问端口: ${GatewayPort}</strong>，所有服务通过该端口访问</li>
                <li>主服务(3000)仍保留，局域网内可直接访问</li>
                <li>配置修改实时生效，<strong>无需重启服务</strong></li>
            </ul>
        </div>

        <div class="section">
            <h2>➕ 添加新服务</h2>
            <div class="add-form">
                <div class="form-group">
                    <label>访问路由 (如 /admin)</label>
                    <input type="text" id="newRoute" placeholder="/xxx">
                </div>
                <div class="form-group">
                    <label>目标地址 (如 http://127.0.0.1:3001)</label>
                    <input type="text" id="newTarget" placeholder="http://127.0.0.1:xxxx">
                </div>
                <button class="btn btn-primary" onclick="addService()">添加</button>
            </div>
        </div>

        <div class="section">
            <h2>📋 当前服务列表</h2>
            <div id="serviceList" class="service-list">
                <!-- 动态生成 -->
            </div>
        </div>

        <div class="gateway-link">
            <span class="status"><span class="status-dot"></span>网关运行中</span>
            <a href="/" target="_blank" style="margin-left:16px;">← 返回首页</a>
        </div>
    </div>
</div>

<script>
async function loadConfig() {
    const res = await fetch('/_gateway/config');
    const data = await res.json();
    renderServiceList(data.services);
}

function renderServiceList(services) {
    const container = document.getElementById('serviceList');
    document.getElementById('serviceCount').textContent = services.length;
    
    if (services.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>暂无服务配置</p></div>';
        return;
    }
    
    container.innerHTML = services.map(item => \`
        <div class="service-item">
            <span class="service-route">\${item.route}</span>
            <span class="service-arrow">→</span>
            <span class="service-target">\${item.target}</span>
            <div class="service-actions">
                <button class="btn btn-ghost" onclick="testService('\${item.route}')">测试</button>
                <button class="btn btn-danger" onclick="deleteService('\${item.route}')">删除</button>
            </div>
        </div>
    \`).join('');
}

async function addService() {
    const route = document.getElementById('newRoute').value.trim();
    const target = document.getElementById('newTarget').value.trim();
    
    if (!route || !target) {
        alert('请填写完整信息');
        return;
    }
    
    if (!route.startsWith('/')) {
        alert('路由必须以 / 开头');
        return;
    }
    
    const res = await fetch('/_gateway/service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route, target })
    });
    
    const data = await res.json();
    if (data.success) {
        alert('添加成功！');
        document.getElementById('newRoute').value = '';
        document.getElementById('newTarget').value = '';
        loadConfig();
    } else {
        alert('添加失败: ' + data.message);
    }
}

async function deleteService(route) {
    if (!confirm('确定要删除该服务吗？')) return;
    
    const res = await fetch('/_gateway/service?route=' + encodeURIComponent(route), {
        method: 'DELETE'
    });
    
    const data = await res.json();
    if (data.success) {
        alert('删除成功！');
        loadConfig();
    } else {
        alert('删除失败: ' + data.message);
    }
}

function testService(route) {
    window.open(route, '_blank');
}

loadConfig();
</script>
</body>
</html>
    `);
});

/**
 * 获取当前服务配置
 * GET /_gateway/config
 */
app.get('/_gateway/config', (req, res) => {
    res.json({
        success:true,
        port: GatewayPort,
        services: ServiceList
    });
});

/**
 * 更新服务配置（热重载）
 * POST /_gateway/config
 * Body: { services: [...] }
 */
app.post('/_gateway/config', (req, res) => {
    try {
        if (req.body.services && Array.isArray(req.body.services)) {
            ServiceList = req.body.services;
            registerProxies();
            res.json({
                success:true,
                message:"配置已更新",
                services: ServiceList
            });
        } else {
            res.status(400).json({
                success:false,
                message:"无效的配置格式"
            });
        }
    } catch (e) {
        res.status(500).json({
            success:false,
            message:e.message
        });
    }
});

/**
 * 添加新服务
 * POST /_gateway/service
 * Body: { route:"/xxx", target:"http://127.0.0.1:xxxx" }
 */
app.post('/_gateway/service', (req, res) => {
    try {
        const { route, target } = req.body;
        if (!route || !target) {
            return res.status(400).json({
                success:false,
                message:"需要route和target参数"
            });
        }

        // 移除已存在的相同route
        ServiceList = ServiceList.filter(s => s.route !== route);
        // 添加新服务
        ServiceList.push({ route, target });
        registerProxies();

        res.json({
            success:true,
            message:"服务已添加",
            services: ServiceList
        });
    } catch (e) {
        res.status(500).json({
            success:false,
            message:e.message
        });
    }
});

/**
 * 删除服务
 * DELETE /_gateway/service?route=/xxx
 */
app.delete('/_gateway/service', (req, res) => {
    try {
        const { route } = req.query;
        if (!route) {
            return res.status(400).json({
                success:false,
                message:"需要route参数"
            });
        }

        const beforeLen = ServiceList.length;
        ServiceList = ServiceList.filter(s => s.route !== route);

        if (ServiceList.length === beforeLen) {
            return res.json({
                success:false,
                message:"未找到该route的服务"
            });
        }

        registerProxies();

        res.json({
            success:true,
            message:"服务已删除",
            services: ServiceList
        });
    } catch (e) {
        res.status(500).json({
            success:false,
            message:e.message
        });
    }
});

//启动监听
const server = app.listen(GatewayPort,()=>{
    console.log(`✅ 单端口聚合网关已启动 统一对外端口:${GatewayPort}`)
    console.log(`📌 当前全部已挂载服务数量：${ServiceList.length} 个`)
    console.log(`\n🔗 访问示例:`)
    ServiceList.forEach(item=>{
        console.log(`   ${item.route.padEnd(10)} -> ${item.target}`)
    })
    console.log(`\n🎛️  管理页面:`)
    console.log(`   http://127.0.0.1:${GatewayPort}/_gateway/`)
    console.log(`\n🛠️  API接口:`)
    console.log(`   GET    /_gateway/config          - 获取当前配置`)
    console.log(`   POST   /_gateway/config          - 更新全部配置`)
    console.log(`   POST   /_gateway/service         - 添加新服务`)
    console.log(`   DELETE /_gateway/service?route=  - 删除服务`)
})
