# Scheduler MCP External Capabilities Design

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

## Context

Synapse already exposes one local MCP server for Database tools and first-phase Scheduler tools. The first Scheduler MCP phase added external list, get, create, enable, and disable actions.

The next phase extends the Scheduler external capability surface while preserving the rule that every exposed capability must align across four layers:

```text
Task Scheduler underlying capability
  -> local HTTP API action
  -> CLI command
  -> MCP tool
```

No MCP tool should exist as a placeholder. If a capability is not intended to be usable by agents, it should not appear in the external capability matrix.

## Goals

- Add read-only Scheduler observation capabilities for runs, runtime status, and available action types.
- Add conservative Scheduler task update capability.
- Keep API, CLI, and MCP action names, input shapes, output shapes, validation, and errors aligned.
- Make the capability matrix the single source for Scheduler external capabilities.
- Promote the Action Runtime registry to a first-class main-process service so action type listing and task execution use the same registry.
- Keep Scheduler transport and protocol adaptation out of `TaskSchedulerService`.
- Explicitly keep delete, manual run, and stop-run out of API, CLI, and MCP.
- Add negative tests that prevent accidental exposure of delete, manual run, and stop-run.

## Non-Goals

- No Scheduler task deletion through API, CLI, or MCP.
- No manual task run through API, CLI, or MCP.
- No stop-running-run through API, CLI, or MCP.
- No update of task `action`, `scope`, `enabled`, run counters, run status, or computed scheduling fields.
- No workflow composer, multi-action orchestration, or new action type.
- No renderer UI redesign.
- No change to existing Database MCP tools, schemas, or result normalization.

## Chosen Approach

Use a capability matrix path. Scheduler external capabilities are defined once, then used to keep API, CLI, and MCP synchronized.

```text
Scheduler external capability matrix
  action: schedulerTaskRunsList
  cliCommand: scheduler runs
  mcpTool: scheduler_task_runs_list
  mutates: false
  service: TaskSchedulerService.listRuns

  action: schedulerTaskRuntimeStatus
  cliCommand: scheduler status
  mcpTool: scheduler_task_runtime_status
  mutates: false
  service: TaskSchedulerService.inspect + task lookup

  action: schedulerActionTypesList
  cliCommand: scheduler actions
  mcpTool: scheduler_action_types_list
  mutates: false
  service: MainActionRegistry.list

  action: schedulerTaskUpdate
  cliCommand: scheduler update
  mcpTool: scheduler_task_update
  mutates: true
  service: TaskSchedulerService.updateTask
```

The external matrix must not include:

```text
schedulerTaskDelete
schedulerTaskRunNow
schedulerTaskStopRun
```

UI-only Scheduler IPC can continue to expose UI workflows such as delete, manual run, stop, and run dialogs. This design only governs the external Agent-facing capability surface.

## Architecture

### Action Runtime As A First-Class Service

Create a main-process service descriptor:

```text
core.action-runtime
  -> MainActionRegistry
  -> builtin.command
  -> builtin.script
  -> builtin.http-request
```

`core.task-scheduler` depends on `core.action-runtime` and uses that registry for execution.

`core.database` builds the neutral `SynapseActionRouter` using:

```text
databaseDispatch
schedulerDispatch(taskSchedulerService, actionRuntimeRegistry)
```

This prevents two action registries from drifting. `scheduler_action_types_list` reports the same registry that scheduled task execution uses.

### Public Action Manifest Metadata

Extend `ActionManifest` with a stable public field descriptor list:

```ts
type ActionConfigFieldDescriptor = {
  readonly name: string
  readonly kind: "string" | "number" | "boolean" | "enum" | "record"
  readonly required: boolean
  readonly description?: string
  readonly choices?: readonly string[]
  readonly defaultValue?: unknown
}
```

Built-in action manifests populate these descriptors. The external Scheduler layer should not introspect private Zod internals to describe action schemas.

