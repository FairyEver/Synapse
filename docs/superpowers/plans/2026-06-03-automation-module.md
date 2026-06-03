# Automation Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `自动化` module next to the existing `定时` module, with independent data, service, IPC, UI, and run history, while leaving old scheduled tasks running unchanged.

**Architecture:** Build a new `core.automation` service with its own repositories and timers. Reuse existing Action Runtime as the executor layer, and add an Automation-only Trigger Registry for `builtin.cron` and `builtin.interval`. Renderer gets a new `desktop/src/modules/automation/` module and `window.synapse.automation` bridge.

**Tech Stack:** Electron, React, TypeScript, zod, Vitest, shadcn/Radix UI, Tailwind theme tokens, existing Action Runtime.

---

## File Structure

Create:

- `desktop/electron/services/automation/types.ts`  
  Shared main-process Automation entity, trigger, executor, run, validation, and service id types.
- `desktop/electron/services/automation/trigger-registry.ts`  
  Main-process trigger registry with config parsing, validation, summary, next-run calculation, and runtime guard hooks.
- `desktop/electron/services/automation/builtin-triggers.ts`  
  Registers `builtin.cron` and `builtin.interval`.
- `desktop/electron/services/automation/schedule-calculator.ts`  
  Pure next-run helpers copied from the scheduler behavior and adapted to trigger configs with `activeDays`.
- `desktop/electron/services/automation/item-repository.ts`  
  Repository for `automation.items`.
- `desktop/electron/services/automation/run-repository.ts`  
  Repository for `automation.runs`.
- `desktop/electron/services/automation/execution-service.ts`  
  Runs one automation through Action Runtime, writes run records, records audit.
- `desktop/electron/services/automation/automation-service.ts`  
  Owns timers, lifecycle, CRUD, manual run, stop, validation, and events.
- `desktop/electron/services/automation/index.ts`  
  Barrel exports.
- `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`
- `desktop/electron/services/automation/__tests__/schedule-calculator.test.ts`
- `desktop/electron/services/automation/__tests__/item-repository.test.ts`
- `desktop/electron/services/automation/__tests__/run-repository.test.ts`
- `desktop/electron/services/automation/__tests__/execution-service.test.ts`
- `desktop/electron/services/automation/__tests__/automation-service.test.ts`
- `desktop/electron/modules/automation/ipc.ts`
- `desktop/electron/modules/automation/__tests__/ipc.test.ts`
- `desktop/src/types/automation.ts`
- `desktop/src/modules/automation/index.tsx`
- `desktop/src/modules/automation/types.ts`
- `desktop/src/modules/automation/utils.ts`
- `desktop/src/modules/automation/hooks/use-automation.ts`
- `desktop/src/modules/automation/hooks/__tests__/use-automation.test.tsx`
- `desktop/src/modules/automation/components/automation-card.tsx`
- `desktop/src/modules/automation/components/automation-card-grid.tsx`
- `desktop/src/modules/automation/components/automation-form-dialog.tsx`
- `desktop/src/modules/automation/components/automation-runs-dialog.tsx`
- `desktop/src/modules/automation/components/trigger-config-form.tsx`
- `desktop/src/modules/automation/__tests__/automation-module.test.tsx`
- `desktop/src/modules/automation/__tests__/automation-form-dialog.test.tsx`

Modify:

- `desktop/electron/runtime/data-repo/schemas/placeholders.ts`  
  Add `automation.items` and `automation.runs` schemas.
- `desktop/electron/runtime/data-repo/schemas/index.ts`  
  Export and register Automation schemas.
- `desktop/electron/bootstrap/descriptors.ts`  
  Add `coreAutomationDescriptor`.
- `desktop/electron/bootstrap/registry.ts`  
  Register `coreAutomationDescriptor`.
- `desktop/electron/bootstrap/ipc-registry.ts`  
  Register `automationIpcModule`.
- `desktop/electron/preload.ts`  
  Expose `window.synapse.automation`.
- `desktop/src/types/bridge.ts`  
  Add Automation bridge types.
- `desktop/src/App.tsx`  
  Add `automation` tab immediately after `task-scheduler`.
- `desktop/scripts/generate-ipc.mjs`  
  Add Automation IPC module to codegen.
- `desktop/electron/bootstrap/__tests__/registry.test.ts`
- `desktop/electron/bootstrap/__tests__/descriptors.test.ts`
- `desktop/electron/__tests__/preload.test.ts`
- `desktop/src/__tests__/App.workflow-entry.test.tsx`
- `RELEASE_NOTES_PENDING.md`

Do not modify:

- `desktop/electron/services/task-scheduler/*` unless a test-proven shared pure helper is extracted.
- `desktop/electron/modules/task-scheduler/ipc.ts`
- `desktop/src/modules/task-scheduler/*`
- `desktop/synapse-capabilities/shared/scheduler-domain.ts`

---

### Task 1: Add Automation Types And Data Schemas

**Files:**

- Create: `desktop/electron/services/automation/types.ts`
- Create: `desktop/src/types/automation.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

Add tests to `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`:

```ts
import {
  automationItemsSchema,
  automationRunsSchema,
} from "../schemas"

