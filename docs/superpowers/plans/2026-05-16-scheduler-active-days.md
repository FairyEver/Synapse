# Scheduler Active Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "day of week" constraint (`activeDays`) to scheduled tasks that acts as a high-priority gate independent of cron/interval scheduling.

**Architecture:** `activeDays` is a top-level field on `ScheduledTaskEntry`. The schedule calculator filters candidate times through this constraint. The UI presents 7 toggle buttons (Mon–Sun) in the trigger section. MCP create/update accept the field optionally.

**Tech Stack:** TypeScript, Vitest, React, shadcn/ui Toggle components

---

### Task 1: Add `activeDays` to type definitions

**Files:**
- Modify: `desktop/electron/services/task-scheduler/types.ts:35-68`
- Modify: `desktop/src/types/task-scheduler.ts:21-51`

- [ ] **Step 1: Add `activeDays` to internal `ScheduledTaskEntryV2`**

In `desktop/electron/services/task-scheduler/types.ts`, add the field to the interface:

```typescript
export interface ScheduledTaskEntryV2 extends Record<string, unknown> {
  readonly id: string
  readonly schemaVersion: 2
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskActionRef
  readonly enabled: boolean
  readonly activeDays: readonly number[]  // 0=Sun, 1=Mon ... 6=Sat
  readonly missedRunPolicy: "skip" | "run_once"
  readonly overlapPolicy: "skip"
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt?: string
  readonly lastRunAt?: string
  readonly lastStatus?: ScheduledTaskStatus
  readonly activeRun?: ScheduledTaskActiveRun
  readonly runCount: number
  readonly configVersion: number
}
```

Add `activeDays` to `ScheduledTaskCreateInput` and `ScheduledTaskUpdateInput`:

```typescript
export interface ScheduledTaskCreateInput {
  readonly name: string
  readonly description?: string
  readonly scope: TaskScope
  readonly cwd?: string
  readonly trigger: TaskTrigger
  readonly action: TaskActionRef
  readonly enabled?: boolean
  readonly activeDays?: readonly number[]
  readonly missedRunPolicy?: "skip" | "run_once"
}

export interface ScheduledTaskUpdateInput {
  readonly name?: string
  readonly description?: string
  readonly scope?: TaskScope
  readonly cwd?: string
  readonly trigger?: TaskTrigger
  readonly action?: TaskActionRef
  readonly enabled?: boolean
  readonly activeDays?: readonly number[]
  readonly missedRunPolicy?: "skip" | "run_once"
}
```

- [ ] **Step 2: Add `activeDays` to public type**

In `desktop/src/types/task-scheduler.ts`, add to `ScheduledTask`:

```typescript
export type ScheduledTask = {
  id: string
  schemaVersion: 2
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  enabled: boolean
  activeDays: number[]  // 0=Sun, 1=Mon ... 6=Sat
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: ScheduledTaskStatus
  activeRun?: ScheduledTaskActiveRun
  runCount: number
}
```

Add to `ScheduledTaskCreateInput`:

```typescript
export type ScheduledTaskCreateInput = {
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  enabled?: boolean
  activeDays?: number[]
  missedRunPolicy?: "skip" | "run_once"
}
```

Add to `ScheduledTaskUpdateInput`:

```typescript
export type ScheduledTaskUpdateInput = {
  name?: string
  description?: string
  scope?: ScheduledTaskScope
  cwd?: string
  trigger?: ScheduledTaskTrigger
  action?: ScheduledTaskActionRef
  enabled?: boolean
  activeDays?: number[]
  missedRunPolicy?: "skip" | "run_once"
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit --project tsconfig.test.json 2>&1 | head -30`

Expected: Type errors in task-repository.ts and other files that now need to supply `activeDays` — these will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/services/task-scheduler/types.ts desktop/src/types/task-scheduler.ts
git commit -m "feat(scheduler): add activeDays field to task type definitions"
```

---

### Task 2: Hydrate `activeDays` in task repository

**Files:**
- Modify: `desktop/electron/services/task-scheduler/task-repository.ts:31-60`
- Test: `desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts`

- [ ] **Step 1: Write failing test for hydration**

Add to `desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts`:

```typescript
it("hydrates activeDays to all-days when missing from stored data", async () => {
  // Simulate a legacy task without activeDays
  const legacyTask = {
    id: "task:legacy",
    schemaVersion: 2,
    name: "Legacy",
    scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
    action: { type: "builtin.command", config: { command: "echo hi" } },
    enabled: true,
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    runCount: 0,
    configVersion: 0,
  }
  await deps.tasks.upsert(legacyTask as never)
  const result = await repo.get("task:legacy")
  expect(result!.activeDays).toEqual([0, 1, 2, 3, 4, 5, 6])
})

