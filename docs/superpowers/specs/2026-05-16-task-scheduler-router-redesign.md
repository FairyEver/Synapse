# Task Scheduler 执行详情页 + react-router 全局迁移

日期: 2026-05-16

## 概述

本次改动包含两个紧密关联的部分：

1. **全局 react-router 迁移**：将 App.tsx 中基于 state 的 tab 切换替换为 `react-router-dom` 的 `MemoryRouter`，建立 flat route 路由表。
2. **Task Scheduler 执行详情页**：新增 `/task-scheduler/:taskId` 路由，提供实时运行状态轮询、最新运行结果展示，解决当前"点击运行后无反馈、无历史留存、loading 显示错乱"的问题。

## 第一部分：react-router 全局迁移

### 路由表

| 路径 | 组件 | 对应原 tab |
|------|------|-----------|
| `/` | redirect → `/rule` | — |
| `/rule` | `RulesModule` | `rule` |
| `/skill` | `SkillsModule` | `skill` |
| `/prompt` | `PromptsModule` | `prompt` |
| `/agent` | `AgentModule` | `agent` |
| `/database` | `DatabaseModule` | `database` |
| `/task-scheduler` | `TaskSchedulerListPage` | `task-scheduler` |
| `/task-scheduler/:taskId` | `TaskDetailPage` | **新增** |
| `/editor-scan` | `EditorScanModule` | `editor-scan` |
| `/token-usage` | `TokenUsageModule` | `token-usage` |
| `/workflow` | `WorkflowModule` | `workflow`（DEV only） |
| `/settings` | `SettingsModule` | `settings` |

### 关键决策

- **MemoryRouter**：Electron 没有地址栏，用 `MemoryRouter` 而非 `BrowserRouter`。初始路由 `/rule`。
- **导航栏**：`AppShellNavigation` 的 `onValueChange` 改为调用 `navigate(path)`。高亮状态根据 `useLocation().pathname` 前缀匹配（如 `/task-scheduler/:taskId` 仍高亮 `task-scheduler` tab）。
- **现有事件适配**：
  - `subscribeOpenAgentSession` → `navigate("/agent")`
  - `subscribeOpenSettingsTab` → `navigate("/settings")`
  - `subscribeContentOpenRequest` → `navigate("/" + request.contentType)`
  - `publishActiveAppTab` → 从 `useLocation().pathname` 提取 tab id 后 publish
- **AgentModule 持久化**：Agent 当前用 `className="contents"` + CSS hidden 保持挂载。迁移后需保持此行为。方案：Agent 始终渲染，非 `/agent` 路由时用 `display: none` 隐藏。其他模块不需要持久化。
- **Content dialog state**：保留现有 content dialog 状态管理机制，只改 tab 切换为 route navigation。
- **`activeTab` 计算**：从 `useLocation().pathname` 派生，用于 navigation highlight 和 `publishActiveAppTab`。不再作为独立 state。

### 迁移范围

- `App.tsx`：用 `MemoryRouter` + `Routes` + `Route` 替换 `activeTab` state 和条件渲染。
- `AppShellNavigation`：`value`/`onValueChange` 改为基于 pathname。
- `app-shell/navigation.ts` 中的 event subscribers：改为接收 navigate 函数而非 setActiveTab。
- 不修改各模块组件内部逻辑。

## 第二部分：Task Scheduler 执行详情页

### 当前问题

1. **无实时反馈**：`handleRunTask` 是 fire-and-forget，调用 `runTask` 后只显示 toast，没有后续状态更新。
2. **无运行结果查看入口**：运行结束后看不到结果，需要手动打开"历史"dialog。
3. **Loading 显示错乱**：`<LoaderCircle className="animate-spin" />` 旁的文字被 spin 动画影响。
4. **历史 dialog 不刷新**：`TaskRunsDialog` 只在打开时加载一次，没有轮询。

### 页面布局

```
┌──────────────────────────────────────────────┐
│  ← 返回列表    任务名称         [编辑] [运行] │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─ 任务概要 ──────────────────────────────┐ │
│  │  状态 Badge  ·  触发方式  ·  下次执行    │ │
│  │  供应商/模型（agent 任务）              │ │
│  └──────────────────────────────────────────┘ │
│                                              │
│  ┌─ 最新运行 ──────────────────────────────┐ │
│  │                                          │ │
│  │  [运行中]  手动触发  12:30:00            │ │
│  │                                          │ │
│  │  ──── 结果 ────                          │ │
│  │  summary text                            │ │
│  │  ┌─ stdout ─────────────────────┐        │ │
│  │  │ ...                          │        │ │
│  │  └──────────────────────────────┘        │ │
│  │  metrics: 2.3s · exit 0                  │ │
│  │                                          │ │
│  └──────────────────────────────────────────┘ │
│                                              │
│  [查看历史记录]                               │
│                                              │
└──────────────────────────────────────────────┘
```

