# Automation Module Design

Date: 2026-06-03

## Context

Synapse already has a Task Scheduler module. Its current model is effectively a scheduled automation: a trigger starts one registered action executor and writes run history. That module must remain available as `定时`, and existing scheduled tasks must keep running.

This design introduces a new `自动化` module beside the existing `定时` entry. The first version intentionally does not migrate, rename, or replace the old Task Scheduler. It creates a clean Automation product surface that models the current capability as:

```text
Automation = one Trigger + one Executor
```

The first version is a structural and product-model reset, not a feature expansion.

## Goals

- Add a new `自动化` navigation entry immediately to the right of `定时`.
- Keep the old Task Scheduler UI, data, IPC, service, MCP tools, and runtime behavior available.
- Create a new Automation module with independent data, IPC, service, runs, and UI.
- Reuse the existing Action Runtime executors for command, script, HTTP request, and Agent.
- Introduce a first-class Trigger Registry for cron and interval triggers.
- Keep each automation limited to one trigger and one executor.
- Move trigger-specific settings, including active days, into each trigger config.
- Put Automation configuration in a dedicated Electron window opened from the list page.
- Keep first-version behavior equivalent to current scheduled tasks where supported.

## Non-Goals

- No migration from `task-scheduler.tasks` or `task-scheduler.runs`.
- No deletion, hiding, or behavioral change of the old `定时` module.
- No Webhook, file-change, user-action, database-change, or event trigger in this phase.
- No multi-trigger automation.
- No multi-executor automation.
- No Workflow executor in this phase.
- No MCP or external API rename from `scheduler_*` to `automation_*` in this phase.
- No custom visual system, custom colors, gradients, decorative styling, or marketing copy.

## Product Model

An Automation is a user-managed rule:

```text
When this trigger fires, run this executor.
```

One automation has exactly one trigger and exactly one executor. If the same executor should run under three different conditions, users create three automations. If multiple operations need to run in sequence or in parallel, that belongs to a future Workflow executor, not the Automation module itself.

## First-Version Capabilities

Triggers:

- `builtin.cron`
- `builtin.interval`

Executors:

- `builtin.command`
- `builtin.script`
- `builtin.http-request`
- `builtin.agent`

Runtime policy:

- Missed scheduled runs are skipped by default.
- Overlapping runs for the same automation are skipped.
- Manual run is supported.
- Running automation runs can be stopped.
- Run history is retained per automation.

The missed-run and overlap policies are system behavior in this version, not visible form controls.

## Data Model

Use new namespaces:

```text
automation.items
automation.runs
```

Automation item:

```ts
type AutomationItem = {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  enabled: boolean
  scope:
    | { type: "global" }
    | { type: "project"; projectId: string }
  cwd?: string
  trigger: AutomationTriggerRef
  executor: AutomationExecutorRef
  policy: {
    missedRunPolicy: "skip"
    overlapPolicy: "skip"
  }
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: AutomationRunStatus
  activeRun?: { status: "running"; id?: string }
  validation?: AutomationValidation
  runCount: number
  configVersion: number
}
```

Trigger reference:

```ts
type AutomationTriggerRef = {
  type: string
  config: Record<string, unknown>
}
```

Executor reference:

```ts
type AutomationExecutorRef = {
  type: string
  config: Record<string, unknown>
}
```

Run record:

```ts
type AutomationRun = {
  id: string
  schemaVersion: 1
  automationId: string
  startedAt: string
  finishedAt?: string
  status: "running" | "success" | "failed" | "timeout" | "cancelled" | "skipped"
  triggeredBy: "trigger" | "manual"
  triggerType?: string
  executorType?: string
  result?: ActionRunResult
  error?: string
}
```

## Trigger Registry

Add a standalone trigger registry for Automation. It should mirror the shape and discipline of Action Runtime without importing renderer code into Electron or Electron code into renderer.

Main trigger responsibilities:

- Register trigger definitions.
- Validate stored trigger config.
- Normalize default config.
- Compute the next run time when the trigger is schedule-based.
- Start and stop trigger runtime if the trigger requires listeners in the future.
- Produce concise summaries for logs and run records.

Renderer trigger responsibilities:

- Register trigger metadata.
- Render trigger choices.
- Render trigger config forms.
- Summarize selected trigger config.
- Validate form state before save.