describe("automation schemas", () => {
  it("validates automation item records", () => {
    expect(automationItemsSchema.validate({
      id: "automation:1",
      schemaVersion: 1,
      name: "Daily report",
      enabled: true,
      scope: { type: "global" },
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *", activeDays: [1, 2, 3, 4, 5] },
      },
      executor: {
        type: "builtin.command",
        config: { command: "echo ok", shell: "posix" },
      },
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      runCount: 0,
      configVersion: 0,
    })).toBe(true)
  })

  it("validates automation run records", () => {
    expect(automationRunsSchema.validate({
      id: "automation-run:1",
      schemaVersion: 1,
      automationId: "automation:1",
      startedAt: "2026-06-03T00:00:00.000Z",
      status: "running",
      triggeredBy: "manual",
      triggerType: "builtin.cron",
      executorType: "builtin.command",
    })).toBe(true)
  })
})
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: FAIL because `automationItemsSchema` and `automationRunsSchema` are not exported.

- [ ] **Step 3: Add main and renderer Automation types**

Create `desktop/electron/services/automation/types.ts`:

```ts
import type {
  ActionRunResult,
  ActionStoredConfigValidation,
} from "../../../action-packages/types"

export const AUTOMATION_SERVICE_ID = "core.automation"

export type AutomationTriggerRef = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type AutomationExecutorRef = {
  readonly type: string
  readonly config: Record<string, unknown>
}

export type AutomationScope =
  | { readonly type: "global" }
  | { readonly type: "project"; readonly projectId: string }

export type AutomationRunStatus =
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"
  | "skipped"

export type AutomationActiveRunStatus = "running" | AutomationRunStatus
export type AutomationRunTrigger = "trigger" | "manual" | "missed_run"
export type AutomationValidation = ActionStoredConfigValidation

export type AutomationPolicy = {
  readonly missedRunPolicy: "skip" | "run_once"
  readonly overlapPolicy: "skip"
}

export interface AutomationItem extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly scope: AutomationScope
  readonly cwd?: string
  readonly trigger: AutomationTriggerRef
  readonly executor: AutomationExecutorRef
  readonly policy: AutomationPolicy
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: AutomationRunStatus
  readonly activeRun?: { readonly status: "running"; readonly id?: string }
  readonly validation?: AutomationValidation
  readonly runCount: number
  readonly configVersion: number
}

export interface AutomationCreateInput {
  readonly name: string
  readonly description?: string
  readonly enabled?: boolean
  readonly scope: AutomationScope
  readonly cwd?: string
  readonly trigger: AutomationTriggerRef
  readonly executor: AutomationExecutorRef
  readonly policy?: Partial<AutomationPolicy>
}

export interface AutomationUpdateInput {
  readonly name?: string
  readonly description?: string
  readonly enabled?: boolean
  readonly scope?: AutomationScope
  readonly cwd?: string
  readonly trigger?: AutomationTriggerRef
  readonly executor?: AutomationExecutorRef
  readonly policy?: Partial<AutomationPolicy>
}

export interface AutomationRun extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 1
  readonly automationId: string
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: AutomationActiveRunStatus
  readonly triggeredBy: AutomationRunTrigger
  readonly triggerType: string
  readonly executorType: string
  readonly result?: ActionRunResult
  readonly error?: string
}

export interface AutomationRunFinishInput {
  readonly status: AutomationRunStatus
  readonly result?: ActionRunResult
  readonly error?: string
}
```

Create `desktop/src/types/automation.ts` with the same public shapes, importing `ActionRunResult` from `../../action-packages/types`.

- [ ] **Step 4: Add schemas**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, add these types and schemas near task-scheduler schemas:

```ts
export type AutomationRunStatusV1 = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type AutomationActiveRunStatusV1 = "running" | AutomationRunStatusV1
export type AutomationRunTriggerV1 = "trigger" | "manual" | "missed_run"

export interface AutomationItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  enabled: boolean
  scope: ScheduledTaskScopeV1
  cwd?: string
  trigger: ScheduledTaskActionV1
  executor: ScheduledTaskActionV1
  policy: {
    missedRunPolicy: "skip" | "run_once"
    overlapPolicy: "skip"
  }
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: AutomationRunStatusV1
  runCount: number
  configVersion: number
}

export interface AutomationRunEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  automationId: string
  startedAt: string
  finishedAt?: string
  status: AutomationActiveRunStatusV1
  triggeredBy: AutomationRunTriggerV1
  triggerType: string
  executorType: string
  result?: Record<string, unknown>
  error?: string
}

function isAutomationRunStatus(value: unknown): value is AutomationRunStatusV1 {
  return value === "success" || value === "failed" || value === "timeout" || value === "cancelled" || value === "skipped"
}

function isAutomationActiveRunStatus(value: unknown): value is AutomationActiveRunStatusV1 {
  return value === "running" || isAutomationRunStatus(value)
}

function isAutomationRunTrigger(value: unknown): value is AutomationRunTriggerV1 {
  return value === "trigger" || value === "manual" || value === "missed_run"
}

function isAutomationPolicy(value: unknown): value is AutomationItemEntryV1["policy"] {
  return isAnyRecord<AutomationItemEntryV1["policy"]>(value)
    && (value as AutomationItemEntryV1["policy"]).overlapPolicy === "skip"
    && ((value as AutomationItemEntryV1["policy"]).missedRunPolicy === "skip" || (value as AutomationItemEntryV1["policy"]).missedRunPolicy === "run_once")
}

export const automationItemsSchema: NamespaceSchema<AutomationItemEntryV1> = {
  name: "automation.items",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AutomationItemEntryV1 =>
    isAnyRecord<AutomationItemEntryV1>(v)
    && (v as AutomationItemEntryV1).schemaVersion === 1
    && typeof (v as AutomationItemEntryV1).id === "string"
    && typeof (v as AutomationItemEntryV1).name === "string"
    && isOptionalString((v as AutomationItemEntryV1).description)
    && typeof (v as AutomationItemEntryV1).enabled === "boolean"
    && isTaskScope((v as AutomationItemEntryV1).scope)
    && isOptionalString((v as AutomationItemEntryV1).cwd)
    && isTaskAction((v as AutomationItemEntryV1).trigger)
    && isTaskAction((v as AutomationItemEntryV1).executor)
    && isAutomationPolicy((v as AutomationItemEntryV1).policy)
    && typeof (v as AutomationItemEntryV1).createdAt === "string"
    && typeof (v as AutomationItemEntryV1).updatedAt === "string"
    && isOptionalString((v as AutomationItemEntryV1).nextRunAt)
    && isOptionalString((v as AutomationItemEntryV1).lastRunAt)
    && ((v as AutomationItemEntryV1).lastStatus === undefined || isAutomationRunStatus((v as AutomationItemEntryV1).lastStatus))
    && typeof (v as AutomationItemEntryV1).runCount === "number"
    && typeof (v as AutomationItemEntryV1).configVersion === "number",
}

export const automationRunsSchema: NamespaceSchema<AutomationRunEntryV1> = {
  name: "automation.runs",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AutomationRunEntryV1 =>
    isAnyRecord<AutomationRunEntryV1>(v)
    && (v as AutomationRunEntryV1).schemaVersion === 1
    && typeof (v as AutomationRunEntryV1).id === "string"
    && typeof (v as AutomationRunEntryV1).automationId === "string"
    && typeof (v as AutomationRunEntryV1).startedAt === "string"
    && isOptionalString((v as AutomationRunEntryV1).finishedAt)
    && isAutomationActiveRunStatus((v as AutomationRunEntryV1).status)
    && isAutomationRunTrigger((v as AutomationRunEntryV1).triggeredBy)
    && typeof (v as AutomationRunEntryV1).triggerType === "string"
    && typeof (v as AutomationRunEntryV1).executorType === "string"
    && ((v as AutomationRunEntryV1).result === undefined || isAnyRecord((v as AutomationRunEntryV1).result))
    && isOptionalString((v as AutomationRunEntryV1).error),
}
```