### 状态机

```
idle → loading → running → completed / failed / cancelled
```

- **idle**：没有活跃 run。显示上一次 run 的结果（如果有），或空状态"尚未运行"。
- **loading**：用户点击了"运行"，等待 `runTask` IPC 返回。按钮变为 disabled + spinner。
- **running**：`runTask` 返回了 `status: "running"` 的 run。页面显示 spinner + 运行时长计时器。启动 2s 间隔轮询 `listRuns(taskId, { limit: 1 })`。
- **completed/failed/cancelled**：run 结束。展示完整 `ActionResultView`。停止轮询。刷新 task 信息。

### 轮询逻辑（`useTaskRunPolling`）

```typescript
// 输入
{ taskId: string; enabled: boolean }

// 行为
// 1. 挂载/taskId 变化时加载一次 getTask + listRuns(taskId, { limit: 1 })
// 2. 如果最新 run 的 status 是 "running"，启动 2s 间隔轮询
// 3. run 结束后停止轮询，刷新 task 信息
// 4. enabled=false 时清除轮询
// 5. 返回 { task, latestRun, loading, error, refresh, triggerRun }
```

### 运行按钮行为

- **从列表页卡片点击"运行"**：调用 `runTask(id)` → `navigate("/task-scheduler/" + taskId)`。
- **在详情页点击"运行"**：调用 `runTask(id)` → 原地刷新，进入 running 状态。
- **Agent 类型任务从详情页运行**：不调用 `requestWatchNextAgentSession`（用户已在详情页）。

### 新增文件

| 文件 | 职责 |
|------|------|
| `src/modules/task-scheduler/pages/task-detail-page.tsx` | 任务详情页主组件 |
| `src/modules/task-scheduler/hooks/use-task-run-polling.ts` | 轮询 hook |
| `src/modules/task-scheduler/components/task-latest-run.tsx` | 最新 run 展示组件 |
| `src/modules/task-scheduler/components/task-summary-bar.tsx` | 任务概要栏 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/modules/task-scheduler/index.tsx` | 重构为列表视图，"运行"按钮改为 navigate |
| `src/modules/task-scheduler/components/task-card.tsx` | "运行"按钮 onClick 传入 navigate handler |
| `src/App.tsx` | 引入 MemoryRouter，改写路由 |

### 保留文件

- `TaskRunsDialog`：保留，作为"查看历史记录"入口

## 第三部分：边界情况与错误处理

| 场景 | 处理 |
|------|------|
| 详情页加载时 taskId 不存在 | 显示"任务不存在"+ 返回列表按钮 |
| 正在轮询时任务被删除 | 下次轮询 `getTask` 返回 null → 显示"任务已被删除"+ 返回 |
| 正在轮询时 IPC 失败 | 保留当前展示数据，显示重试提示，不清空内容 |
| 同一任务重复运行（overlap） | 主进程 `overlapPolicy: "skip"` 已处理，详情页显示 skipped 状态 |
| 从列表页点运行但 navigate 时 run 已完成 | 详情页加载最新 run，直接显示结果 |
| 详情页手动运行 agent 任务 | 不调用 `requestWatchNextAgentSession` |

### Loading 状态修复

确保 `animate-spin` 只应用在 `<LoaderCircle>` icon 上，文字在 icon 旁边独立渲染，使用 `flex items-center gap-2` 布局。

### 新增 bridge 方法

无需新增。现有 `getTask`、`listRuns`、`runTask`、`stopRun` 已满足所有需求。

## 测试策略

- `useTaskRunPolling` hook 单元测试：轮询启停、状态转换、cleanup
- `TaskDetailPage` 组件测试：idle/running/completed 三态渲染
- 路由迁移冒烟测试：所有 tab 路由可正确加载对应模块
- 现有 task-scheduler 测试：确保列表、表单、历史 dialog 测试仍通过

## UI 规范

- 使用 shadcn 组件：`Button`、`Badge`、`ScrollArea`、`Separator`、`Card`
- 颜色使用 token：`bg-background`、`text-foreground`、`bg-card`、`text-muted-foreground`、`border-border`
- 不引入自定义颜色或装饰性样式
- 所有文案为用户导向的产品文案，不含技术术语
