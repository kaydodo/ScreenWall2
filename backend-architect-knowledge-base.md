# 后端架构师知识库

> 本文件整合后端架构核心知识体系，适用于 API 设计、数据库架构、微服务、分布式系统等场景。

---

## 一、API 设计原则

### 1.1 RESTful API 设计规范

**资源命名**
- 使用名词复数：`/users`、`/orders`、`/products`
- 避免动词：`/getUser` ❌ → `/GET /users/{id}` ✅
- 嵌套资源限制在 2 层：`/users/{id}/orders`

**HTTP 方法语义**
| 方法 | 用途 | 幂等性 | 安全性 |
|------|------|--------|--------|
| GET | 查询资源 | ✅ | ✅ |
| POST | 创建资源 | ❌ | ❌ |
| PUT | 完整更新 | ✅ | ❌ |
| PATCH | 部分更新 | ❌ | ❌ |
| DELETE | 删除资源 | ✅ | ❌ |

**状态码规范**
| 状态码 | 含义 | 场景 |
|--------|------|------|
| 200 | OK | 成功响应 |
| 201 | Created | 资源创建成功 |
| 204 | No Content | 删除成功无返回 |
| 400 | Bad Request | 请求参数错误 |
| 401 | Unauthorized | 未认证 |
| 403 | Forbidden | 无权限 |
| 404 | Not Found | 资源不存在 |
| 429 | Too Many Requests | 限流 |
| 500 | Internal Error | 服务器错误 |

### 1.2 API 版本管理

**URL 路径方式**（推荐）
```
/api/v1/users
/api/v2/users
```

**Header 方式**
```
Accept: application/vnd.api+json;version=2
```

### 1.3 错误响应格式

```json
{
  "code": 10001,
  "message": "用户不存在",
  "detail": {
    "field": "userId",
    "reason": "长度为0"
  },
  "requestId": "uuid-xxx"
}
```

### 1.4 分页规范

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

Cursor 分页（适合大表）：
```json
{
  "data": [...],
  "cursor": {
    "next": "eyJpZCI6MTAwfQ==",
    "hasMore": true
  }
}
```

---

## 二、数据库架构

### 2.1 SQL vs NoSQL 选型

| 场景 | 推荐 | 原因 |
|------|------|------|
| 事务一致性 | SQL (PostgreSQL/MySQL) | ACID 事务支持 |
| 高并发读写 | NoSQL (MongoDB/Redis) | 横向扩展能力强 |
| 复杂查询 | SQL | JOIN、聚合能力强 |
| 缓存层 | Redis/Memcached | 内存存储，低延迟 |
| 全文搜索 | Elasticsearch | 倒排索引 |
| 时序数据 | InfluxDB/TimescaleDB | 压缩存储 |

### 2.2 索引设计原则

**创建索引**
```sql
-- 单列索引
CREATE INDEX idx_user_id ON users(id);

-- 复合索引（最左前缀原则）
CREATE INDEX idx_user_status ON users(status, created_at);

-- 唯一索引
CREATE UNIQUE INDEX idx_user_email ON users(email);
```

**索引选择**
- WHERE 条件中频繁使用的列
- ORDER BY / GROUP BY 涉及的列
- 区分度高的列（区分度 < 0.1 谨慎建索引）
- 避免在频繁更新的列上建索引

### 2.3 分库分表策略

**垂直分表**（按列拆分）
- 冷热数据分离
- 大字段独立表
- 安全字段独立表

**水平分表**（按行拆分）
- Hash 分片：`shard_key % N`
- 范围分片：`user_id BETWEEN 0 AND 999999`
- 一致性 Hash：解决扩容数据迁移问题

### 2.4 数据库缓存策略

**Cache-Aside 模式**（推荐）
```
读：Cache → Miss → DB → Set Cache
写：DB → Delete Cache（不是更新 Cache）
```

**读写分离**
```
主库：写操作
从库：读操作（延迟感知）
```

---

## 三、微服务架构

### 3.1 服务拆分原则

**康威定律**
> 系统结构应与组织结构匹配

**高内聚低耦合**
- 单一职责：一个服务一个业务领域
- 边界清晰：服务间通过 API 通信
- 无循环依赖

**拆分粒度参考**
| 维度 | 微服务 | 小型单体 | 中型单体 |
|------|--------|---------|---------|
| 团队规模 | 2-5人/服务 | 5-10人 | 10-20人 |
| 部署频率 | 随时 | 每周 | 每月 |
| 故障隔离 | 服务级 | 应用级 | 数据库级 |

### 3.2 服务间通信

**同步通信**
- HTTP/REST：简单场景
- gRPC：高性能、B protobuf
- GraphQL：按需获取

