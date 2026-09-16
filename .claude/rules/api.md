---
name: api
paths:
  - desktop/electron/**/*.ts
  - desktop/app-capabilities/**/*.ts
  - desktop/synapse-capabilities/**/*.ts
  - desktop/database/**/*.ts
---

# 主进程 Service / IPC Handler 设计约定

## IPC Handler

- 按领域拆分文件：`electron/ipc/<domain>-handlers.ts`
- 使用 `validated-ipc.ts` 封装，确保类型安全
- handler 只做参数校验和调度，业务逻辑下沉到 service
- capability 和 IPC operation id 统一使用 `app.<namespace>.<resource>.<action>`。IPC descriptor 只声明 operation id，channel 统一派生为 `synapse:app:<namespace>:<resource>:<action>`。
- capability 对应的 preload bridge 去掉 `app` 前缀、snake_case 转 camelCase，并按资源嵌套，例如 `app.database.table.list` 对应 `window.synapse.database.table.list()`。
- UI 专用 IPC 可以使用独立的规范 operation id，但没有同语义 capability 时不得注册 MCP 工具。旧 action、channel 和 bridge 名称不得保留兼容入口。

## Service 层

- 每个领域一个 service：`electron/services/<domain>-service.ts`
- service 之间可以互相调用，但避免循环依赖
- 文件/网络 IO 必须 try/catch，返回结构化错误

## Editor Adapter

- 编辑器集成通过 adapter 模式：`electron/services/editor-adapters/<editor>-adapter.ts`
- 新增编辑器只需实现 adapter 接口，不改核心逻辑
- 内容安装使用原子操作（写临时文件 → rename）

## Database

- SQLite 数据层在 `electron/database/`
- 四种访问接口：CLI / MCP / HTTP / IPC，共享同一个 service 层
- 查询逻辑集中在 `database/service.ts`，不在各接口层重复

## Capability API

- 本地 HTTP 路径保持 `POST /api`，请求体 `action` 必须是已注册的规范 `app.*` capability id。
- MCP 工具名只能由 capability id 把点号替换为下划线得到，例如 `app.database.table.list` 对应 `app_database_table_list`。
- 唯一例外：公开 MCP 表面额外暴露两个路由包装工具 `search` 与 `invoke`。它们不对应任何 capability id，不得注册进 capability catalog 或 `MCP_TOOL_ACTIONS`，也不得出现在 `app.*` 命名空间里。除这两个名字外不得新增非 `app_*` 的公开工具名。
- dispatcher 直接接收规范 action；禁止旧 action 转译、别名、fallback 或双重注册。

## 分页约定

- 分页工具必须在自己的 description 里声明分页风格与续页字段，句式统一为 `Pagination: <cursor|offset>-based. <如何续页>`，位置在 `Permissions:` 页脚之前。
- 两种风格语义不同，不得互相替换：
  - `cursor`：不可随机访问、无总数；游标绑定查询，改任何过滤条件都从头开始。用于高频增删、需要抗漂移的数据（终端会话）。
  - `offset`：可随机访问；翻页期间数据变动会重复或漏项。用于需要页码或总数的数据（数据库行、Drive 列表）。
- 续页字段名必须与实现一致：`nextCursor`、`nextOffset`、`page.nextOffset`；没有续页字段时用 `total`，并在句式里写明由调用方自行计算。
- 不得声明实现不消费的分页参数：description 或 schema 接受了 `limit` / `cursor` / `offset`，就必须真的按它分页。

## 日志

- 主进程：`createMainLogger(module)` from `log-store.ts`
- 渲染进程日志通过 IPC 转发到主进程统一写盘
