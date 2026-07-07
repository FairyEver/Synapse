# Synapse Automation MCP API Reference

All tools are accessed through the `synapse-mcp` MCP server. Each tool maps to the same canonical Synapse API action.

## Discovery

### app_automation_trigger_type_list

Input:

```json
{}
```

Returns trigger descriptors with `type`, `title`, `kind`, `defaultConfig`, `configSchema`, and optional `variables`.

### app_automation_executor_type_list

Input:

```json
{}
```

Returns executor descriptors with `type`, `title`, `permissions`, `defaultConfig`, and `configFields`.

`defaultConfig` is platform-aware. On Windows, `builtin.command` and `builtin.script` return `shell: "cmd"` by default. Explicit saved or user-provided `shell` values are still honored.

## Items

### app_automation_item_list

Input:

```json
{
  "enabled": true,
  "limit": 20,
  "scope": { "type": "project", "projectId": "project-id" }
}
```

All fields are optional. Returns public item summaries. `enabled` and `scope` filters are applied before `limit`, so use `limit` for bounded list/lookup flows on large Automation sets.

### app_automation_item_get

Input:

```json
{ "automationId": "automation:..." }
```

Returns one public item summary or `null`.

### app_automation_item_create

For command or script executors, the dispatcher applies the `defaultConfig` returned by `app_automation_executor_type_list` before validation. Provide the user-requested command, script, timeout, or environment fields, and include `shell` only when the user explicitly requests a non-default shell.

Input:

```json
{
  "name": "Daily summary",
  "description": "Optional description",
  "enabled": true,
  "scope": { "type": "global" },
  "cwd": "/Users/example/project",
  "trigger": {
    "type": "builtin.interval",
    "config": { "everyMinutes": 60, "anchor": "created_at", "activeDays": [1, 2, 3, 4, 5] }
  },
  "executor": {
    "type": "builtin.command",
    "config": { "command": "date", "timeoutMins": 30 }
  },
  "policy": { "missedRunPolicy": "skip", "overlapPolicy": "skip" }
}
```

Workflow executor example:

```json
{
  "executor": {
    "type": "builtin.workflow",
    "config": {
      "workflowId": "workflow-id",
      "paramTemplates": {
        "title": "{{trigger.request.body.title}}",
        "triggeredAt": "{{trigger.triggeredAt}}"
      }
    }
  }
}
```

`builtin.workflow` config fields are `workflowId` and `paramTemplates`. `paramTemplates` values may use Automation template variables returned by trigger discovery.

Returns a public item summary.

### app_automation_item_update

Input:

```json
{
  "automationId": "automation:...",
  "patch": {
    "name": "New name",
    "trigger": {
      "type": "builtin.interval",
      "config": { "everyMinutes": 30, "anchor": "last_completed_at", "activeDays": [1, 2, 3, 4, 5] }
    }
  }
}
```

Returns a public item summary. `trigger` and `executor` patches replace the corresponding stored refs.

### app_automation_item_delete

Input:

```json
{ "automationId": "automation:..." }
```

Returns:

```json
{ "deleted": true }
```

### app_automation_item_enable

Input:

```json
{ "automationId": "automation:..." }
```

Returns a public item summary.

### app_automation_item_disable

Input:

```json
{ "automationId": "automation:..." }
```

Returns a public item summary.

## Runs

### app_automation_run_execute

Input:

```json
{ "automationId": "automation:..." }
```

Returns a safe run summary. If the Automation is missing or no run starts, the tool fails instead of returning a successful empty result.

### app_automation_run_disable

Input:

```json
{ "runId": "automation-run:..." }
```

Returns:

```json
{ "stopped": true }
```

If the run already finished, the result can include:

```json
{ "stopped": false, "alreadyFinished": true }
```

If stop was requested but the run did not settle yet, the result can include:

```json
{ "stopped": false, "stopRequested": true }
```

Do not describe `stopRequested: true` as stopped. Check `app_automation_runtime_inspect` or `app_automation_run_list` before reporting the run as stopped.

If the run is missing or no longer active, the tool fails instead of returning a successful empty stop result.

### app_automation_run_list

Input:

```json
{ "automationId": "automation:...", "limit": 20 }
```

Returns recent safe run summaries. `limit` defaults to 20 and caps at 100.

### app_automation_webhook_list

Input:

```json
{}
```

