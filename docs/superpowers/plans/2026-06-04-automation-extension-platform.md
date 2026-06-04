# Automation Extension Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Automation into an extension platform where future triggers and executors are added through packages and registries rather than core service branches.

**Architecture:** Keep `AutomationItem` storage as `{ trigger: { type, config }, executor: { type, config } }`. Move trigger-specific schedule, guard, and event matching behavior into trigger package runtime definitions. Keep executor execution behind the existing Action Runtime registry while removing trigger/executor type knowledge from Automation Core, IPC handler schemas, and the renderer editor builder.

**Tech Stack:** Electron main process, React renderer, TypeScript, zod, Vitest, shadcn/Radix primitives, existing Synapse DataRepository, IpcRegistry, EventBus, Action Runtime.

---

## File Structure

Create:

- `desktop/automation-trigger-packages/types.shared.ts`
  Shared trigger platform types used by main and renderer trigger registries.
- `desktop/automation-trigger-packages/builtin/cron/index.shared.ts`
  Cron shared manifest, schema, summary, and helper exports.
- `desktop/automation-trigger-packages/builtin/cron/index.main.ts`
  Cron main-process trigger definition with schedule runtime behavior.
- `desktop/automation-trigger-packages/builtin/cron/index.renderer.ts`
  Cron renderer trigger definition with `ConfigForm`.
- `desktop/automation-trigger-packages/builtin/cron/runtime.main.ts`
  Cron next-run and active-day runtime behavior.
- `desktop/automation-trigger-packages/builtin/interval/index.shared.ts`
  Interval shared manifest, schema, summary, and helper exports.
- `desktop/automation-trigger-packages/builtin/interval/index.main.ts`
  Interval main-process trigger definition with schedule runtime behavior.
- `desktop/automation-trigger-packages/builtin/interval/index.renderer.ts`
  Interval renderer trigger definition with `ConfigForm`.
- `desktop/automation-trigger-packages/builtin/interval/runtime.main.ts`
  Interval next-run, active-day, and reschedule runtime behavior.

Modify:

- `desktop/electron/services/automation/trigger-registry.ts`
  Use shared trigger platform types and delegate schedule/event behavior through `definition.runtime`.
- `desktop/electron/services/automation/builtin-triggers.ts`
  Register trigger definitions from package `index.main.ts` files.
- `desktop/electron/services/automation/automation-service.ts`
  Remove concrete cron/interval branches and add generic `acceptEvent`.
- `desktop/electron/services/automation/item-repository.ts`
  Remove concrete interval branch and make next-run calculation nullable.
- `desktop/electron/services/automation/schedule-calculator.ts`
  Leave unchanged in this plan. It becomes legacy helper coverage after trigger package runtimes stop importing it; deletion is a separate cleanup decision.
- `desktop/electron/services/automation/types.ts`
  Re-export `AutomationTriggerEvent` for the service boundary.
- `desktop/electron/modules/automation/ipc.ts`
  Replace concrete trigger IPC schema with generic trigger reference shape.
- `desktop/src/automation-triggers/action-registry.ts`
  Use shared trigger manifest shape including `kind`.
- `desktop/src/automation-triggers/builtin-triggers.ts`
  Register renderer definitions from package `index.renderer.ts` files.
- `desktop/src/modules/automation/types.ts`
  Remove old dialog-only `AutomationFormState` and `AutomationFormTriggerType`.
- `desktop/src/modules/automation/utils.ts`
  Remove old hard-coded form payload path; keep draft/editor and formatting utilities.
- `desktop/src/modules/automation/components/automation-form-dialog.tsx`
  Delete this file after references and tests are removed.
- `desktop/src/modules/automation/__tests__/automation-module.test.tsx`
  Assert the main module opens editor windows and never renders the old form dialog.
- `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
  Keep registry-driven editor coverage and add fake trigger coverage if local mocking stays simple.
- `RELEASE_NOTES_PENDING.md`
  Add a user-visible note only if the final implementation changes behavior or UI. This platform refactor should not need a release note if behavior is unchanged.

Regression test files:

- `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`
- `desktop/electron/services/automation/__tests__/automation-service.test.ts`
- `desktop/electron/services/automation/__tests__/item-repository.test.ts`
- `desktop/electron/modules/automation/__tests__/ipc.test.ts`
- `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`
- `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
- `desktop/src/modules/automation/__tests__/automation-module.test.tsx`
- Existing Task Scheduler tests under `desktop/electron/services/task-scheduler/__tests__/`

---

### Task 1: Shared Trigger Platform Contracts

**Files:**

- Create: `desktop/automation-trigger-packages/types.shared.ts`
- Modify: `desktop/electron/services/automation/trigger-registry.ts`
- Modify: `desktop/src/automation-triggers/action-registry.ts`
- Test: `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`
- Test: `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`

- [ ] **Step 1: Write failing main registry tests**

Replace `testTrigger` in `desktop/electron/services/automation/__tests__/trigger-registry.test.ts` with a schedule trigger definition that includes `kind` and `runtime`:

```ts
const testTrigger = {
  manifest: {
    id: "builtin.test",
    title: "Test",
    kind: "schedule" as const,
    defaultConfig: { value: "ok" },
    configSchema: z.object({ value: z.string().min(1) }),
  },
  summarize: (config: { value: string }) => config.value,
  runtime: {
    computeNextRunAt: () => new Date("2026-06-03T00:10:00.000Z"),
  },
}
```

Add these tests to the same file:

```ts
it("exposes schedule runtime through the trigger definition", () => {
  const registry = new AutomationTriggerRegistry()
  registry.register(testTrigger)

  const trigger = registry.get("builtin.test")

  expect(trigger.manifest.kind).toBe("schedule")
  expect(trigger.runtime.computeNextRunAt?.({
    config: { value: "ok" },
    from: new Date("2026-06-03T00:00:00.000Z"),
    createdAt: "2026-06-03T00:00:00.000Z",
  })).toEqual(new Date("2026-06-03T00:10:00.000Z"))
})

it("uses custom stored config validation when provided", () => {
  const registry = new AutomationTriggerRegistry()
  registry.register({
    ...testTrigger,
    validateStoredConfig: () => ({
      status: "needs_update",
      issues: [{ field: "trigger.config.value", message: "值已失效" }],
    }),
  })

  expect(registry.validateStoredConfig("builtin.test", { value: "ok" })).toEqual({
    status: "needs_update",
    issues: [{ field: "trigger.config.value", message: "值已失效" }],
  })
})
```