### Scheduler External Adapter

Add a Scheduler external adapter, for example:

```text
desktop/electron/services/task-scheduler/external-capabilities.ts
```

Responsibilities:

- Parse and validate public action inputs.
- Convert public `schedule` objects to internal `trigger` objects.
- Convert internal `trigger` objects back to public `schedule` objects.
- Validate restricted update patches.
- Build run-history summaries with bounded output.
- Build runtime-status payloads.
- Convert `MainActionRegistry` manifests to public action type descriptions.

`TaskSchedulerService` remains focused on lifecycle, timers, scheduling, run execution, and persistence.

## Capability Details

### `schedulerTaskRunsList`

MCP tool:

```text
scheduler_task_runs_list
```

CLI:

```bash
synapse scheduler run list <taskId> [--limit N]
```

API input:

```json
{
  "action": "schedulerTaskRunsList",
  "taskId": "task:...",
  "limit": 20
}
```

Rules:

- `taskId` is required.
- `limit` is optional.
- Default `limit` is `20`.
- Maximum `limit` is `100`.
- Missing task id is an error.
- The call is read-only.

Underlying call:

```text
TaskSchedulerService.listRuns(taskId, { limit })
```

Output:

```ts
type SchedulerRunSummary = {
  id: string
  taskId: string
  status: "running" | "success" | "failed" | "timeout" | "cancelled" | "skipped"
  triggeredBy: "schedule" | "manual" | "missed_run"
  startedAt: string
  finishedAt?: string
  error?: string
  summary?: string
  metrics?: {
    durationMs?: number
    exitCode?: number | null
    httpStatus?: number
  }
}
```

Run logs are not returned by default. This keeps MCP responses bounded and prevents accidental large output dumps. A future phase can add a separate run-detail tool if needed.

### `schedulerTaskRuntimeStatus`

MCP tool:

```text
scheduler_task_runtime_status
```

CLI:

```bash
synapse scheduler runtime inspect [taskId]
```

API input:

```json
{
  "action": "schedulerTaskRuntimeStatus",
  "taskId": "task:..."
}
```

`taskId` is optional.

Underlying calls:

```text
TaskSchedulerService.inspect()
TaskSchedulerService.getTask(taskId) or listTasks()
```

Output:

```ts
type SchedulerRuntimeStatus = {
  runningTaskIds: string[]
  scheduledTaskIds: string[]
  tasks: SchedulerTaskRuntimeStatusItem[]
}

type SchedulerTaskRuntimeStatusItem = {
  id: string
  name: string
  enabled: boolean
  running: boolean
  scheduled: boolean
  activeRunId?: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: string
}
```

If `taskId` is provided, `tasks` contains zero or one item. Missing task id returns an error instead of silently returning an empty list.

Implementation note: the current `inspect()` returns `runningTaskIds` and timer task ids, not active run ids. To support `activeRunId`, either extend `TaskSchedulerService.inspect()` to include the current active run id per task, or omit `activeRunId` until the service can provide it honestly. Do not synthesize fake run ids.

### `schedulerActionTypesList`

MCP tool:

```text
scheduler_action_types_list
```

CLI:

```bash
synapse scheduler action-type list
```

API input:

```json
{
  "action": "schedulerActionTypesList"
}
```

Underlying call:

```text
MainActionRegistry.list()
```

Output:

```ts
type SchedulerActionTypeSummary = {
  type: string
  title: string
  permissions: string[]
  defaultConfig: Record<string, unknown>
  configFields: ActionConfigFieldDescriptor[]
}
```

The first implementation exposes the built-in actions already registered by Action Runtime:

```text
builtin.command
builtin.script
builtin.http-request
```

This tool exists so agents can create scheduled tasks with valid `action.type` and `action.config` without guessing.

### `schedulerTaskUpdate`

MCP tool:

```text
scheduler_task_update
```

CLI:

```bash
synapse scheduler update <taskId> --data '{...}'
```

API input:

```json
{
  "action": "schedulerTaskUpdate",
  "taskId": "task:...",
  "name": "Daily summary",
  "description": "Optional",
  "cwd": "/optional/path",
  "schedule": {
    "type": "interval",
    "everyMinutes": 30
  },
  "missedRunPolicy": "skip"
}
```

Allowed patch fields:

```ts
type SchedulerTaskExternalUpdate = {
  name?: string
  description?: string
  cwd?: string
  schedule?: SchedulerSchedule
  missedRunPolicy?: "skip" | "run_once"
}
```

Forbidden fields:

```text
scope
action
enabled
overlapPolicy
runCount
lastRunAt
lastStatus
nextRunAt
createdAt
updatedAt
trigger
```

Rules:

- `taskId` is required.
- Empty patch is an error.
- Unknown or forbidden fields are errors.
- `schedule` uses the public external shape, not internal `trigger`.
- Updating an enabled task relies on `TaskSchedulerService.updateTask()` to recompute `nextRunAt` and reschedule timers.
- `enabled` remains controlled only by `schedulerTaskEnable` and `schedulerTaskDisable`.
- `action` remains non-updatable through external capabilities.

Underlying call:

```text
TaskSchedulerService.updateTask(taskId, restrictedPatch)
```

## Explicitly UI-Only Or Hidden Capabilities

### Delete

Do not expose Scheduler task deletion through API, CLI, or MCP in this phase.

Rationale:

- A visible `scheduler_task_delete` that only returns "please use the UI" is a fake capability.
- Agents treat MCP tools as available actions.
- Exposing a placeholder violates the four-layer alignment rule.

The design statement is:

```text
Task deletion is UI-only for this phase.
```

If delete is opened later, it must be implemented as a real capability from the underlying service upward:

```text
TaskSchedulerService.deleteTask
  -> schedulerTaskDelete API action
  -> synapse scheduler delete CLI command
  -> scheduler_task_delete MCP tool
  -> permission/audit policy
  -> tests
```

### Manual Run And Stop Run

Do not expose manual run or stop-run through API, CLI, or MCP in this phase.

Rationale:

- Manual run can trigger shell/script/network side effects immediately.
- Stop-run changes live execution state and needs stronger UX and audit semantics.
- The current phase is observation plus conservative maintenance only.

## API Design

The local HTTP API keeps the existing action style:

```json
{
  "action": "schedulerTaskUpdate",
  "...": "canonical params"
}
```

The HTTP layer does not know Scheduler details. It dispatches through `SynapseActionRouter`.

Errors remain transport-wrapped:

```json
{
  "ok": false,
  "error": "message"
}
```

## CLI Design

Add Scheduler CLI commands:

```bash
synapse scheduler run list <taskId> [--limit N]
synapse scheduler runtime inspect [taskId]
synapse scheduler action-type list
synapse scheduler update <taskId> --data '{...}'
```

The CLI:

- Parses command arguments.
- Converts them to canonical API action params.
- Calls local HTTP.
- Prints concise JSON for structured read-only outputs.
- Prints concise confirmation for update.
- Exits non-zero on errors.

The CLI help must not include:

```bash
synapse scheduler delete
synapse scheduler run
synapse scheduler stop
```

## MCP Design

Append these tools to MCP `tools/list`:

```text
scheduler_task_runs_list
scheduler_task_runtime_status
scheduler_action_types_list
scheduler_task_update
```

Do not append:

```text
scheduler_task_delete
scheduler_task_run_now
scheduler_task_stop_run
```

MCP schemas are exported from the Scheduler capability domain. They should not be copied into Database MCP files.

MCP result normalization remains domain-aware:

- Database tools keep the current normalization.
- Scheduler tools return Scheduler payloads directly.

HTTP MCP and stdio MCP must expose the same tools and route to the same action names.