First phase trigger packages:

```text
desktop/trigger-packages/builtin/cron/
  manifest.ts
  schema.ts
  scheduler.main.ts
  config.renderer.tsx
  index.shared.ts

desktop/trigger-packages/builtin/interval/
  manifest.ts
  schema.ts
  scheduler.main.ts
  config.renderer.tsx
  index.shared.ts
```

The first implementation may keep shared schedule calculation helpers near the automation service if that is simpler, but trigger-specific schema and renderer form logic should live in trigger packages.

## Trigger Configs

Cron:

```ts
type CronTriggerConfig = {
  expr: string
  timezone?: string
  activeDays: readonly number[]
}
```

Interval:

```ts
type IntervalTriggerConfig = {
  everyMinutes: number
  anchor: "created_at" | "last_completed_at"
  activeDays: readonly number[]
}
```

`activeDays` belongs to cron and interval because it is meaningful only for time-based triggers. It must not live on Automation top level in the new model.

Defaults:

- Cron expression: `0 9 * * *`
- Interval: every 60 minutes
- Interval anchor: `created_at`
- Active days: all days

## Executor Reuse

Automation reuses the existing Action Runtime as its executor registry. Do not copy command, script, HTTP request, or Agent executor implementation.

The Automation execution context can adapt to the existing `ActionRuntimeContext` shape. Any shared context naming changes should be additive or local to Automation and must not break Task Scheduler.

The old Task Scheduler continues to use the same Action Runtime.

## Automation Service

Add a new main-process service:

```text
desktop/electron/services/automation/
  automation-service.ts
  automation-execution-service.ts
  automation-repository.ts
  automation-run-repository.ts
  trigger-registry.ts
  builtin-triggers.ts
  schedule-calculator.ts
  types.ts
```

Suggested service responsibilities:

- Load enabled automation items on startup.
- Schedule cron and interval timers.
- Skip invalid automation items without mutating unrelated state.
- Skip overlapping runs for the same automation.
- Execute the selected executor through Action Runtime.
- Persist run records and latest status.
- Emit automation change events through EventBus.
- Stop active runs on app shutdown.

The Automation service must not route through `TaskSchedulerService` or mutate task-scheduler namespaces.

## Window And IPC

Add a dedicated Automation IPC module:

```text
desktop/electron/modules/automation/ipc.ts
```

Bridge shape:

```ts
window.synapse.automation = {
  listAutomations(): Promise<AutomationItem[]>
  getAutomation(id: string): Promise<AutomationItem | null>
  createAutomation(input: AutomationCreateInput): Promise<AutomationItem>
  updateAutomation(id: string, patch: AutomationUpdateInput): Promise<AutomationItem>
  deleteAutomation(id: string): Promise<{ deleted: boolean }>
  setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationItem>
  runAutomation(id: string): Promise<AutomationRun | null>
  stopRun(runId: string): Promise<{ stopped: boolean }>
  listRuns(id: string, options?: { limit?: number }): Promise<AutomationRun[]>
  openEditorWindow(input: { id?: string }): Promise<void>
  onChanged(listener: (event: AutomationChangedEvent) => void): () => void
}
```

The editor opens in a dedicated BrowserWindow, following the existing content and workflow window patterns. The renderer should not create windows directly.

Suggested window query:

```text
?synapseWindow=automation&windowKind=editor&id=<automationId>
?synapseWindow=automation&windowKind=editor
```

New unsaved automations are created in the editor window only when the user saves.

## Navigation And List Page

The main app navigation keeps `定时` and adds `自动化` immediately to its right.

The Automation tab page is only a list surface:

- Shows configured automations.
- Provides `新建`.
- Opens the dedicated editor window when a list item is clicked.
- Shows concise columns or cards: name, trigger summary, executor summary, enabled state, next run, last status.
- Provides list-level actions such as enable, disable, run, history, and delete where appropriate.

The list page must not embed the full automation editor.

## Editor Window UI

The Automation editor window has three structural areas:

```text
Header
  Name
  Edit name/description action
  Edit / Run Log tabs when applicable

Main
  Left: Trigger
  Right: Executor

Footer
  Summary sentence
  Only Save
  Save And Enable
```

Header:

- The name defaults to a generated value such as `自动化 1`.
- The name is visible as the title.
- Description is edited through a compact edit affordance and does not need to be constantly visible.
- Do not place an enabled switch in the header.

Main:

- Left side starts with trigger selection.
- Right side starts with executor selection.
- Once selected, each side shows that type's config form and a `更换` action.
- First phase only shows cron and interval triggers.
- First phase only shows command, script, HTTP request, and Agent executors.
- Use existing shadcn components and token classes.
- Avoid card nesting and decorative visual treatment.

Footer:

- Shows a concise summary, for example `当 每天 09:00 时，就执行 Agent`.
- If incomplete, show a short actionable state such as `选择触发器和执行器后可启用`.
- `仅保存` saves with `enabled: false`.
- `保存并启用` saves with `enabled: true`.
- Buttons are disabled until required trigger and executor config is valid.

Run Log:

- Existing persisted automations can show an `运行日志` tab.
- New unsaved editor windows do not need run history.
- Run history remains read-only except for stopping active runs.

## Validation And Error Handling

Validation is layered:

- Trigger registry validates trigger config.
- Action Runtime validates executor config.
- Automation service validates the complete item before save, enable, manual run, and scheduled execution.

Invalid saved automation items should be shown as needing update and treated as disabled at runtime. Do not auto-migrate or guess missing config.

Manual run and enable should fail before execution if trigger or executor config is invalid.

Scheduled execution of invalid items should skip and record a concise skipped run.

Errors shown in UI should be short and user-actionable. Logs must avoid leaking prompt content, Authorization values, tokens, cookies, or environment secrets.

## Permissions And Audit

Executor permissions continue to come from Action Runtime:

- Shell executors use `shell.exec`.
- HTTP executor uses `network.connect`.
- Agent executor uses `agent.spawn`.

Automation service should record audit metadata with:

- automation id
- run id
- trigger type
- executor type
- trigger source

No trigger in the first phase requires new sensitive listener permissions.

## Compatibility With Existing Task Scheduler

The old Task Scheduler remains:

- Existing `定时` navigation entry stays available.
- Existing task data remains in `task-scheduler.tasks`.
- Existing run data remains in `task-scheduler.runs`.
- Existing `window.synapse.taskScheduler` bridge stays available.
- Existing `scheduler_*` MCP tools stay available.
- Existing scheduled timers continue to start from `core.task-scheduler`.

Small shared-helper refactors are allowed only when they do not change old Scheduler behavior. Examples:

- Reusing pure cron parsing helpers.
- Reusing Action Runtime definitions.
- Sharing non-mutating date calculation utilities after tests prove old behavior is unchanged.

Do not route old Scheduler through new Automation service in this phase.

## Testing Strategy

Main-process tests:

- Automation repository creates, updates, lists, and deletes independent items.
- Cron trigger computes next run with active days in trigger config.
- Interval trigger computes next run with active days in trigger config.
- Automation service starts enabled automation timers.
- Manual run executes the selected Action Runtime executor.
- Overlap skips a second run for the same automation.
- Invalid trigger config blocks enable and manual run.
- Existing Task Scheduler service tests continue to pass.

Renderer tests:

- Navigation shows `定时` and `自动化` in the correct order.
- Automation list renders configured items and opens editor window on item click.
- Editor window renders trigger side and executor side.
- `仅保存` saves disabled automation.
- `保存并启用` saves enabled automation.
- Footer summary updates from trigger and executor selections.
- Missing trigger or executor disables save-and-enable.

Window tests:

- `openEditorWindow` reuses an existing editor window for the same automation id.
- New automation editor opens without creating data until save.
- Query parsing rejects unsupported automation window kinds.

Regression tests:

- Old `taskScheduler` preload bridge remains present.
- Old scheduler data namespaces remain unchanged.
- Old scheduler MCP tools remain listed.

## Implementation Order

1. Add Automation types, repositories, and schemas.
2. Add Trigger Registry with cron and interval trigger packages.
3. Add Automation execution service that reuses Action Runtime.
4. Add Automation service startup, timers, run history, and events.
5. Add Automation IPC and preload bridge.
6. Add Automation editor window service and query parsing.
7. Add Automation list module and navigation entry.
8. Add Automation editor window UI.
9. Add tests and confirm old Task Scheduler tests still pass.

