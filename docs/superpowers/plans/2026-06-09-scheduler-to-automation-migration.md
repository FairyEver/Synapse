# Scheduler To Automation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-task “迁移到自动化” action that stops running scheduled tasks, creates an equivalent automation, and deletes the original scheduled task on success.

**Architecture:** Add a small main-process migration helper owned by the task scheduler module. The helper converts scheduler task data into `AutomationCreateInput`, orchestrates stop/create/delete with rollback, and is exposed through a single task scheduler IPC method. Renderer changes only add the card action, confirmation dialog, bridge call, and focused UI state.

**Tech Stack:** Electron main process, ServiceRegistry, DataRepository-backed scheduler and automation services, React, TypeScript, Vitest, shadcn/Radix UI, lucide-react, existing preload bridge.

---

## File Structure

Create:

- `desktop/electron/services/task-scheduler/task-automation-migration.ts`  
  Pure mapper plus migration orchestrator. Owns conversion, stop-before-migrate, rollback, and structured logging.
- `desktop/electron/services/task-scheduler/__tests__/task-automation-migration.test.ts`  
  Focused unit tests for mapping and orchestration failure modes.

Modify:

- `desktop/electron/services/task-scheduler/index.ts`  
  Export the migration helper and result type.
- `desktop/electron/modules/task-scheduler/ipc.ts`  
  Add request/response schemas and the `tasks:migrate-to-automation` IPC method.
- `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`  
  Verify IPC routes to the service/helper and validates the response.
- `desktop/electron/preload.ts`  
  Add the IPC channel and `window.synapse.taskScheduler.migrateTaskToAutomation`.
- `desktop/src/types/bridge.ts`  
  Add the bridge method type.
- `desktop/src/types/task-scheduler.ts`  
  Add `ScheduledTaskMigrationResult`.
- `desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts`  
  Export `migrateTaskToAutomation`.
- `desktop/src/modules/task-scheduler/components/task-card.tsx`  
  Add the icon action between history and delete.
- `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`  
  Pass migration callbacks and disabled state.
- `desktop/src/modules/task-scheduler/index.tsx`  
  Add confirmation state, mutation handler, and dialog.
- `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`  
  Verify the migration icon and disabled behavior.
- `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`  
  Verify dialog copy, bridge call, success refresh, and failure behavior.
- `RELEASE_NOTES_PENDING.md`  
  Add a user-facing note.

Do not modify:

- `desktop/resources/templates/**`
- Automation editor UI
- Scheduler run history persistence
- Automation run history persistence

---

### Task 1: Add Pure Mapping And Result Types

**Files:**

- Create: `desktop/electron/services/task-scheduler/task-automation-migration.ts`
- Modify: `desktop/electron/services/task-scheduler/index.ts`
- Modify: `desktop/src/types/task-scheduler.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/task-automation-migration.test.ts`

- [ ] **Step 1: Write failing mapper tests**

Create `desktop/electron/services/task-scheduler/__tests__/task-automation-migration.test.ts` with:

```ts
import { describe, expect, it } from "vitest"

import { buildAutomationCreateInputFromTask } from "../task-automation-migration"
import type { ScheduledTaskEntry } from "../types"

describe("task automation migration mapping", () => {
  it("maps an enabled cron task to an enabled automation with active days in trigger config", () => {
    const input = buildAutomationCreateInputFromTask(createTask({
      enabled: true,
      validation: { status: "valid", issues: [] },
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", timezone: "Asia/Shanghai" } },
      activeDays: [1, 2, 3, 4, 5],
    }))

    expect(input).toEqual({
      name: "Daily build",
      description: "Build project",
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      cwd: "/Users/test/project",
      trigger: {
        type: "builtin.cron",
        config: {
          expr: "0 9 * * *",
          timezone: "Asia/Shanghai",
          activeDays: [1, 2, 3, 4, 5],
        },
      },
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    })
  })

  it("maps interval tasks and disables automations when source task needs update", () => {
    const input = buildAutomationCreateInputFromTask(createTask({
      enabled: true,
      validation: {
        status: "needs_update",
        issues: [{ field: "action.config.command", message: "命令不能为空" }],
      },
      trigger: { type: "builtin.interval", config: { everyMinutes: 30, anchor: "last_completed_at" } },
      activeDays: [0, 6],
      missedRunPolicy: "run_once",
    }))

    expect(input.enabled).toBe(false)
    expect(input.trigger).toEqual({
      type: "builtin.interval",
      config: {
        everyMinutes: 30,
        anchor: "last_completed_at",
        activeDays: [0, 6],
      },
    })
    expect(input.policy).toEqual({ missedRunPolicy: "run_once", overlapPolicy: "skip" })
  })

  it("keeps disabled source tasks disabled after migration", () => {
    const input = buildAutomationCreateInputFromTask(createTask({ enabled: false }))

    expect(input.enabled).toBe(false)
  })
})

function createTask(overrides: Partial<ScheduledTaskEntry> = {}): ScheduledTaskEntry {
  return {
    id: "task:1",
    schemaVersion: 2,
    name: "Daily build",
    description: "Build project",
    scope: { type: "project", projectId: "project-1" },
    cwd: "/Users/test/project",
    trigger: { type: "builtin.interval", config: { everyMinutes: 10 } },
    action: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run mapper tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/task-automation-migration.test.ts
```

Expected: FAIL because `task-automation-migration.ts` does not exist.

- [ ] **Step 3: Add migration result type to renderer shared task types**

In `desktop/src/types/task-scheduler.ts`, add after `ScheduledTaskRun`:

```ts
export type ScheduledTaskMigrationResult = {
  automationId: string
  deletedTaskId: string
}
```

- [ ] **Step 4: Add pure mapper**

Create `desktop/electron/services/task-scheduler/task-automation-migration.ts`:

```ts
import type { AutomationCreateInput, AutomationItem } from "../automation"
import type { ScheduledTaskEntry } from "./types"

export type ScheduledTaskMigrationResult = {
  readonly automationId: string
  readonly deletedTaskId: string
}

export type CreatedAutomationRef = Pick<AutomationItem, "id" | "enabled">

export function buildAutomationCreateInputFromTask(
  task: ScheduledTaskEntry,
): AutomationCreateInput {
  return {
    name: task.name,
    description: task.description,
    enabled: task.enabled && task.validation?.status !== "needs_update",
    scope: task.scope,
    cwd: task.cwd,
    trigger: {
      type: task.trigger.type,
      config: {
        ...task.trigger.config,
        activeDays: [...task.activeDays],
      },
    },
    executor: task.action,
    policy: {
      missedRunPolicy: task.missedRunPolicy,
      overlapPolicy: "skip",
    },
  }
}
```

- [ ] **Step 5: Export mapper and result type**

In `desktop/electron/services/task-scheduler/index.ts`, export the helper:

```ts
export {
  buildAutomationCreateInputFromTask,
  migrateTaskToAutomation,
  type ScheduledTaskMigrationResult,
} from "./task-automation-migration"
```

The `migrateTaskToAutomation` export will fail until Task 2; add a temporary function in `task-automation-migration.ts` so this task compiles:

```ts
export async function migrateTaskToAutomation(): Promise<ScheduledTaskMigrationResult> {
  throw new Error("migrateTaskToAutomation is not wired")
}
```

- [ ] **Step 6: Run mapper tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/task-automation-migration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/task-scheduler/task-automation-migration.ts \
  desktop/electron/services/task-scheduler/__tests__/task-automation-migration.test.ts \
  desktop/electron/services/task-scheduler/index.ts \
  desktop/src/types/task-scheduler.ts
