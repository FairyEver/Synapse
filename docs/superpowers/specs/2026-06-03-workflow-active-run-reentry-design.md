# Workflow Active Run Re-entry Design

## 背景

用户从工作流编辑页或列表页启动运行后，Synapse 会打开独立 Runner 窗口。当前用户关闭 Runner 窗口后，运行仍在后台继续，但主界面没有稳定入口能重新查看进度。列表可能显示“执行中”，但该状态只来自 renderer 本地事件监听，没有保留可点击的 `runId`。运行历史也看不到该实例，因为历史只读取终态 snapshot，而 snapshot 只在 `completed`、`failed` 或 `cancelled` 时写入磁盘。

这导致用户看到工作流正在运行，却无法回到运行详情。

## 目标

- 正在运行的工作流必须能从工作流列表重新打开 Runner。
- 正在运行的实例必须出现在运行历史顶部，状态为“执行中”。
- 关闭 Runner 窗口不影响运行，也不丢失重新查看进度的入口。
- 终态历史继续使用现有 snapshot 存储。
- 改动保持在 workflow 模块内，不改变 Editor / Runner 分离模型。

## 非目标

- 不做应用重启后的运行恢复。
- 不把所有运行过程持续写入磁盘。
- 不引入新的运行持久化 store。
- 不改变工作流引擎执行模型。
- 不改变 Runner 的实时事件订阅和 `runStatus(runId)` hydrate 方式。

## 当前实现

主进程中：

- `startRunWithLifecycle()` 在内存 `runStatuses` 中写入 running 状态。
- `runCompletions` 和 abort controller 也只存在内存中。
- `RunSnapshotService.save()` 只在 workflow terminal event 或 engine rejection 时调用。
- `runHistory(workflowId)` 只调用 `RunSnapshotService.list(workflowId)`。
- `runStatus(runId)` 优先读内存 `runStatuses`，找不到时再从 snapshot hydrate。

Renderer 中：

- `WorkflowList` 通过 `workflow.onEvent` 监听 `workflow:started`，只保存每个 workflow 的展示状态。
- `WorkflowCard` 能显示“执行中” badge，但没有 active `runId`，不能打开当前 Runner。
- `RunHistoryDialog` 只展示终态 snapshots，状态标签没有 running 分支。
- `WorkflowRunnerApp` 已经可以通过 `runStatus(runId)` 恢复 active run 的定义、参数和节点状态。

## 推荐方案

将“运行历史”从“终态 snapshot 列表”扩展为“可查看运行实例列表”：主进程返回 active runs + terminal snapshots，Renderer 统一展示。

### Run List Item

新增 UI 查询类型 `WorkflowRunListItem`，用于运行历史和列表 active-run 查询。该类型覆盖 active run 和 terminal snapshot 的共同字段：

```ts
interface WorkflowRunListItem {
  runId: string
  workflowId: string
  status: "running" | "completed" | "failed" | "cancelled"
  startedAt: number
  endedAt?: number
  durationMs?: number
  nodeResults: Record<string, NodeRunResult>
  params?: Record<string, unknown>
  definition?: WorkflowDefinition
  error?: string
}
```

保留 `WorkflowRunSnapshot` 的终态约束，不把 snapshot 类型改成 running。

### Main Process

在 workflow IPC 层新增一个纯函数用于按 workflow 合并运行记录：

1. 从 `runStatuses` 找出 `workflowId` 匹配且 `status === "running"` 的 active runs。
2. 将 active runs 映射为 `WorkflowRunListItem`。
3. 从 `RunSnapshotService.list(workflowId)` 读取 terminal snapshots，并映射为 `WorkflowRunListItem`。
4. 按 `startedAt` 倒序排序，保证 active run 在顶部；如果时间相同，active run 优先。

`runHistory(workflowId)` 返回 `WorkflowRunListItem[]`，而不再是纯 `WorkflowRunSnapshot[]`。

为列表页新增批量 `activeRuns()` IPC，返回所有 running 工作流的 `WorkflowRunListItem[]`。列表加载后将这些 active runs 按 `workflowId` 合并到卡片状态中。使用批量接口避免每个 workflow 单独发起一次 IPC，也避免用户重新进入工作流模块后缺少直接入口。

