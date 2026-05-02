# Synapse MCP Scheduler Tools Design

## Context

Synapse currently exposes Data Store capabilities through an MCP server named `synapse-database`. The server supports HTTP and stdio transports and already registers itself with supported editors. Its database tools are stable and should not be renamed or behaviorally changed in this phase.

Synapse also has a first-class Task Scheduler module. The scheduler already supports cron and interval triggers, task enablement, manual runs, run history, and action execution through the existing Action Runtime.

The new goal is to let agents create and manage scheduled tasks through MCP without changing existing database MCP behavior.

## Goals

- Rename the MCP product identity from Data Store MCP to Synapse MCP.
- Keep every existing database MCP tool name, input schema, result shape, validation path, and execution path unchanged.
- Add scheduler MCP tools for creating and managing scheduled tasks.
- Support the same scheduler tools through HTTP MCP and stdio MCP.
- Route scheduler MCP calls through `TaskSchedulerService`, not directly through task repositories.
- Keep the first version focused on safe task management; do not expose deletion or run-result mutation.

## Non-Goals

- No rename of existing database tools such as `list_tables`, `query`, `insert`, or `operation_log`.
- No `database_*` tool migration in this phase.
- No `synapse_overview` tool in this phase.
- No scheduler task deletion through MCP.
- No stop-run tool through MCP.
- No workflow composer, multi-action task orchestration, or new action types.
- No renderer UI redesign beyond product copy needed for the MCP service name.

## Chosen Approach

Upgrade the existing MCP service identity to Synapse MCP and append a scheduler tool group.

Existing database tools remain exactly as they are. The scheduler tools use the `scheduler_` prefix and resource-style naming:

```text
scheduler_task_list
scheduler_task_get
scheduler_task_create
scheduler_task_update
scheduler_task_enable
scheduler_task_disable
scheduler_task_run
scheduler_task_runs_list
```

This gives agents one Synapse MCP server for local Synapse capabilities while keeping the database protocol stable.

## Service Identity

The current MCP identity lives in `desktop/data-store/shared/server-identity.ts`.

The implementation should change the current server name from `synapse-database` to:

```text
synapse
```

`SYNAPSE_DATA_SERVER_IDENTITY.name` should follow that name so MCP `initialize` returns the new Synapse identity.

To avoid duplicate editor registrations after the rename, the previous names should be treated as legacy registration names:

```text
synapse-database
synapse-data
```

The existing registration flow already has a legacy-name removal pattern. The implementation should reuse that pattern instead of inventing a second migration path.

User-facing settings copy should say `Synapse MCP`. File and module paths remain under `data-store` for this phase to keep the code change small.

## Existing Database Tools

The database tools remain unchanged:

- Tool names stay as they are.
- `inputSchema` stays as it is.
- `MCP_TOOL_ACTIONS` mappings for database tools stay behaviorally equivalent.
- `normalizeToolResult` keeps returning the same shapes.
- `dispatchDataStoreAction` remains the database execution path.
- Data Store HTTP API and CLI behavior remain unchanged.

Adding scheduler tools must not require callers to migrate any existing database MCP prompts or integrations.

## Scheduler Tool Semantics

### `scheduler_task_list`

Lists scheduled tasks.

Input:

```json
{}
```

Returns the same task entry shape exposed by the existing task scheduler IPC API.

### `scheduler_task_get`

Gets one scheduled task.

Input:

```json
{
  "taskId": "task:..."
}
```

Returns a task entry or `null`.

### `scheduler_task_create`

Creates a scheduled task.

Input uses a slightly agent-friendly `schedule` field and maps to the existing scheduler create shape:

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
    "type": "builtin.http-request",
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

The MCP layer maps schedules to the internal trigger model:

```text
cron     -> { type: "builtin.cron", config: { expr, timezone? } }
interval -> { type: "builtin.interval", config: { everyMinutes, anchor? } }
```

Supported action types are the action types already registered by the Action Runtime:

```text
builtin.command
builtin.script
builtin.http-request
```

The action config is validated by the existing action package schema during normal scheduler execution.

### `scheduler_task_update`

Updates a scheduled task.

Input:

```json
{
  "taskId": "task:...",
  "patch": {
    "name": "New name",
    "description": "Optional",
    "scope": { "type": "global" },
    "cwd": "/optional/path",
    "schedule": {
      "type": "interval",
      "everyMinutes": 60
    },
    "action": {
      "type": "builtin.command",
      "config": {}
    },
    "enabled": true,
    "missedRunPolicy": "skip"
  }
}
```

Only provided fields are changed. A provided `schedule` is mapped to the internal trigger model before calling `TaskSchedulerService.updateTask`.

### `scheduler_task_enable`

Enables one task.

Input:

```json
{
  "taskId": "task:..."
}
```