git commit -m "feat(scheduler): map tasks to automation inputs"
```

---

### Task 2: Implement Main-Process Migration Orchestration

**Files:**

- Modify: `desktop/electron/services/task-scheduler/task-automation-migration.ts`
- Test: `desktop/electron/services/task-scheduler/__tests__/task-automation-migration.test.ts`

- [ ] **Step 1: Add orchestration tests**

Append these imports to `task-automation-migration.test.ts`:

```ts
import { vi } from "vitest"
import { migrateTaskToAutomation } from "../task-automation-migration"
```

Append these tests:

```ts
describe("migrateTaskToAutomation", () => {
  it("creates automation then deletes the source task", async () => {
    const harness = createMigrationHarness()

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .resolves.toEqual({ automationId: "automation:1", deletedTaskId: "task:1" })

    expect(harness.automation.automationCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Daily build",
      executor: { type: "builtin.command", config: { command: "echo ok", shell: "posix" } },
    }))
    expect(harness.scheduler.deleteTask).toHaveBeenCalledWith("task:1")
  })

  it("stops a running task before migration", async () => {
    const harness = createMigrationHarness({
      task: createTask({ activeRun: { status: "running", id: "run:1" } }),
    })

    await migrateTaskToAutomation({ taskId: "task:1", ...harness.deps })

    expect(harness.scheduler.stopRun).toHaveBeenCalledWith("run:1")
    expect(harness.automation.automationCreate).toHaveBeenCalled()
    expect(harness.scheduler.deleteTask).toHaveBeenCalledWith("task:1")
  })

  it("does not create automation when stopping the active run fails", async () => {
    const harness = createMigrationHarness({
      task: createTask({ activeRun: { status: "running", id: "run:1" } }),
      stopResult: { stopped: false },
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("停止运行失败")

    expect(harness.automation.automationCreate).not.toHaveBeenCalled()
    expect(harness.scheduler.deleteTask).not.toHaveBeenCalled()
  })

  it("keeps the source task when automation creation fails", async () => {
    const harness = createMigrationHarness({
      createError: new Error("create failed"),
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("create failed")

    expect(harness.scheduler.deleteTask).not.toHaveBeenCalled()
  })

  it("rolls back automation when deleting the source task fails", async () => {
    const harness = createMigrationHarness({
      deleteError: new Error("delete failed"),
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("delete failed")

    expect(harness.automation.automationDelete).toHaveBeenCalledWith("automation:1")
  })

  it("disables both records when rollback delete also fails", async () => {
    const harness = createMigrationHarness({
      deleteError: new Error("delete failed"),
      rollbackError: new Error("rollback failed"),
    })

    await expect(migrateTaskToAutomation({ taskId: "task:1", ...harness.deps }))
      .rejects.toThrow("delete failed")

    expect(harness.automation.automationDisable).toHaveBeenCalledWith("automation:1")
    expect(harness.scheduler.schedulerTaskDisable).toHaveBeenCalledWith("task:1")
  })
})

function createMigrationHarness(options: {
  task?: ScheduledTaskEntry | null
  stopResult?: { stopped: boolean }
  createError?: Error
  deleteError?: Error
  rollbackError?: Error
} = {}) {
  const task = options.task === undefined ? createTask() : options.task
  const scheduler = {
    schedulerTaskGet: vi.fn(async () => task),
    stopRun: vi.fn(async () => options.stopResult ?? { stopped: true }),
    deleteTask: vi.fn(async () => {
      if (options.deleteError) throw options.deleteError
      return { deleted: true }
    }),
    schedulerTaskDisable: vi.fn(async () => createTask({ enabled: false })),
  }
  const automation = {
    automationCreate: vi.fn(async () => {
      if (options.createError) throw options.createError
      return { id: "automation:1", enabled: true }
    }),
    automationDelete: vi.fn(async () => {
      if (options.rollbackError) throw options.rollbackError
      return { deleted: true }
    }),
    automationDisable: vi.fn(async () => ({ id: "automation:1", enabled: false })),
  }
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  }
  return {
    scheduler,
    automation,
    deps: {
      scheduler: scheduler as never,
      automation: automation as never,
      logger,
    },
  }
}
```

- [ ] **Step 2: Run orchestration tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/task-automation-migration.test.ts
```

Expected: FAIL because `migrateTaskToAutomation` still throws the temporary error.

- [ ] **Step 3: Implement orchestration**

Replace the temporary `migrateTaskToAutomation` in `task-automation-migration.ts` with:

```ts
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AutomationService } from "../automation"
import type { TaskSchedulerService } from "./task-scheduler-service"

export interface MigrateTaskToAutomationInput {
  readonly taskId: string
  readonly scheduler: Pick<
    TaskSchedulerService,
    "schedulerTaskGet" | "stopRun" | "deleteTask" | "schedulerTaskDisable"
  >
  readonly automation: Pick<
    AutomationService,
    "automationCreate" | "automationDelete" | "automationDisable"
  >
  readonly logger?: StructuredLogger
}

export async function migrateTaskToAutomation({
  taskId,
  scheduler,
  automation,
  logger,
}: MigrateTaskToAutomationInput): Promise<ScheduledTaskMigrationResult> {
  const startedAt = Date.now()
  logger?.info("Scheduled task migration started.", {
    boundary: "task-scheduler.migrate-to-automation",
    taskId,
  })

  const firstTask = await scheduler.schedulerTaskGet(taskId)
  if (!firstTask) throw new Error(`任务不存在：${taskId}`)

  const activeRunId = firstTask.activeRun?.id
  if (activeRunId) {
    const stopResult = await scheduler.stopRun(activeRunId)
    if (!stopResult.stopped) {
      throw new Error("停止运行失败")
    }
  }

  const task = await scheduler.schedulerTaskGet(taskId)
  if (!task) throw new Error(`任务不存在：${taskId}`)

  const createInput = buildAutomationCreateInputFromTask(task)
  let automationId: string | undefined
  try {
    const created = await automation.automationCreate(createInput)
    automationId = created.id
    await scheduler.deleteTask(taskId)
    logger?.info("Scheduled task migration finished.", {
      boundary: "task-scheduler.migrate-to-automation",
      taskId,
      automationId,
      triggerType: task.trigger.type,
      executorType: task.action.type,
      stoppedActiveRun: Boolean(activeRunId),
      durationMs: Date.now() - startedAt,
    })
    return { automationId, deletedTaskId: taskId }
  } catch (error) {
    if (automationId) {
      await rollbackCreatedAutomation({
        taskId,
        automationId,
        scheduler,
        automation,
        logger,
      })
    }
    logger?.warn("Scheduled task migration failed.", {
      boundary: "task-scheduler.migrate-to-automation",
      taskId,
      automationId,
      durationMs: Date.now() - startedAt,
      ...errorMetadata(error),
    })
    throw error
  }
}

async function rollbackCreatedAutomation({
  taskId,
  automationId,
  scheduler,
  automation,
  logger,
}: {
  readonly taskId: string
  readonly automationId: string
  readonly scheduler: Pick<TaskSchedulerService, "schedulerTaskDisable">
  readonly automation: Pick<AutomationService, "automationDelete" | "automationDisable">
  readonly logger?: StructuredLogger
}): Promise<void> {
  try {
    await automation.automationDelete(automationId)
    logger?.info("Rolled back migrated automation.", {
      boundary: "task-scheduler.migrate-to-automation.rollback",
      taskId,
      automationId,
    })
  } catch (rollbackError) {
    logger?.warn("Failed to delete migrated automation during rollback.", {
      boundary: "task-scheduler.migrate-to-automation.rollback",
      taskId,
      automationId,
      ...errorMetadata(rollbackError),
    })
    await Promise.allSettled([
      automation.automationDisable(automationId),
      scheduler.schedulerTaskDisable(taskId),
    ])
  }
}

function errorMetadata(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
} {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
```

- [ ] **Step 4: Run orchestration tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/task-scheduler/__tests__/task-automation-migration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/task-scheduler/task-automation-migration.ts \
  desktop/electron/services/task-scheduler/__tests__/task-automation-migration.test.ts
git commit -m "feat(scheduler): migrate tasks to automation"
```

---

### Task 3: Expose Migration Through IPC, Preload, And Hook

**Files:**

- Modify: `desktop/electron/modules/task-scheduler/ipc.ts`
- Modify: `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts`
- Test: `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Add failing IPC route test**

In `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`, add `migrateTaskToAutomation` to the service mock in the `"routes task CRUD and run calls"` test:

```ts
migrateTaskToAutomation: vi.fn(async () => ({
  automationId: "automation:1",
  deletedTaskId: "task:1",
})),
```

Then invoke it after the runs list:

```ts
const migrated = await harness.invoke("synapse:task-scheduler:tasks:migrate-to-automation", { taskId: "task:1" })
```

Add expectations:

```ts
expect(service.migrateTaskToAutomation).toHaveBeenCalledWith("task:1")
expect(migrated).toEqual({ automationId: "automation:1", deletedTaskId: "task:1" })
```

- [ ] **Step 2: Run IPC test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/task-scheduler/__tests__/ipc.test.ts
```

Expected: FAIL because the channel is not registered.

- [ ] **Step 3: Add service method wrapper**

In `desktop/electron/services/task-scheduler/task-scheduler-service.ts`, import the helper and automation service type:

```ts
import type { AutomationService } from "../automation"
import {
  migrateTaskToAutomation,
  type ScheduledTaskMigrationResult,
} from "./task-automation-migration"
```

Extend `TaskSchedulerServiceDeps`:

```ts
readonly automation?: AutomationService
```

Add method near `runTaskNow`:

```ts
async migrateTaskToAutomation(taskId: string): Promise<ScheduledTaskMigrationResult> {
  if (!this.deps.automation) {
    throw new Error("Automation service is unavailable")
  }
  return migrateTaskToAutomation({
    taskId,
    scheduler: this,
    automation: this.deps.automation,
    logger: this.deps.logger,
  })
}
```

In `desktop/electron/bootstrap/descriptors.ts`, update the `coreTaskSchedulerDescriptor` create path so it passes `automation: ctx.registry.get("core.automation")` only after confirming descriptor construction order allows it. If direct injection creates a dependency cycle, pass a lazy proxy:

```ts
automation: new Proxy({}, {
  get(_target, prop) {
    const automation = ctx.registry.get<AutomationService>("core.automation") as Record<PropertyKey, unknown>
    const value = automation[prop]
    return typeof value === "function" ? value.bind(automation) : value
  },
}) as AutomationService,
```

- [ ] **Step 4: Add IPC method**

In `desktop/electron/modules/task-scheduler/ipc.ts`, add:

```ts
const migrateTaskResultSchema = z.object({
  automationId: z.string().min(1),
  deletedTaskId: z.string().min(1),
})
```

Add a method after `deleteTask`:

```ts
migrateTaskToAutomation: {
  channel: "synapse:task-scheduler:tasks:migrate-to-automation",
  kind: "invoke",
  request: taskIdRequestSchema,
  response: migrateTaskResultSchema,
  handler: async (ctx, request: TaskIdRequest) => loggedSchedulerIpc(
    "synapse:task-scheduler:tasks:migrate-to-automation",
    "task-scheduler.ipc.migrate-task-to-automation",
    { taskId: request.taskId },
    () => ctx.resolve<TaskSchedulerService>("core.task-scheduler").migrateTaskToAutomation(request.taskId),
  ),
},
```

- [ ] **Step 5: Add preload and bridge types**

In `desktop/electron/preload.ts`, add the channel:

```ts
"migrateTaskToAutomation": "synapse:task-scheduler:tasks:migrate-to-automation",
```

Add the bridge method in the `taskScheduler` object:

```ts
migrateTaskToAutomation: (id) =>
  invoke(IPC_CHANNELS["task-scheduler"].migrateTaskToAutomation)({ taskId: id }),
```

In `desktop/src/types/bridge.ts`, add to the task scheduler bridge:

```ts
migrateTaskToAutomation: (id: string) => Promise<ScheduledTaskMigrationResult>
```

Add the import if missing:

```ts
import type { ScheduledTaskMigrationResult } from "./task-scheduler"
```

- [ ] **Step 6: Add renderer hook wrapper**

In `desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts`, import the result type:

```ts
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskMigrationResult,
  ScheduledTaskRun,
  ScheduledTaskUpdateInput,
} from "@/types/task-scheduler"
```

Add:

```ts
async function migrateTaskToAutomation(id: string): Promise<ScheduledTaskMigrationResult> {
  return requireSynapseBridge().taskScheduler.migrateTaskToAutomation(id)
}
```

Export it:

```ts
export {
  createTask,
  deleteTask,
  exportTasksToFile,
  importTasksFromFile,
  listRuns,
  migrateTaskToAutomation,
  runTask,
  setTaskEnabled,
  stopRun,
  updateTask,
  useTaskSchedulerTasks,
}
```

- [ ] **Step 7: Run bridge tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/task-scheduler/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/electron/modules/task-scheduler/ipc.ts \
  desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts \
  desktop/electron/preload.ts \
  desktop/src/types/bridge.ts \
  desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts \
  desktop/electron/services/task-scheduler/task-scheduler-service.ts \
  desktop/electron/bootstrap/descriptors.ts
git commit -m "feat(scheduler): expose migration bridge"
```

---

### Task 4: Add Scheduler Card Migration UI

**Files:**

- Modify: `desktop/src/modules/task-scheduler/components/task-card.tsx`
- Modify: `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`
- Test: `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`

- [ ] **Step 1: Add failing card tests**

In `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`, update existing `TaskCard` render calls to pass `onMigrate={vi.fn()}`.

Add tests:

```tsx
it("renders a migration icon action between history and delete", () => {
  const html = renderToStaticMarkup(
    <TooltipProvider>
      <TaskCard
        busy={false}
        projects={projects}
        task={createTask()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onHistory={vi.fn()}
        onMigrate={vi.fn()}
        onRun={vi.fn()}
        onStop={vi.fn()}
        onToggleEnabled={vi.fn()}
      />
    </TooltipProvider>,
  )

  expect(html).toContain("迁移到自动化")
})

it("keeps migration available for running tasks unless the task is migrating", async () => {
  const onMigrate = vi.fn()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <TooltipProvider>
        <TaskCard
          busy={false}
          migrateDisabled={false}
          projects={projects}
          task={createTask({ activeRun: { status: "running", id: "run:1" } })}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onMigrate={onMigrate}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
        />
      </TooltipProvider>,
    )
  })

  const migrateButton = document.querySelector<HTMLButtonElement>('button[aria-label="迁移到自动化"]')
  expect(migrateButton?.disabled).toBe(false)

  await act(async () => {
    migrateButton?.click()
  })

  expect(onMigrate).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run card tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/components/__tests__/task-card.test.tsx
```

Expected: FAIL because `onMigrate` is not a prop and no migration button exists.

- [ ] **Step 3: Add task card migration button**

In `task-card.tsx`, add icon import:

```ts
import {
  ArrowRightLeft,
  History,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react"
```

Extend props:

```ts
  migrateDisabled?: boolean
  onMigrate: () => void
```

Destructure:

```ts
  migrateDisabled,
  onMigrate,
```

Add the button between history and delete:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={migrateDisabled}
      aria-label="迁移到自动化"
      onClick={onMigrate}
    >
      <ArrowRightLeft className="size-3.5" />
    </Button>
  </TooltipTrigger>
  <TooltipContent>迁移到自动化</TooltipContent>
</Tooltip>
```

- [ ] **Step 4: Pass callbacks through card grid**

In `task-card-grid.tsx`, add props:

```ts
  migratingTaskIds: ReadonlySet<string>
  onMigrate: (task: ScheduledTask) => void
```

Pass into `TaskCard`:

```tsx
migrateDisabled={migratingTaskIds.has(task.id)}
onMigrate={() => onMigrate(task)}
```

- [ ] **Step 5: Run card tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/components/__tests__/task-card.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-card.tsx \
  desktop/src/modules/task-scheduler/components/task-card-grid.tsx \
  desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx
git commit -m "feat(scheduler): add migration action to task cards"
```

---

### Task 5: Wire Confirmation Dialog And Migration Mutation

**Files:**

- Modify: `desktop/src/modules/task-scheduler/index.tsx`
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`
- Test: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

- [ ] **Step 1: Add failing module tests**

In `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`, ensure the mocked bridge includes:

```ts
migrateTaskToAutomation: vi.fn(async () => ({
  automationId: "automation:1",
  deletedTaskId: "task:1",
})),
```

Add tests:

```tsx
it("confirms migration and calls the bridge", async () => {
  renderModuleWithTasks([createTask({ id: "task:1", name: "Daily build" })])

  await clickButtonByLabel("迁移到自动化")
  expect(await screen.findByText("迁移到自动化")).toBeTruthy()
  expect(screen.getByText("迁移成功后，此任务会被删除。运行历史不会迁移。")).toBeTruthy()

  await userEvent.click(screen.getByRole("button", { name: "迁移" }))

  expect(bridge.taskScheduler.migrateTaskToAutomation).toHaveBeenCalledWith("task:1")
  expect(bridge.taskScheduler.listTasks).toHaveBeenCalledTimes(2)
})

it("shows running-task migration copy", async () => {
  renderModuleWithTasks([createTask({
    id: "task:1",
    activeRun: { status: "running", id: "run:1" },
  })])

  await clickButtonByLabel("迁移到自动化")

  expect(screen.getByText("将先停止当前运行。迁移成功后，此任务会被删除。运行历史不会迁移。")).toBeTruthy()
})

it("shows needs-update migration copy", async () => {
  renderModuleWithTasks([createTask({
    id: "task:1",
    validation: {
      status: "needs_update",
      issues: [{ field: "action.config.command", message: "命令不能为空" }],
    },
  })])

  await clickButtonByLabel("迁移到自动化")

  expect(screen.getByText("新自动化会保持停用。迁移成功后，此任务会被删除。运行历史不会迁移。")).toBeTruthy()
})

it("keeps the migration dialog open when migration fails", async () => {
  bridge.taskScheduler.migrateTaskToAutomation.mockRejectedValueOnce(new Error("failed"))
  renderModuleWithTasks([createTask({ id: "task:1" })])

  await clickButtonByLabel("迁移到自动化")
  await userEvent.click(screen.getByRole("button", { name: "迁移" }))

  expect(await screen.findByRole("button", { name: "迁移" })).toBeTruthy()
})
```

Use the test file’s existing render helpers. If it does not have `clickButtonByLabel`, add:

```ts
async function clickButtonByLabel(label: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: label }))
}
```

- [ ] **Step 2: Run module tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: FAIL because the module has no migration state or dialog.

- [ ] **Step 3: Import migration hook**

In `desktop/src/modules/task-scheduler/index.tsx`, add `migrateTaskToAutomation` to the hook imports:

```ts
import {
  createTask,
  deleteTask,
  exportTasksToFile,
  importTasksFromFile,
  migrateTaskToAutomation,
  runTask,
  setTaskEnabled,
  stopRun,
  updateTask,
  useTaskSchedulerTasks,
} from "./hooks/use-task-scheduler"
```

- [ ] **Step 4: Add state and message helper**

Inside `TaskSchedulerModule`, add:

```ts
const [migrateTarget, setMigrateTarget] = useState<ScheduledTask | null>(null)
const [migratingTaskIds, setMigratingTaskIds] = useState<Set<string>>(() => new Set())
```

Add helper near `formatLastRun` functions or inside module file:

```ts
function getMigrationDescription(task: ScheduledTask | null): string {
  if (!task) return ""
  if (task.validation?.status === "needs_update") {
    return "新自动化会保持停用。迁移成功后，此任务会被删除。运行历史不会迁移。"
  }
  if (task.activeRun?.status === "running") {
    return "将先停止当前运行。迁移成功后，此任务会被删除。运行历史不会迁移。"
  }
  return "迁移成功后，此任务会被删除。运行历史不会迁移。"
}
```

- [ ] **Step 5: Add migration handler**

Inside `TaskSchedulerModule`, add:

```ts
async function handleMigrateTask() {
  if (!migrateTarget) return
  const task = migrateTarget
  setMigratingTaskIds((prev) => new Set(prev).add(task.id))
  try {
    await promise(
      async () => {
        const result = await migrateTaskToAutomation(task.id)
        logger.info("Task migrated to automation.", {
          taskId: result.deletedTaskId,
          automationId: result.automationId,
          taskNameLength: task.name.length,
          actionType: task.action.type,
          triggerType: task.trigger.type,
        })
        return result
      },
      { loading: "正在迁移...", success: "已迁移到自动化", error: "迁移失败" },
    )
    setMigrateTarget(null)
    await refresh()
  } catch (migrationError) {
    logger.warn("Task migration failed.", {
      boundary: "renderer.task-scheduler.migrate",
      taskId: task.id,
      taskNameLength: task.name.length,
      actionType: task.action.type,
      triggerType: task.trigger.type,
      ...errorLogMeta(migrationError),
    })
  } finally {
    setMigratingTaskIds((prev) => {
      const next = new Set(prev)
      next.delete(task.id)
      return next
    })
  }
}
```

- [ ] **Step 6: Pass migration props to grid**

In the `TaskCardGrid` usage, add:

```tsx
migratingTaskIds={migratingTaskIds}
onMigrate={(task) => setMigrateTarget(task)}
```

- [ ] **Step 7: Add confirmation dialog**

Add before export/import dialogs:

```tsx
<AlertDialog open={migrateTarget !== null} onOpenChange={(open) => !open && setMigrateTarget(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>迁移到自动化</AlertDialogTitle>
      <AlertDialogDescription>
        {getMigrationDescription(migrateTarget)}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction
        disabled={migrateTarget ? migratingTaskIds.has(migrateTarget.id) : false}
        onClick={() => {
          void handleMigrateTask()
        }}
      >
        {migrateTarget && migratingTaskIds.has(migrateTarget.id) ? "迁移中..." : "迁移"}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 8: Run module tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/task-scheduler/index.tsx \
  desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
git commit -m "feat(scheduler): confirm task migration"
```

---

### Task 6: Release Note And Full Verification

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one bullet under the pending user-facing changes section:

```md
- 定时任务现在可以逐个迁移到自动化；迁移会保留执行配置，成功后删除原任务，运行中的任务会先停止再迁移。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/task-scheduler/__tests__/task-automation-migration.test.ts \
  electron/modules/task-scheduler/__tests__/ipc.test.ts \
  electron/__tests__/preload.test.ts \
  src/modules/task-scheduler/components/__tests__/task-card.test.tsx \
  src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run typecheck if available**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. If the package has no `typecheck` script, run:

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Inspect changed UI code for style discipline**

Run:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|from-|to-|gradient|emoji" \
  desktop/src/modules/task-scheduler
```

Expected: no new custom style, arbitrary color, gradient, or emoji heading introduced by this work.

- [ ] **Step 6: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note scheduler migration"
```

---

## Plan Self-Review

- Spec coverage: per-task UI action, confirmation, run-stop behavior, no history migration, disabled needs-update migration, rollback, bridge, tests, and release note are covered.
- Scope: this is one cohesive feature spanning scheduler UI and scheduler-owned migration API; it does not include bulk migration or automation editor changes.
- Type consistency: `ScheduledTaskMigrationResult`, `migrateTaskToAutomation`, `automationId`, and `deletedTaskId` names are consistent across main, preload, bridge, hook, and renderer.
- UI discipline: the plan uses existing shadcn/Radix components, lucide icons, token-backed existing variants, and no custom colors or inline styles.
