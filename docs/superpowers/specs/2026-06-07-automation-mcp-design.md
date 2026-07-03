# Automation MCP And Built-In Skill Design

Date: 2026-06-07

## Context

Synapse already exposes one local `synapse-mcp` server. The server lists tools from shared capability domains, maps MCP tool names to canonical actions, and dispatches those actions through Electron main-process domain dispatchers.

Current MCP domains include Database, Automation, Workflow, Content, Repository, Variable, Model Price, Drive, Skill Repository, and App-provided capabilities. The legacy Scheduler MCP domain has been retired; scheduled-task, cron/interval, run-history, and runtime-state Agent requests should route to Automation.

Automation is now a separate Synapse module from the old Task Scheduler. It owns independent data namespaces, service methods, triggers, executors, run history, runtime state, and renderer UI. The product goal for this feature is to let a user install an Automation MCP built-in Skill and then ask their Agent to create, update, enable, disable, delete, run, stop, inspect, and review Synapse Automations.

## Goals

- Add a new `automation` MCP capability domain for scheduled tasks and Automation runs.
- Expose the full current Automation user-operation surface to MCP:
  - list/get/create/update/delete Automation items
  - enable/disable Automation items
  - manually run an Automation
  - stop a running Automation run
  - list Automation run history
  - inspect Automation runtime state
  - list trigger types
  - list executor types
- Reuse `AutomationService`, `AutomationTriggerRegistry`, and `MainActionRegistry`.
- Keep Automation data, MCP tools, services, and product semantics separate from historical Task Scheduler implementation details.
- Keep Automation Core generic: do not hard-code `builtin.cron`, `builtin.interval`, `builtin.webhook`, `builtin.command`, `builtin.script`, `builtin.http-request`, or `builtin.agent` in MCP dispatcher logic except through registry output.
- Return safe summaries from read and mutation responses. Do not expose executor config bodies such as Agent prompts, shell command text, scripts, HTTP bodies, Authorization values, cookies, tokens, API keys, or environment secrets.
- Add a built-in Skill template `synapse-automation-mcp` that teaches Agents how to use the new tools safely.
- Update the capability naming matrix and release notes.

## Non-Goals

- Do not reintroduce legacy `scheduler_*` MCP tools as aliases for Automation.
- Do not migrate old `task-scheduler.tasks` or `task-scheduler.runs` data into Automation.
- Do not add new trigger types or executor types.
- Do not add new renderer UI.
- Do not expose local renderer IPC-only window operations through MCP.
- Do not return full stored Automation configs from MCP read endpoints.
- Do not add generic "edit by name" APIs. Names are not unique; Agents resolve ids through list/get.
- Do not change MCP server transport, registration, or install behavior.

## Capability Domain

Add `desktop/synapse-capabilities/shared/automation-domain.ts`.

The domain id is `automation`. Canonical capability ids follow `<domain>.<resource>.<action>` and map to MCP tool names by replacing dots with underscores.

| Capability id | MCP tool | Mutates | Purpose |
| --- | --- | --- | --- |
| `automation.item.list` | `automation_item_list` | false | List Automation item summaries. |
| `automation.item.get` | `automation_item_get` | false | Get one Automation item summary by id. |
| `automation.item.create` | `automation_item_create` | true | Create one Automation item. |
| `automation.item.update` | `automation_item_update` | true | Update one Automation item. |
| `automation.item.delete` | `automation_item_delete` | true | Delete one Automation item and its run history through AutomationService. |
| `automation.item.enable` | `automation_item_enable` | true | Enable one Automation item. |
| `automation.item.disable` | `automation_item_disable` | true | Disable one Automation item. |
| `automation.run.execute` | `automation_run_execute` | true | Manually run one Automation item and return a run summary. |
| `automation.run.disable` | `automation_run_disable` | true | Stop one active Automation run by run id; fail if the run is missing or no longer active. |
| `automation.run.list` | `automation_run_list` | false | List recent run summaries for one Automation item. |
| `automation.runtime.inspect` | `automation_runtime_inspect` | false | Inspect timers, running item ids, and compact item runtime state. |
| `automation.trigger_type.list` | `automation_trigger_type_list` | false | List registered trigger type descriptors. |
| `automation.executor_type.list` | `automation_executor_type_list` | false | List registered executor type descriptors from Action Runtime. |

This feature intentionally includes delete, manual run, and stop-run for Automation. That differs from Scheduler MCP because the product goal is full Agent operation of the new Automation module, not a conservative legacy Scheduler external surface.

## Tool Inputs

### Discovery

`automation_trigger_type_list`

Input: empty object.

Output:

```ts
Array<{
  type: string
  title: string
  kind: "schedule" | "event" | "manual"
  defaultConfig: Record<string, unknown>
  configSchema: object
  variables?: Array<{
    key: string
    label: string
    description?: string
    example?: string
    group?: "trigger" | "config" | "event"
    dynamic?: boolean
  }>
}>
```

`automation_executor_type_list`

Input: empty object.

Output:

```ts
Array<{
  type: string
  title: string
  permissions: string[]
  defaultConfig: Record<string, unknown>
  configFields: Array<{
    name: string
    kind: "string" | "number" | "boolean" | "enum" | "record"
    required: boolean
    description?: string
    choices?: string[]
    defaultValue?: unknown
  }>
}>
```

Agents should call both discovery tools before creating or replacing trigger/executor configs unless the exact type and config shape are already known from the current context.

### Item Read

`automation_item_list`

Input:

```ts
{
  enabled?: boolean
  limit?: number
  scope?: { type: "global" } | { type: "project"; projectId?: string }
}
```

`automation_item_get`

Input:

```ts
{ automationId: string }
```

Both return public item summaries, not raw stored items:

```ts
type AutomationItemSummary = {
  id: string
  name: string
  description?: string
  enabled: boolean
  scope: { type: "global" } | { type: "project"; projectId: string }
  cwd?: string
  trigger: { type: string; summary?: string; kind?: string }
  executor: { type: string; title?: string }
  policy: {
    missedRunPolicy: "skip" | "run_once"
    overlapPolicy: "skip"
  }
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: string
  activeRun?: { status: "running"; id?: string }
  validation?: {
    status: "needs_update"
    issues: Array<{ field: string; message: string }>
  }
  runCount: number
  createdAt: string
  updatedAt: string
}
```

The summary must not include `trigger.config` or `executor.config`.

### Item Mutations

`automation_item_create`

Input:

```ts
{
  name: string
  description?: string
  enabled?: boolean
  scope: { type: "global" } | { type: "project"; projectId: string }
  cwd?: string
  trigger: { type: string; config: Record<string, unknown> }
  executor: { type: string; config: Record<string, unknown> }
  policy?: {
    missedRunPolicy?: "skip" | "run_once"
    overlapPolicy?: "skip"
  }
}
```

`automation_item_update`

Input:

```ts
{
  automationId: string
  patch: {
    name?: string
    description?: string
    enabled?: boolean
    scope?: { type: "global" } | { type: "project"; projectId: string }
    cwd?: string
    trigger?: { type: string; config: Record<string, unknown> }
    executor?: { type: string; config: Record<string, unknown> }
    policy?: {
      missedRunPolicy?: "skip" | "run_once"
      overlapPolicy?: "skip"
    }
  }
}
```

`automation_item_delete`, `automation_item_enable`, and `automation_item_disable` all take:

```ts
{ automationId: string }
```

Mutation responses return `AutomationItemSummary` for create/update/enable/disable and `{ deleted: boolean }` for delete.

Update may replace trigger/executor configs because full Automation operation is in scope. Agents should call discovery first, then call `automation_item_get` to understand the current public state, then submit a focused patch.

### Run Operations

`automation_run_execute`

Input:

```ts
{ automationId: string }
```

Output:

```ts
AutomationRunSummary | null
```

`automation_run_disable`

Input:

```ts
{ runId: string }
```

Output:

```ts
{ stopped: boolean; alreadyFinished?: boolean }
```

If a run id is missing or no longer active, the tool fails instead of returning a successful `{ stopped: false }` result.

`automation_run_list`

Input:

```ts
{ automationId: string; limit?: number }
```

Output:

```ts
type AutomationRunSummary = {
  id: string
  automationId: string
  status: "running" | "success" | "failed" | "timeout" | "cancelled" | "skipped"
  triggeredBy: "trigger" | "manual" | "missed_run"
  triggerType: string
  executorType: string
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

Run summaries must not include logs, raw outputs, Agent prompts, shell command content, HTTP request body, headers with secrets, or raw event payloads.

### Runtime Inspect

`automation_runtime_inspect`

Input:

```ts
{ automationId?: string }
```

Output:

```ts
{
  runningItemIds: string[]
  scheduledItemIds: string[]
  items: Array<{
    id: string
    name: string
    enabled: boolean
    running: boolean
    scheduled: boolean
    activeRunId?: string
    nextRunAt?: string
    lastRunAt?: string
    lastStatus?: string
  }>
}
```

If `automationId` is provided and the item does not exist, the dispatcher throws a clear not-found error.

## Dispatcher Design

Add `desktop/electron/capabilities/automation-dispatcher.ts`.

Responsibilities:

- Parse and validate MCP action inputs.
- Convert public params into `AutomationCreateInput` and `AutomationUpdateInput`.
- Validate trigger configs through `AutomationTriggerRegistry`.
- Validate executor configs through `MainActionRegistry`.
- Call `AutomationService` methods.
- Convert returned items and runs to public summaries.
- Apply PermissionGuard and AuditSink for mutating actions.
- Avoid logging raw trigger/executor configs or raw error text.

The dispatcher should be constructed in `coreDatabaseDescriptor`, alongside the existing content, variable, repository, model price, drive, skill-repository, app, and workflow dispatchers. `core.database` must depend on `core.automation` so the single `synapse-mcp` server can route Automation MCP tools to the running service.

The action router adds an `automationDispatch` dependency and routes `domainId === "automation"` to it.

## Security And Redaction

Mutating Automation actions:

- `automation.item.create`
- `automation.item.update`
- `automation.item.delete`
- `automation.item.enable`
- `automation.item.disable`
- `automation.run.execute`
- `automation.run.disable`

must call `PermissionGuard.check()` before persistence or execution:

```ts
{
  action: "automation.mutate",
  actor: { kind: "user", id: `automation-dispatch:${source}` },
  resource: `automation:${automationIdOrAction}`,
  context: {
    source,
    automationAction,
    automationId?,
    runId?,
    triggerType?,
    executorType?,
    patchKeys?
  }
}
```

Allowed and failed mutations are audited. Denied mutations are audited before throwing. Failed audit metadata records error name and error length only, not raw error text.

Public read responses and audit/log metadata must not expose:

- Agent prompt text
- shell commands or script bodies
- HTTP body, Authorization, Bearer, Basic password, Cookie, token, API key, or secret fields
- env var values
- raw event payloads
- full run logs or outputs

The dispatcher may include trigger type, executor type, ids, timestamps, status, summary, and non-secret metrics.

## Built-In Skill Template

Add:

```text
desktop/resources/templates/skills/synapse-automation-mcp/
  meta.json
  content.md
  files/api-reference.md
```

`meta.json`:

- `id`: `synapse-automation-mcp`
- `name`: `synapse-automation-mcp`
- `title`: `Synapse 自动化 MCP`
- `category`: `automation`
- `icon`: `terminal`
- `iconBg`: `teal`

`content.md` should teach Agents:

- Use this skill only for Synapse Automation items and runs.
- Do not confuse Automation with Scheduler or Workflow.
- Resolve names through `automation_item_list`; names are not unique.
- Call trigger/executor discovery before create/update.
- Create/update with full trigger/executor refs.
- Use enable/disable for enabled state.
- Use run execute for manual runs and run disable for active run stop.
- Use runtime inspect and run list for troubleshooting.
- Treat read summaries as intentionally redacted.
- Do not ask MCP to reveal hidden executor configs.

`files/api-reference.md` should list all Automation MCP tools, input schemas, output summaries, and the safe public result boundary.

## Documentation

Update `docs/reference/capability-naming-matrix.md` with all `automation.*` capabilities.

Update `RELEASE_NOTES_PENDING.md` because this is user-visible: users can install the built-in Automation MCP Skill and let Agents manage Automations through Synapse MCP.

## Tests

Add or update focused tests:

- Capability registry includes Automation domain, MCP tool mappings, and tools/list definitions.
- Action router routes `automation.*` actions to `automationDispatch`.
- Automation dispatcher:
  - lists and gets public item summaries without raw configs
  - creates and updates using registry-validated trigger/executor refs
  - rejects unknown trigger and executor types before persistence
  - enables, disables, deletes, manually runs, stops runs, lists runs, and inspects runtime
  - returns run summaries without logs or raw outputs
  - checks permissions and audits mutating actions
  - does not check permissions for read-only actions
  - does not include raw error text in failed audit metadata
- MCP RPC tools/list includes Automation tools and tools/call normalizes Automation domain results the same way as other non-Database domains.
- Built-in template `meta.json` parses and uses existing category/icon/background values.

Suggested verification commands:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  synapse-capabilities/shared/__tests__/automation-domain.test.ts \
  electron/capabilities/__tests__/automation-dispatcher.test.ts \
  electron/capabilities/__tests__/action-router.test.ts \
  database/__tests__/mcp-server.test.ts

pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Do not start dev servers or browser previews for this feature unless the user explicitly asks.

## Success Criteria

- `synapse-mcp` exposes `automation_*` tools.
- Agents can create, update, enable, disable, delete, manually run, stop, inspect, and review Automation items through MCP.
- Legacy `scheduler_*` MCP tools are not supported aliases. Existing `workflow_*` and other current MCP tools continue to work.
- Automation read responses remain useful but do not leak sensitive configs.
- Users can install `Synapse 自动化 MCP` from built-in Skills and get domain-specific Agent guidance.
