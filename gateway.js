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
    console.log(`\n🛠️  热重载接口:`)
    console.log(`   GET    /_gateway/config          - 获取当前配置`)
    console.log(`   POST   /_gateway/config          - 更新全部配置`)
    console.log(`   POST   /_gateway/service         - 添加新服务`)
    console.log(`   DELETE /_gateway/service?route=  - 删除服务`)
})
