# Automation Module Design

Date: 2026-06-03

## Context

Synapse already has a `定时` module backed by Task Scheduler. Its current shape is effectively an automation: a time trigger starts one registered action executor and writes run history. The old module must keep running and remain visible.

This design adds a new `自动化` module beside `定时`. The new module does not migrate, rename, or replace old scheduled tasks. It creates a clean product and code model for:

```text
Automation = one Trigger + one Executor
```

The first version is a structural reset of existing scheduled-task capability, not a feature expansion.

## Goals

- Add a new `自动化` navigation entry immediately to the right of `定时`.
- Keep old Task Scheduler UI, data, IPC, MCP tools, service, timers, and runtime behavior available.
- Create an independent Automation module with its own data, IPC, service, events, runs, and UI.
- Reuse existing Action Runtime executors for command, script, HTTP request, and Agent.
- Introduce a first-class Trigger Registry for cron and interval triggers.
- Keep each automation limited to one trigger and one executor.
- Move trigger-specific settings, including active days, into trigger config.
- Keep the first-version user-facing capability equivalent to current time-based scheduled tasks.
- Allow small old-scheduler helper refactors only when tests prove old behavior is unchanged.

## Non-Goals

- No migration from `task-scheduler.tasks` or `task-scheduler.runs`.
- No deletion, hiding, renaming, or behavioral change of the old `定时` module.
- No Webhook, file-change, user-action, database-change, or event trigger in this phase.
- No multi-trigger automation.
- No multi-executor automation.
- No Workflow executor in this phase.
- No `automation_*` MCP tools or external API replacement in this phase.
- No dedicated editor window in this phase.
- No custom visual system, custom colors, gradients, decorative styling, or marketing copy.

## Product Model

An Automation is a user-managed rule:

```text
When this trigger fires, run this executor.
```

One automation has exactly one trigger and exactly one executor. If the same executor should run under three conditions, users create three automations. If several operations need to run in sequence, in parallel, or with branching, that belongs to a future Workflow executor. Automation itself must stay focused on listening for one trigger and starting one executor.

## First-Version Capabilities

Triggers:

- `builtin.cron`
- `builtin.interval`

Executors:

- `builtin.command`
- `builtin.script`
- `builtin.http-request`
- `builtin.agent`

Runtime behavior:

- Manual run is supported.
- Running automation runs can be stopped.
- Missed scheduled runs default to skip, with `run_once` available as a policy.
- Overlapping runs for the same automation are skipped.
- Run history is retained per automation.

## Data Model

Use new namespaces:

```text
automation.items
automation.runs
```

Automation item:

```ts
type AutomationItem = {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  enabled: boolean
  scope:
    | { type: "global" }
    | { type: "project"; projectId: string }
  cwd?: string
  trigger: AutomationTriggerRef
  executor: AutomationExecutorRef
  policy: {
    missedRunPolicy: "skip" | "run_once"
    overlapPolicy: "skip"
  }
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: AutomationRunStatus
  activeRun?: { status: "running"; id?: string }
  validation?: AutomationValidation
  runCount: number
  configVersion: number
}
```

Trigger reference:

```ts
type AutomationTriggerRef = {
  type: string
  config: Record<string, unknown>
}
```

Executor reference:

```ts
type AutomationExecutorRef = {
  type: string
  config: Record<string, unknown>
}
```

Run record:

```ts
type AutomationRun = {
  id: string
  schemaVersion: 1
  automationId: string
  startedAt: string
  finishedAt?: string
  status: "running" | "success" | "failed" | "timeout" | "cancelled" | "skipped"
  triggeredBy: "trigger" | "manual" | "missed_run"
  triggerType: string
  executorType: string
  result?: ActionRunResult
  error?: string
}
```

## Trigger Registry

Add an Automation-specific trigger registry. It should mirror the discipline of Action Runtime while keeping Electron, renderer, and shared code separated.

Main trigger responsibilities:

- Register trigger definitions.
- Validate stored trigger config.
- Normalize default config.
- Compute next run time for schedule-based triggers.
- Provide a runtime guard such as active-day checks before execution.
- Produce concise summaries for logs and run records.

Renderer trigger responsibilities:

- Register trigger metadata.
- Render trigger choices.
- Render trigger config forms.
- Summarize selected trigger config.
- Validate form state before save.

First phase trigger packages:

```text
desktop/trigger-packages/builtin/cron/
  manifest.ts
  schema.ts
  scheduler.main.ts
  config.renderer.tsx
  index.shared.ts

desktop/trigger-packages/builtin/interval/
  manifest.ts
  schema.ts
  scheduler.main.ts
  config.renderer.tsx
  index.shared.ts
```

The first implementation may keep pure schedule calculation helpers near `desktop/electron/services/automation/` if that keeps the change smaller. Trigger-specific schema, defaults, and renderer form logic should still live behind trigger definitions.

