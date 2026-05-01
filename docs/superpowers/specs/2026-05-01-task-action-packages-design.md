# Task Action Packages Design

## Context

The current task scheduler has a first-version action model centered on shell execution:

```ts
action: {
  type: "shell_command"
  mode: "command" | "script"
  content: string
}
```

This is too narrow for the next phase. Scheduled tasks should continue to support command and script execution, but they also need to trigger HTTP requests now and prompt, skill, agent, workflow, or other Synapse actions later.

The product boundary is:

- An **Action** is a reusable atomic capability, such as command execution, script execution, or an HTTP request.
- A **Workflow** is a separate future module that composes multiple actions and passes context between them.
- A **Scheduled Task** is responsible for triggering one action, or later one workflow, at the right time.

The scheduler must stop owning action-specific configuration and execution details. It should trigger an action reference through a registry.

## Goals

- Introduce a standalone built-in Action Package foundation.
- Keep each built-in action in one logical folder.
- Split command and script into two action types.
- Add `builtin.http-request` as the first new action type to validate the extension model.
- Make action configuration schema-driven, with optional custom renderer UI.
- Store action run results in a generic structure that can be displayed now and consumed by future workflows.
- Lightly interface trigger definitions so cron and interval are registry-ready without expanding trigger scope.
- Preserve existing scheduler behavior: enable/disable, manual run, stop run, missed-run policy, overlap skipping, and run history.
- Keep the design source-code built-in for now while leaving a path to future plugin loading.

## Non-Goals

- No external action plugin installation in this phase.
- No workflow composer in this phase.
- No multi-action scheduled task in this phase.
- No compatibility migration from the existing `shell_command` data shape, because there is no production data to preserve.
- No secret storage, masking, or special sensitive-field handling for action config.
- No new visual design system, custom colors, CSS modules, gradients, or custom component styling.

## Chosen Approach

Create a standalone Action Package layer consumed by the scheduler.

```text
Trigger Layer
  Defines when a task fires.

Scheduler Layer
  Owns task lifecycle, timers, missed-run behavior, overlap handling, and run history.

Action Layer
  Owns action config schema, validation, permission metadata, execution, summaries, and result display.
```

The scheduler stores an action reference:

```ts
type ScheduledTaskActionRef = {
  type: string
  config: Record<string, unknown>
}
```

Execution flow:

```text
TaskSchedulerService fires a task
-> TaskSchedulerExecutionService reads action.type
-> MainActionRegistry resolves the action package
-> action schema validates config
-> action permission request is built
-> PermissionGuard checks the sensitive operation
-> action executor runs
-> ActionRunResult is persisted in task run history
```

The scheduler never branches on `builtin.command`, `builtin.script`, or `builtin.http-request`.

## Package Layout

Use one logical directory per built-in action:

```text
desktop/action-packages/builtin/
  command/
    manifest.ts
    schema.ts
    executor.main.ts
    config.renderer.tsx
    result.renderer.tsx
    index.shared.ts

  script/
    manifest.ts
    schema.ts
    executor.main.ts
    config.renderer.tsx
    result.renderer.tsx
    index.shared.ts

  http-request/
    manifest.ts
    schema.ts
    executor.main.ts
    config.renderer.tsx
    result.renderer.tsx
    index.shared.ts
```

File roles:

- `manifest.ts`: action id, title, permission declarations, feature flags, default config.
- `schema.ts`: zod config schema and inferred config type.
- `executor.main.ts`: Electron main-process executor and dynamic permission context.
- `config.renderer.tsx`: optional custom config form for the renderer.
- `result.renderer.tsx`: optional custom result view for run history.
- `index.shared.ts`: pure shared exports used by main and renderer.

Runtime-specific imports must stay strict:

- Electron code imports only `*.main.ts` and shared files.
- Renderer code imports only `*.renderer.tsx` and shared files.
- Shared files must not import Electron, React, app shell hooks, or runtime services.

To support the new top-level package directory, the implementation may need small, explicit updates to:

- `desktop/tsconfig.json`
- `desktop/tsconfig.electron.json`
- `desktop/tsconfig.test.json`
- `desktop/vite.config.ts`

Those changes should expose only the intended runtime entries and avoid broad cross-imports.

## Action IDs

Use namespace-style built-in ids:

```text
builtin.command
builtin.script
builtin.http-request
```

This is short enough for current built-ins and leaves room for future sources such as:

```text
plugin.some-package.some-action
workflow.some-workflow-id
```

## Registries

Add separate main and renderer registries:

```text
desktop/electron/action-runtime/
  action-registry.ts
  builtin-actions.ts

desktop/src/action-runtime/
  action-registry.ts
  builtin-actions.ts
  action-config-form.tsx
  action-result-view.tsx
```

Main registry responsibilities:

- Register built-in action executors.
- Resolve action definitions by id.
- Validate config before execution.
- Build permission checks.
- Normalize executor output to `ActionRunResult`.

Renderer registry responsibilities:

- Register built-in action metadata.
- Render action selector options.
- Render action config forms.
- Render list summaries.
- Render run result views.

First phase registration is explicit:

```ts
registerBuiltinAction(commandAction)
registerBuiltinAction(scriptAction)
registerBuiltinAction(httpRequestAction)
```

Do not add dynamic filesystem scanning in this phase. Future plugin work can reuse the manifest protocol and change only the registration source.

## Action Definition Shape

Use zod for config schemas because it already exists in the desktop package.

```ts
type ActionPermissionName = "shell.exec" | "network.connect" | string

type ActionManifest<TConfig> = {
  id: string
  title: string
  permissions: readonly ActionPermissionName[]
  defaultConfig: TConfig
  configSchema: z.ZodType<TConfig>
}
```

Main action definition:

```ts
type MainActionDefinition<TConfig> = {
  manifest: ActionManifest<TConfig>
  buildPermissionRequest(input: ActionPermissionInput<TConfig>): PermissionCheckRequest
  execute(input: ActionExecutionInput<TConfig>): Promise<ActionRunResult>
}
```

Renderer action definition:

```ts
type RendererActionDefinition<TConfig> = {
  manifest: ActionManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: ActionConfigFormComponent<TConfig>
  ResultView?: ActionResultViewComponent
}
```

Every action must provide a schema and default config. Custom UI is optional. If no custom component exists, the renderer falls back to a schema-driven generic form and result view.

## Built-In Actions

### `builtin.command`

Config:

```ts
type CommandActionConfig = {
  command: string
  shell: "posix" | "cmd" | "powershell"
  env?: Record<string, string>
  timeoutMins?: number | null
}
```

Behavior:

- Executes a single command through the existing controlled process runner.
- Uses existing shell resolution logic.
- Stores stdout and stderr in `result.logs` and `result.outputs`.
- Uses `shell.exec` permission.

### `builtin.script`

Config:

```ts
type ScriptActionConfig = {
  script: string
  shell: "posix" | "cmd" | "powershell"
  env?: Record<string, string>
  timeoutMins?: number | null
}
```

Behavior:

- Executes multi-line script content through the existing controlled process runner.
- Uses the same shell, env, timeout, cancellation, and output behavior as command execution.
- Uses `shell.exec` permission.

### `builtin.http-request`

Config:

```ts
type HttpRequestActionConfig = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  url: string
  headers?: Record<string, string>
  query?: Record<string, string>
  bodyType: "none" | "json" | "text"
  body?: string
  timeoutMins?: number | null
}
```

Behavior:

- Sends one HTTP request.
- Supports method, URL, query parameters, headers, body type, and timeout.
- Treats any completed HTTP response as an executed request.
- Maps transport errors and invalid config to failed results.
- Stores response status, headers, and body in `result.outputs`.
- Uses `network.connect` permission.

If existing runtime network infrastructure can perform outbound requests under the hard constraints, reuse it. If it cannot, add the minimal network-runtime entry needed under `desktop/electron/runtime/network/`, then call it from the action executor. Do not scatter raw network-sensitive operations through business services.

## Task Data Model

Use a new schema version for scheduled tasks and runs. No legacy compatibility is required.

```ts
type ScheduledTask = {
  id: string
  schemaVersion: 2
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTriggerRef
  action: ScheduledTaskActionRef
  enabled: boolean
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: ScheduledTaskStatus
  runCount: number
}
```

`cwd` remains task-level runtime context. Command and script actions can use it. HTTP does not need it. Future actions can declare whether they use task-level runtime context.

Run record:

```ts
type ScheduledTaskRun = {
  id: string
  schemaVersion: 2
  taskId: string
  startedAt: string
  finishedAt?: string
  status: "running" | "success" | "failed" | "timeout" | "cancelled" | "skipped"
  triggeredBy: "schedule" | "manual" | "missed_run"
  result?: ActionRunResult
  error?: string
}
```

Generic action result:

```ts
type ActionRunResult = {
  status: "success" | "failed" | "timeout" | "cancelled"
  summary?: string
  logs?: Array<{
    label: string
    value: string
  }>
  outputs?: Record<string, unknown>
  error?: string
  metrics?: {
    durationMs?: number
    exitCode?: number | null
    httpStatus?: number
  }
}
```

The top-level run `status` is retained for filtering and list display. The detailed action-specific output lives in `result`.

## Trigger Registry

Triggers should be lightly interface-based in this phase:

```ts
type ScheduledTaskTriggerRef = {
  type: "builtin.cron" | "builtin.interval" | string
  config: Record<string, unknown>
}
```

Built-ins:

```text
builtin.cron
builtin.interval
```

The first implementation can keep most cron and interval code near the scheduler, but it should expose a trigger definition interface for:

- config schema
- default config
- next-run calculation
- renderer summary
- renderer config form, if needed later

Do not add webhook, file-change, application-event, or external trigger sources in this phase.

## Scheduler Behavior

Preserve existing behavior:

- Disabled tasks are not scheduled.
- Missing `nextRunAt` is computed from the trigger registry.
- Missed runs follow task-level policy: `skip` or `run_once`.
- Overlapping runs for the same task are skipped.
- Manual runs go through the same action execution path.
- Stop run aborts the active action execution when the executor supports cancellation.
- Run history remains pruned to the latest 100 runs per task.

