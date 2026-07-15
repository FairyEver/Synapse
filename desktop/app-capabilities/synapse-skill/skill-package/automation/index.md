# Synapse Automation MCP

You have access to Synapse Automation MCP tools for managing Automation items and runs. Automation is the current MCP surface for scheduled tasks, cron/interval triggers, run history, and runtime inspection. Legacy Scheduler MCP tools are retired.

## Scope Boundary

Use this skill only for Synapse Automation items, trigger/executor configuration, scheduled cron/interval or webhook triggers, enablement, manual runs, active run stopping, run history, Automation runtime state, and Swarm Task app runs.

Do not call legacy `scheduler_*` tools; they are no longer part of the current Synapse MCP registry. Do not use this domain file for direct terminal control, Workflow definitions, database rows, Resource Repository publishing, provider settings, or editor installation. For another current Synapse MCP domain, return to `SKILL.md` for routing and read the matching `<domain>/index.md` attachment before using that domain's tools.

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

Swarm Task MCP exposes these operations:

- create, list, get, update, and delete reusable Swarm Task configs
- start one Swarm Task run
- stop refill for a continuous run
- cancel one run
- list and get run state

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

## Swarm Task Rules

Use Swarm Task when the user wants a reusable multi-Agent prompt run. A task stores the prompt, project, concurrency, run mode, per-slot round count, prompt-injection options, and Agent options. Each run snapshots the task config, so later task edits do not change historical runs.

Do not use Swarm Task for direct terminal control. Workers are Agent conversations created by Synapse; worker details live in linked Agent conversations with platform `"swarm"`.

Swarm Task MCP reads, mutations, and run starts pass permission checks before the action runs and write audit outcomes. A permission denial means the action did not start. After any other tool failure, inspect the current task or run state before retrying.

Default flow:

1. Use `app_swarm_task_task_list` to find an existing task by name.
2. Use `app_swarm_task_task_create` for a new reusable config.
3. Use `app_swarm_task_task_update` for a focused config change.
4. Use `app_swarm_task_run_start` to run a saved task. Pass `configOverride` only for this run's temporary changes.
5. Use `app_swarm_task_run_list` and `app_swarm_task_run_get` with the owning taskId for current state and history. `run_get` also requires runId and includes worker records and linked Agent `conversationId` values when available.
6. Use `app_swarm_task_run_stop_refill` to stop launching later batches or slot refills while allowing active workers to finish.
7. Use `app_swarm_task_run_cancel` to cancel a run.
8. Use `app_swarm_task_task_delete` only when the task has no running or draining run; it removes the saved task and its run history.

`concurrency` is the number of slots. `maxRounds` is the number of batches in `batch` mode and the per-slot round count in `continuous` mode, so the planned worker count is `concurrency * maxRounds`. Both default to 1 when omitted. Stop or cancel can make the actual started count lower.

If Synapse restarts while a run is active, the run is recovered as `failed` with an interruption error because worker processes are not resumed across main-process restarts.

Summary injection is disabled by default. Sequence/batch context, previous handoff, summary, recent-summary injection, and file-write instructions are all opt-in; file locking remains enabled if file-write injection is later enabled. If handoff is enabled, batch mode passes up to 20 previous-batch handoffs forward, while continuous mode passes the same slot's previous round handoff forward. Previous-handoff context shares a 64 KiB UTF-8 budget per worker prompt and includes truncation or omission markers when bounded. Summary `recentLimit` defaults to 3 when recent-summary injection is enabled.

When file-write injection is enabled, `fileWrite.path` must be relative to the selected project. Do not pass an absolute path or parent traversal. Set `fileWrite.mode` to `append-only` or `update`.

Worker summaries are persisted only from an explicit `<SYNAPSE_SWARM_SUMMARY>` block and are redacted and bounded before storage. If the block is missing, `summary` is omitted and `summaryFallback` is true; raw worker output is never substituted as the summary.

## API Reference

See the attached `api-reference.md` for complete tool signatures and public result shapes.
