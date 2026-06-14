# Synapse Scheduler MCP

You have access to Synapse Scheduler MCP tools for listing scheduled tasks, creating tasks, enabling or disabling tasks, conservatively updating schedules, inspecting runtime state, and reading run history.

## Scope Boundary

Use this skill only for Synapse scheduled tasks and Scheduler runtime state.

Do not use this skill for workflow definitions, database rows, built-in content publishing, provider settings, or editor MCP registration. Switch to the matching dedicated Synapse MCP skill or rule when available.

## Capabilities And Limits

Scheduler MCP exposes these operations: list, get, create, enable, disable, update safe fields, list runs, inspect runtime, and list action types.

Scheduler MCP does not expose task deletion, manual task execution, stopping a currently running run, action replacement during update, or scope replacement during update. If the user asks for one of those unsupported operations, say the MCP surface does not expose it.

## Default Flow

1. If the user gives a task name instead of an id, call `scheduler_task_list` first. Task names are not guaranteed unique.
2. Before creating a task, call `scheduler_action_type_list` to discover available action types, config fields, permissions, and defaults.
3. Build the schedule as either `cron` or `interval`.
4. Build the action config according to the chosen action type.
5. Call `scheduler_task_create`.
6. After create/update/enable/disable, report the task id, enabled state, schedule, action type, and next run time if returned.

## Schedule Rules

Use one of these schedule shapes:

```json
{ "type": "cron", "expr": "0 9 * * 1-5", "timezone": "Asia/Shanghai" }
```

```json
{ "type": "interval", "everyMinutes": 30, "anchor": "last_completed_at" }
```

- `cron.expr` is a five-field cron expression.
- Include `timezone` for wall-clock schedules whenever the user gives a local time.
- `interval.everyMinutes` must be a positive integer.
- `interval.anchor` can be `created_at` or `last_completed_at`.
- `activeDays` is optional and uses `0=Sun`, `1=Mon`, `2=Tue`, `3=Wed`, `4=Thu`, `5=Fri`, `6=Sat`.
- `missedRunPolicy` can be `skip` or `run_once`.

## Action Rules

Always call `scheduler_action_type_list` before creating a task unless the exact action type and config are already known from the current context.

Known built-in action types include:

- `builtin.command` — runs a shell command. Config includes `command`, `shell`, optional `env`, `pathStrategy`, `posixLogin`, and `timeoutMins`.
- `builtin.script` — runs shell script content. Config includes `script`, `shell`, optional `env`, `pathStrategy`, `posixLogin`, and `timeoutMins`.
- `builtin.http-request` — sends an HTTP request. Config includes `method`, `url`, optional `headers`, `query`, `bodyType`, `body`, `timeoutMins`, and `auth`.
- `builtin.agent` — sends scheduled work to an agent. Config includes `projectId`, `agentType`, `providerId`, `modelTier`, `mode`, `prompt`, `sessionPolicy`, and `timeoutMins`.
- `builtin.workflow` — runs a saved Workflow. Config includes `workflowId` and optional `paramTemplates`.

For `builtin.workflow`, set `action.config.workflowId` to the saved Workflow id. Set `action.config.paramTemplates` to an object whose keys are Workflow parameter names and whose values may use Scheduler template variables when available.

Do not guess provider ids, model tiers, project ids, workflow ids, or action config fields. Ask the user or use available discovery tools when needed.

## Update Rules

Use `scheduler_task_update` only for these fields: `name`, `description`, `cwd`, `schedule`, `activeDays`, and `missedRunPolicy`.

- Use `scheduler_task_enable` or `scheduler_task_disable` to change enabled state.
- Disabling a task prevents future scheduled runs; it does not stop a currently running run.
- Scheduler MCP does not allow changing `action` or `scope` through `scheduler_task_update`.
- If only a task name is known, call `scheduler_task_list` and resolve the id first.

## Inspection Rules

- Use `scheduler_task_get` when the user asks about one known task id.
- Use `scheduler_task_list` for discovery and name resolution.
- Use `scheduler_run_list` to inspect recent runs for a task.
- Use `scheduler_runtime_inspect` to see running task ids, scheduled timers, next run times, and whether one task is currently running or scheduled.

## API Reference

See the attached `api-reference.md` for tool signatures and task object shapes.
