# Server 全面加固设计

## 背景

Synapse 后台服务（NestJS + PostgreSQL）即将进入团队内部试用。当前服务功能基本完整，但在安全、可观测性、API 完整性、测试覆盖和运维方面存在系统性短板。本设计覆盖全面审计发现的所有问题，拆为四个子项目依次实施。

## 子项目总览

| # | 子项目 | 范围 | 依赖 |
|---|--------|------|------|
| 1 | 安全加固 + 运维基础 | 速率限制、安全头、JWT 修正、日志、健康检查、优雅关闭、全局错误处理 | 无 |
| 2 | API 完整性 | 分页/过滤/排序、CRUD 补全、清理任务、审计日志 | 子项目 1（依赖全局错误处理和日志） |
| 3 | 测试体系 | 集成测试、Controller 测试、错误场景测试、覆盖率 | 子项目 1 + 2（测试对象需先就位） |
| 4 | Admin 后台增强 + 部署加固 | 批量操作、导出、session 管理、审计日志 UI、Docker 安全 | 子项目 2（依赖审计日志表和批量端点） |

---

## 子项目 1：安全加固 + 运维基础

### 1.1 速率限制

引入 `@nestjs/throttler`，按端点类型分级限制：

| 端点类别 | 限制 | 窗口 |
|----------|------|------|
| 公共 API（redeem/renew/validate） | 10 次/IP | 1 分钟 |
| Admin 登录 | 5 次/IP | 1 分钟 |
| Admin API | 60 次/IP | 1 分钟 |
| `/v1/license/config`（只读） | 30 次/IP | 1 分钟 |

### 1.2 安全中间件

- 引入 `helmet` 设置安全头（HSTS、CSP、X-Frame-Options、X-Content-Type-Options）
- 配置 CORS：生产环境禁止跨域（admin 前端与 API 同源部署），开发环境允许 localhost 各端口
- Admin cookie `sameSite` 从 `lax` 改为 `strict`

### 1.3 JWT / Token 修正

- 用 `@nestjs/jwt` 替换 `admin-auth.service.ts` 中的自定义 JWT 实现
- Admin token 增加 `exp`（默认 24 小时）和 `iat` 声明
- Lease token 验证时增加过期时间检查（当前 `verifyLicenseLease` 未校验 `exp`）
- 环境变量约束加强：密码最低长度 8 → 12，JWT secret 最低长度 16 → 32

### 1.4 结构化日志

引入 `nestjs-pino`（基于 Pino），JSON 格式输出：

- 自动记录每个请求的 method、path、statusCode、responseTime
- 关键业务事件手动记录：激活成功/失败、风险评估决策、admin 写操作
- 敏感字段脱敏：email 只记录前缀 + hash，IP 记录但标记为 PII
- 开发环境用 `pino-pretty` 可读输出，生产环境纯 JSON

### 1.5 健康检查 + 优雅关闭

- 引入 `@nestjs/terminus`，暴露 `GET /health` 端点
- 健康检查项：数据库连通性（Prisma `$queryRaw`）
- `main.ts` 启用 `app.enableShutdownHooks()`
- PrismaService `onModuleDestroy` 增加 10 秒超时强制断开
- 关闭期间健康检查返回 503

### 1.6 全局错误处理

实现 `AllExceptionsFilter`，统一响应格式：

```json
{
  "error": "Conflict",
  "message": "激活码已存在",
  "statusCode": 409
}
```

Prisma 异常映射：
- `P2002`（唯一约束冲突）→ 409 Conflict
- `P2025`（记录不存在）→ 404 Not Found
- 其他 Prisma 错误 → 500 Internal Server Error

生产环境隐藏堆栈信息，开发环境保留。

---

## 子项目 2：API 完整性

### 2.1 统一分页 / 过滤 / 排序

所有列表端点统一查询参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码，从 1 开始 |
| `pageSize` | number | 20 | 每页条数，最大 100 |
| `sortBy` | string | `createdAt` | 排序字段 |
| `sortOrder` | `asc` \| `desc` | `desc` | 排序方向 |

统一响应格式：

```json
{
  "data": [],
  "total": 150,
  "page": 1,
  "pageSize": 20
}
```

各端点过滤支持：
- Activation Codes：`status`、`createdAt` 范围（`from`/`to`）
- Accounts：`email`（模糊搜索）、`status`
- Devices：`status`、`licenseId`
- Activation Attempts：移除硬编码 `take: 100`，走统一分页

### 2.2 CRUD 补全

| 资源 | 缺失操作 | 实现方式 |
|------|----------|----------|
| Licenses | GET 列表、GET 单个 | 新增端点，支持分页 |
| Accounts | PATCH 更新状态 | 新增 `PATCH /admin/api/accounts/:id/status` |
| Devices | DELETE | 软删除，标记为 `revoked`，走 `PATCH /admin/api/devices/:id/status` |

端点命名统一规则：
- 状态变更：`PATCH /:id/status`
- 归档：`PATCH /:id/archive`
- 列表：`GET /`（带分页参数）
- 详情：`GET /:id`

### 2.3 激活记录清理

- 引入 `@nestjs/schedule`，用 `@Cron` 装饰器实现定时任务
- 默认每天 03:00 清理超过保留期的 ActivationAttempt 记录
- 保留天数通过 `ATTEMPT_RETENTION_DAYS` 环境变量配置，默认 90 天
- 清理时记录日志：删除条数、耗时

