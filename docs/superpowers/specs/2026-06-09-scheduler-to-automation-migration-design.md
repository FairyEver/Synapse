# 定时任务迁移到自动化设计

## 背景

定时任务模块需要为后续下线做准备。现阶段先在每个定时任务上提供“迁移到自动化”能力，将单个旧任务转换成自动化条目。迁移成功后旧定时任务删除，不保留为可继续运行的副本。

现有自动化模块已经具备独立的 item/run 存储、trigger registry、executor registry、运行历史和编辑窗口。迁移功能应复用这些能力，不新增第二套执行逻辑。

## 目标

- 每个定时任务都能手动迁移到自动化。
- 迁移成功后删除原定时任务，避免旧任务和新自动化双跑。
- 运行中的任务迁移时先停止当前运行，再创建自动化并删除旧任务。
- 定时任务运行历史不迁移，自动化从迁移后重新记录运行历史。
- 配置失效的任务允许迁移，但新自动化默认停用。
- 迁移流程按明确阶段处理失败与回滚，失败时不留下两个启用对象。

## 非目标

- 不做批量迁移。
- 不自动跳转到自动化页面或编辑窗口。
- 不复制定时任务运行历史、runCount、lastRunAt、lastStatus、nextRunAt 或 activeRun。
- 不在定时任务页面增加“即将下线”横幅或解释性文案。
- 不改变定时任务和自动化的执行器实现。
- 不新增依赖。

## 用户流程

每张定时任务卡片增加一个“迁移到自动化”图标按钮，位于卡片底部操作区，放在“历史”和“删除”之间。按钮使用 lucide 图标和现有 `Button` / `Tooltip` 组合，tooltip 文案为“迁移到自动化”。

点击按钮后打开确认弹窗。弹窗只保留必要信息：

- 普通任务：`迁移成功后，此任务会被删除。运行历史不会迁移。`
- 运行中任务：`将先停止当前运行。迁移成功后，此任务会被删除。运行历史不会迁移。`
- 配置需要更新的任务：`新自动化会保持停用。迁移成功后，此任务会被删除。运行历史不会迁移。`

确认按钮为“迁移”，提交中显示“迁移中...”。迁移成功后关闭弹窗、刷新定时任务列表，并提示“已迁移到自动化”。迁移失败时弹窗保持打开，提示“迁移失败”。

## 主进程 API

新增一个窄 IPC：

```ts
taskScheduler.migrateTaskToAutomation({ taskId })
```

返回：

```ts
{
  automationId: string
  deletedTaskId: string
}
```

迁移逻辑放在主进程服务层，前端只发起一次迁移请求，不串联 `stopRun`、`createAutomation` 和 `deleteTask`。

在 task scheduler 主进程模块内新增迁移 helper，并由 IPC handler 调用。迁移 helper 依赖 `TaskSchedulerService`、task repository、scheduler execution service 和 `AutomationService`，但不把 automation 业务逻辑散落到 renderer。

## 迁移流程

1. 读取定时任务；不存在则报错。
2. 如果任务存在运行中的 run，调用 scheduler stop 并等待 settle。
3. 停止后重新读取任务，避免运行结束期间状态变化。
4. 校验并构建 `AutomationCreateInput`。
5. 创建自动化。
6. 删除旧定时任务。
7. 删除旧任务成功后返回新自动化 ID 和旧任务 ID。
8. 触发 scheduler 和 automation 的变更事件，让两个页面刷新。

## 数据映射

- `task.name -> automation.name`
- `task.description -> automation.description`
- `task.scope -> automation.scope`
- `task.cwd -> automation.cwd`
- `task.action -> automation.executor`
- `task.missedRunPolicy -> automation.policy.missedRunPolicy`
- `automation.policy.overlapPolicy` 固定为 `skip`
- `task.trigger -> automation.trigger`

`activeDays` 写入自动化 trigger config：

```ts
// cron
{
  type: "builtin.cron",
  config: {
    expr,
    timezone,
    activeDays,
  },
}

// interval
{
  type: "builtin.interval",
  config: {
    everyMinutes,
    anchor,
    activeDays,
  },
}
```

启用状态规则：

- 原任务启用且配置有效：新自动化启用。
- 原任务停用：新自动化停用。
- 原任务配置失效：新自动化停用。