## Permissions And Audit

Read-only capabilities do not execute scheduled actions and do not require shell or network permission.

`schedulerTaskUpdate` mutates task definitions but does not execute task actions. It should be recorded as a Scheduler external mutation if a Scheduler operation log exists in the implementation. If no Scheduler operation log exists yet, the design does not require adding one in this phase.

Scheduled task execution remains governed by the existing path:

```text
TaskSchedulerService
  -> TaskSchedulerExecutionService
  -> Action Runtime
  -> PermissionGuard
  -> AuditSink
```

External update must not bypass future execution permission checks. Updating the schedule only changes when the task will run; execution permissions are still checked at run time.

## Error Handling

Expected errors:

- Unknown action.
- Unknown MCP tool.
- Unsupported CLI subcommand.
- Missing or invalid `taskId`.
- Missing task for runs, status, or update.
- Invalid `limit`.
- Empty update patch.
- Forbidden update field.
- Invalid cron expression.
- Invalid interval schedule.
- Invalid missed-run policy.
- Synapse app is not running for CLI or stdio MCP.

Transport wrapping:

- HTTP returns `{ ok: false, error }`.
- CLI prints the error and exits non-zero.
- MCP returns `isError: true` with the same message.

## Testing

Capability registry tests:

- New actions are registered in the Scheduler domain.
- Each new action has CLI and MCP metadata.
- Database actions remain in the Database domain.
- The external matrix does not include delete, manual run, or stop-run.

Action Runtime tests:

- `core.action-runtime` creates one `MainActionRegistry`.
- `core.task-scheduler` uses the registry from `core.action-runtime`.
- `schedulerActionTypesList` reads from the same registry used for execution.
- Built-in action manifests expose stable `configFields`.

Scheduler external adapter tests:

- `schedulerTaskRunsList` validates `taskId`, applies default limit, and caps limit at `100`.
- `schedulerTaskRuntimeStatus` returns global status and single-task status.
- `schedulerActionTypesList` returns built-in action descriptors.
- `schedulerTaskUpdate` maps public schedule to internal trigger.
- `schedulerTaskUpdate` rejects empty patches.
- `schedulerTaskUpdate` rejects forbidden fields.

CLI tests:

- `synapse scheduler run list <taskId>` calls `schedulerTaskRunsList`.
- `synapse scheduler runtime inspect [taskId]` calls `schedulerTaskRuntimeStatus`.
- `synapse scheduler action-type list` calls `schedulerActionTypesList`.
- `synapse scheduler update <taskId> --data '{...}'` calls `schedulerTaskUpdate`.
- `synapse scheduler delete`, `run`, and `stop` are rejected.

MCP tests:

- `tools/list` includes the four new tools.
- `tools/list` does not include delete, run-now, or stop-run tools.
- New MCP tools route to the expected Scheduler actions.
- HTTP MCP and stdio MCP use the same tool definitions and mappings.

Router/API tests:

- New Scheduler actions route to Scheduler dispatcher.
- Unknown delete/run/stop action remains unknown.
- Existing Database routing is unchanged.

Verification commands:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Do not start the dev server or open runtime previews for this work unless explicitly requested.

## Acceptance Criteria

- The same MCP server exposes existing Database tools, existing Scheduler tools, and the four new Scheduler tools.
- Every new Scheduler external capability has aligned underlying service call, API action, CLI command, and MCP tool.
- Action Runtime registry is first-class and shared between action type listing and scheduled task execution.
- Agents can list task runs, inspect runtime status, inspect available action types, and conservatively update task definitions.
- Agents cannot delete tasks, manually run tasks, stop runs, or change task actions through API, CLI, or MCP.
- Delete remains UI-only in this phase.
- Existing Database MCP behavior is unchanged.
- Existing first-phase Scheduler MCP behavior is unchanged.
- Hard constraints, typecheck, and tests pass after implementation.