- [ ] **Step 2: Write failing renderer registry test**

In `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`, update the first test to assert trigger kinds:

```ts
it("registers built-in triggers in product order", () => {
  expect(rendererAutomationTriggerRegistry.list().map((trigger) => ({
    id: trigger.manifest.id,
    kind: trigger.manifest.kind,
  }))).toEqual([
    { id: "builtin.cron", kind: "schedule" },
    { id: "builtin.interval", kind: "schedule" },
  ])
})
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/trigger-registry.test.ts \
  src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: FAIL because trigger manifests do not have `kind`, main definitions do not expose `runtime`, and the renderer manifest type does not include `kind`.

- [ ] **Step 4: Add shared trigger types**

Create `desktop/automation-trigger-packages/types.shared.ts`:

```ts
import type { ReactElement } from "react"
import type { z } from "zod"

import type { ActionStoredConfigValidation } from "../action-packages/types"

export type AutomationTriggerConfig = Record<string, unknown>

export type AutomationTriggerKind = "schedule" | "event" | "manual"

export type AutomationReschedulePolicy =
  | { readonly mode: "before_run" }
  | { readonly mode: "after_completion" }
  | { readonly mode: "none" }

export type AutomationTriggerManifest<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly id: string
  readonly title: string
  readonly kind: AutomationTriggerKind
  readonly defaultConfig: TConfig
  readonly configSchema: z.ZodType<TConfig>
}

export type AutomationScheduleInput<TConfig extends AutomationTriggerConfig> = {
  readonly config: TConfig
  readonly from: Date
  readonly createdAt: string
  readonly lastRunAt?: string
}

export type AutomationScheduleGuardInput<TConfig extends AutomationTriggerConfig> = {
  readonly config: TConfig
  readonly now: Date
}

export type AutomationTriggerEvent = {
  readonly source: string
  readonly type: string
  readonly payload: Record<string, unknown>
  readonly receivedAt: string
}

export type AutomationEventInput<TConfig extends AutomationTriggerConfig> = {
  readonly config: TConfig
  readonly event: AutomationTriggerEvent
}

export type AutomationTriggerRuntime<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  computeNextRunAt?(input: AutomationScheduleInput<TConfig>): Date | null
  shouldRunNow?(input: AutomationScheduleGuardInput<TConfig>): boolean
  shouldAcceptEvent?(input: AutomationEventInput<TConfig>): boolean
  getReschedulePolicy?(config: TConfig): AutomationReschedulePolicy
}

export type AutomationTriggerDefinition<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarize(config: TConfig): string
  validateStoredConfig?(config: unknown): ActionStoredConfigValidation
  readonly runtime: AutomationTriggerRuntime<TConfig>
}

export type AutomationTriggerConfigFormComponent<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = (props: {
  readonly value: TConfig
  readonly onChange: (value: TConfig) => void
}) => ReactElement

export type RendererAutomationTriggerDefinition<
  TConfig extends AutomationTriggerConfig = AutomationTriggerConfig,
> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: AutomationTriggerConfigFormComponent<TConfig>
}
```

- [ ] **Step 5: Update main trigger registry**

In `desktop/electron/services/automation/trigger-registry.ts`, replace local trigger type definitions with imports from the shared file:

```ts
import type {
  ActionStoredConfigValidation,
} from "../../../action-packages/types"
import type {
  AutomationTriggerConfig,
  AutomationTriggerDefinition,
} from "../../../automation-trigger-packages/types.shared"
import type { AutomationTriggerRef } from "./types"

export class AutomationTriggerRegistry {
  private readonly triggers = new Map<string, AutomationTriggerDefinition>()

  register<TConfig extends AutomationTriggerConfig>(
    trigger: AutomationTriggerDefinition<TConfig>,
  ): void {
    const id = trigger.manifest.id
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger as AutomationTriggerDefinition)
  }

  get(id: string): AutomationTriggerDefinition {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Automation trigger "${id}" is not registered`)
    }
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
    if (trigger.validateStoredConfig) {
      return trigger.validateStoredConfig(config)
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

export type {
  AutomationEventInput,
  AutomationReschedulePolicy,
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerConfig,
  AutomationTriggerDefinition,
  AutomationTriggerEvent,
  AutomationTriggerKind,
  AutomationTriggerManifest,
  AutomationTriggerRuntime,
} from "../../../automation-trigger-packages/types.shared"
```

- [ ] **Step 6: Update renderer trigger registry**

In `desktop/src/automation-triggers/action-registry.ts`, replace local type declarations with shared imports and exports:

```ts
import type {
  AutomationTriggerConfig,
  AutomationTriggerConfigFormComponent,
  AutomationTriggerManifest,
  RendererAutomationTriggerDefinition,
} from "../../automation-trigger-packages/types.shared"

export class RendererAutomationTriggerRegistry {
  private readonly triggers = new Map<string, RendererAutomationTriggerDefinition>()

  register<TConfig extends AutomationTriggerConfig>(
    trigger: RendererAutomationTriggerDefinition<TConfig>,
  ): void {
    const { id } = trigger.manifest
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger as RendererAutomationTriggerDefinition)
  }

  get(id: string): RendererAutomationTriggerDefinition {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Automation trigger "${id}" is not registered`)
    }
    return trigger
  }

  list(): readonly RendererAutomationTriggerDefinition[] {
    return [...this.triggers.values()]
  }

  getDefaultConfig(id: string): AutomationTriggerConfig {
    return this.get(id).manifest.defaultConfig
  }

  parseConfig(id: string, config: AutomationTriggerConfig): AutomationTriggerConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }

  summarize(id: string, config: AutomationTriggerConfig): string {
    const trigger = this.get(id)
    return trigger.summarizeConfig(trigger.manifest.configSchema.parse(config))
  }
}