This maps to `TaskSchedulerService.setTaskEnabled(taskId, true)`.

### `scheduler_task_disable`

Disables one task.

Input:

```json
{
  "taskId": "task:..."
}
```

This maps to `TaskSchedulerService.setTaskEnabled(taskId, false)`.

Separate enable and disable tools are easier for agents to call correctly than a boolean setter.

### `scheduler_task_run`

Manually runs one task.

Input:

```json
{
  "taskId": "task:..."
}
```

This maps to `TaskSchedulerService.runTaskNow(taskId)`.

The tool does not allow the caller to set `triggeredBy`, write run output, or forge a run status.

### `scheduler_task_runs_list`

Lists run history for one task.

Input:

```json
{
  "taskId": "task:...",
  "limit": 20
}
```

This maps to `TaskSchedulerService.listRuns(taskId, { limit })`. The limit should follow the same max bound used by the existing IPC layer.

## Execution Boundary

Scheduler MCP calls must resolve the existing `core.task-scheduler` service through the Electron service registry. They must not write `task-scheduler.tasks` or `task-scheduler.runs` repositories directly.

The MCP tool executor should have two domains:

- database tools: existing `dispatchDataStoreAction` path
- scheduler tools: new `TaskSchedulerService` path

Unknown tools continue to return the current MCP unknown-tool response.

## HTTP And Stdio Transport

HTTP MCP and stdio MCP must expose the same tools and behavior.

The Electron in-process MCP server is the authoritative execution environment because it can resolve `TaskSchedulerService`. The stdio bridge cannot own scheduler execution directly.

To keep behavior aligned, stdio tool calls should route to the running Electron app rather than duplicating scheduler logic. The stdio bridge should forward MCP JSON-RPC requests to the in-process MCP HTTP endpoint after resolving its local URL from app-persisted server metadata.

The app-persisted metadata should include the active MCP URL after the in-process MCP HTTP server starts. Use the existing server metadata file that stdio already reads, extending it with an `mcpUrl` field. The bridge must not guess the port because the HTTP MCP server can move to the next port when the preferred port is occupied.

With that routing:

- tool definitions come from one shared source
- database behavior remains unchanged
- scheduler execution happens in the Electron main process
- stdio and HTTP return the same response shape for the same tool call

## Permissions And Audit

Scheduler MCP tools must rely on the same scheduler and action execution path as the app UI.

Important constraints:

- Creating and updating tasks go through `TaskSchedulerService`.
- Manual runs go through `TaskSchedulerService.runTaskNow`.
- Action execution continues to use existing Action Runtime permission checks.
- `builtin.command` and `builtin.script` remain shell execution operations.
- `builtin.http-request` remains a network operation.
- MCP callers cannot bypass scheduler overlap, missed-run, timeout, or run-history behavior.
- MCP callers cannot write run records directly.

If a permission check fails during execution, the tool should return the same failure information the scheduler records for that run. MCP must not pretend to have a UI confirmation step.

## Error Handling

Tool errors should stay concise and machine-readable through the existing MCP response shape.

Expected error cases:

- Unknown scheduler task id.
- Invalid cron expression.
- Invalid interval.
- Invalid action type or action config.
- Permission denial during execution.
- Task action failure, timeout, or cancellation.

Scheduler runtime errors must finish the run through the existing scheduler execution service where a run has already started.

## Testing

Add focused tests for the MCP layer:

- Existing database MCP tools still appear with the same names.
- Existing database MCP schemas are unchanged.
- Existing database MCP calls still normalize results the same way.
- `tools/list` includes the eight scheduler tools.
- `scheduler_task_create` maps cron schedule input to `builtin.cron`.
- `scheduler_task_create` maps interval schedule input to `builtin.interval`.
- `scheduler_task_update` patches only provided fields.
- `scheduler_task_enable` and `scheduler_task_disable` call `setTaskEnabled` with the correct boolean.
- `scheduler_task_run` calls `runTaskNow`.
- `scheduler_task_runs_list` calls `listRuns` with `taskId` and `limit`.
- stdio and HTTP use the same tool definitions.
- MCP server identity returns the Synapse-level server name.

Verification commands:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
pnpm --filter @synapse/desktop run test
```

Do not start the dev server or open runtime previews for this work unless explicitly requested.

## Acceptance Criteria

- MCP service is presented as Synapse MCP.
- Existing database MCP tools are not renamed.
- Existing database MCP behavior remains unchanged.
- Scheduler tools are visible from MCP `tools/list`.
- Scheduler tools work from both HTTP MCP and stdio MCP.
- Scheduler tools call `TaskSchedulerService`.
- Agents can create, update, enable, disable, run, inspect, and read run history for tasks.
- MCP does not expose scheduler delete, stop-run, or run-result mutation in this phase.
- Hard constraints, typecheck, and tests pass.
