# Synapse MCP Scheduler Tools Design

> Superseded note: Synapse-owned CLI and stdio MCP capability entrypoints were retired after this document was written. Current external capability access uses loopback HTTP MCP; local HTTP `/api` remains an authenticated internal API.

## Context

Synapse currently exposes Database capabilities through one local MCP server. That server already supports HTTP MCP and stdio MCP, and its existing database tools are stable.

Synapse also has a first-class Task Scheduler module. The scheduler already supports cron and interval triggers, task enablement, manual runs, run history, and action execution through the existing scheduler and Action Runtime services.

The new goal is to extend the same MCP server from "database-only" capabilities into a broader Synapse capability surface. The first added domain is Task Scheduler.

This must not merge Database and Task Scheduler into one domain. They are separate domains behind shared transport surfaces.

## Goals

- Keep one MCP server for Synapse local capabilities.
- Keep every existing Database MCP tool name, input schema, result shape, validation path, and execution path unchanged.
- Add a separate Scheduler domain with `scheduler_` MCP tools.
- Add matching HTTP API actions and CLI commands for the same Scheduler capabilities.
- Make API, CLI, and MCP use the same Scheduler action names and canonical input shapes.
- Route Scheduler calls through `TaskSchedulerService`, not task repositories.
- Keep the first Scheduler MCP phase focused on task creation, enablement, disablement, listing, and detail lookup.
- Design the capability layer so later domains can be added without editing Database internals.

## Non-Goals

- Database tools use canonical `database_*` names such as `database_table_list`, `database_row_list`, `database_row_create`, and `database_log_list`.
- No additional Database behavior changes in this phase.
- No Scheduler task deletion through MCP, CLI, or the new HTTP action set.
- No stop-running-run tool in this phase.
- No Scheduler update tool in this phase.
- No manual run tool in this phase.
- No run-history MCP tool in this phase.
- No workflow composer, multi-action orchestration, or new action types.
- No renderer UI redesign.

## Chosen Approach

Use one shared transport layer with multiple isolated capability domains.

```text
Synapse local capability gateway
  Database domain
    existing Database actions
    existing Database MCP tools
    existing Database dispatcher

  Scheduler domain
    new Scheduler actions
    new Scheduler MCP tools
    new Scheduler dispatcher
```

The outer gateway owns transport concerns:

- HTTP API request routing.
- MCP tool listing and tool-call routing.
- CLI top-level command routing.
- Source tracking such as `api`, `cli`, `mcp-http`, and `mcp-stdio`.

Each domain owns its own capability definitions, validation, parameter conversion, result normalization, and service calls.

The Database domain must not import Scheduler logic. The Scheduler domain must not import Database business logic.

## Existing Database Behavior

The existing database behavior remains unchanged:

- Existing MCP tool names stay as they are.
- Existing MCP input schemas stay as they are.
- Existing MCP result normalization stays behaviorally equivalent.
- Existing Database actions continue to route to `dispatchDatabaseAction`.
- Existing Database HTTP API calls continue to work.
- Existing Database CLI commands continue to work.

The current Database implementation already has the useful pattern this design should copy:

- One registry maps action names to MCP tools and CLI commands.
- CLI and stdio MCP call the running Electron app through local HTTP.
- HTTP dispatches by `action`.
- MCP HTTP and stdio MCP use shared tool definitions.

The Scheduler domain should reuse that pattern, not be added into the Database dispatcher.

## Capability Domain Model

Introduce a domain-oriented capability model. File names are illustrative; implementation should follow existing repository placement conventions while preserving domain boundaries.

```ts
type SynapseCapabilityDomain = {
  id: string
  actions: readonly CapabilityAction[]
  dispatch(action: string, params: Record<string, unknown>, context: DispatchContext): Promise<DispatchResult> | DispatchResult
}

type CapabilityAction = {
  action: string
  mcpTool?: McpToolDefinition
  cliCommand?: CliCommandDefinition
  mutates: boolean
}
```

Database registers one domain. Scheduler registers another domain.

The gateway can then provide shared helpers:

- `getAllMcpTools()`
- `getActionForMcpTool(toolName)`
- `getCliCommands()`
- `dispatchSynapseAction(action, params, context)`

This keeps later domains extensible. Adding a `rules`, `skills`, or `content` domain should not require editing Database capability files.

## Scheduler Actions

The first Scheduler action set is:

```text
schedulerTaskList
schedulerTaskGet
schedulerTaskCreate
schedulerTaskEnable
schedulerTaskDisable
```

These are the canonical action names used by the HTTP API. CLI and MCP map onto the same names.

| Capability | HTTP action | CLI | MCP tool |
| --- | --- | --- | --- |
| List tasks | `schedulerTaskList` | `synapse scheduler list` | `scheduler_task_list` |
| Get one task | `schedulerTaskGet` | `synapse scheduler get <taskId>` | `scheduler_task_get` |
| Create task | `schedulerTaskCreate` | `synapse scheduler create --data '{...}'` | `scheduler_task_create` |
| Enable task | `schedulerTaskEnable` | `synapse scheduler enable <taskId>` | `scheduler_task_enable` |
| Disable task | `schedulerTaskDisable` | `synapse scheduler disable <taskId>` | `scheduler_task_disable` |