export type {
  AutomationTriggerConfig,
  AutomationTriggerConfigFormComponent,
  AutomationTriggerManifest,
  RendererAutomationTriggerDefinition,
}
```

- [ ] **Step 7: Add temporary `kind` and `runtime` to built-ins**

In `desktop/electron/services/automation/builtin-triggers.ts`, add `kind: "schedule"` to both manifests and wrap existing `computeNextRunAt` functions under `runtime`.

The cron registration block should become:

```ts
registry.register({
  manifest: {
    id: "builtin.cron",
    title: "Cron",
    kind: "schedule",
    defaultConfig: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] },
    configSchema: cronTriggerSchema,
  },
  summarize: (config) => `Cron · ${config.expr}`,
  runtime: {
    computeNextRunAt: (input) => computeNextRunAt({
      trigger: { type: "builtin.cron", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    }),
  },
})
```

The interval registration block should become:

```ts
registry.register({
  manifest: {
    id: "builtin.interval",
    title: "固定间隔",
    kind: "schedule",
    defaultConfig: { everyMinutes: 60, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
    configSchema: intervalTriggerSchema,
  },
  summarize: (config) => config.anchor === "last_completed_at"
    ? `每 ${config.everyMinutes} 分钟 · 完成后`
    : `每 ${config.everyMinutes} 分钟`,
  runtime: {
    computeNextRunAt: (input) => computeNextRunAt({
      trigger: { type: "builtin.interval", config: input.config },
      from: input.from,
      createdAt: input.createdAt,
    }),
  },
})
```

In `desktop/automation-trigger-packages/builtin/cron/manifest.ts` and `desktop/automation-trigger-packages/builtin/interval/manifest.ts`, add `kind: "schedule"` to each manifest.

- [ ] **Step 8: Run focused tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/trigger-registry.test.ts \
  src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add \
  desktop/automation-trigger-packages/types.shared.ts \
  desktop/automation-trigger-packages/builtin/cron/manifest.ts \
  desktop/automation-trigger-packages/builtin/interval/manifest.ts \
  desktop/electron/services/automation/trigger-registry.ts \
  desktop/electron/services/automation/builtin-triggers.ts \
  desktop/electron/services/automation/__tests__/trigger-registry.test.ts \
  desktop/src/automation-triggers/action-registry.ts \
  desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx
git commit -m "refactor(automation): define trigger platform contracts"
```

---

### Task 2: Move Built-In Trigger Runtime Into Packages

**Files:**

- Create: `desktop/automation-trigger-packages/builtin/cron/runtime.main.ts`
- Create: `desktop/automation-trigger-packages/builtin/cron/index.shared.ts`
- Create: `desktop/automation-trigger-packages/builtin/cron/index.main.ts`
- Create: `desktop/automation-trigger-packages/builtin/cron/index.renderer.ts`
- Modify: `desktop/automation-trigger-packages/builtin/cron/index.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/runtime.main.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/index.shared.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/index.main.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/index.renderer.ts`
- Modify: `desktop/automation-trigger-packages/builtin/interval/index.ts`
- Modify: `desktop/electron/services/automation/builtin-triggers.ts`
- Modify: `desktop/src/automation-triggers/builtin-triggers.ts`
- Test: `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`
- Test: `desktop/electron/services/automation/__tests__/schedule-calculator.test.ts`
- Test: `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`

- [ ] **Step 1: Add failing package ownership assertions**

In `desktop/electron/services/automation/__tests__/trigger-registry.test.ts`, add:

```ts
import { cronTriggerDefinition } from "../../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerDefinition } from "../../../../automation-trigger-packages/builtin/interval/index.main"

it("exports built-in main trigger definitions from trigger packages", () => {
  expect(cronTriggerDefinition.manifest.id).toBe("builtin.cron")
  expect(cronTriggerDefinition.manifest.kind).toBe("schedule")
  expect(cronTriggerDefinition.runtime.computeNextRunAt).toBeTypeOf("function")

  expect(intervalTriggerDefinition.manifest.id).toBe("builtin.interval")
  expect(intervalTriggerDefinition.manifest.kind).toBe("schedule")
  expect(intervalTriggerDefinition.runtime.getReschedulePolicy?.({
    everyMinutes: 60,
    anchor: "last_completed_at",
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  })).toEqual({ mode: "after_completion" })
})
```

In `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`, add:

```tsx
import { cronRendererTriggerDefinition } from "../../../automation-trigger-packages/builtin/cron/index.renderer"
import { intervalRendererTriggerDefinition } from "../../../automation-trigger-packages/builtin/interval/index.renderer"

it("exports built-in renderer trigger definitions from trigger packages", () => {
  expect(cronRendererTriggerDefinition.manifest.id).toBe("builtin.cron")
  expect(cronRendererTriggerDefinition.ConfigForm).toBeTypeOf("function")

  expect(intervalRendererTriggerDefinition.manifest.id).toBe("builtin.interval")
  expect(intervalRendererTriggerDefinition.ConfigForm).toBeTypeOf("function")
})
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/trigger-registry.test.ts \
  src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: FAIL because `index.main.ts` and `index.renderer.ts` files do not exist.

- [ ] **Step 3: Create cron shared exports**

Create `desktop/automation-trigger-packages/builtin/cron/index.shared.ts`:

```ts
export { cronTriggerManifest } from "./manifest"
export {
  cronTriggerConfigSchema,
  type CronTriggerConfig,
} from "./schema"

export function summarizeCronTriggerConfig(config: { readonly expr: string }): string {
  return `Cron · ${config.expr}`
}
```

- [ ] **Step 4: Create cron main runtime**

Create `desktop/automation-trigger-packages/builtin/cron/runtime.main.ts`:

```ts
import { nextCronRun } from "../../../electron/services/task-scheduler/cron-expression"
import type {
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { CronTriggerConfig } from "./schema"

export const cronTriggerRuntime: AutomationTriggerRuntime<CronTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<CronTriggerConfig>): Date {
    return nextCronRun(input.config.expr, input.from, input.config.timezone)
  },
  shouldRunNow(input: AutomationScheduleGuardInput<CronTriggerConfig>): boolean {
    return isActiveDay(input.now, input.config)
  },
  getReschedulePolicy: () => ({ mode: "before_run" }),
}

function isActiveDay(date: Date, config: CronTriggerConfig): boolean {
  if (config.activeDays.length >= 7) return true
  const weekday = config.timezone ? weekdayForTimezone(date, config.timezone) : date.getDay()
  return config.activeDays.includes(weekday)
}

function weekdayForTimezone(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(date)
  const weekdayStr = parts.find((part) => part.type === "weekday")?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekdayStr] ?? date.getDay()
}
```

- [ ] **Step 5: Create cron main definition**

Create `desktop/automation-trigger-packages/builtin/cron/index.main.ts`:

```ts
import type { AutomationTriggerDefinition } from "../../types.shared"
import {
  cronTriggerManifest,
  summarizeCronTriggerConfig,
  type CronTriggerConfig,
} from "./index.shared"
import { cronTriggerRuntime } from "./runtime.main"

