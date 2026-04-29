# Task Scheduler Design

## Context

Synapse currently has a scheduled-task feature under the Feishu connector path. The existing model stores `scheduled.jobs` and `scheduled.heartbeat`, requires Feishu connector/session fields, and routes execution through Feishu reply targets and AgentRuntime. That coupling no longer matches the product direction.

The new task scheduler must be a general desktop automation capability. Feishu, Agent, HTTP requests, and Synapse internal actions should be optional future action types, not scheduler dependencies.

## Goals

- Replace the Feishu-bound scheduled task feature with a clean `task-scheduler` module.
- Support both global tasks and project-bound tasks.
- Support shell command/script execution in the first version.
- Support cron and fixed interval triggers.
- Support missed-run policy per task, defaulting to no catch-up.
- Skip overlapping runs for the same task.
- Record complete run history for the latest 100 runs per task.
- Support manual stop for running tasks and timeout-based termination.
- Use save-time permission checks and per-run audit records for shell execution.
- Expose a first-class task center in the app navigation.

## Non-Goals

- No Feishu scheduled-task compatibility layer.
- No migration from `scheduled.jobs` or `scheduled.heartbeat`.
- No HTTP/Webhook action in the first version.
- No Synapse internal action in the first version.
- No Agent action in the first version.
- No workflow chaining or multi-step action orchestration in the first version.
- No retry policy in the first version.
- No desktop notifications in the first version.
- No per-task timezone UI in the first version.

## Architecture

Add a new main-process service module:

```text
desktop/electron/services/task-scheduler/
  action-registry.ts
  cron-expression.ts
  execution-service.ts
  run-repository.ts
  shell-action.ts
  task-repository.ts
  task-scheduler-service.ts
  types.ts
```

Add a dedicated IPC module:

```text
desktop/electron/modules/task-scheduler/ipc.ts
```

Add renderer types and UI:

```text
desktop/src/types/task-scheduler.ts
desktop/src/modules/task-scheduler/
  index.tsx
  components/
  hooks/
  utils.ts
```

The main service boundaries are:

- `TaskSchedulerService`: loads task definitions, schedules timers, handles missed runs, skips overlaps, starts runs, stops runs, and updates `nextRunAt`.
- `ScheduledTaskRepository`: persists task definitions.
- `ScheduledTaskRunRepository`: persists run records and prunes each task to the latest 100 records.
- `TaskActionRegistry`: maps an action `type` to its executor.
- `ShellTaskAction`: implements first-version shell command/script execution.
- `TaskSchedulerExecutionService`: coordinates action execution, run records, process cancellation, permission checks, audit, and error normalization.

The scheduler core must not import Feishu connector code or AgentRuntime. Future Feishu or Agent integration must register as action executors.

## Data Model

Use new data namespaces to avoid reusing the old Feishu-shaped storage:

- `task-scheduler.tasks`
- `task-scheduler.runs`

Task definition:

```ts
type ScheduledTask = {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  scope:
    | { type: "global" }
    | { type: "project"; projectId: string }
  cwd?: string
  trigger:
    | { type: "cron"; expr: string; timezone?: string }
    | { type: "interval"; everyMinutes: number; anchor?: "created_at" | "last_completed_at" }
  action: {
    type: "shell_command"
    mode: "command" | "script"
    content: string
    env?: Record<string, string>
    timeoutMins?: number | null
  }
  enabled: boolean
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: "success" | "failed" | "timeout" | "cancelled" | "skipped"
  runCount: number
}
```

Run record:

```ts
type ScheduledTaskRun = {
  id: string
  schemaVersion: 1
  taskId: string
  startedAt: string
  finishedAt?: string
  status: "running" | "success" | "failed" | "timeout" | "cancelled" | "skipped"
  exitCode?: number | null
  stdout?: string
  stderr?: string
  error?: string
  triggeredBy: "schedule" | "manual" | "missed_run"
}
```

Defaults:

- `enabled: true`
- `missedRunPolicy: "skip"`
- `overlapPolicy: "skip"`
- `action.timeoutMins: 30`
- interval `anchor: "created_at"` in the first version
- cron uses the system local timezone in the first version
- keep the latest 100 run records per task

## Scheduling Behavior

Cron triggers use a five-field cron expression and system local timezone. The first version can reuse the existing parser if it is moved or copied into `task-scheduler` without retaining Feishu dependencies.

Interval triggers are not converted to cron. They are stored as first-class triggers so future behavior can distinguish wall-clock schedules from cadence-based schedules.

For interval triggers:

- `created_at` means the cadence is based on task creation time and scheduled occurrences.
- `last_completed_at` is reserved in the schema but not exposed in the first-version UI.

On app startup:

- Disabled tasks are not scheduled.
- If a task has no `nextRunAt`, compute and persist the next run.
- If `nextRunAt` is in the past and `missedRunPolicy` is `skip`, compute the next future run.
- If `nextRunAt` is in the past and `missedRunPolicy` is `run_once`, run once with `triggeredBy: "missed_run"`, then compute the next future run.

When a schedule fires:

- Remove the timer from the in-memory map.
- If the task is disabled, record a skipped run only when useful for debugging, then stop.
- If the same task is already running, record a skipped run with an overlap reason and compute the next run.
- Otherwise compute and persist the next run before starting execution, then execute the action.

## Shell Execution

The first action type is `shell_command`.

Input modes:

- `command`: single-line command text.
- `script`: multi-line script text.

Shell selection is fixed:

- macOS/Linux: `/bin/sh -lc <content>`
- Windows: `cmd.exe /d /s /c <content>`

Environment behavior:

- Inherit the Synapse process environment.
- Apply task-level `env` as overrides.
- Do not display env values in run history.

Working directory:

- Global task: use `cwd` when set; otherwise use a default cwd injected by bootstrap from Electron `app.getPath("userData")`.
- Project task: default to the configured project workspace path; allow task `cwd` to override it.
- Reject execution if the resolved `cwd` does not exist or is not a directory.

Timeout and cancellation:

- Default timeout is 30 minutes.
- `timeoutMins: null` means no timeout.
- Manual stop cancels the running process and records the run as `cancelled`.
- Timeout records the run as `timeout`.

Output:

- Store complete `stdout` and `stderr` for each retained run.
- This may store sensitive output; the first version accepts that risk because the user explicitly wants full output.

## Permissions And Audit

Shell commands are sensitive operations.

On create or edit:

- If `action.type === "shell_command"`, run `PermissionGuard.check()` for `shell.exec`.
- Changing command/script content, cwd, env, or timeout requires a new save-time check.
- If permission is denied, do not save the task.

On each run:

- Record an audit event before process execution.
- Record the result in run history.
- Do not block scheduled execution waiting for a new permission prompt.

This design keeps automatic execution reliable while preserving an approval point when task behavior changes.

## IPC API

Add dedicated task scheduler bridge methods instead of routing through `connectors.feishu`.

Suggested renderer bridge shape:

```ts
window.synapse.taskScheduler = {
  listTasks(): Promise<ScheduledTask[]>
  getTask(id: string): Promise<ScheduledTask | null>
  createTask(input: ScheduledTaskCreateInput): Promise<ScheduledTask>
  updateTask(id: string, patch: ScheduledTaskUpdateInput): Promise<ScheduledTask>
  deleteTask(id: string): Promise<{ ok: true }>
  setTaskEnabled(id: string, enabled: boolean): Promise<ScheduledTask>
  runTask(id: string): Promise<ScheduledTaskRun | null>
  stopRun(runId: string): Promise<ScheduledTaskRun | null>
  listRuns(taskId: string): Promise<ScheduledTaskRun[]>
}
```

IPC handlers resolve only `core.task-scheduler`. They must not resolve Feishu connector services.

## UI

Add a first-class task center rather than keeping task scheduling in Settings.

First-version UI:

- One dense task table.
- Filters for scope, enabled state, trigger type, and last status.
- Primary action: create task.
- Row actions: run now, enable/disable, edit, view details, delete.
- Running task action: stop.
- Create/edit uses one Dialog form.
- Task details uses a Dialog with task metadata and latest 100 run records.

Task form fields:

- Name.
- Scope: global or project.
- Working directory.
- Trigger type: cron or interval.
- Cron expression or interval minutes.
- Missed run policy: skip or run once.
- Command mode: command or script.
- Command/script content.
- Environment overrides.
- Timeout: default 30 minutes, allow no timeout.
- Enabled.

Use shadcn/ui components and the current `radix-nova` preset. Do not add custom colors, gradients, inline styles, or one-off CSS. Keep UI copy short and operational.

## Legacy Removal

Remove the old Feishu scheduled-task surface:

- Remove the Settings category entry for old scheduled tasks.
- Remove `ScheduledTasksPanel` from Settings.
- Remove renderer bridge methods under `connectors.feishu` for scheduled jobs and heartbeats.
- Remove connector IPC handlers for old scheduled jobs and heartbeats.
- Remove Feishu `/cron` and `/heartbeat` command handling.
- Remove old scheduler/heartbeat services from service descriptors.
- Remove data-repo schema entries and tests for `scheduled.jobs` and `scheduled.heartbeat`.

No data migration is needed because the old feature has not been used. Any old on-disk namespace files are treated as orphaned legacy files and are not read by the new scheduler.

## Error Handling

Create/edit validation errors should identify the invalid field.

Run-time errors should be captured in run history:

- missing cwd
- process spawn failure
- non-zero exit code
- timeout
- manual cancellation
- unknown action type

Save-time permission denial is surfaced to the create/edit form and does not create a run record.

The scheduler service should log unexpected internal failures through structured logger and keep the app running.

## Testing

Add focused tests for:

- cron next-run calculation
- interval next-run calculation
- missed-run skip
- missed-run run-once
- overlap skip
- repository validation
- run-history pruning to latest 100 records
- shell action command construction per platform
- create/update permission check behavior
- manual stop and timeout status mapping
- IPC schema validation
- removal of Feishu scheduled-task IPC channels from generated channels

Run verification from the repo root:

```bash
pnpm desktop:check:hard-constraints
pnpm desktop:typecheck
pnpm desktop:test
```

Do not start the dev server for verification unless explicitly requested.

## Resolved Decisions

All first-version decisions are resolved:

- First action type: local shell command/script.
- Future action types: HTTP/Webhook, Synapse internal actions, Agent calls.
- Scope: global and project tasks.
- Trigger types: cron and interval.
- Missed run policy: per task, default skip.
- Overlap policy: skip.
- Result handling: run history only.
- Run history retention: latest 100 records per task.
- Output retention: complete stdout/stderr.
- Retry: none.
- UI placement: first-class task center.
- Details/history presentation: Dialog.
- Create/edit presentation: Dialog.
- Security: save-time permission check and per-run audit.
- Shell: fixed platform shell.