Returns current account Webhooks for `builtin.webhook` trigger configs:

```json
[
  {
    "publicId": "wh_...",
    "name": "Deploy hook",
    "enabled": true,
    "createdAt": "2026-06-14T00:00:00.000Z",
    "updatedAt": "2026-06-14T00:00:00.000Z",
    "lastDeliveryAt": "2026-06-14T00:05:00.000Z",
    "lastDeliveryStatus": "delivered"
  }
]
```

Use `publicId` as `trigger.config.webhookPublicId`. This result does not include the Webhook secret URL.

## Runtime

### app_automation_runtime_inspect

Input:

```json
{ "automationId": "automation:..." }
```

`automationId` is optional. Returns running item ids, scheduled item ids, and compact runtime state.

## Swarm Tasks

### app_swarm_task_task_list

Input:

```json
{}
```

Returns reusable Swarm Task configs. Use this before creating a duplicate task by name.

### app_swarm_task_task_get

Input:

```json
{ "taskId": "swarm-task:..." }
```

Returns one Swarm Task config or `null`.

### app_swarm_task_task_create

Input:

```json
{
  "name": "Research candidates",
  "description": "Optional description",
  "config": {
    "projectId": "project-id",
    "workspacePath": "/Users/example/project",
    "prompt": "Find and summarize candidate approaches.",
    "presetId": "general",
    "runMode": "batch",
    "concurrency": 3,
    "maxRounds": 3,
    "injectOptions": {
      "workerIdentity": true,
      "roundContext": true,
      "runContext": true,
      "outputProtocol": true,
      "parallelContext": true,
      "gitContext": false,
      "customAppendix": ""
    },
    "output": {
      "mode": "managed-directory",
      "targetFilePolicy": "append-only"
    },
    "summary": {
      "enabled": true,
      "injectRecent": false,
      "recentLimit": 3
    },
    "handoff": {
      "enabled": false
    },
    "agent": {}
  }
}
```

Returns the saved task. `runMode` is `batch` or `continuous`. `concurrency` is 1-20. `maxRounds` is 1-500. Output `mode` is `managed-directory`, `target-file`, or `both`. Target file policy is `append-only`, `section-update`, or `free-edit`.

### app_swarm_task_task_update

Input:

```json
{
  "taskId": "swarm-task:...",
  "patch": {
    "name": "New name",
    "description": "Updated description"
  }
}
```

Returns the updated task. `currentConfig` replaces the saved task config; if you include it, send a full config object. Omit `currentConfig` when changing only name or description.

### app_swarm_task_task_delete

Input:

```json
{ "taskId": "swarm-task:..." }
```

Returns:

```json
{ "ok": true }
```

### app_swarm_task_run_start

Input:

```json
{
  "taskId": "swarm-task:...",
  "configOverride": {
    "runMode": "continuous",
    "concurrency": 2,
    "maxRounds": 10
  }
}
```

`configOverride` is optional and applies only to this run. The run stores a full config snapshot.

### app_swarm_task_run_stopRefill

Input:

```json
{ "runId": "swarm-run:..." }
```

Requests a continuous run to stop launching new workers. Active workers may continue.

### app_swarm_task_run_cancel

Input:

```json
{ "runId": "swarm-run:..." }
```

Cancels the run and active workers when possible.

### app_swarm_task_run_list

Input:

```json
{ "taskId": "swarm-task:...", "limit": 20 }
```

All fields are optional. Returns recent runs. `limit` caps at 200.

### app_swarm_task_run_get

Input:

```json
{ "runId": "swarm-run:..." }
```

Returns one run with workers. Worker records include phase, status, optional summary, optional handoff, and linked Agent `conversationId` when available. Open linked worker conversations as Agent conversations with platform `"swarm"`.

## Public Summary Boundary

Item summaries include trigger type, trigger summary, executor type, executor title, status, timestamps, and validation issues.

Item summaries do not include `trigger.config` or `executor.config`.

Run summaries include id, status, trigger/executor type, timestamps, sanitized result summary, and whitelisted non-secret metrics.

Run summaries do not include logs, raw outputs, Agent prompts, shell command text, scripts, HTTP bodies, Authorization values, Bearer tokens, Basic passwords, cookies, API keys, environment variable values, or raw event payloads.

Swarm Task runs include config snapshots and worker summaries. Treat worker prompts and linked Agent conversation content as conversation data, not as direct terminal output.