export const cronTriggerDefinition = {
  manifest: cronTriggerManifest,
  summarize: summarizeCronTriggerConfig,
  runtime: cronTriggerRuntime,
} satisfies AutomationTriggerDefinition<CronTriggerConfig>
```

- [ ] **Step 6: Create cron renderer definition**

Create `desktop/automation-trigger-packages/builtin/cron/index.renderer.ts`:

```ts
import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { CronTriggerConfigForm } from "./config.renderer"
import {
  cronTriggerManifest,
  summarizeCronTriggerConfig,
  type CronTriggerConfig,
} from "./index.shared"

export const cronRendererTriggerDefinition = {
  manifest: cronTriggerManifest,
  summarizeConfig: summarizeCronTriggerConfig,
  ConfigForm: CronTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<CronTriggerConfig>
```

Modify `desktop/automation-trigger-packages/builtin/cron/index.ts` to keep compatibility for current renderer imports:

```ts
export { cronRendererTriggerDefinition } from "./index.renderer"
export { CronTriggerConfigForm } from "./config.renderer"
export { cronTriggerManifest } from "./manifest"
export {
  cronTriggerConfigSchema,
  type CronTriggerConfig,
} from "./schema"
```

- [ ] **Step 7: Create interval shared exports**

Create `desktop/automation-trigger-packages/builtin/interval/index.shared.ts`:

```ts
export { intervalTriggerManifest } from "./manifest"
export {
  intervalTriggerConfigSchema,
  type IntervalTriggerConfig,
} from "./schema"

export function summarizeIntervalTriggerConfig(config: {
  readonly everyMinutes: number
  readonly anchor: "created_at" | "last_completed_at"
}): string {
  return config.anchor === "last_completed_at"
    ? `每 ${config.everyMinutes} 分钟 · 完成后`
    : `每 ${config.everyMinutes} 分钟`
}
```

- [ ] **Step 8: Create interval main runtime**

Create `desktop/automation-trigger-packages/builtin/interval/runtime.main.ts`:

```ts
import type {
  AutomationScheduleGuardInput,
  AutomationScheduleInput,
  AutomationTriggerRuntime,
} from "../../types.shared"
import type { IntervalTriggerConfig } from "./schema"

export const intervalTriggerRuntime: AutomationTriggerRuntime<IntervalTriggerConfig> = {
  computeNextRunAt(input: AutomationScheduleInput<IntervalTriggerConfig>): Date {
    const everyMs = input.config.everyMinutes * 60_000
    if (input.config.anchor === "last_completed_at") {
      return new Date(input.from.getTime() + everyMs)
    }
    const anchor = new Date(input.createdAt).getTime()
    const from = input.from.getTime()
    const elapsed = Math.max(0, from - anchor)
    const steps = Math.floor(elapsed / everyMs) + 1
    return new Date(anchor + steps * everyMs)
  },
  shouldRunNow(input: AutomationScheduleGuardInput<IntervalTriggerConfig>): boolean {
    if (input.config.activeDays.length >= 7) return true
    return input.config.activeDays.includes(input.now.getDay())
  },
  getReschedulePolicy(config: IntervalTriggerConfig) {
    return config.anchor === "last_completed_at"
      ? { mode: "after_completion" as const }
      : { mode: "before_run" as const }
  },
}
```

- [ ] **Step 9: Create interval main and renderer definitions**

Create `desktop/automation-trigger-packages/builtin/interval/index.main.ts`:

```ts
import type { AutomationTriggerDefinition } from "../../types.shared"
import {
  intervalTriggerManifest,
  summarizeIntervalTriggerConfig,
  type IntervalTriggerConfig,
} from "./index.shared"
import { intervalTriggerRuntime } from "./runtime.main"

export const intervalTriggerDefinition = {
  manifest: intervalTriggerManifest,
  summarize: summarizeIntervalTriggerConfig,
  runtime: intervalTriggerRuntime,
} satisfies AutomationTriggerDefinition<IntervalTriggerConfig>
```

Create `desktop/automation-trigger-packages/builtin/interval/index.renderer.ts`:

```ts
import type { RendererAutomationTriggerDefinition } from "../../types.shared"
import { IntervalTriggerConfigForm } from "./config.renderer"
import {
  intervalTriggerManifest,
  summarizeIntervalTriggerConfig,
  type IntervalTriggerConfig,
} from "./index.shared"

export const intervalRendererTriggerDefinition = {
  manifest: intervalTriggerManifest,
  summarizeConfig: summarizeIntervalTriggerConfig,
  ConfigForm: IntervalTriggerConfigForm,
} satisfies RendererAutomationTriggerDefinition<IntervalTriggerConfig>
```

Modify `desktop/automation-trigger-packages/builtin/interval/index.ts`:

```ts
export { intervalRendererTriggerDefinition } from "./index.renderer"
export { IntervalTriggerConfigForm } from "./config.renderer"
export { intervalTriggerManifest } from "./manifest"
export {
  intervalTriggerConfigSchema,
  type IntervalTriggerConfig,
} from "./schema"
```

- [ ] **Step 10: Register package definitions**

Replace `desktop/electron/services/automation/builtin-triggers.ts` with:

```ts
import { cronTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/cron"
import { cronTriggerDefinition } from "../../../automation-trigger-packages/builtin/cron/index.main"
import { intervalTriggerConfigSchema } from "../../../automation-trigger-packages/builtin/interval"
import { intervalTriggerDefinition } from "../../../automation-trigger-packages/builtin/interval/index.main"
import { AutomationTriggerRegistry } from "./trigger-registry"

export { cronTriggerConfigSchema, intervalTriggerConfigSchema }

export function createBuiltinAutomationTriggerRegistry(): AutomationTriggerRegistry {
  const registry = new AutomationTriggerRegistry()
  registry.register(cronTriggerDefinition)
  registry.register(intervalTriggerDefinition)
  return registry
}
```

Replace the definition construction in `desktop/src/automation-triggers/builtin-triggers.ts` with:

```ts
import { cronRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/cron/index.renderer"
import { intervalRendererTriggerDefinition } from "../../automation-trigger-packages/builtin/interval/index.renderer"
import { RendererAutomationTriggerRegistry } from "./action-registry"

export const rendererAutomationTriggerRegistry = new RendererAutomationTriggerRegistry()
rendererAutomationTriggerRegistry.register(cronRendererTriggerDefinition)
rendererAutomationTriggerRegistry.register(intervalRendererTriggerDefinition)
```

- [ ] **Step 11: Run focused tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/trigger-registry.test.ts \
  electron/services/automation/__tests__/schedule-calculator.test.ts \
  src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: PASS.

- [ ] **Step 12: Commit**

Run:

```bash
git add \
  desktop/automation-trigger-packages/builtin/cron \
  desktop/automation-trigger-packages/builtin/interval \
  desktop/electron/services/automation/builtin-triggers.ts \
  desktop/electron/services/automation/__tests__/trigger-registry.test.ts \
  desktop/src/automation-triggers/builtin-triggers.ts \
  desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx
git commit -m "refactor(automation): move built-in triggers into packages"
```

---

### Task 3: Remove Trigger Type Branches From Core Scheduling

**Files:**

- Modify: `desktop/electron/services/automation/automation-service.ts`
- Modify: `desktop/electron/services/automation/item-repository.ts`
- Test: `desktop/electron/services/automation/__tests__/automation-service.test.ts`
- Test: `desktop/electron/services/automation/__tests__/item-repository.test.ts`

- [ ] **Step 1: Add fake schedule trigger helpers to service tests**

In `desktop/electron/services/automation/__tests__/automation-service.test.ts`, import the registry type:

```ts
import { AutomationTriggerRegistry } from "../trigger-registry"
```

Add this helper near `createHarness`:

```ts
function fakeScheduleTriggerRegistry(): AutomationTriggerRegistry {
  const registry = createBuiltinAutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.fake-schedule",
      title: "Fake Schedule",
      kind: "schedule",
      defaultConfig: { enabled: true },
      configSchema: z.object({ enabled: z.boolean() }),
    },
    summarize: () => "Fake Schedule",
    runtime: {
      computeNextRunAt: () => new Date("2026-06-03T00:05:00.000Z"),
      shouldRunNow: ({ config }) => config.enabled,
      getReschedulePolicy: () => ({ mode: "after_completion" }),
    },
  })
  return registry
}
```

Update `createHarness` options to accept triggers:

```ts
function createHarness(options: {
  readonly action?: MainActionDefinition<TestActionConfig>
  readonly logger?: StructuredLogger
  readonly eventBus?: Pick<EventBus, "emit">
  readonly triggers?: AutomationTriggerRegistry
} = {}) {
  const triggers = options.triggers ?? createBuiltinAutomationTriggerRegistry()
```

- [ ] **Step 2: Add failing core decoupling tests**

Add these tests to `desktop/electron/services/automation/__tests__/automation-service.test.ts`:

```ts
it("schedules a package-defined trigger without core type branches", async () => {
  const harness = createHarness({ triggers: fakeScheduleTriggerRegistry() })
  const item = await harness.service.automationCreate({
    name: "Fake schedule",
    scope: { type: "global" },
    trigger: { type: "builtin.fake-schedule", config: { enabled: true } },
    executor: { type: "builtin.test", config: { message: "ok" } },
  })

  await harness.service.start()

  expect(item.nextRunAt).toBe("2026-06-03T00:05:00.000Z")
  expect(harness.service.automationRuntimeInspect().timers).toContain(item.id)
  await harness.service.stop()
})

it("uses trigger runtime guard instead of activeDays from core", async () => {
  const harness = createHarness({ triggers: fakeScheduleTriggerRegistry() })
  const item = await harness.service.automationCreate({
    name: "Guarded fake schedule",
    scope: { type: "global" },
    trigger: { type: "builtin.fake-schedule", config: { enabled: false } },
    executor: { type: "builtin.test", config: { message: "ok" } },
  })

  const run = await harness.service.triggerForTest(item.id, "trigger")

  expect(run?.status).toBe("skipped")
  expect(run?.error).toBe("trigger runtime guard skipped run")
})

it("reschedules after completion when trigger policy requests it", async () => {
  const harness = createHarness({ triggers: fakeScheduleTriggerRegistry() })
  const item = await harness.service.automationCreate({
    name: "Completion anchored fake schedule",
    scope: { type: "global" },
    trigger: { type: "builtin.fake-schedule", config: { enabled: true } },
    executor: { type: "builtin.test", config: { message: "ok" } },
  })

  const run = await harness.service.triggerForTest(item.id, "trigger")
  const stored = await harness.items.get(item.id)

  expect(run?.status).toBe("success")
  expect(stored?.nextRunAt).toBe("2026-06-03T00:05:00.000Z")
})
```

In `desktop/electron/services/automation/__tests__/item-repository.test.ts`, add a fake trigger registry helper and this failing test:

```ts
it("recomputes next run after completion using trigger reschedule policy", async () => {
  const registry = createBuiltinAutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.fake-after-completion",
      title: "Fake After Completion",
      kind: "schedule",
      defaultConfig: { value: "ok" },
      configSchema: z.object({ value: z.string() }),
    },
    summarize: () => "Fake After Completion",
    runtime: {
      computeNextRunAt: () => new Date("2026-06-03T00:15:00.000Z"),
      getReschedulePolicy: () => ({ mode: "after_completion" }),
    },
  })
  const repo = new AutomationItemRepository({
    items: new MemoryNamespace<AutomationItem>("automation.items"),
    triggers: registry,
    now: () => new Date("2026-06-03T00:00:00.000Z"),
    idFactory: () => "automation:1",
  })
  const item = await repo.create({
    name: "Fake",
    scope: { type: "global" },
    trigger: { type: "builtin.fake-after-completion", config: { value: "ok" } },
    executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
  })

  const result = await repo.markRunResult(item.id, { status: "success" })

  expect(result?.nextRunAt).toBe("2026-06-03T00:15:00.000Z")
})
```

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/automation-service.test.ts \
  electron/services/automation/__tests__/item-repository.test.ts
```

