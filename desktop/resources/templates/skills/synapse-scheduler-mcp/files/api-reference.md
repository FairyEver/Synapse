# Synapse Scheduler MCP — API Reference

All tools are accessed through the `synapse-mcp` MCP server.

## Task Discovery

### scheduler_task_list

List scheduled tasks. Use first when only a task name is known.

**Params:** `enabled?`, `limit?`, `scope?`

`scope` can be `{ "type": "global" }` or `{ "type": "project", "projectId": "..." }`. Omit `projectId` with project scope to match all project tasks.

### scheduler_task_get

Get one scheduled task by id.

**Params:** `taskId`

## Task Creation

### scheduler_action_type_list

List action types that can be used when creating scheduled tasks, including public config fields, defaults, and permissions.

Call before `scheduler_task_create` unless the exact action config is already known.

### scheduler_task_create

Create one scheduled task.

**Params:** `name`, `scope`, `schedule`, `action`, `description?`, `cwd?`, `enabled?`, `missedRunPolicy?`, `activeDays?`

`scope`:

```json
{ "type": "global" }
```

```json
{ "type": "project", "projectId": "project-id" }
```

`schedule`:

```json
{ "type": "cron", "expr": "0 9 * * 1-5", "timezone": "Asia/Shanghai" }
```

```json
{ "type": "interval", "everyMinutes": 30, "anchor": "last_completed_at" }
```

`action`:

```json
{
  "type": "builtin.command",
  "config": {
    "command": "echo ok",
    "shell": "posix",
    "timeoutMins": 30
  }
}
```

## Enable And Disable

### scheduler_task_enable

Enable one scheduled task.

**Params:** `taskId`

### scheduler_task_disable

Disable one scheduled task.

**Params:** `taskId`

Disabling prevents future scheduled runs and does not stop a currently running run.

## Updates

### scheduler_task_update

Conservatively update one scheduled task.

**Params:** `taskId`, `name?`, `description?`, `cwd?`, `schedule?`, `activeDays?`, `missedRunPolicy?`

Only those fields are accepted. Use enable/disable tools for enabled state. Action, scope, delete, manual run, and stop-run are not exposed through Scheduler MCP.

## Runs And Runtime

### scheduler_run_list

List recent runs for one scheduled task.

**Params:** `taskId`, `limit?`

This is read-only and does not start or stop runs. Run summaries include id, task id, status, trigger source, timestamps, sanitized error/summary text, and whitelisted non-secret metrics such as `durationMs`, `exitCode`, and `httpStatus`. They do not include logs, raw outputs, command text, scripts, Agent prompts, HTTP bodies, Authorization values, Bearer tokens, cookies, API keys, environment variable values, or raw event payloads.

### scheduler_runtime_inspect

Inspect Scheduler runtime state for one task or all tasks.

**Params:** `taskId?`

Returns running task ids, scheduled task ids, and per-task state such as enabled, running, scheduled, next run time, last run time, and last status.

## Common Action Configs

### builtin.command

Runs a shell command.

Fields: `command`, `shell`, `env?`, `pathStrategy?`, `posixLogin?`, `timeoutMins?`

### builtin.script

Runs shell script content.

Fields: `script`, `shell`, `env?`, `pathStrategy?`, `posixLogin?`, `timeoutMins?`

### builtin.http-request

Sends an HTTP request.

Fields: `method`, `url`, `headers?`, `query?`, `bodyType`, `body?`, `timeoutMins?`, `auth?`

### builtin.agent

Sends scheduled work to an agent.

Fields: `projectId`, `agentType`, `providerId`, `modelTier`, `mode`, `prompt`, `sessionPolicy`, `timeoutMins?`

### builtin.workflow

Runs a saved Workflow.

Fields: `workflowId`, `paramTemplates?`

`paramTemplates` is an object keyed by Workflow parameter name. Values are string templates that may use Scheduler template variables when available.