### Renderer List

`WorkflowList` 的 run state 从单纯状态值改为包含 `runId`：

```ts
type WorkflowCardRunState = {
  status: WorkflowRunStatus["status"]
  runId?: string
}
```

行为：

- 首次加载列表后查询 active runs，并填充对应 workflow 的 run state。
- 收到 `workflow:started` 事件时记录 `{ status: "running", runId }`。
- 收到 terminal 事件时保留终态状态，但清掉 active `runId`。
- `WorkflowCard` 有 active `runId` 时提供“查看进度”入口，调用 `openRunner(meta.id, runId)`。
- 运行按钮继续用于启动新运行。若存在 active run，现有冲突确认流程不变。

UI 文案保持克制：使用“执行中”“查看进度”“运行历史”等必要文本，不增加解释性说明。

### Run History Dialog

`RunHistoryDialog` 改为消费 `WorkflowRunListItem[]`：

- `running` badge 显示“执行中”。
- running 记录显示开始时间、已产生节点数；没有 duration 时不显示耗时。
- 点击 running 记录打开 Runner。
- terminal 记录沿用现有展示和点击逻辑。
- 空状态仍为“暂无运行记录。”，因为 active run 会计入记录。

### Runner

Runner 不需要改运行恢复主流程：

- 仍由 `openRunner(workflowId, runId)` 打开或聚焦。
- 仍通过 `runStatus(runId)` hydrate。
- 仍订阅 `workflow.onEvent` 做实时更新。

如果用户从历史打开 active run，Runner 的表现应与首次运行后自动打开一致。

## 数据流

### 从列表重新进入 active run

```text
WorkflowList mounted
  -> workflow.list()
  -> workflow.activeRuns()
  -> merge active run state into cards

User clicks 查看进度
  -> workflow.openRunner(workflowId, runId)
  -> WorkflowRunnerApp
  -> workflow.runStatus(runId)
  -> subscribe workflow.onEvent
```

### 从历史重新进入 active run

```text
User opens 运行历史
  -> workflow.runHistory(workflowId)
      -> active runs from runStatuses
      -> terminal snapshots from RunSnapshotService
      -> sorted run list
  -> User clicks 执行中 record
  -> workflow.openRunner(workflowId, runId)
```

### Run completes while dialog is open

Terminal event updates `runStatuses` and writes snapshot. `RunHistoryDialog` listens to workflow events for the current workflow and reloads after `workflow:completed`、`workflow:failed` 或 `workflow:cancelled`，让已打开的历史弹窗自动把记录从“执行中”更新为终态，不要求用户关闭后重开。

## Error Handling

- 如果 `activeRuns()` 失败，列表仍展示工作流定义并记录脱敏 warning；本次渲染可以不展示 active re-entry。
- 如果 `runHistory()` 失败，保留现有弹窗错误态和重试按钮。
- 如果从卡片或历史调用 `openRunner()` 失败，展示现有通用 toast 并记录脱敏诊断。
- 如果 `runStatus(runId)` 后续返回 null，Runner 保持现有 fallback 行为。

## Testing

Main process:

- `runHistory()` returns active running item before snapshots.
- `runHistory()` returns only snapshots when no active run exists.
- active run item includes `runId`, `workflowId`, `startedAt`, `nodeResults`, `definition`, and `params`.
- terminal snapshots are not duplicated when a run has already completed.
- `activeRuns()` returns all running workflow items and excludes terminal statuses.

Renderer:

- `WorkflowList` loads active runs and passes active `runId` to `WorkflowCard`.
- `WorkflowCard` opens Runner when the active progress entry is clicked.
- `WorkflowList` updates active `runId` from `workflow:started`.
- `WorkflowList` clears active `runId` on terminal events.
- `RunHistoryDialog` renders running records with “执行中”.
- Clicking a running history record calls `openRunner(workflowId, runId)`.

Regression:

- Existing terminal history still opens Runner.
- Existing run conflict behavior is unchanged.
- Existing run report and Runner hydration tests still pass.

## Release Note

Record this change in `RELEASE_NOTES_PENDING.md` during implementation because it fixes a user-visible workflow navigation issue: users can return to an in-progress workflow run after closing the runner window.