迁移不复制：

- run history
- runCount
- lastRunAt
- lastStatus
- nextRunAt
- activeRun
- configVersion

## 配置失效任务

如果旧任务 `validation.status === "needs_update"`，迁移仍然允许继续。新自动化创建时 `enabled` 必须为 `false`。自动化服务自身的配置校验会在列表读取时继续标记“需要更新”，用户之后通过自动化编辑器修复。

如果配置结构已经无法被自动化 trigger 或 executor schema 接收，创建自动化会失败。此时旧任务必须保留，不删除。

## 运行中任务

迁移运行中任务时，确认后自动停止当前 run。停止失败或等待 settle 后仍无法确认停止时，不创建自动化，也不删除旧任务。

停止成功后不迁移当前运行历史。该 run 会在旧任务历史中结束，但旧任务最终会被删除，因此这段历史不会进入自动化。

## 失败与回滚

创建自动化失败：

- 保留旧定时任务。
- 不删除旧任务。
- 如果此前停止了运行，不自动恢复该运行。

删除旧定时任务失败：

- 优先删除刚创建的自动化。
- 回滚成功后保留旧定时任务，并提示迁移失败。
- 回滚失败时，必须确保旧任务和新自动化都处于停用状态，再抛出错误。

事件刷新失败不应影响迁移结果，但必须结构化记录日志。

## 日志与审计

迁移过程记录结构化日志，至少包含：

- 迁移开始和结束。
- taskId、automationId、triggerType、executorType。
- 是否运行中、是否执行 stop。
- 创建自动化是否成功。
- 删除旧任务是否成功。
- 回滚是否成功。

日志不得记录 executor config、HTTP header、token、Authorization、Cookie、env secret 或其它敏感正文。

如果现有 create/delete/stop 操作经过权限检查和审计，迁移 API 必须保持同等级别的权限与审计语义，不能因为组合操作绕过敏感操作记录。

## Renderer 设计

`TaskCard` 新增：

- `onMigrate: () => void`
- `migrateDisabled?: boolean`

`TaskCardGrid` 透传：

- `onMigrate: (task) => void`

`TaskSchedulerModule` 新增：

- `migrateTarget` 状态。
- `migratingTaskIds` 状态，避免同一任务重复提交，同时不阻塞其它任务卡片的查看操作。
- `handleMigrateTask(task)` 调用新的 bridge 方法。

迁移按钮禁用条件：

- 当前任务正在迁移。
- 全局 mutation busy 时可禁用，保持现有页面交互一致。

运行中任务不禁用迁移按钮，因为产品语义是“先停止再迁移”。

## Bridge 与类型

在以下位置补充迁移方法：

- `desktop/electron/modules/task-scheduler/ipc.ts`
- `desktop/electron/preload.ts`
- `desktop/src/types/bridge.ts`
- `desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts`

响应类型定义为：

```ts
type ScheduledTaskMigrationResult = {
  automationId: string
  deletedTaskId: string
}
```

## 测试

主进程测试：

- 有效启用任务迁移后旧任务删除，新自动化启用。
- 停用任务迁移后旧任务删除，新自动化停用。
- `needs_update` 任务迁移后旧任务删除，新自动化停用。
- 运行中任务迁移时会先 stop，再创建自动化并删除旧任务。
- stop 失败时不创建自动化，不删除旧任务。
- 创建自动化失败时不删除旧任务。
- 删除旧任务失败时删除刚创建的自动化。
- 删除旧任务失败且回滚失败时，两边都停用。
- cron 和 interval 的 `activeDays` 正确进入自动化 trigger config。
- 运行历史不复制到自动化 runs。

Renderer 测试：

- 每张任务卡片显示迁移按钮。
- 点击迁移按钮打开确认弹窗。
- 普通、运行中、needs_update 三种弹窗文案正确。
- 确认后调用迁移 bridge。
- 成功后刷新列表并关闭弹窗。
- 失败后保留弹窗并显示失败提示。

回归验证：

- `pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler`
- `pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler`
- `pnpm --filter @synapse/desktop run check:hard-constraints`

## 后续扩展

后续如需“一键迁移全部定时任务”，应复用本设计中的主进程迁移函数，并在批量流程中逐项执行、逐项记录结果。批量能力不属于本次范围。