In `desktop/electron/runtime/data-repo/schemas/index.ts`, export the new schemas and add them to `allSchemas` immediately after task scheduler schemas.

- [ ] **Step 5: Run schema tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/automation/types.ts desktop/src/types/automation.ts desktop/electron/runtime/data-repo/schemas/placeholders.ts desktop/electron/runtime/data-repo/schemas/index.ts desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
git commit -m "feat: add automation data schemas"
```

---

### Task 2: Add Trigger Registry And Schedule Calculator

**Files:**

- Create: `desktop/electron/services/automation/trigger-registry.ts`
- Create: `desktop/electron/services/automation/builtin-triggers.ts`
- Create: `desktop/electron/services/automation/schedule-calculator.ts`
- Create: `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`
- Create: `desktop/electron/services/automation/__tests__/schedule-calculator.test.ts`

- [ ] **Step 1: Write failing trigger registry tests**

Create `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { AutomationTriggerRegistry } from "../trigger-registry"

const testTrigger = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    defaultConfig: { value: "ok" },
    configSchema: z.object({ value: z.string().min(1) }),
  },
  summarize: (config: { value: string }) => config.value,
}

describe("AutomationTriggerRegistry", () => {
  it("registers and parses trigger config", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)

    expect(registry.parseConfig("builtin.test", { value: "hello" })).toEqual({ value: "hello" })
    expect(registry.summarize("builtin.test", { value: "hello" })).toBe("hello")
  })

  it("rejects duplicate trigger ids", () => {
    const registry = new AutomationTriggerRegistry()
    registry.register(testTrigger)
    expect(() => registry.register(testTrigger)).toThrow(/already registered/)
  })

  it("reports needs_update for unknown triggers", () => {
    const registry = new AutomationTriggerRegistry()
    expect(registry.validateStoredConfig("missing", {})).toEqual({
      status: "needs_update",
      issues: [{ field: "trigger.type", message: "选择触发器" }],
    })
  })
})
```

- [ ] **Step 2: Write failing schedule calculator tests**

Create `desktop/electron/services/automation/__tests__/schedule-calculator.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { computeNextRunAt } from "../schedule-calculator"

describe("automation schedule calculator", () => {
  it("computes the next cron run with active days", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *", activeDays: [1] },
      },
      from: new Date("2026-06-02T10:00:00.000Z"),
      createdAt: "2026-06-01T00:00:00.000Z",
    })

    expect(next.getDay()).toBe(1)
    expect(next.getTime()).toBeGreaterThan(new Date("2026-06-02T10:00:00.000Z").getTime())
  })

  it("computes created_at interval runs", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 30, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      from: new Date("2026-06-03T00:40:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })

    expect(next.toISOString()).toBe("2026-06-03T01:00:00.000Z")
  })

  it("computes last_completed_at interval runs", () => {
    const next = computeNextRunAt({
      trigger: {
        type: "builtin.interval",
        config: { everyMinutes: 30, anchor: "last_completed_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      },
      from: new Date("2026-06-03T00:40:00.000Z"),
      createdAt: "2026-06-03T00:00:00.000Z",
    })

    expect(next.toISOString()).toBe("2026-06-03T01:10:00.000Z")
  })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/trigger-registry.test.ts electron/services/automation/__tests__/schedule-calculator.test.ts
```

Expected: FAIL because registry and calculator files do not exist.

- [ ] **Step 4: Implement trigger registry**

Create `desktop/electron/services/automation/trigger-registry.ts`:

```ts
import type { z } from "zod"
import type { ActionStoredConfigValidation } from "../../../action-packages/types"
import type { AutomationTriggerRef } from "./types"

export type AutomationTriggerManifest<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
  readonly id: string
  readonly title: string
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
}

export type AutomationTriggerRuntimeInput<TConfig extends Record<string, unknown>> = {
  readonly config: TConfig
  readonly from: Date
  readonly createdAt: string
  readonly lastRunAt?: string
}

export type AutomationTriggerDefinition<TConfig extends Record<string, unknown> = Record<string, unknown>> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarize(config: TConfig): string
  computeNextRunAt?(input: AutomationTriggerRuntimeInput<TConfig>): Date
  shouldRunNow?(input: { readonly config: TConfig; readonly now: Date }): boolean
}