## Scheduler Identity And Lookup

Task detail lookup is by `taskId` only.

Task names are human-facing labels. They are not unique and can be changed. Agents that only know a name should call `scheduler_task_list`, inspect the returned entries, pick the matching `id`, then call `scheduler_task_get`.

Do not add `get by name` in this phase.

## Scheduler Canonical Inputs

The HTTP action input shape is the canonical shape. CLI and MCP should adapt into this shape and should not invent different semantics.

### `schedulerTaskList`

Input:

```json
{
  "enabled": true,
  "limit": 50
}
```

Both fields are optional.

The first implementation supports `enabled` and `limit`. Do not add exact-name lookup. If name search is needed later, add `nameContains` and keep the result as a list.

Result should be a summary list that is sufficient for an agent to choose an id:

```ts
type SchedulerTaskSummary = {
  id: string
  name: string
  description?: string
  enabled: boolean
  schedule: SchedulerSchedule
  action: { type: string }
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: string
  runCount: number
}
```

### `schedulerTaskGet`

Input:

```json
{
  "taskId": "task:..."
}
```

Returns the full task detail or `null`.

### `schedulerTaskCreate`

Input:

```json
{
  "name": "Daily summary",
  "description": "Optional",
  "scope": { "type": "global" },
  "cwd": "/optional/path",
  "schedule": {
    "type": "cron",
    "expr": "0 9 * * *"
  },
  "action": {
    "type": "builtin.command",
    "config": {}
  },
  "enabled": true,
  "missedRunPolicy": "skip"
}
```

Supported schedules:

```json
{ "type": "cron", "expr": "0 9 * * *", "timezone": "optional" }
{ "type": "interval", "everyMinutes": 30, "anchor": "created_at" }
```

The Scheduler dispatcher maps the public `schedule` field to the existing internal `trigger` model:

```text
cron     -> { type: "builtin.cron", config: { expr, timezone? } }
interval -> { type: "builtin.interval", config: { everyMinutes, anchor? } }
```

The public API should not require agents or CLI users to know internal trigger type names such as `builtin.cron`.

Supported action types are the action types already registered by the Action Runtime:

```text
builtin.command
builtin.script
builtin.http-request
```

Action config validation should use the same validation path used by the existing Scheduler and Action Runtime. The Scheduler MCP/API/CLI layer must not create a second action validation system.

### `schedulerTaskEnable`

Input:

```json
{
  "taskId": "task:..."
}
```

Maps to `TaskSchedulerService.setTaskEnabled(taskId, true)`.

### `schedulerTaskDisable`

Input:

```json
{
  "taskId": "task:..."
}
```

Maps to `TaskSchedulerService.setTaskEnabled(taskId, false)`.

Disabling a task means it remains in the task list but will not be scheduled for future runs. It does not stop a currently running run.

## HTTP API Design

Keep the existing local HTTP request style:

```json
{
  "action": "schedulerTaskCreate",
  "...": "canonical action params"
}
```

The HTTP layer should not know Scheduler details. It should call a neutral action router:

```text
POST /api
  -> dispatchSynapseAction(action, params, context)
    -> Database domain dispatcher
    -> Scheduler domain dispatcher
```

Expected source values:

```text
api
cli
mcp-stdio
mcp-http
```

Database mutation operation logging remains Database-owned. Scheduler can add its own operation logging later if needed, but the first phase should not write Scheduler events into the Database operation log.

## CLI Design

Keep one `synapse` CLI binary.

Existing Database commands remain at their current paths, for example:

```bash
synapse database table list
synapse database row list todos
```

Add Scheduler as a separate subcommand namespace:

```bash
synapse scheduler list
synapse scheduler get task:...
synapse scheduler create --data '{...}'
synapse scheduler enable task:...
synapse scheduler disable task:...
```

The CLI should:

- Parse command-line arguments.
- Convert them to canonical action params.
- Call local HTTP with the canonical action name.
- Print concise human-readable output.
- Exit non-zero on errors.

The CLI should not call `TaskSchedulerService` directly.

Historical CLI build paths can remain as thin transport wrappers if that keeps packaging small, but Scheduler parsing and capability definitions should not live inside Database business modules.

## MCP Design

Append Scheduler tools to the existing MCP `tools/list` result:

```text
scheduler_task_list
scheduler_task_get
scheduler_task_create
scheduler_task_enable
scheduler_task_disable
```

Existing Database tools remain unchanged and stay in the same MCP server.

MCP tool schemas should be generated or exported from the Scheduler domain capability definition. They should not be hand-copied into a Database-specific MCP file.

MCP result normalization should be domain-aware:

- Database tools keep the current Database result normalization.
- Scheduler tools return Scheduler task payloads directly after transport wrapping.

Unknown tools continue to return the current MCP unknown-tool response shape.

## HTTP MCP And Stdio MCP

HTTP MCP and stdio MCP must expose the same tools and behavior.

The Electron in-process environment is the authoritative execution environment because it can resolve `TaskSchedulerService`.