Expected: FAIL because `AutomationService` still uses core `activeDays` and interval branches, and `AutomationItemRepository.markRunResult` only recomputes for `builtin.interval`.

- [ ] **Step 4: Update repository next-run logic**

In `desktop/electron/services/automation/item-repository.ts`, replace `computeNextRunAt` with nullable schedule behavior:

```ts
private computeNextRunAt(item: AutomationItem, from: Date): Date | null {
  const trigger = this.triggers.get(item.trigger.type)
  if (trigger.manifest.kind !== "schedule") {
    return null
  }
  if (!trigger.runtime.computeNextRunAt) {
    throw new Error(`Automation trigger "${item.trigger.type}" does not support scheduling`)
  }
  return trigger.runtime.computeNextRunAt({
    config: item.trigger.config,
    from,
    createdAt: item.createdAt,
    lastRunAt: item.lastRunAt,
  })
}
```

Replace each `this.computeNextRunAt(...).toISOString()` use with a helper:

```ts
private computeNextRunAtIso(item: AutomationItem, from: Date): string | undefined {
  return this.computeNextRunAt(item, from)?.toISOString()
}
```

In `create`, `update`, and `setEnabled`, use:

```ts
nextRunAt: enabled ? this.computeNextRunAtIso(item, this.now()) : undefined,
```