export class AutomationTriggerRegistry {
  private readonly triggers = new Map<string, AutomationTriggerDefinition>()

  register(trigger: AutomationTriggerDefinition): void {
    const id = trigger.manifest.id
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger)
  }

  get(id: string): AutomationTriggerDefinition {
    const trigger = this.triggers.get(id)
    if (!trigger) throw new Error(`Automation trigger "${id}" is not registered`)
    return trigger
  }

  list(): readonly AutomationTriggerDefinition[] {
    return [...this.triggers.values()]
  }

  parseConfig(id: string, config: Record<string, unknown>): Record<string, unknown> {
    return this.get(id).manifest.configSchema.parse(config)
  }

  normalize(ref: AutomationTriggerRef): AutomationTriggerRef {
    return {
      type: ref.type,
      config: this.parseConfig(ref.type, ref.config),
    }
  }

  validateStoredConfig(id: string, config: Record<string, unknown>): ActionStoredConfigValidation {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      return {
        status: "needs_update",
        issues: [{ field: "trigger.type", message: "选择触发器" }],
      }
    }
    const parsed = trigger.manifest.configSchema.safeParse(config)
    return parsed.success
      ? { status: "valid", issues: [] }
      : { status: "needs_update", issues: [{ field: "trigger.config", message: "检查触发器" }] }
  }

  summarize(id: string, config: Record<string, unknown>): string {
    const trigger = this.get(id)
    return trigger.summarize(trigger.manifest.configSchema.parse(config))
  }
}
```

- [ ] **Step 5: Implement schedule calculator and built-in triggers**

Create `desktop/electron/services/automation/schedule-calculator.ts` by adapting `desktop/electron/services/task-scheduler/schedule-calculator.ts`. Replace `TaskTrigger` with:

```ts
import { nextCronRun } from "../task-scheduler/cron-expression"

export type AutomationTimeTrigger =
  | {
      readonly type: "builtin.cron"
      readonly config: {
        readonly expr: string
        readonly timezone?: string
        readonly activeDays: readonly number[]
      }
    }
  | {
      readonly type: "builtin.interval"
      readonly config: {
        readonly everyMinutes: number
        readonly anchor: "created_at" | "last_completed_at"
        readonly activeDays: readonly number[]
      }
    }

export function computeNextRunAt(input: {
  readonly trigger: AutomationTimeTrigger
  readonly from: Date
  readonly createdAt: string
}): Date {
  const activeDays = input.trigger.config.activeDays.length < 7
    ? new Set(input.trigger.config.activeDays)
    : null

  if (!activeDays) return computeRawCandidate(input)

  let candidate = computeRawCandidate(input)

  for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
    const weekday = getWeekday(candidate, input.trigger)
    if (activeDays.has(weekday)) return candidate
    const nextDay = advanceToNextValidDay(candidate, activeDays, input.trigger)
    candidate = computeRawCandidate({ ...input, from: nextDay })
  }

  return candidate
}
```

Copy `MAX_ADVANCE_ITERATIONS`, `computeRawCandidate`, `getWeekday`, `advanceToNextValidDay`, and `getTimezoneOffsetMs` from `desktop/electron/services/task-scheduler/schedule-calculator.ts`. In the copied code, replace only the imported trigger type with `AutomationTimeTrigger`; the helper bodies otherwise stay behaviorally identical so old scheduler and new automation calculate time the same way.

Create `desktop/electron/services/automation/builtin-triggers.ts`:

```ts
import { z } from "zod"
import { computeNextRunAt } from "./schedule-calculator"
import { AutomationTriggerRegistry } from "./trigger-registry"

const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

export const cronTriggerSchema = z.object({
  expr: z.string().min(1),
  timezone: z.string().min(1).optional(),
  activeDays: activeDaysSchema,
})

export const intervalTriggerSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]).default("created_at"),
  activeDays: activeDaysSchema,
})

