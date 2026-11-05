# Synapse Automation MCP API Reference

## Receipt trigger fragments

Use trigger type discovery for the current schemas and variables. Internal letters use `{ "type": "builtin.mail-internal-received", "config": {} }`. External mail uses `{ "type": "builtin.mail-received", "config": {} }` for all configured accounts, or adds `config.accountId` using an actual ID returned by `app_mail_account_list`. No sender/subject/body/attachment filters are supported.

`{{trigger.payload.id}}` matches Copy ID: `站内信ID` is the typed `synapse://mail-internal/<id>` reference; `邮件ID` is the local `em_...` ID. The existing `{{trigger.payload.messageId}}` retains its raw identifier value. Discovery returns these labels and keys through the shared trigger manifests; no new tool or configuration field is required.

Create/update/enable/disable continue using the existing Automation tools; no extra receipt MCP tool is introduced. Enabling confirms the source cursor online and fails without enabling when a source is unavailable. `app_automation_run_execute` rejects these triggers without receipt context. An imported configuration is disabled and must be enabled again online. The existing Agent executor consumes `{{trigger.payload.body}}` and other discovered receipt variables; reading does not mark a letter read. Queue/dedupe records are local-only and are not imported or exported.

> **Reaching Synapse tools.** The Synapse MCP server publishes only two tools, `search` and `invoke`. Call `search` first with the user's intent or the exact `app_*` name, then call `invoke` with the exact name and the `arguments` described by the `inputSchema` that `search` returned. Never guess a name or arguments. In Synapse Agent conversations the same two tools appear as `mcp__synapse-tool-router__search` and `mcp__synapse-tool-router__invoke`.

Each tool maps to the same canonical Synapse API action.

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

`builtin.agent` and `builtin.claude-code` are registered. Claude Code accepts `{ "projectId": "project-id", "prompt": "Review {{trigger.payload.body}}", "singleRun": false }`; `singleRun` is optional and defaults to false. It reads the current default provider/model/permission mode at execution time and creates a terminal without navigating or taking focus. Omitted/false preserves interactive mode; true adds native `--print` and the terminal session/pane/empty tab is removed when the CLI exits (including failures). This does not change trigger frequency, does not forcibly close on Stop hooks, and does not guarantee CLI background tasks have finished. Success confirms the initial prompt submission, not task completion. Confirmation times out after 60 seconds without automatic resend; a created terminal is not forcibly stopped and remains available until its process exits. Retired types are rejected on create/update and removed in the background, including after backup restore. Both supported types (including invalid configs) and run history are preserved.

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

Use Agent/provider/project discovery to obtain real configuration identifiers before creating an Automation.

Input:

```json
{
  "name": "Daily summary",
  "enabled": true,
  "scope": { "type": "project", "projectId": "project-id" },
  "trigger": {
    "type": "builtin.interval",
    "config": { "everyMinutes": 60, "anchor": "created_at" }
  },
  "conditions": {
    "operator": "and",
    "items": [
      { "type": "weekdays", "days": [1, 2, 3, 4, 5] },
      { "type": "daily-time-range", "start": "08:00", "end": "17:00" }
    ]
  },
  "executor": {
    "type": "builtin.agent",
    "config": {
      "projectId": "project-id",
      "agentType": "claude-code",
      "providerId": "provider-id",
      "modelTier": "default",
      "mode": "default",
      "prompt": "Summarize the project at {{trigger.triggeredAt}}",
      "sessionPolicy": "fresh",
      "timeoutMins": 30
    }
  },
  "policy": { "missedRunPolicy": "skip", "overlapPolicy": "skip" }
}
```

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
      "config": { "everyMinutes": 30, "anchor": "last_completed_at" }
    },
    "conditions": {
      "operator": "or",
      "items": [
        { "type": "weekdays", "days": [1, 2, 3, 4, 5] },
        { "type": "daily-time-range", "start": "09:00", "end": "18:00" }
      ]
    }
  }
}
```

Returns a public item summary. `trigger` and `executor` patches replace the corresponding stored refs. Omit `conditions` to preserve the current set; pass `conditions: null` to clear it.

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

## Public Summary Boundary

Item summaries include `schemaVersion`, `legacy`, safe top-level `conditions`, trigger type, trigger summary, executor type, executor title, status, timestamps, and validation issues.

Item summaries do not include `trigger.config` or `executor.config`.

Run summaries include id, status, trigger/executor type, timestamps, sanitized result summary, and whitelisted non-secret metrics.

Run summaries do not include logs, raw outputs, Agent prompts, shell command text, scripts, HTTP bodies, Authorization values, Bearer tokens, Basic passwords, cookies, API keys, environment variable values, or raw event payloads.

### Automation conditions

Automation `schemaVersion: 2` accepts optional top-level `conditions`:

```json
{
  "operator": "and",
  "items": [
    { "type": "weekdays", "days": [1, 2, 3, 4, 5] },
    { "type": "daily-time-range", "start": "08:00", "end": "17:00" }
  ]
}
```

Each type may occur once. Weekdays use `0=Sunday` through `6=Saturday`. Time ranges use `HH:mm`, allow `24:00` only as the end, and require start earlier than end. Empty or omitted conditions mean unrestricted. The relation applies to the whole set: `and` requires all conditions, `or` requires any one.

All automatic trigger types are gated. Cron uses its configured timezone; other triggers use local time. Start is inclusive and end exclusive. Manual runs remain unrestricted and active runs continue across the end boundary. Cron/interval candidates retain their cadence and search at most five years. Webhook and mail events outside the set are discarded without replay; mail deliveries are marked skipped internally.

Create/update do not accept schedule conditions inside cron or interval `trigger.config`. Older nested fields are not migrated. Existing `schemaVersion: 1` Automations are disabled on upgrade, preserved read-only, and reject enable/update/run operations; create a new v2 Automation to use the new model.