In `markRunResult`, replace `recalcNextRunAt` with trigger policy:

```ts
const trigger = this.triggers.get(existing.trigger.type)
const recalcNextRunAt = existing.enabled &&
  trigger.runtime.getReschedulePolicy?.(trigger.manifest.configSchema.parse(existing.trigger.config)).mode ===
    "after_completion"
```

When recomputing, use:

```ts
const nextRunAt = recalcNextRunAt ? this.computeNextRunAtIso(next, this.now()) : existing.nextRunAt
return {
  ...next,
  ...(recalcNextRunAt ? { nextRunAt } : {}),
}
```

- [ ] **Step 5: Update service schedule logic**

In `desktop/electron/services/automation/automation-service.ts`, replace `resolveNextRunAt` with:

```ts
private resolveNextRunAt(item: AutomationItem, preferredNextRunAt?: string): Date | null {
  if (preferredNextRunAt) {
    const preferred = new Date(preferredNextRunAt)
    if (preferred.getTime() > this.now().getTime()) return preferred
  }
  const trigger = this.deps.triggers.get(item.trigger.type)
  if (trigger.manifest.kind !== "schedule") return null
  if (!trigger.runtime.computeNextRunAt) {
    throw new Error(`Automation trigger "${item.trigger.type}" does not support scheduling`)
  }
  return trigger.runtime.computeNextRunAt({
    config: item.trigger.config,
    from: this.now(),
    createdAt: item.createdAt,
    lastRunAt: item.lastRunAt,
  })
}
```

In `schedule`, after resolving next run, add:

```ts
if (!nextRunAt) {
  await this.deps.items.markScheduled(id, undefined)
  return
}
```

Replace `isActiveToday` use in `runScheduled` with package runtime guard:

```ts
const trigger = this.deps.triggers.get(item.trigger.type)
const parsedTriggerConfig = trigger.manifest.configSchema.parse(item.trigger.config)
if (trigger.runtime.shouldRunNow && !trigger.runtime.shouldRunNow({
  config: parsedTriggerConfig,
  now: this.now(),
})) {
  await this.schedule(id)
  return this.recordSkipped(item, triggeredBy, "trigger runtime guard skipped run")
}
const reschedulePolicy = trigger.runtime.getReschedulePolicy?.(parsedTriggerConfig) ?? { mode: "before_run" as const }
const deferSchedule = reschedulePolicy.mode === "after_completion"
if (triggeredBy === "trigger" && reschedulePolicy.mode === "before_run") await this.schedule(id)
```

Remove `isActiveToday` and `getWeekdayForDate` from the bottom of the file.

- [ ] **Step 6: Run focused tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/automation-service.test.ts \
  electron/services/automation/__tests__/item-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Check no concrete trigger branches remain in Automation Core**

Run:

```bash
rg -n 'builtin\\.cron|builtin\\.interval|activeDays|last_completed_at' \
  desktop/electron/services/automation/automation-service.ts \
  desktop/electron/services/automation/item-repository.ts
```

Expected: no matches.

- [ ] **Step 8: Commit**

Run:

```bash
git add \
  desktop/electron/services/automation/automation-service.ts \
  desktop/electron/services/automation/item-repository.ts \
  desktop/electron/services/automation/__tests__/automation-service.test.ts \
  desktop/electron/services/automation/__tests__/item-repository.test.ts
git commit -m "refactor(automation): delegate schedule behavior to triggers"
```

---

### Task 4: Generic Automation IPC Trigger Validation

**Files:**

- Modify: `desktop/electron/modules/automation/ipc.ts`
- Test: `desktop/electron/modules/automation/__tests__/ipc.test.ts`

- [ ] **Step 1: Add failing IPC generic trigger test**

In `desktop/electron/modules/automation/__tests__/ipc.test.ts`, add:

```ts
it("accepts generic trigger refs without editing IPC schemas per trigger", async () => {
  const service = {
    automationCreate: vi.fn(async (input) => automationItem({
      ...defaultAutomationInput(),
      trigger: input.trigger,
      enabled: input.enabled ?? true,
    })),
  }
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.automation") return service as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(automationIpcModule, { moduleId: "automation", resolve })

  await harness.invoke("synapse:automation:items:create", {
    ...defaultAutomationInput(),
    trigger: {
      type: "builtin.fake-event",
      config: { source: "test", value: 1 },
    },
  })

  expect(service.automationCreate).toHaveBeenCalledWith(expect.objectContaining({
    trigger: {
      type: "builtin.fake-event",
      config: { source: "test", value: 1 },
    },
  }))
})
```

- [ ] **Step 2: Run IPC test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/automation/__tests__/ipc.test.ts
```

Expected: FAIL because the current `automationTriggerSchema` is a discriminated union of only cron and interval.

- [ ] **Step 3: Replace trigger schema**

In `desktop/electron/modules/automation/ipc.ts`, delete `activeDaysSchema` if it becomes unused and replace `automationTriggerSchema` with:

```ts
const automationTriggerSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})
```

Keep `automationExecutorSchema` as:

```ts
const automationExecutorSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
})
```

- [ ] **Step 4: Run IPC test and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/automation/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add desktop/electron/modules/automation/ipc.ts desktop/electron/modules/automation/__tests__/ipc.test.ts
git commit -m "refactor(automation): accept generic trigger refs over IPC"
```

---

### Task 5: Remove Hard-Coded Renderer Form Path

**Files:**