export function createBuiltinAutomationTriggerRegistry(): AutomationTriggerRegistry {
  const registry = new AutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.cron",
      title: "Cron",
      defaultConfig: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      configSchema: cronTriggerSchema,
    },
    summarize: (config) => `Cron · ${config.expr}`,
    computeNextRunAt: (input) => computeNextRunAt({
      trigger: { type: "builtin.cron", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    }),
  })
  registry.register({
    manifest: {
      id: "builtin.interval",
      title: "固定间隔",
      defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
      configSchema: intervalTriggerSchema,
    },
    summarize: (config) => config.anchor === "last_completed_at"
      ? `每 ${config.everyMinutes} 分钟 · 完成后`
      : `每 ${config.everyMinutes} 分钟`,
    computeNextRunAt: (input) => computeNextRunAt({
      trigger: { type: "builtin.interval", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    }),
  })
  return registry
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/trigger-registry.test.ts electron/services/automation/__tests__/schedule-calculator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/automation/trigger-registry.ts desktop/electron/services/automation/builtin-triggers.ts desktop/electron/services/automation/schedule-calculator.ts desktop/electron/services/automation/__tests__/trigger-registry.test.ts desktop/electron/services/automation/__tests__/schedule-calculator.test.ts
git commit -m "feat: add automation trigger registry"
```

---

### Task 3: Add Automation Repositories

**Files:**

- Create: `desktop/electron/services/automation/item-repository.ts`
- Create: `desktop/electron/services/automation/run-repository.ts`
- Create: `desktop/electron/services/automation/__tests__/item-repository.test.ts`
- Create: `desktop/electron/services/automation/__tests__/run-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `desktop/electron/services/automation/__tests__/item-repository.test.ts` with an in-memory namespace like task-scheduler repository tests. Cover create, update, enable, disable, markScheduled, and markRunResult:

```ts
it("creates automation items in automation.items", async () => {
  const repo = new AutomationItemRepository({
    items: new MemoryNamespace<AutomationItem>("automation.items"),
    triggers: createBuiltinAutomationTriggerRegistry(),
    now: () => new Date("2026-06-03T00:00:00.000Z"),
    idFactory: () => "automation:1",
  })

  const item = await repo.create({
    name: "Daily",
    scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] } },
    executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
  })

  expect(item.id).toBe("automation:1")
  expect(item.policy).toEqual({ missedRunPolicy: "skip", overlapPolicy: "skip" })
  expect(item.nextRunAt).toBeDefined()
})
```

Create `desktop/electron/services/automation/__tests__/run-repository.test.ts`:

```ts
it("starts, finishes, and lists automation runs newest first", async () => {
  const repo = new AutomationRunRepository({
    runs: new MemoryNamespace<AutomationRun>("automation.runs"),
    now: () => new Date("2026-06-03T00:00:00.000Z"),
    idFactory: () => "automation-run:1",
  })

  const run = await repo.start("automation:1", "manual", {
    triggerType: "builtin.cron",
    executorType: "builtin.command",
  })
  const finished = await repo.finish(run.id, { status: "success" })

  expect(finished.status).toBe("success")
  expect(await repo.listByAutomation("automation:1")).toHaveLength(1)
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/item-repository.test.ts electron/services/automation/__tests__/run-repository.test.ts
```

Expected: FAIL because repositories do not exist.

- [ ] **Step 3: Implement repositories**

Implement `AutomationItemRepository` with the same persistence style as `ScheduledTaskRepository`, but use `automation.items`, `trigger`, `executor`, and `policy`.

Core methods:

```ts
create(input: AutomationCreateInput): Promise<AutomationItem>
update(id: string, patch: AutomationUpdateInput): Promise<AutomationItem>
delete(id: string): Promise<boolean>
get(id: string): Promise<AutomationItem | null>
list(): Promise<AutomationItem[]>
setEnabled(id: string, enabled: boolean): Promise<AutomationItem>
markScheduled(id: string, nextRunAt: string | undefined): Promise<AutomationItem | null>
markRunResult(id: string, result: { status: AutomationRunStatus }): Promise<AutomationItem | null>
```

Implement `AutomationRunRepository` with the same pruning behavior as `ScheduledTaskRunRepository`, but use `automationId`.

- [ ] **Step 4: Run repository tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/item-repository.test.ts electron/services/automation/__tests__/run-repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/automation/item-repository.ts desktop/electron/services/automation/run-repository.ts desktop/electron/services/automation/__tests__/item-repository.test.ts desktop/electron/services/automation/__tests__/run-repository.test.ts
git commit -m "feat: add automation repositories"
```

---

### Task 4: Add Execution And Automation Services

**Files:**

- Create: `desktop/electron/services/automation/execution-service.ts`
- Create: `desktop/electron/services/automation/automation-service.ts`
- Create: `desktop/electron/services/automation/index.ts`
- Create: `desktop/electron/services/automation/__tests__/execution-service.test.ts`
- Create: `desktop/electron/services/automation/__tests__/automation-service.test.ts`

- [ ] **Step 1: Write failing execution service test**

Create `execution-service.test.ts` with a fake Action Runtime action:

```ts
it("runs an automation executor through Action Runtime", async () => {
  const action = testAction({ status: "success", summary: "ok" })
  const actions = new MainActionRegistry()
  actions.register(action)
  const runs = new AutomationRunRepository({ runs: new MemoryNamespace<AutomationRun>("automation.runs") })
  const items = fakeItemStore()

  const service = new AutomationExecutionService({
    items,
    runs,
    actions,
    permissionGuard: allowPermissionGuard(),
    auditSink: memoryAuditSink(),
    defaultCwd: "/tmp",
  })

  const run = await service.runItem(testAutomationItem(), "manual")

  expect(run.status).toBe("success")
  expect(action.execute).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: Write failing automation service tests**

Create `automation-service.test.ts`:

```ts
it("manual run executes enabled valid automation", async () => {
  const harness = createAutomationServiceHarness()
  const item = await harness.items.create(validCreateInput())

  const run = await harness.service.runNow(item.id)

  expect(run?.status).toBe("success")
  expect(await harness.runs.listByAutomation(item.id)).toHaveLength(1)
})

it("overlap records skipped run", async () => {
  const harness = createAutomationServiceHarness({ actionDelayMs: 50 })
  const item = await harness.items.create(validCreateInput())

  const first = harness.service.runNow(item.id)
  const second = await harness.service.runNow(item.id)

  expect(second?.status).toBe("skipped")
  await first
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/execution-service.test.ts electron/services/automation/__tests__/automation-service.test.ts
```

Expected: FAIL because services do not exist.

- [ ] **Step 4: Implement `AutomationExecutionService`**

Create `execution-service.ts` using the old `TaskSchedulerExecutionService` structure. Required differences:

```ts
context: {
  taskId: item.id,
  taskName: item.name,
  runId: run.id,
  triggeredBy: triggeredBy === "trigger" ? "schedule" : triggeredBy,
  cwd: resolveCwd(item, defaultCwd),
  actor: { kind: "user", id: "automation", display: "Automation" },
  abortSignal: controller.signal,
  configVersion: item.configVersion,
}
```

Audit metadata must include:

```ts
{
  source: "automation",
  automationId: item.id,
  runId: run.id,
  triggerType: item.trigger.type,
  executorType: item.executor.type,
  triggeredBy,
}
```

- [ ] **Step 5: Implement `AutomationService`**

Create `automation-service.ts` with:

```ts
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
listRuns(id: string, options?: { limit?: number }): Promise<AutomationRun[]>
runtimeInspect(): { timers: readonly string[]; runningItemIds: readonly string[] }
```

Emit events:

```ts
this.deps.eventBus?.emit({
  domain: "automation",
  type: "automation.changed",
  payload,
  timestamp: this.now().toISOString(),
}, { backpressure: "coalesce" })
```

- [ ] **Step 6: Add barrel exports**

Create `desktop/electron/services/automation/index.ts`:

```ts
export {
  AUTOMATION_SERVICE_ID,
  type AutomationCreateInput,
  type AutomationExecutorRef,
  type AutomationItem,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationTriggerRef,
  type AutomationUpdateInput,
} from "./types"
export { AutomationService, type AutomationServiceDeps } from "./automation-service"
export { AutomationExecutionService, type AutomationExecutionServiceDeps } from "./execution-service"
export { AutomationItemRepository, type AutomationItemRepositoryDeps } from "./item-repository"
export { AutomationRunRepository, type AutomationRunRepositoryDeps } from "./run-repository"
export { AutomationTriggerRegistry } from "./trigger-registry"
export { createBuiltinAutomationTriggerRegistry } from "./builtin-triggers"
```

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/execution-service.test.ts electron/services/automation/__tests__/automation-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/services/automation
git commit -m "feat: add automation runtime service"
```

---

### Task 5: Register Service, Data Schemas, And IPC

**Files:**

- Create: `desktop/electron/modules/automation/ipc.ts`
- Create: `desktop/electron/modules/automation/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/scripts/generate-ipc.mjs`
- Test: `desktop/electron/bootstrap/__tests__/registry.test.ts`
- Test: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`

- [ ] **Step 1: Write failing registration tests**

Add expectations:

```ts
expect(serviceIds).toContain("core.automation")
expect(byId.get("core.automation")?.dependsOn).toEqual([
  "core.data-repository",
  "core.permission-guard",
  "core.audit-sink",
  "core.action-runtime",
  "core.event-bus",
])
expect(idx("core.action-runtime")).toBeLessThan(idx("core.automation"))
```

In IPC registry tests, expect `registeredIpcModules.map(m => m.id)` to contain `"automation"`.

- [ ] **Step 2: Write failing IPC test**

Create `desktop/electron/modules/automation/__tests__/ipc.test.ts`:

```ts
it("registers automation IPC methods and event payload", async () => {
  expect(automationIpcModule.id).toBe("automation")
  expect(automationIpcModule.events.changed.channel).toBe("synapse:events:automation")
  expect(automationIpcModule.events.changed.payload.parse({
    itemId: "automation:1",
    reason: "created",
  })).toEqual({ itemId: "automation:1", reason: "created" })
})
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts electron/modules/automation/__tests__/ipc.test.ts
```

Expected: FAIL because Automation service and IPC are not registered.

- [ ] **Step 4: Add service descriptor**

In `desktop/electron/bootstrap/descriptors.ts`, import Automation classes and add:

```ts
export const coreAutomationDescriptor: ServiceDescriptor<AutomationService> = {
  id: "core.automation",
  criticality: "degraded",
  dependsOn: [
    "core.data-repository",
    "core.permission-guard",
    "core.audit-sink",
    "core.action-runtime",
    "core.event-bus",
  ],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    const permissionGuard = ctx.registry.get<PermissionGuard>("core.permission-guard")
    const auditSink = ctx.registry.get<AuditSink>("core.audit-sink")
    const actions = ctx.registry.get<MainActionRegistry>("core.action-runtime")
    const triggers = createBuiltinAutomationTriggerRegistry()
    const items = new AutomationItemRepository({
      items: dataRepository.namespace("automation.items"),
      triggers,
    })
    const runs = new AutomationRunRepository({
      runs: dataRepository.namespace("automation.runs"),
    })
    const execution = new AutomationExecutionService({
      items,
      runs,
      actions,
      permissionGuard,
      auditSink,
      defaultCwd: app.getPath("userData"),
    })
    return new AutomationService({
      items,
      runs,
      triggers,
      actions,
      execution,
      defaultCwd: app.getPath("userData"),
      eventBus: ctx.registry.get<EventBus>("core.event-bus"),
      logger: ctx.logger.child("automation"),
    })
  },
  start(service) {
    return service.start()
  },
  stop(service) {
    return service.stop()
  },
}
```

Register in `desktop/electron/bootstrap/registry.ts` after `coreTaskSchedulerDescriptor`.

- [ ] **Step 5: Add Automation IPC module**

Create `desktop/electron/modules/automation/ipc.ts` with zod schemas matching `desktop/src/types/automation.ts`. Channels:

```text
synapse:automation:items:list
synapse:automation:items:get
synapse:automation:items:create
synapse:automation:items:update
synapse:automation:items:delete
synapse:automation:items:set-enabled
synapse:automation:items:run-now
synapse:automation:runs:stop
synapse:automation:runs:list
synapse:events:automation
```

Handlers resolve:

```ts
ctx.resolve<AutomationService>("core.automation")
```

- [ ] **Step 6: Register IPC module and codegen**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { automationIpcModule } from "../modules/automation/ipc"
```

Register it immediately after `taskSchedulerIpcModule`.

Modify `desktop/scripts/generate-ipc.mjs` by adding:

```js
{ id: "automation", importPath: "../electron/modules/automation/ipc.ts" },
```

- [ ] **Step 7: Run registration and IPC tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/registry.test.ts electron/bootstrap/__tests__/descriptors.test.ts electron/modules/automation/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 8: Generate IPC and run typecheck slice**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/modules/automation desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/ipc-registry.ts desktop/scripts/generate-ipc.mjs desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat: register automation service and ipc"
```

---

### Task 6: Add Preload Bridge

**Files:**

- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Write failing preload test**

In `desktop/electron/__tests__/preload.test.ts`, add:

```ts
it("exposes automation bridge", () => {
  expect(bridge.automation).toMatchObject({
    listItems: expect.any(Function),
    getItem: expect.any(Function),
    createItem: expect.any(Function),
    updateItem: expect.any(Function),
    deleteItem: expect.any(Function),
    setItemEnabled: expect.any(Function),
    runNow: expect.any(Function),
    stopRun: expect.any(Function),
    listRuns: expect.any(Function),
    onChanged: expect.any(Function),
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
```

Expected: FAIL because `bridge.automation` is undefined.

- [ ] **Step 3: Add bridge types**

In `desktop/src/types/bridge.ts`, import Automation types and add:

```ts
automation: {
  listItems: () => Promise<AutomationItem[]>
  getItem: (id: string) => Promise<AutomationItem | null>
  createItem: (input: AutomationCreateInput) => Promise<AutomationItem>
  updateItem: (payload: { id: string; patch: AutomationUpdateInput }) => Promise<AutomationItem>
  deleteItem: (id: string) => Promise<{ deleted: boolean }>
  setItemEnabled: (payload: { id: string; enabled: boolean }) => Promise<AutomationItem>
  runNow: (id: string) => Promise<AutomationRun | null>
  stopRun: (runId: string) => Promise<{ stopped: boolean }>
  listRuns: (id: string, options?: { limit?: number }) => Promise<AutomationRun[]>
  onChanged: (listener: (event: AutomationChangedEvent) => void) => () => void
}
```

- [ ] **Step 4: Add preload implementation**

In `desktop/electron/preload.ts`, add `automation` beside `taskScheduler`:

```ts
automation: {
  listItems: invoke(IPC_CHANNELS.automation.listItems),
  getItem: (id) => invoke(IPC_CHANNELS.automation.getItem)({ itemId: id }),
  createItem: (input) => invoke(IPC_CHANNELS.automation.createItem)(input),
  updateItem: (payload) => invoke(IPC_CHANNELS.automation.updateItem)(payload),
  deleteItem: (id) => invoke(IPC_CHANNELS.automation.deleteItem)({ itemId: id }),
  setItemEnabled: (payload) =>
    invoke(IPC_CHANNELS.automation.setItemEnabled)({
      itemId: payload.id,
      enabled: payload.enabled,
    }),
  runNow: (id) => invoke(IPC_CHANNELS.automation.runNow)({ itemId: id }),
  stopRun: (runId) => invoke(IPC_CHANNELS.automation.stopRun)({ runId }),
  listRuns: (id, options) =>
    invoke(IPC_CHANNELS.automation.listRuns)({ itemId: id, limit: options?.limit }),
  onChanged: createDomainEventPayloadSubscription<AutomationChangedEvent>(
    subscribe,
    "automation",
    "automation.changed",
  ),
}
```

- [ ] **Step 5: Run preload test and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/__tests__/preload.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat: expose automation bridge"
```

---

### Task 7: Add Renderer Automation Module

**Files:**

- Create: `desktop/src/modules/automation/index.tsx`
- Create: `desktop/src/modules/automation/types.ts`
- Create: `desktop/src/modules/automation/utils.ts`
- Create: `desktop/src/modules/automation/hooks/use-automation.ts`
- Create: `desktop/src/modules/automation/components/automation-card.tsx`
- Create: `desktop/src/modules/automation/components/automation-card-grid.tsx`
- Create: `desktop/src/modules/automation/components/automation-form-dialog.tsx`
- Create: `desktop/src/modules/automation/components/automation-runs-dialog.tsx`
- Create: `desktop/src/modules/automation/components/trigger-config-form.tsx`
- Create: `desktop/src/modules/automation/__tests__/automation-module.test.tsx`
- Create: `desktop/src/modules/automation/__tests__/automation-form-dialog.test.tsx`
- Create: `desktop/src/modules/automation/hooks/__tests__/use-automation.test.tsx`

- [ ] **Step 1: Write failing hook test**

Create `use-automation.test.tsx`:

```tsx
it("loads automation items and refreshes on change event", async () => {
  bridge.automation.listItems.mockResolvedValueOnce([]).mockResolvedValueOnce([automationItem()])
  let listener: ((event: AutomationChangedEvent) => void) | undefined
  bridge.automation.onChanged.mockImplementation((next) => {
    listener = next
    return vi.fn()
  })

  const snapshots: Array<ReturnType<typeof useAutomationItems>> = []
  render(<Probe onSnapshot={(snapshot) => snapshots.push(snapshot)} />)

  await waitFor(() => expect(bridge.automation.listItems).toHaveBeenCalledTimes(1))
  listener?.({ itemId: "automation:1", reason: "created" })
  await waitFor(() => expect(bridge.automation.listItems).toHaveBeenCalledTimes(2))
})
```

- [ ] **Step 2: Write failing module and form tests**

Create `automation-module.test.tsx`:

```tsx
it("renders empty state and new automation action", () => {
  mocks.useAutomationItems.mockReturnValue({
    items: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const html = renderToStaticMarkup(<AutomationModule />)

  expect(html).toContain("新建")
  expect(html).toContain("暂无自动化")
})
```

Create `automation-form-dialog.test.tsx`:

```tsx
it("builds cron trigger with active days inside trigger config", async () => {
  const onCreate = vi.fn().mockResolvedValue(undefined)
  render(<AutomationFormDialog open state={{ mode: "create" }} busy={false} onOpenChange={vi.fn()} onCreate={onCreate} onUpdate={vi.fn()} />)

  await userEvent.type(screen.getByLabelText("名称"), "Daily")
  await userEvent.click(screen.getByRole("button", { name: "保存" }))

  await waitFor(() => expect(onCreate).toHaveBeenCalled())
  expect(onCreate.mock.calls[0][0].trigger).toMatchObject({
    type: "builtin.cron",
    config: { activeDays: expect.any(Array) },
  })
})
```

- [ ] **Step 3: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation
```

Expected: FAIL because module files do not exist.

- [ ] **Step 4: Implement hook and utils**

Create `hooks/use-automation.ts` with the same pattern as `use-task-scheduler.ts`, using `requireSynapseBridge().automation`.

Create `utils.ts` with:

```ts
export function formatAutomationTrigger(item: Pick<AutomationItem, "trigger">): string
export function formatAutomationExecutor(item: Pick<AutomationItem, "executor">): string
export function formatAutomationNextRun(item: Pick<AutomationItem, "enabled" | "nextRunAt">): string
export function buildAutomationCreateInput(form: AutomationFormState): AutomationCreateInput
export function buildAutomationUpdateInput(form: AutomationFormState): AutomationUpdateInput
```

Use `rendererActionRegistry.parseConfig` for executor config. Use local trigger schemas from `trigger-config-form.tsx` or a shared pure helper to validate trigger config.

- [ ] **Step 5: Implement UI components**

Use existing shadcn components already used by Task Scheduler:

- `Button`
- `Dialog`
- `Field`, `FieldLabel`, `FieldError`
- `Input`
- `Textarea`
- `Select`
- `Switch`
- `ScrollArea`
- `ToggleGroup`

Do not add `style={{...}}`, custom colors, CSS modules, gradients, card nesting, or feature-description paragraphs.

The form sections must render these headings:

```text
基础信息
触发器
执行器
```

- [ ] **Step 6: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/automation
git commit -m "feat: add automation renderer module"
```

---

### Task 8: Add Navigation Entry

**Files:**

- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/__tests__/App.workflow-entry.test.tsx`

- [ ] **Step 1: Write failing navigation test**

In `desktop/src/__tests__/App.workflow-entry.test.tsx`, mock the module:

```ts
vi.mock("@/modules/automation", () => ({ AutomationModule: () => <div>自动化模块</div> }))
```

Add assertion:

```ts
expect(html.indexOf("定时")).toBeLessThan(html.indexOf("自动化"))
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/__tests__/App.workflow-entry.test.tsx
```

Expected: FAIL because the navigation entry does not exist.

- [ ] **Step 3: Add `automation` tab**

In `desktop/src/App.tsx`:

```ts
import { AutomationModule } from "@/modules/automation"
```

Extend `AppTabId` with `"automation"`.

Add navigation item immediately after task scheduler:

```ts
{ id: "task-scheduler" as const, label: "定时" },
{ id: "automation" as const, label: "自动化" },
```

Render:

```tsx
{activeTab === "automation" ? (
  <ErrorBoundary fallbackTitle="自动化模块出现问题">
    <AutomationModule />
  </ErrorBoundary>
) : null}
```

- [ ] **Step 4: Run navigation test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/__tests__/App.workflow-entry.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/App.tsx desktop/src/__tests__/App.workflow-entry.test.tsx
git commit -m "feat: add automation navigation entry"
```

---

### Task 9: Final Verification And Release Notes

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a user-facing note:

```md
- 新增“自动化”入口，作为独立模块承载“触发器 + 执行器”的新模型；旧“定时”入口和已有定时任务保持不变。
```

- [ ] **Step 2: Run focused automation tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation electron/modules/automation src/modules/automation
```

Expected: PASS.

- [ ] **Step 3: Run old scheduler regression tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler electron/modules/task-scheduler src/modules/task-scheduler
```

Expected: PASS.

- [ ] **Step 4: Run hard constraints and typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit release note and any verification fixes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note automation module"
```

---

## Self-Review Checklist

- Spec coverage: The plan covers independent Automation data, Trigger Registry, Action Runtime executor reuse, service lifecycle, IPC/preload, renderer UI, navigation, tests, and release notes.
- Explicit non-goals: No Webhook, file-change, user-action, Workflow executor, migration, MCP rename, or dedicated editor window appears in implementation tasks.
- Old Scheduler safety: Old scheduler code is not modified except for optional shared pure helpers, and old scheduler regression tests are required.
- Type consistency: Plan uses `AutomationItem`, `AutomationRun`, `trigger`, `executor`, `policy`, `listItems`, `runNow`, and `automation.changed` consistently.
- UI discipline: The plan requires existing shadcn/Radix primitives, theme tokens, no custom colors, no CSS modules, no inline styles, no marketing copy.