**异步通信**
- 消息队列：RabbitMQ/Kafka/RocketMQ
- 事件驱动：Event Sourcing / CQRS
- 消息格式：JSON / Avro / Protobuf

### 3.3 服务注册与发现

**客户端发现**
```
客户端 → 注册中心 → 获取服务列表 → 直接调用
```

**服务端发现**
```
客户端 → 负载均衡/网关 → 注册中心 → 服务实例
```

### 3.4 API 网关

**功能**
- 路由转发
- 认证鉴权
- 限流熔断
- 请求聚合
- 协议转换

**开源方案**
- Kong / APISIX（Nginx-based）
- Spring Cloud Gateway
- Envoy + Istio

---

## 四、分布式系统模式

### 4.1 熔断器（Circuit Breaker）

**三状态**
```
CLOSED（正常）→ 故障率超阈值 → OPEN（熔断）
                              ↓ 超时后
                           HALF_OPEN（探测）
                              ↓ 成功
                           CLOSED
```

**实现要点**
- 滑动窗口统计
- 失败率阈值（50%）
- 熔断时长
- 半开探测请求数

### 4.2 限流算法

**令牌桶**
```
capacity = 100
rate = 10/秒

请求到达 → 获取令牌 → 有令牌 → 通过
                              无令牌 → 拒绝
         定时补充令牌
```

**滑动窗口日志**
```
时间窗口 = 60秒
最大请求 = 100

每个请求记录时间戳
统计窗口内请求数
超阈值则拒绝
```

### 4.3 幂等性设计

**接口幂等**
```
POST /orders（创建订单）
→ 客户端生成 orderId
→ 服务端根据 orderId 幂等处理

PUT /orders/{id}（更新订单）
→ 使用版本号乐观锁
→ WHERE id = ? AND version = ?
```

**消息幂等**
```
消息ID + Redis/Dedup表
消费前检查是否已处理
```

### 4.4 分布式事务

**Seata AT 模式**
```
全局事务协调者（TC）
    ↓
分支事务（TM）→ 本地事务 + Undo Log
    ↓
Commit → 异步删除 Undo Log
Rollback → 执行 Undo Log 回滚
```

**Saga 模式**（长事务）
```
A → B → C → D

正向：每个步骤有补偿操作
反向：C失败 → 补偿B、补偿A
```

**最终一致性 vs 强一致性**
- 强一致性：Seata AT / XA
- 最终一致性：消息队列 + 定时任务对账

### 4.5 一致性 Hash

```
         Hash环
    ┌─────────────────┐
    │    Node A       │
    │                 │
    │ Node D    Node B│
    │                 │
    │    Node C       │
    └─────────────────┘

Key → Hash(key) → 顺时针找到第一个节点
```

**虚拟节点**：解决数据倾斜问题

---

## 五、高并发设计

### 5.1 缓存策略

**多级缓存**
```
Browser Cache → CDN → Nginx → Redis → DB
```

**缓存失效策略**
- TTL：固定时间
- LRU：最近最少使用
- LFU：最不频繁使用

**缓存问题**
| 问题 | 解决方案 |
|------|---------|
| 缓存穿透 | 布隆过滤器 / 空值缓存 |
| 缓存击穿 | 互斥锁 / 热点数据永不过期 |
| 缓存雪崩 | TTL随机化 / 多级缓存 |

### 5.2 消息队列

**Kafka 适用场景**
- 日志收集
- 实时流处理
- 大数据场景
- 顺序消费

**RabbitMQ 适用场景**
- 可靠消息
- 复杂路由
- 事务消息
- 小规模场景

**RocketMQ 适用场景**
- 交易系统
- 分布式事务
- 延时消息
- 阿里云场景

### 5.3 读写分离 + 分库分表

```
                    ┌─────────────┐
                    │   应用层    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌────────┐  ┌────────┐
         │ DataNode│  │ DataNode│  │ DataNode│
         │ (主库)  │  │ (从库)  │  │ (从库)  │
         └────────┘  └────────┘  └────────┘
```

---

## 六、安全架构

### 6.1 认证机制

**JWT**
```json
{
  "header": {
    "alg": "HS256",
    "typ": "JWT"
  },
  "payload": {
    "sub": "userId",
    "exp": 1699999999,
    "roles": ["admin"]
  },
  "signature": "xxx"
}
```

**OAuth2.0**
```
授权码模式：
Client → 授权服务器 → 返回 Code → 换 Token → 访问资源
```

### 6.2 授权模型

**RBAC**（基于角色）
```
用户 → 角色 → 权限
   admin  →  [read, write, delete]
   user   →  [read]
```

**ABAC**（基于属性）
```json
{
  "condition": {
    "resource.owner": "${user.id}",
    "resource.type": "document",
    "action": "write"
  }
}
```