- Delete: `desktop/src/modules/automation/components/automation-form-dialog.tsx`
- Modify: `desktop/src/modules/automation/types.ts`
- Modify: `desktop/src/modules/automation/utils.ts`
- Test: `desktop/src/modules/automation/__tests__/automation-module.test.tsx`
- Test: `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
- Test: `desktop/src/modules/automation/hooks/__tests__/use-automation.test.tsx`

- [ ] **Step 1: Add failing absence test**

In `desktop/src/modules/automation/__tests__/automation-module.test.tsx`, add:

```tsx
it("does not render the legacy automation form dialog", () => {
  render(<AutomationModule />)

  expect(document.querySelector('[data-track="automation-form-dialog"]')).toBeNull()
})
```

- [ ] **Step 2: Run renderer tests and verify current behavior**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/automation/__tests__/automation-module.test.tsx \
  src/modules/automation/editor/__tests__/editor-app.test.tsx
```

Expected: PASS or FAIL depending on existing mocks. If PASS, still continue; the next steps remove dead hard-coded code and TypeScript will catch hidden imports.

- [ ] **Step 3: Remove dialog-only types**

In `desktop/src/modules/automation/types.ts`, replace the file content with:

```ts
import type { ActionConfig } from "../../../action-packages/types"

type AutomationEditorMode =
  | { mode: "create" }
  | { mode: "edit"; automationId: string }

type AutomationEditorDraft = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  triggerType: string | null
  triggerConfig: Record<string, unknown>
  executorType: string | null
  executorConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}

type AutomationEditorLoadState =
  | { status: "loading" }
  | { status: "ready"; draft: AutomationEditorDraft; item?: import("@/types/automation").AutomationItem }
  | { status: "error"; message: string }

export type {
  AutomationEditorDraft,
  AutomationEditorLoadState,
  AutomationEditorMode,
}
```

If the inline `import("@/types/automation").AutomationItem` style is rejected by lint or local convention, use a normal top-level type import:

```ts
import type { AutomationItem } from "@/types/automation"
```

and set the ready state to:

```ts
| { status: "ready"; draft: AutomationEditorDraft; item?: AutomationItem }
```

- [ ] **Step 4: Remove hard-coded form utilities**

In `desktop/src/modules/automation/utils.ts`, remove:

- `DEFAULT_EXECUTOR_TYPE`
- `DEFAULT_ACTIVE_DAYS`
- `DEFAULT_AUTOMATION_FORM_STATE`
- `createAutomationFormState`
- `createDefaultExecutorConfig`
- `buildAutomationCreateInput`
- `buildAutomationUpdateInput`
- `buildAutomationPayload`
- `readActiveDays`
- `readPositiveInteger`

Keep:

- `buildAutomationCreateInputFromDraft`
- `buildAutomationUpdateInputFromDraft`
- `createAutomationDraftFromItem`
- `createDefaultAutomationDraft`
- `generateAutomationDraftName`
- `formatAutomationDate`
- `formatAutomationExecutor`
- `formatAutomationNextRun`
- `formatAutomationRunStatus`
- `formatAutomationScope`
- `formatAutomationStatus`
- `formatAutomationTrigger`

The export block must become:

```ts
export {
  buildAutomationCreateInputFromDraft,
  buildAutomationUpdateInputFromDraft,
  createAutomationDraftFromItem,
  createDefaultAutomationDraft,
  generateAutomationDraftName,
  formatAutomationDate,
  formatAutomationExecutor,
  formatAutomationNextRun,
  formatAutomationRunStatus,
  formatAutomationScope,
  formatAutomationStatus,
  formatAutomationTrigger,
}
```

- [ ] **Step 5: Delete legacy dialog file**

Delete `desktop/src/modules/automation/components/automation-form-dialog.tsx`.

Run:

```bash
rg -n 'AutomationFormDialog|AutomationFormState|createAutomationFormState|buildAutomationCreateInput\\(|buildAutomationUpdateInput\\(' desktop/src/modules/automation
```

Expected: no matches.

- [ ] **Step 6: Run renderer tests and TypeScript-relevant test files**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/modules/automation/__tests__/automation-module.test.tsx \
  src/modules/automation/editor/__tests__/editor-app.test.tsx \
  src/modules/automation/hooks/__tests__/use-automation.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add \
  desktop/src/modules/automation/types.ts \
  desktop/src/modules/automation/utils.ts \
  desktop/src/modules/automation/components/automation-form-dialog.tsx \
  desktop/src/modules/automation/__tests__/automation-module.test.tsx
git commit -m "refactor(automation): remove legacy hard-coded form"
```

---

### Task 6: Add Internal Event Ingress Boundary

**Files:**

- Modify: `desktop/electron/services/automation/types.ts`
- Modify: `desktop/electron/services/automation/automation-service.ts`
- Test: `desktop/electron/services/automation/__tests__/automation-service.test.ts`

- [ ] **Step 1: Add failing event trigger test**

In `desktop/electron/services/automation/__tests__/automation-service.test.ts`, add this helper:

```ts
function fakeEventTriggerRegistry(): AutomationTriggerRegistry {
  const registry = createBuiltinAutomationTriggerRegistry()
  registry.register({
    manifest: {
      id: "builtin.fake-event",
      title: "Fake Event",
      kind: "event",
      defaultConfig: { eventType: "demo.created" },
      configSchema: z.object({ eventType: z.string().min(1) }),
    },
    summarize: (config) => `Event · ${config.eventType}`,
    runtime: {
      shouldAcceptEvent: ({ config, event }) => event.type === config.eventType,
    },
  })
  return registry
}
```

Add the test:

```ts
it("accepts events through trigger runtime matching", async () => {
  const harness = createHarness({ triggers: fakeEventTriggerRegistry() })
  const item = await harness.service.automationCreate({
    name: "Event automation",
    scope: { type: "global" },
    trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
    executor: { type: "builtin.test", config: { message: "ok" } },
  })

  const runs = await harness.service.acceptEvent({
    source: "test",
    type: "demo.created",
    payload: { id: "1" },
    receivedAt: "2026-06-03T00:00:00.000Z",
  })

  expect(runs).toHaveLength(1)
  expect(runs[0]).toEqual(expect.objectContaining({
    automationId: item.id,
    status: "success",
    triggeredBy: "trigger",
  }))
})