The scheduler should depend on trigger and action registries, not concrete built-in packages.

## Permissions And Audit

Action permissions use a hybrid model:

- Static permission names are declared in the manifest.
- Dynamic permission context is built from action config at execution time.
- The shared execution service calls `PermissionGuard.check()`.

Command and script permission context:

- action: `shell.exec`
- action type
- task id
- run id
- shell
- cwd
- env keys
- timeout
- command or script summary

HTTP permission context:

- action: `network.connect`
- action type
- task id
- run id
- method
- URL
- header keys
- timeout

Configuration values are not treated as secrets. Users can configure any header, body, env var, or parameter. The first phase does not add secret storage or masking.

Audit records should include action type, task id, run id, trigger source, status, duration, and error summary. Avoid writing large payloads such as full response bodies, env values, or full request bodies into audit records. Full execution output belongs in run history.

## Renderer UI

Keep the task scheduler as a dense internal tool.

Task list columns:

```text
名称 | 触发 | 动作 | 作用域 | 上次 | 下次 | 状态 | 启用 | 操作
```

The action column uses the renderer action registry:

- `builtin.command`: `命令 · <command summary>`
- `builtin.script`: `脚本 · <shell>`
- `builtin.http-request`: `<method> · <url summary>`

Top controls:

- Refresh.
- Create task.
- Optional lightweight filters for action type, trigger type, enabled state, and last status.

Create/edit dialog stays single-page, not a wizard:

```text
基础信息
触发计划
执行动作
运行设置
```

The `执行动作` section:

- Shows an action type selector.
- Renders the selected action config form.
- If the user switches action type after editing config, confirm that the current action config will be cleared.
- Uses action defaults when a new action type is selected.
- Does not include explanatory marketing or architecture copy.

Built-in action forms:

```text
命令
- Shell
- 命令
- 环境变量
- 超时

脚本
- Shell
- 脚本
- 环境变量
- 超时

HTTP 请求
- Method
- URL
- Query
- Headers
- Body 类型
- Body
- 超时
```

The dialog should continue to use existing shadcn components and token classes. Do not introduce inline styles, custom colors, CSS modules, nested cards, or decorative UI.

## Run History UI

Run history should use the generic action result view.

Each run displays:

- status
- trigger source
- started and finished time
- `result.summary`, when present
- `result.metrics`, when present
- `result.logs`, when present
- top-level `error`, when present

If an action provides `ResultView`, render it. Otherwise use the default `ActionResultView`.

Default result rendering:

- Metrics as short text rows.
- Logs as labeled preformatted blocks.
- Outputs are not dumped wholesale unless no logs or custom view are available.

Running actions still show a stop button when cancellable.

## Error Handling

Save-time errors:

- Unknown action type.
- Invalid action config.
- Invalid trigger config.
- Permission denial.

Run-time errors:

- Unknown action type if a saved task references a removed action.
- Config validation failure.
- Permission denial at execution time.
- Executor failure.
- Timeout.
- Cancellation.
- Network or process failure.

All run-time errors should finish the run with a failed, timeout, or cancelled status and persist a useful `error` value. The scheduler service should keep running after an action failure.

## Testing

Main-process tests:

- Main action registry registers and resolves built-ins.
- Unknown action type fails cleanly.
- Command config schema validates required fields.
- Script config schema validates required fields.
- HTTP config schema validates method, URL, body type, and timeout.
- Execution service handles success, failure, timeout, cancellation, validation failure, and permission denial.
- Scheduler service does not branch on concrete action ids.
- Run repository stores `ActionRunResult` and prunes latest 100 runs.
- HTTP action builds query, headers, body, timeout, and status mapping correctly.
- Shell actions preserve command/script output behavior.

Renderer tests:

- Action selector renders command, script, and HTTP request.
- Switching action type resets config after confirmation.
- Each built-in action form builds the expected `action: { type, config }` payload.
- Task list displays action summaries through the registry.
- Run history displays generic `ActionRunResult` logs and metrics.

Verification commands:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Do not start the dev server or open runtime previews for this work unless explicitly requested.

## Acceptance Criteria

- Task scheduler data uses action references rather than scheduler-owned shell fields.
- Command and script are separate built-in actions.
- HTTP request is implemented as a built-in action package.
- Adding a new built-in action should not require changing scheduler core control flow.
- Action config is schema-validated.
- Action UI can be default schema-driven or custom per action.
- Action execution results use `ActionRunResult`.
- Permissions are declared by action manifest and checked with dynamic execution context.
- Trigger definitions are registry-ready for cron and interval without adding new trigger types.
- UI remains concise, shadcn-based, and free of custom visual styling.

## Resolved Decisions

- First phase uses source-code built-in packages, not external plugins.
- Action package id style is `builtin.<name>`.
- Each action lives in one logical folder.
- Command and script are modeled as separate actions.
- HTTP request is included in the first phase.
- No legacy `shell_command` compatibility or migration is required.
- Config values are not treated as sensitive by the action framework.
- Action result shape keeps `outputs` for future workflow consumption.
- Workflows are a future separate module that can reuse the same action registry.