it("preserves activeDays when creating a task with specific days", async () => {
  const task = await repo.create({
    name: "Weekday only",
    scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
    action: { type: "builtin.command", config: { command: "echo hi" } },
    activeDays: [1, 2, 3, 4, 5],
  })
  expect(task.activeDays).toEqual([1, 2, 3, 4, 5])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/task-repository.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — `activeDays` not set on created tasks, hydration not implemented.

- [ ] **Step 3: Implement hydration and creation logic**

In `desktop/electron/services/task-scheduler/task-repository.ts`:

1. Add a constant at the top:

```typescript
const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6]
```

2. Add a hydration helper:

```typescript
function hydrateActiveDays(task: ScheduledTaskEntry): ScheduledTaskEntry {
  if (task.activeDays && Array.isArray(task.activeDays) && task.activeDays.length > 0) {
    return task
  }
  return { ...task, activeDays: [...ALL_DAYS] }
}
```

3. Apply hydration in `get()`:

```typescript
async get(id: string): Promise<ScheduledTaskEntry | null> {
  const task = await this.tasks.get(id)
  return task ? hydrateActiveDays(task) : null
}
```

4. Apply hydration in `list()`:

```typescript
async list(): Promise<ScheduledTaskEntry[]> {
  const tasks = await this.tasks.list()
  return tasks.map(hydrateActiveDays)
}
```

5. Set `activeDays` in `create()` — in the task object construction:

```typescript
activeDays: input.activeDays ? [...input.activeDays] : [...ALL_DAYS],
```

6. Handle `activeDays` in `update()` — in the candidate construction, add to `definedPatch`:

```typescript
activeDays: patch.activeDays,
```

7. Add validation in `validateTask()`:

```typescript
if (!Array.isArray(task.activeDays) || task.activeDays.length === 0) {
  throw new Error("activeDays must contain at least one day (0-6)")
}
if (task.activeDays.some((d: number) => !Number.isInteger(d) || d < 0 || d > 6)) {
  throw new Error("activeDays values must be integers 0-6")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/task-repository.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/task-scheduler/task-repository.ts desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts
git commit -m "feat(scheduler): hydrate activeDays in task repository"
```

---

### Task 3: Extend schedule calculator with activeDays filtering

**Files:**
- Modify: `desktop/electron/services/task-scheduler/schedule-calculator.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/schedule-calculator.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `desktop/electron/services/task-scheduler/__tests__/schedule-calculator.test.ts`:

```typescript
describe("activeDays filtering", () => {
  it("returns candidate unchanged when activeDays includes the weekday", () => {
    // 2026-05-11 is a Monday (day 1)
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      from: new Date("2026-05-11T08:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(result.toISOString()).toBe(new Date("2026-05-11T09:00:00Z").toISOString())
  })

  it("skips to next valid day for cron when candidate falls on excluded day", () => {
    // 2026-05-10 is a Saturday (day 6), activeDays only Mon-Fri
    // cron "0 9 * * *" from Saturday 08:00 → candidate is Sat 09:00
    // should skip to Monday 2026-05-12 09:00
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      from: new Date("2026-05-09T10:00:00Z"),  // Friday 10:00, next cron = Sat 09:00
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1, 2, 3, 4, 5],
    })
    // Next cron after Fri 10:00 = Sat 09:00 (day 6, excluded)
    // Skip to Mon 09:00
    expect(result.toISOString()).toBe(new Date("2026-05-12T09:00:00Z").toISOString())
  })

  it("skips to next valid day for interval when candidate falls on excluded day", () => {
    // 2026-05-10 is a Saturday (day 6)
    // interval every 60 min, created Sat 08:00, from Sat 08:30
    // candidate = Sat 09:00 (excluded)
    // next valid day = Sunday (day 0) if activeDays includes 0
    const result = computeNextRunAt({
      trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "created_at" } },
      from: new Date("2026-05-10T08:30:00Z"),
      createdAt: "2026-05-10T08:00:00Z",
      activeDays: [0],  // only Sunday
    })
    // Should jump to Sunday 2026-05-11 00:00 + interval from anchor
    // On Sunday, first interval hit from anchor perspective:
    // anchor = Sat 08:00, steps on Sunday 00:00: elapsed = 16h = 960min, steps = 960/60 = 16, next = anchor + 17*60min = Sat 08:00 + 1020min = Sun 01:00
    // Actually for interval, we jump to next valid day 00:00 and recalculate from there
    const sunday = new Date("2026-05-11T00:00:00Z")
    const expected = computeNextRunAt({
      trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "created_at" } },
      from: sunday,
      createdAt: "2026-05-10T08:00:00Z",
    })
    expect(result.toISOString()).toBe(expected.toISOString())
  })

  it("treats all-days activeDays same as no constraint", () => {
    const withAll = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      from: new Date("2026-05-10T08:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })
    const without = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      from: new Date("2026-05-10T08:00:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
    })
    expect(withAll.toISOString()).toBe(without.toISOString())
  })

  it("handles timezone-aware weekday check", () => {
    // 2026-05-11 00:30 UTC = 2026-05-11 08:30 Asia/Shanghai (Monday)
    // activeDays = [1] (Monday only)
    const result = computeNextRunAt({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      from: new Date("2026-05-11T00:30:00Z"),
      createdAt: "2026-05-01T00:00:00Z",
      activeDays: [1],
    })
    // 09:00 Shanghai = 01:00 UTC on Monday
    expect(result.toISOString()).toBe(new Date("2026-05-11T01:00:00Z").toISOString())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/schedule-calculator.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — `activeDays` parameter not recognized.

- [ ] **Step 3: Implement activeDays filtering in computeNextRunAt**

Update `desktop/electron/services/task-scheduler/schedule-calculator.ts`:

```typescript
import { nextCronRun } from "./cron-expression"
import type { TaskTrigger } from "./types"

const ALL_DAYS = new Set([0, 1, 2, 3, 4, 5, 6])
const MAX_ADVANCE_ITERATIONS = 7

export function computeNextRunAt(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
  readonly activeDays?: readonly number[]
}): Date {
  const activeDaysSet = input.activeDays && input.activeDays.length < 7
    ? new Set(input.activeDays)
    : ALL_DAYS

  let candidate = computeRawCandidate(input)

  if (activeDaysSet.size === 7) return candidate

  for (let i = 0; i < MAX_ADVANCE_ITERATIONS; i++) {
    const weekday = getWeekday(candidate, input.trigger)
    if (activeDaysSet.has(weekday)) return candidate
    const nextValidDay = advanceToNextValidDay(candidate, activeDaysSet, input.trigger)
    candidate = computeRawCandidate({ ...input, from: nextValidDay })
  }

  return candidate
}

function computeRawCandidate(input: {
  readonly trigger: TaskTrigger
  readonly from: Date
  readonly createdAt: string
}): Date {
  if (input.trigger.type === "builtin.cron") {
    return nextCronRun(input.trigger.config.expr, input.from, input.trigger.config.timezone)
  }
  const everyMs = input.trigger.config.everyMinutes * 60_000
  if (input.trigger.config.anchor === "last_completed_at") {
    return new Date(input.from.getTime() + everyMs)
  }
  const anchor = new Date(input.createdAt).getTime()
  const from = input.from.getTime()
  const elapsed = Math.max(0, from - anchor)
  const steps = Math.floor(elapsed / everyMs) + 1
  return new Date(anchor + steps * everyMs)
}

function getWeekday(date: Date, trigger: TaskTrigger): number {
  const timezone = trigger.type === "builtin.cron" ? trigger.config.timezone : undefined
  if (!timezone) return date.getUTCDay()
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(date)
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekdayStr] ?? date.getUTCDay()
}

function advanceToNextValidDay(date: Date, activeDays: Set<number>, trigger: TaskTrigger): Date {
  const timezone = trigger.type === "builtin.cron" ? trigger.config.timezone : undefined
  const result = new Date(date)
  for (let i = 0; i < 7; i++) {
    result.setUTCDate(result.getUTCDate() + 1)
    // Set to start of day in the relevant timezone
    if (timezone) {
      const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      const parts = formatter.formatToParts(result)
      const y = parts.find((p) => p.type === "year")!.value
      const m = parts.find((p) => p.type === "month")!.value
      const d = parts.find((p) => p.type === "day")!.value
      // Create midnight in that timezone by finding the UTC offset
      const midnightLocal = new Date(`${y}-${m}-${d}T00:00:00`)
      const offset = result.getTime() - midnightLocal.getTime()
      result.setTime(new Date(`${y}-${m}-${d}T00:00:00Z`).getTime())
    } else {
      result.setUTCHours(0, 0, 0, 0)
    }
    const weekday = getWeekday(result, trigger)
    if (activeDays.has(weekday)) return result
  }
  return result
}

export function resolveStartupSchedule(input: {
  readonly enabled: boolean
  readonly nextRunAt?: string
  readonly missedRunPolicy: "skip" | "run_once"
  readonly trigger: TaskTrigger
  readonly createdAt: string
  readonly now: Date
}): { readonly action: "none" | "schedule_next" | "run_missed_once" } {
  if (!input.enabled) return { action: "none" }
  if (!input.nextRunAt) return { action: "schedule_next" }
  const nextRunAt = new Date(input.nextRunAt)
  const nextRunAtTime = nextRunAt.getTime()
  if (!Number.isFinite(nextRunAtTime)) return { action: "schedule_next" }
  if (nextRunAtTime > input.now.getTime()) return { action: "schedule_next" }
  return input.missedRunPolicy === "run_once"
    ? { action: "run_missed_once" }
    : { action: "schedule_next" }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/schedule-calculator.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: All tests PASS (both existing and new).

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/task-scheduler/schedule-calculator.ts desktop/electron/services/task-scheduler/__tests__/schedule-calculator.test.ts
git commit -m "feat(scheduler): filter computeNextRunAt by activeDays constraint"
```

---

### Task 4: Wire activeDays through task-scheduler-service

**Files:**
- Modify: `desktop/electron/services/task-scheduler/task-scheduler-service.ts:179-200`
- Test: `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts`

- [ ] **Step 1: Write failing test for runtime activeDays guard**

Add to `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts`:

```typescript
it("skips scheduled run when current day is not in activeDays", async () => {
  // Create a task with activeDays excluding today
  const today = new Date("2026-05-10T09:00:00Z") // Saturday = day 6
  const service = createService({ now: () => today })
  const task = await service.schedulerTaskCreate({
    name: "Weekday only",
    scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
    action: { type: "builtin.command", config: { command: "echo hi" } },
    activeDays: [1, 2, 3, 4, 5], // Mon-Fri only
  })

  // Manually trigger as if the timer fired
  const result = await service.triggerForTest(task.id, "schedule")
  expect(result!.status).toBe("skipped")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts -t "skips scheduled run" --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — no activeDays check in runScheduled.

- [ ] **Step 3: Add activeDays guard in runScheduled**

In `desktop/electron/services/task-scheduler/task-scheduler-service.ts`, in the `runScheduled` method, after the `if (!task.enabled)` check, add:

```typescript
// activeDays gate: skip if today is not in the allowed days
if (task.activeDays && task.activeDays.length < 7) {
  const timezone = task.trigger.type === "builtin.cron" ? task.trigger.config.timezone : undefined
  const currentDay = getWeekdayForDate(this.now(), timezone)
  if (!task.activeDays.includes(currentDay)) {
    await this.schedule(id)
    return this.recordSkipped(task.id, triggeredBy, "day not in activeDays")
  }
}
```

Add the helper function at the bottom of the file:

```typescript
function getWeekdayForDate(date: Date, timezone?: string): number {
  if (!timezone) return date.getDay()
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).formatToParts(date)
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? ""
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekdayStr] ?? date.getDay()
}
```

- [ ] **Step 4: Pass activeDays to computeNextRunAt calls**

In `resolveNextRunAt` and anywhere `computeNextRunAt` is called within the service, pass `activeDays` from the task:

```typescript
private resolveNextRunAt(task: ScheduledTaskEntry, preferredNextRunAt?: string): Date {
  if (preferredNextRunAt) {
    const preferred = new Date(preferredNextRunAt)
    if (preferred.getTime() > this.now().getTime()) return preferred
  }
  return computeNextRunAt({
    trigger: task.trigger,
    from: this.now(),
    createdAt: task.createdAt,
    activeDays: task.activeDays,
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/task-scheduler/task-scheduler-service.ts desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts
git commit -m "feat(scheduler): add activeDays runtime guard in task-scheduler-service"
```

---

### Task 5: Expose activeDays in MCP capabilities

**Files:**
- Modify: `desktop/synapse-capabilities/shared/scheduler-domain.ts:19-39`
- Modify: `desktop/electron/services/task-scheduler/external-capabilities.ts:238-296`
- Test: `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`

- [ ] **Step 1: Write failing test for MCP create with activeDays**

Add to `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts`:

```typescript
it("scheduler.task.create accepts activeDays and passes to service", async () => {
  const result = await dispatch("scheduler.task.create", {
    name: "Weekday task",
    scope: { type: "global" },
    schedule: { type: "cron", expr: "0 9 * * *" },
    action: { type: "builtin.command", config: { command: "echo hi" } },
    activeDays: [1, 2, 3, 4, 5],
  })
  expect(result.ok).toBe(true)
  expect((result.data as { activeDays: number[] }).activeDays).toEqual([1, 2, 3, 4, 5])
})

it("scheduler.task.create defaults activeDays to all days when omitted", async () => {
  const result = await dispatch("scheduler.task.create", {
    name: "All days task",
    scope: { type: "global" },
    schedule: { type: "cron", expr: "0 9 * * *" },
    action: { type: "builtin.command", config: { command: "echo hi" } },
  })
  expect(result.ok).toBe(true)
  expect((result.data as { activeDays: number[] }).activeDays).toEqual([0, 1, 2, 3, 4, 5, 6])
})

it("scheduler.task.create rejects empty activeDays", async () => {
  await expect(dispatch("scheduler.task.create", {
    name: "No days",
    scope: { type: "global" },
    schedule: { type: "cron", expr: "0 9 * * *" },
    action: { type: "builtin.command", config: { command: "echo hi" } },
    activeDays: [],
  })).rejects.toThrow(/activeDays/)
})

it("scheduler.task.update can change activeDays", async () => {
  const created = await dispatch("scheduler.task.create", {
    name: "Update test",
    scope: { type: "global" },
    schedule: { type: "cron", expr: "0 9 * * *" },
    action: { type: "builtin.command", config: { command: "echo hi" } },
  })
  const taskId = (created.data as { id: string }).id
  const result = await dispatch("scheduler.task.update", {
    taskId,
    activeDays: [6, 0],
  })
  expect(result.ok).toBe(true)
  expect((result.data as { activeDays: number[] }).activeDays).toEqual([6, 0])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/external-api.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL

- [ ] **Step 3: Add activeDays to MCP schema types**

In `desktop/synapse-capabilities/shared/scheduler-domain.ts`, add `activeDays` to `SchedulerTaskCreateParams`:

```typescript
export type SchedulerTaskCreateParams = {
  readonly name: string
  readonly description?: string
  readonly scope: { readonly type: "global" } | { readonly type: "project"; readonly projectId: string }
  readonly cwd?: string
  readonly schedule: SchedulerSchedule
  readonly action: {
    readonly type: string
    readonly config: Record<string, unknown>
  }
  readonly enabled?: boolean
  readonly activeDays?: readonly number[]
  readonly missedRunPolicy?: "skip" | "run_once"
}
```

Add `activeDays` to `SchedulerTaskUpdateParams`:

```typescript
export type SchedulerTaskUpdateParams = {
  readonly taskId: string
  readonly name?: string
  readonly description?: string
  readonly cwd?: string
  readonly schedule?: SchedulerSchedule
  readonly activeDays?: readonly number[]
  readonly missedRunPolicy?: "skip" | "run_once"
}
```

Add `activeDays` to the MCP tool input schemas for `scheduler_task_create` and `scheduler_task_update` (in the `buildSchedulerTools()` function or equivalent schema definitions):

```typescript
activeDays: {
  type: "array",
  items: { type: "integer", minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
  description: "Days of week when the task is allowed to run. 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat. Defaults to all days if omitted.",
}
```

- [ ] **Step 4: Wire activeDays through external-capabilities dispatcher**

In `desktop/electron/services/task-scheduler/external-capabilities.ts`:

1. Add `activeDays` to `parseCreateParams`:

```typescript
function parseCreateParams(params: Record<string, unknown>): SchedulerTaskCreateParams {
  // ...existing parsing...
  return {
    name,
    description: optionalString(params.description, "description"),
    scope: parseScope(scope),
    cwd: optionalString(params.cwd, "cwd"),
    schedule: parseSchedule(schedule),
    action: parseAction(action),
    enabled: optionalBoolean(params.enabled, "enabled"),
    activeDays: parseOptionalActiveDays(params.activeDays),
    missedRunPolicy: parseMissedRunPolicy(params.missedRunPolicy),
  }
}
```

2. Add `activeDays` to `parseUpdateParams` allowed fields and parsing:

```typescript
function parseUpdateParams(params: Record<string, unknown>): SchedulerTaskUpdateParams {
  const allowed = new Set(["taskId", "name", "description", "cwd", "schedule", "activeDays", "missedRunPolicy"])
  // ...existing logic...
  const input: SchedulerTaskUpdateParams = {
    taskId,
    name: optionalString(params.name, "name"),
    description: optionalString(params.description, "description"),
    cwd: optionalString(params.cwd, "cwd"),
    schedule: params.schedule === undefined ? undefined : parseSchedule(requireRecord(params.schedule, "schedule")),
    activeDays: parseOptionalActiveDays(params.activeDays),
    missedRunPolicy: parseMissedRunPolicy(params.missedRunPolicy),
  }
  if (
    input.name === undefined
    && input.description === undefined
    && input.cwd === undefined
    && input.schedule === undefined
    && input.activeDays === undefined
    && input.missedRunPolicy === undefined
  ) {
    throw new Error("scheduler.task.update requires at least one field to update")
  }
  return input
}
```

3. Add the parsing helper:

```typescript
function parseOptionalActiveDays(value: unknown): readonly number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error("Missing or invalid 'activeDays': expected array")
  if (value.length === 0) throw new Error("'activeDays' must contain at least one day (0-6)")
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item > 6) {
      throw new Error("'activeDays' values must be integers 0-6")
    }
  }
  return value as number[]
}
```

4. Add `activeDays` to `toCreateInput`:

```typescript
function toCreateInput(input: SchedulerTaskCreateParams): ScheduledTaskCreateInput {
  return {
    name: input.name,
    description: input.description,
    scope: input.scope,
    cwd: input.cwd,
    trigger: toTrigger(input.schedule),
    action: input.action,
    enabled: input.enabled,
    activeDays: input.activeDays ? [...input.activeDays] : undefined,
    missedRunPolicy: input.missedRunPolicy,
  }
}
```

5. Add `activeDays` to `toUpdatePatch`:

```typescript
function toUpdatePatch(input: SchedulerTaskUpdateParams): ScheduledTaskUpdateInput {
  return {
    name: input.name,
    description: input.description,
    cwd: input.cwd,
    trigger: input.schedule ? toTrigger(input.schedule) : undefined,
    activeDays: input.activeDays ? [...input.activeDays] : undefined,
    missedRunPolicy: input.missedRunPolicy,
  }
}
```

6. Add `activeDays` to `toPublicTaskSummary` and `SchedulerTaskSummary`:

```typescript
export type SchedulerTaskSummary = {
  // ...existing fields
  readonly activeDays: readonly number[]
}

export function toPublicTaskSummary(task: ScheduledTaskEntry): SchedulerTaskSummary {
  return {
    // ...existing fields
    activeDays: task.activeDays,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/external-api.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add desktop/synapse-capabilities/shared/scheduler-domain.ts desktop/electron/services/task-scheduler/external-capabilities.ts desktop/electron/services/task-scheduler/__tests__/external-api.test.ts
git commit -m "feat(scheduler): expose activeDays in MCP create/update capabilities"
```

---

### Task 6: Create ActiveDaysInput UI component

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/active-days-input.tsx`

- [ ] **Step 1: Create the component**

Create `desktop/src/modules/task-scheduler/components/active-days-input.tsx`:

```typescript
import { cn } from "@/lib/utils"

type ActiveDaysInputProps = {
  value: number[]
  onChange: (days: number[]) => void
  error?: string
}

const DAY_LABELS: { day: number; label: string }[] = [
  { day: 1, label: "一" },
  { day: 2, label: "二" },
  { day: 3, label: "三" },
  { day: 4, label: "四" },
  { day: 5, label: "五" },
  { day: 6, label: "六" },
  { day: 0, label: "日" },
]

function ActiveDaysInput({ value, onChange, error }: ActiveDaysInputProps) {
  const selected = new Set(value)

  function toggle(day: number) {
    const next = selected.has(day)
      ? value.filter((d) => d !== day)
      : [...value, day]
    onChange(next)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        {DAY_LABELS.map(({ day, label }) => (
          <button
            key={day}
            type="button"
            aria-label={`周${label}`}
            aria-pressed={selected.has(day)}
            className={cn(
              "h-8 w-8 rounded-full text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              selected.has(day)
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
            onClick={() => toggle(day)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export { ActiveDaysInput }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit --project tsconfig.test.json 2>&1 | grep active-days`

Expected: No errors for this file.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/active-days-input.tsx
git commit -m "feat(scheduler): add ActiveDaysInput toggle component"
```

---

### Task 7: Integrate ActiveDaysInput into task form

**Files:**
- Modify: `desktop/src/modules/task-scheduler/types.ts:13-25`
- Modify: `desktop/src/modules/task-scheduler/utils.ts:16-99`
- Modify: `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx:284-362`

- [ ] **Step 1: Add activeDays to TaskFormState**

In `desktop/src/modules/task-scheduler/types.ts`, add to `TaskFormState`:

```typescript
type TaskFormState = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  activeDays: number[]
  triggerType: TaskFormTriggerType
  cronExpr: string
  everyMinutes: string
  intervalAnchor: "created_at" | "last_completed_at"
  actionType: string
  actionConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}
```

- [ ] **Step 2: Update form utils**

In `desktop/src/modules/task-scheduler/utils.ts`:

1. Update `DEFAULT_TASK_FORM_STATE`:

```typescript
const DEFAULT_TASK_FORM_STATE: TaskFormState = {
  name: "",
  description: "",
  cwd: "",
  enabled: true,
  activeDays: [0, 1, 2, 3, 4, 5, 6],
  triggerType: "cron",
  cronExpr: "0 9 * * *",
  everyMinutes: "60",
  intervalAnchor: "created_at",
  actionType: DEFAULT_ACTION_TYPE,
  actionConfig: rendererActionRegistry.getDefaultConfig(DEFAULT_ACTION_TYPE),
  missedRunPolicy: "skip",
}
```

2. Update `createTaskFormState` to read `activeDays` from existing task:

```typescript
function createTaskFormState(
  task?: ScheduledTask,
  _defaultProjectId = "",
  _platform?: string,
): TaskFormState {
  if (!task) {
    return { ...DEFAULT_TASK_FORM_STATE }
  }

  return {
    name: task.name,
    description: task.description ?? "",
    cwd: task.cwd ?? "",
    enabled: task.enabled,
    activeDays: task.activeDays ?? [0, 1, 2, 3, 4, 5, 6],
    triggerType: task.trigger.type === "builtin.cron" ? "cron" : "interval",
    cronExpr: task.trigger.type === "builtin.cron" ? task.trigger.config.expr : DEFAULT_TASK_FORM_STATE.cronExpr,
    everyMinutes: task.trigger.type === "builtin.interval"
      ? String(task.trigger.config.everyMinutes)
      : DEFAULT_TASK_FORM_STATE.everyMinutes,
    intervalAnchor: task.trigger.type === "builtin.interval"
      ? task.trigger.config.anchor ?? "created_at"
      : DEFAULT_TASK_FORM_STATE.intervalAnchor,
    actionType: task.action.type,
    actionConfig: task.action.config,
    missedRunPolicy: task.missedRunPolicy,
  }
}
```

3. Update `buildTaskPayload` to include `activeDays`:

```typescript
function buildTaskPayload(form: TaskFormState): ScheduledTaskCreateInput {
  const name = requireTrimmed(form.name, "名称")
  const description = optionalTrimmed(form.description)
  const cwd = optionalTrimmed(form.cwd)
  const actionConfig = rendererActionRegistry.parseConfig(form.actionType, form.actionConfig)

  const projectId = (actionConfig as Record<string, unknown>).projectId
  const scope = typeof projectId === "string" && projectId.trim()
    ? { type: "project" as const, projectId: projectId.trim() }
    : { type: "global" as const }

  if (form.activeDays.length === 0) {
    throw new Error("请至少选择一个活跃日")
  }

  return {
    name,
    description,
    scope,
    cwd,
    trigger: form.triggerType === "cron"
      ? { type: "builtin.cron", config: { expr: requireTrimmed(form.cronExpr, "Cron") } }
      : {
          type: "builtin.interval",
          config: {
            everyMinutes: readPositiveInteger(form.everyMinutes, "间隔"),
            anchor: form.intervalAnchor,
          },
        },
    action: {
      type: form.actionType,
      config: actionConfig,
    },
    enabled: form.enabled,
    activeDays: form.activeDays,
    missedRunPolicy: form.missedRunPolicy,
  }
}
```

4. Update `serializeTasksForExport` to include `activeDays`:

```typescript
function serializeTasksForExport(tasks: ScheduledTask[]): TaskExportFile {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: tasks.map((task) => ({
      name: task.name,
      description: task.description,
      scope: task.scope,
      cwd: task.cwd,
      trigger: task.trigger,
      action: task.action,
      activeDays: task.activeDays,
      missedRunPolicy: task.missedRunPolicy,
    })),
  }
}
```

- [ ] **Step 3: Add ActiveDaysInput to the form dialog**

In `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`:

1. Add import:

```typescript
import { ActiveDaysInput } from "./active-days-input"
```

2. In the "触发计划" section, after the interval anchor toggle group (after the closing `</div>` of the trigger grid), add:

```typescript
<TaskField label="活跃日" htmlFor="task-form-active-days">
  <ActiveDaysInput
    value={form.activeDays}
    onChange={(days) => updateField("activeDays", days)}
    error={form.activeDays.length === 0 ? "请至少选择一个活跃日" : undefined}
  />
</TaskField>
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit --project tsconfig.test.json 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/task-scheduler/types.ts desktop/src/modules/task-scheduler/utils.ts desktop/src/modules/task-scheduler/components/task-form-dialog.tsx desktop/src/modules/task-scheduler/components/active-days-input.tsx
git commit -m "feat(scheduler): integrate ActiveDaysInput into task form"
```

---

### Task 8: Pass activeDays through task-repository computeNextRunAt calls

**Files:**
- Modify: `desktop/electron/services/task-scheduler/task-repository.ts`

The task repository calls `computeNextRunAt` in `create()`, `update()`, `setEnabled()`, and `markRunResult()`. All of these need to pass `activeDays`.

- [ ] **Step 1: Update all computeNextRunAt calls in task-repository**

In `desktop/electron/services/task-scheduler/task-repository.ts`, update each call:

In `create()`:

```typescript
const next = {
  ...task,
  nextRunAt: enabled
    ? computeNextRunAt({ trigger, from: this.now(), createdAt: now, activeDays: task.activeDays }).toISOString()
    : undefined,
}
```

In `update()`:

```typescript
const next: ScheduledTaskEntry = {
  ...candidate,
  nextRunAt: enabled
    ? computeNextRunAt({ trigger, from: this.now(), createdAt: existing.createdAt, activeDays: candidate.activeDays }).toISOString()
    : undefined,
}
```

In `setEnabled()`:

```typescript
const next: ScheduledTaskEntry = {
  ...existing,
  enabled,
  updatedAt: this.isoNow(),
  nextRunAt: enabled
    ? computeNextRunAt({ trigger, from: this.now(), createdAt: existing.createdAt, activeDays: existing.activeDays }).toISOString()
    : undefined,
}
```

In `markRunResult()`:

```typescript
...(recalcNextRunAt
  ? {
      nextRunAt: computeNextRunAt({
        trigger: existing.trigger,
        from: this.now(),
        createdAt: existing.createdAt,
        activeDays: existing.activeDays,
      }).toISOString(),
    }
  : {}),
```

- [ ] **Step 2: Run all scheduler tests**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/ --reporter=verbose 2>&1 | tail -20`

Expected: All PASS.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/task-scheduler/task-repository.ts
git commit -m "feat(scheduler): pass activeDays to computeNextRunAt in repository"
```

---

### Task 9: End-to-end verification

**Files:** None (verification only)

- [ ] **Step 1: Run full scheduler test suite**

Run: `pnpm vitest run electron/services/task-scheduler/__tests__/ --reporter=verbose 2>&1 | tail -30`

Expected: All tests PASS.

- [ ] **Step 2: Run TypeScript type check**

Run: `pnpm tsc --noEmit --project tsconfig.test.json 2>&1 | head -30`

Expected: Clean (or only pre-existing errors unrelated to scheduler).

- [ ] **Step 3: Run full test suite to check for regressions**

Run: `pnpm vitest run --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|Tests)" | tail -5`

Expected: No new failures introduced.

- [ ] **Step 4: Verify MCP tool schema includes activeDays**

Run: `pnpm exec tsx -e "import { buildAllMcpTools } from './synapse-capabilities/shared/registry'; const tools = buildAllMcpTools(); const create = tools.find(t => t.name === 'scheduler_task_create'); console.log(JSON.stringify(create?.inputSchema?.properties?.activeDays, null, 2))"`

Expected: Prints the activeDays JSON Schema definition.
