---
name: api
paths:
  - desktop/electron/**/*.ts
---

# 主进程 Service / IPC Handler 设计约定

## IPC Handler

- 按领域拆分文件：`electron/ipc/<domain>-handlers.ts`
- 使用 `validated-ipc.ts` 封装，确保类型安全
- handler 只做参数校验和调度，业务逻辑下沉到 service

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

## 日志

- 主进程：`createMainLogger(module)` from `log-store.ts`
- 渲染进程日志通过 IPC 转发到主进程统一写盘