### 6.3 数据安全

**敏感数据加密**
- 传输：TLS 1.3
- 存储：AES-256
- 密钥：KMS 管理

**脱敏策略**
```sql
-- 手机号
'138****5678'

-- 身份证
'110101*******1234'

-- 银行卡
'**** **** **** 1234'
```

---

## 七、监控与可观测性

### 7.1 黄金指标（RED 原则）

| 指标 | 含义 | 监控 |
|------|------|------|
| Rate | 请求率 | QPS |
| Errors | 错误率 | 5xx 比例 |
| Duration | 延迟 | P50/P95/P99 |

### 7.2 日志规范

**结构化日志**
```json
{
  "timestamp": "2024-01-01T10:00:00Z",
  "level": "INFO",
  "service": "order-service",
  "traceId": "abc123",
  "message": "Order created",
  "data": {
    "orderId": "123",
    "userId": "456"
  }
}
```

**采样策略**
- 正常流量：100%
- 错误流量：100%
- 高延迟：100%
- Debug 日志：1%

### 7.3 链路追踪

**OpenTelemetry**
```
Span: 一次操作
  - name
  - startTime/endTime
  - attributes
  - status

Trace: 一次请求完整链路
  - 多个 Span 组成
  - 共享 traceId
```

---

## 八、容器与 DevOps

### 8.1 Docker 最佳实践

**镜像优化**
```dockerfile
# 多阶段构建
FROM golang:1.21 AS builder
WORKDIR /app
COPY . .
RUN go build -o main

FROM alpine:latest
COPY --from=builder /app/main /app/
CMD ["/app/main"]
```

**安全**
- 最小化基础镜像
- 不使用 root 运行
- 敏感信息用 secret

### 8.2 Kubernetes 架构

```
┌─────────────────────────────────┐
│           Master               │
│  ┌───────┐ ┌───────┐ ┌───────┐ │
│  │ API   │ │Sched-  │ │ Ctrl  │ │
│  │Server │ │ uler  │ │Manager│ │
│  └───────┘ └───────┘ └───────┘ │
└─────────────────────────────────┘
           ↓
┌─────────────────────────────────┐
│           Node                  │
│  ┌───────┐ ┌───────┐ ┌───────┐ │
│  │ Kub-  │ │  Pod  │ │  Pod  │ │
│  │  elet │ │       │ │       │ │
│  └───────┘ └───────┘ └───────┘ │
└─────────────────────────────────┘
```

### 8.3 CI/CD 流程

```
Code → Build → Test → Scan → Push → Deploy
 │      │       │      │      │       │
 └──────┴───────┴──────┴──────┴───────→ ArgoCD/GitOps
```

---

## 九、架构决策参考

### 9.1 技术选型矩阵

| 需求 | 首选 | 备选 |
|------|------|------|
| 高并发 API | Go / Java | Node.js / Rust |
| 数据处理 | Java / Python | Go |
| 实时系统 | Go / Rust | C++ |
| 快速原型 | Node.js / Python | Go |
| 机器学习 | Python | Go / Java |

### 9.2 性能优化路径

```
1. 代码优化
   ↓
2. 缓存（本地 → 分布式）
   ↓
3. 数据库优化（索引 → 分库分表）
   ↓
4. 读写分离
   ↓
5. 异步化
   ↓
6. 水平扩容
```

### 9.3 可扩展性原则

**YAGNI**：不提前实现不需要的功能
**KISS**：保持简单
**DRY**：不重复
**SOLID**：
- 单一职责
- 开闭原则
- 里氏替换
- 接口隔离
- 依赖倒置

---

## 十、项目实践（ScreenWall2 参考）

### 10.1 ScreenWall2 当前架构

```
客户端（Python D3D11）
    ↓ WebSocket + Buffer 二进制
服务端（Node.js + Socket.IO）
    ↓ 广播
前端（main.html / monitor-wall.html）
```

**帧类型**：统一 0x10（二进制 WebP 流）
**帧率**：6fps（客户端控制）
**分辨率**：480×270（格子）/ 1280×1080（1080p 预览，横向压缩）

### 10.2 关键决策记录

| 日期 | 决策 | 结果 |
|------|------|------|
| 2026-05-02 | 移除 HQ 独立通道，统一预览流 | ✅ 简化架构 |
| 2026-05-08 | 二进制 Buffer 替代 base64 | ✅ 体积减少 33% |
| 2026-05-08 | 帧率 8fps → 6fps | ✅ 降低负载 |
| 2026-05-08 | 统一 WebP 质量至 30 | ✅ 统一参数 |
| 2026-05-12 | 统一帧类型为 0x10 | ✅ 简化代码 |

---

*本文档持续更新中*
