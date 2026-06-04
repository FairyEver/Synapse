# Automation Extension Platform Design

Date: 2026-06-04

## Context

Automation is a new Synapse module. It does not need to preserve old implementation shortcuts from Task Scheduler. The product direction is that Automation will eventually have many trigger types and many executor types, including both schedule-based and event-based triggers.

The current implementation has the correct high-level product model, but it is not yet a full extension platform:

- Automation data stores `trigger` and `executor` as `{ type, config }`.
- Executors are mostly registry-driven through the existing Action Runtime.
- Triggers have main and renderer registries, but some runtime and IPC paths still know about `builtin.cron` and `builtin.interval`.
- The renderer has a new registry-driven editor window, but old dialog/form utilities still hard-code cron and interval.

This design establishes Automation as an extension platform instead of a time-task feature. The goal is to make future trigger and executor additions local to packages and registration files, not spread across Automation Core.

## Goals

- Treat Automation as a platform with a small orchestration core and package-based trigger/executor extensions.
- Keep the product model simple: one automation has exactly one trigger and one executor.
- Make Automation Core independent of concrete trigger types such as cron, interval, webhook, file change, database change, or app event.
- Keep executor execution behind a stable registry interface.
- Support schedule-based triggers now and reserve an event-trigger ingress path for future work.
- Make renderer configuration fully registry-driven.
- Make IPC schemas generic enough that adding a trigger or executor does not require changing IPC handler logic.
- Preserve current built-in capabilities: cron trigger, interval trigger, command executor, script executor, HTTP request executor, and Agent executor.
- Keep old Task Scheduler data and runtime separate from Automation.

## Non-Goals

- Do not migrate, rename, or remove old Task Scheduler data.
- Do not implement webhook, file-change, database-change, or app-event triggers in this refactor.
- Do not implement Workflow executor in this refactor.
- Do not add multi-trigger automation.
- Do not add multi-executor automation.
- Do not introduce a new visual system or custom UI styling.
- Do not make Automation Core depend on renderer-only concepts.
- Do not add new runtime dependencies unless a later implementation plan proves they are necessary.

## Product Model

Automation remains:

```text
When one trigger fires, run one executor.
```

If users need the same executor under multiple conditions, they create multiple automations. If users need branching, sequencing, fan-out, or fan-in, that belongs to Workflow or a future Workflow executor. Automation Core must stay focused on trigger-to-executor orchestration.

## Core Data Model

Automation items keep generic trigger and executor references:

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
  policy: AutomationPolicy
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

type AutomationTriggerRef = {
  type: string
  config: Record<string, unknown>
}

type AutomationExecutorRef = {
  type: string
  config: Record<string, unknown>
}
```

Core storage must not use discriminated unions for concrete trigger or executor types. Package registries own semantic validation.

## Trigger Platform

Triggers are extension packages. A trigger declares what kind of trigger it is and which runtime capabilities it provides.

```ts
type AutomationTriggerKind = "schedule" | "event" | "manual"

type AutomationTriggerManifest<TConfig extends Record<string, unknown>> = {
  id: string
  title: string
  kind: AutomationTriggerKind
  defaultConfig: TConfig
  configSchema: z.ZodType<TConfig>
}