The stdio MCP bridge should continue to forward tool calls to the running Electron app through local HTTP `/api`, matching the current Database pattern. It must not own Scheduler execution logic and it must not proxy by guessing the MCP HTTP port.

The implementation must keep these true:

- Tool definitions come from one shared source.
- Tool-to-action mappings come from one shared source.
- Scheduler execution happens in Electron main process.
- stdio and HTTP return equivalent MCP results for the same tool call.

## Service Boundary

Scheduler calls must resolve the existing `core.task-scheduler` service through the Electron service registry or receive it through explicit dependency injection in tests.

Scheduler transport layers must not write these repositories directly:

```text
task-scheduler.tasks
task-scheduler.runs
```

Allowed service calls in this phase:

```text
TaskSchedulerService.listTasks()
TaskSchedulerService.getTask(taskId)
TaskSchedulerService.createTask(mappedInput)
TaskSchedulerService.setTaskEnabled(taskId, true)
TaskSchedulerService.setTaskEnabled(taskId, false)
```

Do not expose `deleteTask`, `runTaskNow`, `stopRun`, or `listRuns` through the new external Scheduler capability set in this phase.

## Permissions And Audit

Creating, enabling, and disabling tasks should record the request source in the dispatch context.

Task execution remains governed by the existing Scheduler and Action Runtime path:

```text
TaskSchedulerService
  -> TaskSchedulerExecutionService
  -> Action Runtime
  -> PermissionGuard
  -> AuditSink
```

MCP cannot bypass shell, script, network, timeout, overlap, missed-run, or run-history behavior.

First phase MCP does not add an interactive permission-confirmation flow. If a scheduled action later fails because permissions deny execution, the failure should be recorded through the same Scheduler execution path already used by the app.

## Error Handling

Use the same underlying error message across HTTP, CLI, and MCP.

Expected cases:

- Unknown action.
- Unknown MCP tool.
- Missing or invalid `taskId`.
- Unknown Scheduler task id for enable or disable.
- Invalid cron expression.
- Invalid interval.
- Invalid action type or action config.
- Synapse app is not running for CLI or stdio MCP.

Transport-specific wrapping:

- HTTP returns `{ ok: false, error }`.
- CLI prints the error and exits non-zero.
- MCP returns `isError: true` with the same message.

`schedulerTaskGet` returns `null` for a missing task, matching existing service behavior. Enable and disable should surface an error if the task does not exist.

## Testing

Add focused tests around drift prevention and domain isolation.

Capability registry tests:

- Database actions are still registered in the Database domain.
- Scheduler actions are registered in the Scheduler domain.
- `schedulerTaskList`, `schedulerTaskGet`, `schedulerTaskCreate`, `schedulerTaskEnable`, and `schedulerTaskDisable` each have API action, CLI command, and MCP tool metadata.
- The combined MCP tool list includes existing Database tools and new Scheduler tools.
- Existing Database tool names are unchanged.

Scheduler dispatcher tests:

- `schedulerTaskCreate` maps cron schedule input to `builtin.cron`.
- `schedulerTaskCreate` maps interval schedule input to `builtin.interval`.
- `schedulerTaskEnable` calls `setTaskEnabled(taskId, true)`.
- `schedulerTaskDisable` calls `setTaskEnabled(taskId, false)`.
- `schedulerTaskGet` calls `getTask(taskId)`.
- `schedulerTaskList` applies supported filters without exact-name lookup.

HTTP router tests:

- Database actions route to Database dispatcher.
- Scheduler actions route to Scheduler dispatcher.
- Unknown actions return the existing error shape.

CLI tests:

- `synapse scheduler list` calls `schedulerTaskList`.
- `synapse scheduler get <taskId>` calls `schedulerTaskGet`.
- `synapse scheduler create --data '{...}'` calls `schedulerTaskCreate`.
- `synapse scheduler enable <taskId>` calls `schedulerTaskEnable`.
- `synapse scheduler disable <taskId>` calls `schedulerTaskDisable`.

MCP tests:

- `tools/list` includes the five Scheduler tools.
- Existing Database MCP tools still appear with unchanged names.
- Scheduler MCP tool calls route to Scheduler actions.
- HTTP MCP and stdio MCP use the same tool definitions and tool-to-action mappings.

Verification commands:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Do not start the dev server or open runtime previews for this work unless explicitly requested.

## Acceptance Criteria

- The same MCP server exposes existing Database tools and new Scheduler tools.
- Existing Database MCP tool names, schemas, and results are unchanged.
- Database and Scheduler remain separate capability domains.
- Scheduler has API, CLI, and MCP entry points with aligned action names and input shapes.
- Scheduler task detail lookup uses `taskId`, not name.
- Agents can list tasks, inspect one task by id, create tasks, enable tasks, and disable tasks.
- Agents cannot delete tasks, stop running runs, manually run tasks, mutate run results, or list run history through this first external Scheduler capability set.
- Scheduler external calls route through `TaskSchedulerService`.
- Scheduler transport code does not directly write task repositories.
- The design supports adding later domains without editing Database internals.
- Hard constraints, typecheck, and tests pass after implementation.
