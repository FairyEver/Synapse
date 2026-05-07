# Synapse 代码结构性优化设计

日期：2026-05-07
范围：代码解耦、复用性优化、架构健壮性提升（不新增功能）

## 策略

由内而外分三阶段：先建共享基础设施层，再拆主进程大文件，最后拆渲染进程大文件。

## Phase 1：基础设施层

### 1.1 共享验证 Schema 库

位置：`electron/runtime/ipc/schemas.ts`

提取跨模块复用的基础 schema：

- `projectRequestSchema` — `z.object({ projectId: z.string().min(1) })`
- `paginationSchema` — `z.object({ limit, offset })`
- `repositoryUuidSchema` — `z.object({ repositoryUuid: z.string().min(1) })`

各模块改为 import 后 `.extend()` 自己的字段。不改运行时行为。

### 1.2 Service 层错误处理规范化

不引入新错误类，修正不一致：

- IO/网络操作：必须 try/catch，log 后 throw 或 fallback
- 文件存在性检查：`.catch(() => null)` 保留
- 静默吞错：逐个审查 17 处，不合理的改为 `logger.warn` + 适当处理

### 1.3 复杂状态管理模式

约定（Phase 3 执行）：

- 超过 5 个相关联的 useState → 改用 `useReducer` + typed action
- useRef 用于跨渲染追踪的 → 评估纳入 reducer state 或提取为独立 hook

## Phase 2：主进程大文件拆分

### 2.1 database/service.ts（2263 行）

拆分为：

| 文件 | 职责 |
|------|------|
| `service.ts` | facade，持有连接，委托调用 |
| `query-builder.ts` | WHERE 子句、排序、分页、combinator |
| `schema-manager.ts` | 表/列 CRUD、metadata |
| `import-export.ts` | 数据导入导出、备份恢复 |
| `type-coercion.ts` | boolean/JSON/multi-choice 读写转换 |
| `validators.ts` | 行数据验证、choice/列名规则校验 |

外部消费者（CLI/MCP/HTTP/IPC）调用方式不变。

### 2.2 agent-runtime-service.ts（1920 行）

拆分为：

| 文件 | 职责 |
|------|------|
| `agent-runtime-service.ts` | 编排层，管理会话生命周期 |
| `session-manager.ts` | 会话创建/销毁/列表/持久化 |
| `message-router.ts` | 消息收发、流式响应处理 |
| `tool-dispatcher.ts` | 工具调用路由与执行 |
| `state-tracker.ts` | 运行状态追踪、超时、重试 |

### 2.3 其他主进程大文件

| 文件 | 行数 | 拆分策略 |
|------|------|----------|
| `connectors/feishu/connector-service.ts` | 1561 | OAuth 流程 / 消息同步 / workspace 管理 |
| `diagnostics-service.ts` | 1234 | 系统信息 / Git 状态 / 编辑器状态 / 网络检查 |
| `bridge-adapter-service.ts` | 1054 | 按编辑器类型拆分适配逻辑 |

### 2.4 IPC 大文件

- `modules/agent/ipc.ts`（850 行）→ `ipc-sessions.ts` / `ipc-messages.ts` / `ipc-tools.ts`，主 `ipc.ts` 作为注册入口聚合

## Phase 3：渲染进程拆分

### 3.1 content-browser-page.tsx（1092 行）

拆分为：

| 文件 | 职责 |
|------|------|
| `content-browser-page.tsx` | 页面壳，布局编排 + 页面级状态 |
| `content-filter-bar.tsx` | 筛选条件（类型/标签/仓库） |
| `content-list.tsx` | 列表渲染 + 分页 |
| `content-bulk-actions.tsx` | 批量选择 + 操作栏 |
| `content-search.tsx` | 搜索输入 + 搜索逻辑 |

子组件通过 props 通信，不引入新 Context。

### 3.2 use-agent-chat.ts（770 行，15 useState）

拆分为：

| 文件 | 职责 |
|------|------|
| `use-agent-chat.ts` | 入口 hook，组合子 hook |
| `use-chat-reducer.ts` | state type + action type + reducer 函数 |
| `use-chat-messages.ts` | 消息列表管理、追加、流式更新 |
| `use-chat-connection.ts` | IPC 连接、发送、断开、重连 |
| `use-chat-scroll.ts` | 滚动位置追踪、自动滚底 |

15 个 useState 全部收入 useReducer，状态转换集中可测试。

### 3.3 其他渲染进程大文件

| 文件 | 行数 | 拆分策略 |
|------|------|----------|
| `feishu-connector-panel.tsx` | 805 | OAuth 配置 / workspace 绑定 / 同步状态 |
| `data-table-view.tsx` | 771 | table toolbar / column config / row actions |
| `repository-list-editor.tsx` | 697 | 列表 + 编辑表单 + 操作确认对话框 |
| `skill-create-dialog.tsx` | 675 | 基础信息 / 内容编辑 / 附件管理 |

## 约束

- 不引入新状态管理库（不加 Zustand/Redux）
- 不引入新 IPC 抽象层（不加 React Query 式缓存）
- 不改变模块边界（当前模块划分已合理）
- 不改变对外 API（路由、IPC channel、preload bridge 签名不变）
- 不新增功能

## 验收标准

- 所有拆分后的文件不超过 300 行
- TypeScript 编译通过，无新增 `any`
- 共享 schema 消除所有重复的 `projectRequestSchema` 定义
- 静默吞错逐个审查并修正
- `use-agent-chat` 的 useState 数量从 15 降到 0（全部收入 reducer）

## 执行依赖

```
Phase 1.1 + 1.2 → Phase 2（主进程拆分依赖共享 schema）
Phase 1.3 → Phase 3（渲染进程拆分依赖状态管理约定）
Phase 2 与 Phase 3 可并行
```