type AutomationTriggerDefinition<TConfig extends Record<string, unknown>> = {
  manifest: AutomationTriggerManifest<TConfig>
  summarize(config: TConfig): string
  validateStoredConfig?(config: unknown): AutomationValidation
  runtime: AutomationTriggerRuntime<TConfig>
}
```

The runtime capability surface is additive:

```ts
type AutomationTriggerRuntime<TConfig extends Record<string, unknown>> = {
  computeNextRunAt?(input: AutomationScheduleInput<TConfig>): Date | null
  shouldRunNow?(input: AutomationScheduleGuardInput<TConfig>): boolean
  shouldAcceptEvent?(input: AutomationEventInput<TConfig>): boolean
  getReschedulePolicy?(config: TConfig): AutomationReschedulePolicy
}
```

Schedule triggers must provide `computeNextRunAt`. Event triggers must provide `shouldAcceptEvent`. Manual triggers are reserved for future explicit user/application initiation and do not need timers.

### Schedule Trigger Semantics

Schedule-specific behavior must live in trigger runtime definitions:

- cron expression parsing
- timezone handling
- active-day checks
- interval anchoring
- run-after-completion behavior
- next-run calculation

Automation Core can ask a trigger for next run and reschedule policy. It must not branch on `builtin.cron`, `builtin.interval`, or any future trigger id.

The built-in cron and interval triggers are just packages:

```text
desktop/automation-trigger-packages/builtin/cron/
desktop/automation-trigger-packages/builtin/interval/
```

Each package owns schema, defaults, summary, renderer config form, main runtime behavior, and tests.

### Event Trigger Semantics

The platform must reserve a generic ingress path:

```ts
type AutomationTriggerEvent = {
  source: string
  type: string
  payload: Record<string, unknown>
  receivedAt: string
}
```

Future event producers can submit events to Automation Core. Automation Core finds enabled event triggers and delegates matching to `trigger.runtime.shouldAcceptEvent`. The first refactor only needs the core shape and tests with a fake event trigger; it must not ship new user-facing event trigger types.

## Executor Platform

Executors are also extension packages. The current Action Runtime already provides most of the needed main-process executor boundary.

Automation should use executor language in its product and module code, while allowing existing Action Runtime packages to remain shared where practical.

```ts
type AutomationExecutorDefinition<TConfig extends Record<string, unknown>> = {
  manifest: AutomationExecutorManifest<TConfig>
  summarize(config: TConfig): string
  buildPermissionRequest(input: AutomationExecutorPermissionInput<TConfig>): PermissionRequest
  execute(input: AutomationExecutorInput<TConfig>): Promise<ActionRunResult>
}
```

The built-in executors remain:

- `builtin.command`
- `builtin.script`
- `builtin.http-request`
- `builtin.agent`

AutomationExecutionService must resolve executors from the registry, validate config through the executor schema, build permission requests through the executor, and call `execute`. It must not branch on executor id.

## Main-Process Architecture

Automation Core owns orchestration only:

- item repository
- run repository
- trigger registry
- executor registry
- schedule runtime
- event ingress runtime
- execution orchestration
- run history
- change events

Automation Core may enforce generic policy:

- enabled/disabled state
- overlap policy
- missed-run policy
- config validation state
- active run tracking
- run history pruning

Automation Core must not implement concrete trigger or executor behavior.

The main service boundary should become:

```ts
class AutomationService {
  start(): Promise<void>
  stop(): Promise<void>
  listItems(): Promise<AutomationItem[]>
  getItem(id: string): Promise<AutomationItem | null>
  createItem(input: AutomationCreateInput): Promise<AutomationItem>
  updateItem(id: string, patch: AutomationUpdateInput): Promise<AutomationItem>
  deleteItem(id: string): Promise<{ deleted: boolean }>
  setItemEnabled(id: string, enabled: boolean): Promise<AutomationItem>
  runNow(id: string): Promise<AutomationRun | null>
  stopRun(runId: string): Promise<{ stopped: boolean }>
  listRuns(automationId: string, options?: { limit?: number }): Promise<AutomationRun[]>
  acceptEvent(event: AutomationTriggerEvent): Promise<AutomationRun[]>
}
```

`acceptEvent` is a platform boundary. It can remain internal or test-only until the first real event trigger ships.

## Renderer Architecture

Renderer trigger and executor configuration must be registry-driven:

```ts
type RendererAutomationTriggerDefinition<TConfig> = {
  manifest: AutomationTriggerManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: AutomationTriggerConfigFormComponent<TConfig>
}

type RendererAutomationExecutorDefinition<TConfig> = {
  manifest: AutomationExecutorManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: AutomationExecutorConfigFormComponent<TConfig>
  ResultView?: AutomationExecutorResultViewComponent
}
```

The Automation editor must:

- list triggers from the renderer trigger registry
- list executors from the renderer executor registry
- initialize config from package defaults
- parse config through package schemas before save
- render config panels from package `ConfigForm`
- avoid special cases for cron, interval, command, script, HTTP, or Agent

The old dialog/form path that hard-codes cron and interval must be removed or made unreachable and deleted in the same refactor.

## IPC And Validation

IPC should validate generic transport shape:

```ts
const automationTriggerRefSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})

const automationExecutorRefSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})
```

Semantic validation belongs to main registries:

- unknown trigger id -> `needs_update` or create/update failure depending on operation
- invalid trigger config -> trigger registry validation error
- unknown executor id -> `needs_update` or create/update failure depending on operation
- invalid executor config -> executor registry validation error

IPC handlers must not need edits when a new trigger or executor package is registered.

## Package Layout

Preferred target structure:

```text
desktop/automation-trigger-packages/
  types.shared.ts
  builtin/
    cron/
      schema.ts
      manifest.ts
      runtime.main.ts
      config.renderer.tsx
      index.shared.ts
      index.main.ts
      index.renderer.ts
    interval/
      schema.ts
      manifest.ts
      runtime.main.ts
      config.renderer.tsx
      index.shared.ts
      index.main.ts
      index.renderer.ts

desktop/automation-executor-packages/
  types.shared.ts
  builtin/
    command/
    script/
    http-request/
    agent/
```

If executor packages stay under `desktop/action-packages/` for reuse, Automation-facing code should still wrap them through an executor registry boundary so the Automation module does not leak Task Scheduler naming.

## Migration Strategy

This is not a data migration. Stored Automation items already use `{ type, config }`. The refactor changes where validation and behavior live.

Existing Automation items with cron or interval triggers must continue to load and run. Existing Task Scheduler items must not be read, migrated, or modified by Automation.

## Error Handling

Automation Core should distinguish:

- unknown trigger/executor type
- invalid trigger/executor config
- trigger runtime scheduling failure
- event matching failure
- executor permission denial
- executor runtime failure
- stop/cancel state

Create and update operations should fail fast for invalid package config. Listing existing items should mark invalid records as `needs_update` and avoid scheduling them.

Logs and exported run details must not include prompt text, request bodies, tokens, Authorization values, cookies, API keys, or environment secrets.

## Testing Strategy

Tests must prove the extension boundary, not only cron/interval behavior.

Main-process tests:

- trigger registry rejects duplicate ids
- trigger registry normalizes config through package schema
- unknown trigger validates as `needs_update`
- AutomationService schedules a fake schedule trigger without knowing its id
- AutomationService accepts a fake event trigger without knowing its id
- AutomationService does not branch on cron/interval-specific behavior
- IPC accepts generic trigger refs and delegates semantic validation to registries
- existing cron and interval behavior remains unchanged
- existing Task Scheduler tests remain unchanged

Renderer tests:

- editor trigger list comes from renderer trigger registry
- editor executor list comes from renderer executor registry
- selecting a trigger renders that trigger package config form
- selecting an executor renders that executor package config form
- save parses trigger config through renderer trigger registry
- save parses executor config through renderer executor registry
- old hard-coded form path is not rendered by the Automation module

Boundary tests:

- adding a fake trigger package and registering it does not require changes to AutomationService, AutomationExecutionService, IPC handler logic, item repository, run repository, or editor builder.

## Success Criteria

After this refactor, adding a new trigger such as `builtin.test-event` should require only:

- adding the trigger package
- registering it in the main trigger registry
- registering it in the renderer trigger registry if it has UI
- adding package-specific tests

It must not require changes to:

- `AutomationService`
- `AutomationExecutionService`
- `AutomationItemRepository`
- `AutomationRunRepository`
- Automation IPC handler logic
- Automation editor builder

Adding a new executor should follow the same rule through the executor registry.

## Implementation Phases

### Phase 1: Platform Contracts

Define shared trigger platform types, main trigger registry behavior, renderer trigger registry behavior, and package-facing contracts. Move cron and interval package declarations toward the new shape without changing runtime behavior.

### Phase 2: Core Runtime Decoupling

Remove concrete cron/interval checks from AutomationService, AutomationItemRepository, and schedule calculator paths. Delegate schedule guard, next-run calculation, and reschedule policy to trigger runtime definitions.

### Phase 3: Generic IPC Validation

Replace concrete trigger IPC schemas with generic trigger refs. Keep create/update validation strict by calling main registry normalization before persistence.

### Phase 4: Renderer Cleanup

Delete the old hard-coded Automation dialog/form path and keep only the editor-window builder. Ensure the editor can render package-provided trigger and executor config forms without concrete type branches.

### Phase 5: Event Ingress Boundary

Add the internal event ingress shape and `acceptEvent` service boundary. Cover it with a fake event trigger test only. Do not expose new user-facing event triggers in this phase.

## Review Checklist

- Automation Core owns orchestration, not concrete trigger behavior.
- Trigger packages own schedule/event semantics.
- Executor packages own execution semantics.
- IPC schemas are generic transport schemas.
- Renderer config UI is registry-driven.
- Old Task Scheduler remains separate.
- No new user-facing trigger or executor type is introduced by the platform refactor.
