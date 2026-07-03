# Synapse Automation MCP

You have access to Synapse Automation MCP tools for managing Automation items and runs. Automation is separate from Scheduler and Workflow.

## Scope Boundary

Use this skill only for Synapse Automation items, trigger/executor configuration, enablement, manual runs, active run stopping, run history, and Automation runtime state.

Do not use this skill for old Scheduler tasks, Workflow definitions, database rows, Resource Repository publishing, provider settings, or editor installation. Switch to the matching dedicated Synapse MCP skill when available.

## Capabilities

Automation MCP exposes these operations:

- list, get, create, update, delete Automation items
- enable or disable Automation items
- manually run one Automation
- stop one active Automation run
- list recent Automation runs
- inspect Automation runtime state
- list registered trigger types
- list registered executor types

Read responses intentionally omit raw `trigger.config` and `executor.config`. Do not ask MCP to reveal hidden command text, scripts, Agent prompts, HTTP bodies, tokens, cookies, Authorization values, or environment secrets.

## Default Flow

1. If the user gives an Automation name instead of an id, call `app_automation_item_list` first. Names are not unique; pass `limit` and `scope` when you only need a bounded subset.
2. Before creating or replacing configs, call `app_automation_trigger_type_list` and `app_automation_executor_type_list`.
3. Build a full `trigger` ref: `{ "type": "...", "config": { ... } }`.
4. Build a full `executor` ref: `{ "type": "...", "config": { ... } }`.
5. Call `app_automation_item_create` or `app_automation_item_update`.
6. Use `app_automation_item_enable` or `app_automation_item_disable` for enabled state changes.
7. Use `app_automation_run_execute` for a manual run.
8. Use `app_automation_webhook_list` before creating a `builtin.webhook` trigger unless the user already gave a Webhook public id.
9. Use `app_automation_runtime_inspect` and `app_automation_run_list` to troubleshoot execution state.
10. Use `app_automation_run_disable` only when stopping an active run by run id.

## Trigger Rules

Always use trigger type discovery unless the exact config is already known from this conversation.

Known built-in trigger types include:

- `builtin.cron` - schedule by five-field cron expression.
- `builtin.interval` - schedule by fixed interval.
- `builtin.webhook` - run when a matching Webhook delivery arrives.

Use the returned `configSchema`, `defaultConfig`, and `variables` from `app_automation_trigger_type_list`. Do not guess fields that are not in the schema.

For `builtin.webhook`, call `app_automation_webhook_list` and set `trigger.config.webhookPublicId` from the returned `publicId`. You may also set `trigger.config.webhookName` from the returned name.

## Executor Rules

Always use executor type discovery unless the exact config is already known from this conversation.

Known built-in executor types include:

- `builtin.command` - runs one shell command.
- `builtin.script` - runs shell script content.
- `builtin.http-request` - sends one HTTP request.
- `builtin.agent` - sends work to an Agent.
- `builtin.workflow` - runs a saved Workflow.

Use `app_automation_executor_type_list` for public config fields, platform-aware defaults, and permissions. On Windows, `builtin.command` and `builtin.script` defaults use `cmd`; do not force `posix` unless the user explicitly asks for a POSIX shell. Do not guess provider ids, model tiers, project ids, or Agent settings.

For `builtin.workflow`, set `executor.config.workflowId` to the saved Workflow id. Set `executor.config.paramTemplates` to an object whose keys are Workflow parameter names and whose values may use Automation template variables such as `{{trigger.triggeredAt}}` or Webhook variables from `app_automation_trigger_type_list`.

## Update Rules

Use `app_automation_item_update` with a focused patch. The patch may include `trigger` or `executor`, but those refs replace the corresponding stored config.

If you only need to enable or disable an Automation, use `app_automation_item_enable` or `app_automation_item_disable` instead of `app_automation_item_update`.

If a read result only shows `{ type, summary }`, that is expected. It is not enough to reconstruct private configs. Ask the user for the new desired config or use discovery defaults.

## Run Rules

- `app_automation_run_execute` starts a manual run and returns a safe run summary. Treat tool failure as no run started.
- `app_automation_run_disable` stops an active run by run id. Treat tool failure as missing or no longer active. If the result has `stopRequested: true`, say the stop request was sent, not that the run has stopped; then check `app_automation_runtime_inspect` or `app_automation_run_list`.
- `app_automation_run_list` returns recent run summaries without raw logs or outputs.
- `app_automation_runtime_inspect` shows which items are scheduled or running.
- `app_automation_webhook_list` returns Webhook `publicId`, name, enabled state, and delivery status for `builtin.webhook` trigger configuration.

## API Reference

See the attached `api-reference.md` for complete tool signatures and public result shapes.