it("ignores events that trigger runtime rejects", async () => {
  const harness = createHarness({ triggers: fakeEventTriggerRegistry() })
  await harness.service.automationCreate({
    name: "Event automation",
    scope: { type: "global" },
    trigger: { type: "builtin.fake-event", config: { eventType: "demo.created" } },
    executor: { type: "builtin.test", config: { message: "ok" } },
  })

  const runs = await harness.service.acceptEvent({
    source: "test",
    type: "demo.deleted",
    payload: { id: "1" },
    receivedAt: "2026-06-03T00:00:00.000Z",
  })

  expect(runs).toEqual([])
})
```

- [ ] **Step 2: Run service test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/automation-service.test.ts
```

Expected: FAIL because `AutomationService.acceptEvent` does not exist.

- [ ] **Step 3: Export event type from service types**

In `desktop/electron/services/automation/types.ts`, add:

```ts
export type {
  AutomationTriggerEvent,
} from "../../../automation-trigger-packages/types.shared"
```

- [ ] **Step 4: Implement `acceptEvent`**

In `desktop/electron/services/automation/automation-service.ts`, import the event type:

```ts
import type {
  AutomationTriggerEvent,
} from "../../../automation-trigger-packages/types.shared"
```

Add this public method to `AutomationService`:

```ts
async acceptEvent(event: AutomationTriggerEvent): Promise<AutomationRun[]> {
  const items = await this.deps.items.list()
  const acceptedRuns: AutomationRun[] = []
  for (const item of items) {
    if (!item.enabled) continue
    if (!this.isItemValid(item)) continue
    const trigger = this.deps.triggers.get(item.trigger.type)
    if (trigger.manifest.kind !== "event") continue
    if (!trigger.runtime.shouldAcceptEvent) continue
    const config = trigger.manifest.configSchema.parse(item.trigger.config)
    const accepted = trigger.runtime.shouldAcceptEvent({ config, event })
    if (!accepted) continue
    const run = await this.executeOrSkip(item, "trigger")
    acceptedRuns.push(run)
  }
  return acceptedRuns
}
```

Do not add new logging in this task. The test-only event boundary must not log `event.payload`.

- [ ] **Step 5: Run service test and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/automation/__tests__/automation-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add \
  desktop/electron/services/automation/types.ts \
  desktop/electron/services/automation/automation-service.ts \
  desktop/electron/services/automation/__tests__/automation-service.test.ts
git commit -m "refactor(automation): add event trigger ingress boundary"
```

---

### Task 7: Boundary Regression And Full Verification

**Files:**

- Modify: `docs/superpowers/specs/2026-06-04-automation-extension-platform-design.md` only if implementation revealed a necessary spec correction.
- Test-only verification across Automation, Task Scheduler, IPC, and renderer.

- [ ] **Step 1: Verify no concrete trigger branches remain in core**

Run:

```bash
rg -n 'builtin\\.cron|builtin\\.interval|activeDays|last_completed_at|Cron|固定间隔' \
  desktop/electron/services/automation/automation-service.ts \
  desktop/electron/services/automation/item-repository.ts \
  desktop/electron/modules/automation/ipc.ts \
  desktop/src/modules/automation/editor/trigger-executor-builder.tsx
```

Expected: no matches.

- [ ] **Step 2: Verify trigger-specific behavior is package-local**

Run:

```bash
rg -n 'builtin\\.cron|builtin\\.interval|activeDays|last_completed_at|Cron|固定间隔' \
  desktop/automation-trigger-packages \
  desktop/electron/services/automation/builtin-triggers.ts \
  desktop/src/automation-triggers/builtin-triggers.ts
```

Expected: matches only in trigger packages and trigger registration files.

- [ ] **Step 3: Run Automation main-process tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/automation/__tests__/trigger-registry.test.ts \
  electron/services/automation/__tests__/schedule-calculator.test.ts \
  electron/services/automation/__tests__/item-repository.test.ts \
  electron/services/automation/__tests__/run-repository.test.ts \
  electron/services/automation/__tests__/execution-service.test.ts \
  electron/services/automation/__tests__/automation-service.test.ts \
  electron/modules/automation/__tests__/ipc.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run Automation renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  src/automation-triggers/__tests__/trigger-registry.test.tsx \
  src/modules/automation/__tests__/automation-module.test.tsx \
  src/modules/automation/editor/__tests__/editor-app.test.tsx \
  src/modules/automation/hooks/__tests__/use-automation.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run Task Scheduler regression tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts \
  electron/services/task-scheduler/__tests__/execution-service.test.ts \
  electron/services/task-scheduler/__tests__/schedule-calculator.test.ts \
  electron/services/task-scheduler/__tests__/cron-expression.test.ts \
  electron/modules/task-scheduler/__tests__/ipc.test.ts \
  src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx \
  src/modules/task-scheduler/__tests__/cron-utils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run hard constraints and desktop test suite**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run test
```

Expected: both commands PASS.

- [ ] **Step 7: Verify release notes stay unchanged**

This plan is an internal architecture refactor with unchanged user-facing behavior. Do not edit `RELEASE_NOTES_PENDING.md` during this plan.

- [ ] **Step 8: Commit final verification adjustments**

If Step 6 required small test or spec adjustments, commit them:

```bash
git add docs/superpowers/specs/2026-06-04-automation-extension-platform-design.md
git commit -m "docs: record automation platform verification"
```

If there are no changes after verification, skip this commit.

---

## Plan Self-Review

Spec coverage:

- Platform trigger contracts are covered by Task 1.
- Cron and interval package ownership is covered by Task 2.
- Core runtime decoupling is covered by Task 3.
- Generic IPC validation is covered by Task 4.
- Registry-driven renderer cleanup is covered by Task 5.
- Event ingress boundary is covered by Task 6.
- Automation and Task Scheduler regression coverage is covered by Task 7.

Placeholder scan:

- This plan intentionally avoids incomplete code placeholders.
- All new files have concrete content blocks.
- Each task has explicit commands and expected results.

Type consistency:

- Shared trigger types use `AutomationTriggerDefinition`, `AutomationTriggerRuntime`, `AutomationTriggerEvent`, and `AutomationReschedulePolicy`.
- Main registry and renderer registry both import from `desktop/automation-trigger-packages/types.shared.ts`.
- Trigger package definitions use `index.main.ts` and `index.renderer.ts`.
- Core service method is named `acceptEvent(event: AutomationTriggerEvent): Promise<AutomationRun[]>`, matching the spec.