### 2.4 审计日志

新建 Prisma 模型：

```prisma
model AuditLog {
  id         String   @id @default(cuid())
  adminId    String
  action     String   // e.g. "activation_code.create", "device.revoke"
  targetType String   // e.g. "ActivationCode", "Device"
  targetId   String
  detail     Json?
  ipAddress  String
  createdAt  DateTime @default(now())

  @@index([action, createdAt])
  @@index([targetType, targetId])
  @@index([createdAt])
}
```

- 通过 NestJS Interceptor 自动捕获所有 admin 写操作（POST/PATCH/DELETE）
- Interceptor 从请求中提取 adminId、action、target 信息，写入 AuditLog
- 提供 `GET /admin/api/audit-logs` 查询端点（带分页、按 action/时间过滤）

---

## 子项目 3：测试体系

### 3.1 集成测试

- 测试数据库：用 Docker Compose 启动独立 PostgreSQL 实例（端口 5433 避免冲突）
- 每个测试套件前执行 `prisma migrate reset` 保证干净状态
- 测试场景覆盖：
  - 完整激活流程：创建激活码 → 兑换 → 续约 → 验证 → 设备管理
  - 风险检测流程：多次失败触发锁定 → admin 解锁 → 重新激活
  - 边界场景：过期激活码、超出设备上限、并发兑换同一码
  - 分页/过滤：验证各列表端点的分页参数和过滤逻辑

### 3.2 Controller 测试

用 NestJS `Test.createTestingModule` + mock service 层：

- LicensesController：输入校验（Zod 拒绝畸形数据）、错误映射、响应格式
- AdminController：权限守卫拦截未认证请求、分页参数解析、审计日志触发
- AdminAuthController：登录/登出流程、cookie 设置正确性、速率限制触发

### 3.3 错误场景测试

- 数据库断连：健康检查返回 503，业务请求返回 500
- 无效/过期 token：返回 401
- 速率限制触发：返回 429 + `Retry-After` 头
- 畸形请求体：返回 400 + 具体校验错误信息

### 3.4 覆盖率配置

- vitest.config.ts 增加 `@vitest/coverage-v8`
- 覆盖率阈值：
  - `licenses.service.ts`、`activation-risk.service.ts`：最低 80%
  - 整体：最低 60%
- 覆盖率报告输出到 `coverage/` 目录

---

## 子项目 4：Admin 后台增强 + 部署加固

### 4.1 批量操作

- 列表页增加 checkbox 多选
- 新增批量端点：
  - `POST /admin/api/activation-codes/batch` — 批量归档/更新状态
  - `POST /admin/api/devices/batch` — 批量更新设备状态
- 请求体：`{ ids: string[], action: "archive" | "updateStatus", status?: string }`
- 每次上限 50 条，超出返回 400
- 批量操作产生的审计日志逐条记录（每个 ID 一条）

### 4.2 数据导出

- `GET /admin/api/activation-codes/export?format=csv` — 导出激活码列表
- `GET /admin/api/audit-logs/export?format=csv` — 导出审计日志
- 后端生成 CSV，设置 `Content-Disposition: attachment` 头
- 支持与列表相同的过滤参数（导出的是过滤后的结果）
- 单次导出上限 10000 条

### 4.3 Session 管理

- Admin token 24 小时过期（子项目 1 已实现后端）
- 前端增加空闲检测：30 分钟无鼠标/键盘操作自动调用登出接口
- 登出清除 cookie + 重置前端状态 + 跳转登录页

### 4.4 审计日志 UI

- Admin 后台新增「审计日志」页面，入口在侧边栏
- 表格展示：时间、操作者、操作类型、目标、详情摘要
- 支持按操作类型下拉过滤、时间范围选择
- 走子项目 2 实现的分页接口
- 支持 CSV 导出（走 4.2 的导出端点）

### 4.5 Docker 加固

- Dockerfile 增加非 root 用户：`USER node`
- 增加 `HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/health || exit 1`
- 添加 `.dockerignore`：排除 `node_modules`、`.git`、`*.spec.ts`、`.env`、`coverage/`
- compose.yml 增加资源限制注释（`mem_limit: 512m`、`cpus: '0.5'`）

### 4.6 数据库连接池

- 新增 `DATABASE_POOL_SIZE` 环境变量，默认 10
- Prisma datasource URL 追加 `?connection_limit=${DATABASE_POOL_SIZE}`
- env.ts 中增加 Zod 校验：`z.coerce.number().min(1).max(100).default(10)`

---

## 实施顺序

```
子项目 1（安全 + 运维）
    ↓
子项目 2（API 完整性）
    ↓
子项目 3（测试体系）
    ↓
子项目 4（Admin + 部署）
    ↓
统一验收
```

## 不在范围内

以下问题已知但不在本次改进范围：

- 多管理员账号 / 角色权限（RBAC）— 当前单管理员足够内部使用
- API 版本迁移策略（v1 → v2）— 无破坏性变更需求
- 数据加密存储（email、device info）— 内部使用阶段风险可控
- 负载均衡 / 多实例部署 — 当前规模不需要
- 前端 E2E 测试（Playwright）— Admin 后台 UI 复杂度不高，手动验证即可