## Trigger Configs

Cron:

```ts
type CronTriggerConfig = {
  expr: string
  timezone?: string
  activeDays: readonly number[]
}
```

Interval:

```ts
type IntervalTriggerConfig = {
  everyMinutes: number
  anchor: "created_at" | "last_completed_at"
  activeDays: readonly number[]
}
```

`activeDays` belongs to cron and interval because it is meaningful only for time-based triggers. It must not live on the Automation top level.

Defaults:

- Cron expression: `0 9 * * *`
- Interval: every 60 minutes
- Interval anchor: `created_at`
- Active days: all days

## Executor Reuse

Automation reuses the existing Action Runtime as its executor registry. Do not copy command, script, HTTP request, or Agent executor implementation.

New Automation UI and types should use the product word `executor`. The underlying implementation can adapt to existing `MainActionRegistry` and `rendererActionRegistry`.

The Automation execution context can adapt to the existing `ActionRuntimeContext` shape. Any shared context naming changes must be additive or local to Automation and must not break Task Scheduler.

## Main-Process Services

Add a new service module:

```text
desktop/electron/services/automation/
  types.ts
  automation-service.ts
  execution-service.ts
  item-repository.ts
  run-repository.ts
  trigger-registry.ts
  builtin-triggers.ts
  schedule-calculator.ts
  index.ts
```

`AutomationService` owns lifecycle and scheduling:

- `start` / `stop`
- `listItems` / `getItem`
- `createItem` / `updateItem` / `deleteItem`
- `setItemEnabled`
- `runNow`
- `stopRun`
- `listRuns`
- `runtimeInspect`

`AutomationExecutionService` owns one run:

- Start a run record.
- Resolve and validate executor config through Action Runtime.
- Build and check executor permissions.
- Record audit events with automation metadata.
- Execute the selected executor.
- Persist run result.
- Update latest automation status.
- Handle cancellation, failure, timeout, and skipped runs.

`AutomationItemRepository` only reads and writes `automation.items`.

`AutomationRunRepository` only reads and writes `automation.runs`, retaining the latest 100 runs per automation.

The Automation service must not route through `TaskSchedulerService` or mutate task-scheduler namespaces.

## Scheduling Behavior

On app startup:

1. Load `automation.items`.
2. Ignore disabled items.
3. Ignore invalid items for timer scheduling.
4. If `nextRunAt` is missing or stale, resolve startup behavior from `policy.missedRunPolicy`.
5. Set timers for valid enabled items.

When a timer fires:

1. Remove the in-memory timer.
2. Reload the automation item.
3. Check enabled state.
4. Validate trigger and executor config.
5. Check trigger runtime guard, including active days.
6. Check overlap policy.
7. Compute and persist next run before execution unless interval anchor is `last_completed_at`.
8. Execute the executor.
9. Persist run result and emit change events.
10. For `last_completed_at`, compute next run after execution settles.

Skipped runs are recorded for:

- disabled item
- invalid trigger or executor config
- active day mismatch
- existing run still active

## IPC And Preload

Add a dedicated Automation IPC module:

```text
desktop/electron/modules/automation/ipc.ts
```

Bridge shape:

```ts
window.synapse.automation = {
  listItems(): Promise<AutomationItem[]>
  getItem(id: string): Promise<AutomationItem | null>
  createItem(input: AutomationCreateInput): Promise<AutomationItem>
  updateItem(payload: { id: string; patch: AutomationUpdateInput }): Promise<AutomationItem>
  deleteItem(id: string): Promise<{ deleted: boolean }>
  setItemEnabled(payload: { id: string; enabled: boolean }): Promise<AutomationItem>
  runNow(id: string): Promise<AutomationRun | null>
  stopRun(runId: string): Promise<{ stopped: boolean }>
  listRuns(id: string, options?: { limit?: number }): Promise<AutomationRun[]>
  onChanged(listener: (event: AutomationChangedEvent) => void): () => void
}
```

Change event:

```ts
type AutomationChangedEvent = {
  itemId?: string
  runId?: string
  reason:
    | "created"
    | "updated"
    | "deleted"
    | "enabled"
    | "disabled"
    | "scheduled"
    | "run-started"
    | "run-finished"
    | "run-skipped"
    | "run-stopped"
}
```

EventBus payload:

```text
domain: "automation"
type: "automation.changed"
```

## Navigation And UI

The main app navigation keeps `定时` and adds `自动化` immediately to its right.

Renderer module:

```text
desktop/src/modules/automation/
  index.tsx
  types.ts
  utils.ts
  hooks/
    use-automation.ts
  components/
    automation-card-grid.tsx
    automation-card.tsx
    automation-form-dialog.tsx
    automation-runs-dialog.tsx
    trigger-config-form.tsx
```

The page is a usable management surface, not a marketing page:

- List configured automations.
- Show loading, empty, and error states.
- Provide `新建`.
- Provide enable, disable, run, history, edit, and delete actions.
- Show concise card fields: name, trigger summary, executor summary, enabled state, next run, last status.

The new/edit form uses three sections:

```text
基础信息
触发器
执行器
```

基础信息:

- 名称
- 描述
- 启用
- 错过执行
- 重叠运行: 第一版固定为跳过重叠运行，可展示为不可编辑策略或仅保留在保存数据中
- 运行目录: 复用旧定时任务语义，作为执行上下文字段保留

触发器:

- 触发器类型: Cron / 固定间隔
- Cron: 表达式, 时区, 活跃日
- 固定间隔: 间隔分钟, 起算方式, 活跃日

执行器:

- 执行器类型: 命令 / 脚本 / HTTP 请求 / Agent
- 执行器配置: 复用现有 renderer Action Runtime config forms

UI must use existing shadcn/Radix primitives and theme tokens. Do not add custom colors, gradients, card nesting, feature-introduction paragraphs, or decorative copy.

## Validation And Error Handling

Validation is layered:

- Trigger Registry validates trigger config.
- Action Runtime validates executor config.
- Automation service validates the complete item before save, enable, manual run, and scheduled execution.

Invalid saved automation items should be shown as needing update and treated as disabled at runtime. Do not auto-migrate or guess missing config.

Manual run and enable should fail before execution if trigger or executor config is invalid.

Scheduled execution of invalid items should skip and record a concise skipped run.

UI errors should be short and actionable. Logs must not leak prompt content, Authorization values, tokens, cookies, or environment secrets.

## Permissions And Audit

Executor permissions continue to come from Action Runtime:

- Shell executors use `shell.exec`.
- HTTP executor uses `network.connect`.
- Agent executor uses `agent.spawn`.

Automation service should record audit metadata with:

- automation id
- run id
- trigger type
- executor type
- trigger source

No trigger in the first phase requires new sensitive listener permissions.

## Compatibility With Existing Task Scheduler

The old Task Scheduler remains:

- Existing `定时` navigation entry stays available.
- Existing task data remains in `task-scheduler.tasks`.
- Existing run data remains in `task-scheduler.runs`.
- Existing `window.synapse.taskScheduler` bridge stays available.
- Existing `scheduler_*` MCP tools stay available.
- Existing scheduled timers continue to start from `core.task-scheduler`.

Small shared-helper refactors are allowed only when they do not change old Scheduler behavior. Examples:

- Reusing pure cron parsing helpers.
- Reusing Action Runtime definitions.
- Sharing non-mutating date calculation utilities after tests prove old behavior is unchanged.

Do not route old Scheduler through new Automation service in this phase.

## Testing Strategy

Main-process tests:

- Trigger registry registers cron and interval.
- Trigger registry rejects duplicate trigger ids.
- Unknown trigger returns `needs_update`.
- Cron trigger computes next run with active days in trigger config.
- Interval trigger computes next run with active days in trigger config.
- Automation repository creates, updates, lists, enables, disables, and deletes independent items.
- Automation service starts enabled valid timers.
- Manual run executes the selected Action Runtime executor.
- Scheduled run computes the next run and executes the selected executor.
- Overlap records a skipped run.
- Invalid trigger config blocks enable and manual run.
- Automation runs write only `automation.runs`.
- Existing Task Scheduler service tests continue to pass.

Renderer tests:

- Navigation shows `定时` and `自动化` in the correct order.
- Automation module renders loading, empty, error, and populated states.
- Automation form renders `基础信息`, `触发器`, and `执行器`.
- Cron active days are saved inside trigger config.
- Interval active days are saved inside trigger config.
- Executor config forms reuse existing Action Runtime renderer definitions.
- Missing name, empty active days, invalid trigger config, or invalid executor config blocks save.
- Manual run and stop actions call the automation bridge.

Regression tests:

- Old `taskScheduler` preload bridge remains present.
- Old scheduler data namespaces remain unchanged.
- Old scheduler MCP tools remain listed.
- Old task-scheduler renderer tests continue to pass.

## Implementation Order

1. Add Automation types, repository schemas, and run schemas.
2. Add Trigger Registry with cron and interval trigger definitions.
3. Add Automation repositories.
4. Add Automation execution service that reuses Action Runtime.
5. Add Automation service startup, timers, run history, and events.
6. Add `core.automation` descriptor after Action Runtime.
7. Add Automation IPC module.
8. Add preload and bridge types for `window.synapse.automation`.
9. Add renderer Automation module and hooks.
10. Add Automation form, card grid, run history dialog, and navigation entry.
11. Add focused tests and run old Task Scheduler regression tests.
12. Update `RELEASE_NOTES_PENDING.md` during implementation because this is user-visible.
