# Scheduler Task Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make outdated scheduled tasks visibly require updates, block runtime execution/enabling without mutating stored task data, and guide users through editing the invalid config.

**Architecture:** Add an action-level stored-config validation capability, have the main task scheduler enrich task DTOs with runtime validation, and enforce validation before enabling, manual run, startup scheduling, and scheduled execution. Renderer components consume the validation DTO for presentation and show a small pre-edit dialog for tasks that need updates.

**Tech Stack:** Electron main process, React, TypeScript, zod, shadcn/ui, Vitest.

---

## File Map

- Modify `desktop/action-packages/types.ts`: add generic stored-config validation types.
- Modify `desktop/action-packages/builtin/agent/schema.ts`: export `validateAgentStoredConfig`.
- Modify `desktop/action-packages/builtin/agent/__tests__/schema.test.ts`: cover legacy agent config issue messages.
- Modify `desktop/electron/action-runtime/action-registry.ts`: expose `validateStoredConfig` with schema fallback.
- Modify `desktop/electron/services/task-scheduler/types.ts`: add `validation` to task entries.
- Modify `desktop/electron/services/task-scheduler/task-scheduler-service.ts`: enrich task DTOs and enforce runtime freezing.
- Modify `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts`: cover list, enable, run, schedule skip.
- Modify `desktop/electron/modules/task-scheduler/ipc.ts`: add validation schema to task IPC responses.
- Modify `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`: assert validation is accepted over IPC.
- Modify `desktop/src/types/task-scheduler.ts`: add renderer validation types.
- Modify `desktop/src/modules/task-scheduler/components/task-card.tsx`: render `需要更新`, disable run and switch, show next run as `需要更新`.
- Modify `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`: cover frozen card behavior.
- Modify `desktop/src/modules/task-scheduler/index.tsx`: show update dialog before edit for invalid tasks and block accidental run/toggle handlers.
- Modify `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`: cover edit dialog and valid direct edit.

## Task 1: Action Stored-Config Validation

**Files:**
- Modify: `desktop/action-packages/types.ts`
- Modify: `desktop/action-packages/builtin/agent/schema.ts`
- Modify: `desktop/action-packages/builtin/agent/manifest.ts`
- Modify: `desktop/action-packages/builtin/agent/__tests__/schema.test.ts`
- Modify: `desktop/electron/action-runtime/action-registry.ts`

- [ ] **Step 1: Add failing schema tests for legacy agent configs**

Add these tests to `desktop/action-packages/builtin/agent/__tests__/schema.test.ts`:

```ts
import { validateAgentStoredConfig } from "../schema"

it("reports missing provider and model for legacy scheduled Agent configs", () => {
  const result = validateAgentStoredConfig({
    projectId: "project-1",
    agentType: "claude-code",
    mode: "bypassPermissions",
    prompt: "Run scheduled work",
    sessionPolicy: "fresh",
    timeoutMins: 30,
  })

  expect(result).toEqual({
    status: "needs_update",
    issues: [
      { field: "action.config.providerId", message: "选择供应商" },
      { field: "action.config.modelTier", message: "选择模型" },
    ],
  })
})

it("reports unsupported legacy agent type and permission mode", () => {
  const result = validateAgentStoredConfig({
    projectId: "project-1",
    agentType: "codex",
    mode: "yolo",
    prompt: "Run scheduled work",
    sessionPolicy: "fresh",
  })

  expect(result).toEqual({
    status: "needs_update",
    issues: [
      { field: "action.config.agentType", message: "选择当前支持的 Agent" },
      { field: "action.config.providerId", message: "选择供应商" },
      { field: "action.config.modelTier", message: "选择模型" },
      { field: "action.config.mode", message: "选择权限模式" },
    ],
  })
})
```

- [ ] **Step 2: Run the failing action schema tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- action-packages/builtin/agent/__tests__/schema.test.ts
```

Expected: FAIL because `validateAgentStoredConfig` is not exported.

- [ ] **Step 3: Add generic validation types**

In `desktop/action-packages/types.ts`, add after `export type ActionConfig = Record<string, unknown>`:

```ts
export type ActionStoredConfigIssue = {
  readonly field: string
  readonly message: string
}

export type ActionStoredConfigValidation =
  | { readonly status: "valid"; readonly issues: readonly [] }
  | {
      readonly status: "needs_update"
      readonly issues: readonly ActionStoredConfigIssue[]
    }
```

Extend `ActionManifest` with an optional validator:

```ts
  readonly validateStoredConfig?: (config: ActionConfig) => ActionStoredConfigValidation
```

- [ ] **Step 4: Implement agent stored-config validator**

In `desktop/action-packages/builtin/agent/schema.ts`, import `ActionStoredConfigValidation` and add:

```ts
import type { ActionStoredConfigValidation } from "../../types"
```

Add this helper near the schema:

```ts
const modelTiers = new Set(["default", "haiku", "sonnet", "opus"])

export function validateAgentStoredConfig(
  config: Record<string, unknown>,
): ActionStoredConfigValidation {
  const parsed = agentActionConfigSchema.safeParse(config)
  if (parsed.success) return { status: "valid", issues: [] }

  const issues: Array<{ field: string; message: string }> = []
  if (config.agentType !== "claude-code") {
    issues.push({ field: "action.config.agentType", message: "选择当前支持的 Agent" })
  }
  if (typeof config.providerId !== "string" || config.providerId.trim().length === 0) {
    issues.push({ field: "action.config.providerId", message: "选择供应商" })
  }
  if (typeof config.modelTier !== "string" || !modelTiers.has(config.modelTier)) {
    issues.push({ field: "action.config.modelTier", message: "选择模型" })
  }
  if (!agentPermissionModes.includes(config.mode as never)) {
    issues.push({ field: "action.config.mode", message: "选择权限模式" })
  }

  return issues.length > 0
    ? { status: "needs_update", issues }
    : { status: "needs_update", issues: [{ field: "action.config", message: "检查执行内容" }] }
}
```

- [ ] **Step 5: Wire the validator into the agent manifest**

In `desktop/action-packages/builtin/agent/manifest.ts`, import the validator:

```ts
import { agentActionConfigSchema, validateAgentStoredConfig, type AgentActionConfig } from "./schema"
```

Add the manifest property:

```ts
  validateStoredConfig: validateAgentStoredConfig,
```

- [ ] **Step 6: Add registry fallback validation**

In `desktop/electron/action-runtime/action-registry.ts`, import `ActionStoredConfigValidation` and add this method to `MainActionRegistry`:

```ts
  validateStoredConfig(id: string, config: ActionConfig): ActionStoredConfigValidation {
    const action = this.get(id)
    if (action.manifest.validateStoredConfig) {
      return action.manifest.validateStoredConfig(config)
    }
    const parsed = action.manifest.configSchema.safeParse(config)
    return parsed.success
      ? { status: "valid", issues: [] }
      : { status: "needs_update", issues: [{ field: "action.config", message: "检查执行内容" }] }
  }
```

- [ ] **Step 7: Run action tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- action-packages/builtin/agent/__tests__/schema.test.ts electron/action-runtime/__tests__/action-registry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/action-packages/types.ts desktop/action-packages/builtin/agent/schema.ts desktop/action-packages/builtin/agent/manifest.ts desktop/action-packages/builtin/agent/__tests__/schema.test.ts desktop/electron/action-runtime/action-registry.ts
git commit -m "feat: validate stored task action configs"
```

## Task 2: Main Scheduler Runtime Freezing

**Files:**
- Modify: `desktop/electron/services/task-scheduler/types.ts`
- Modify: `desktop/electron/services/task-scheduler/task-scheduler-service.ts`
- Modify: `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts`

- [ ] **Step 1: Add failing scheduler service tests**

In `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts`, add tests that build an action registry with `builtin.agent`, create a legacy agent task missing `providerId` and `modelTier`, and assert:

```ts
expect((await service.schedulerTaskList())[0].validation).toEqual({
  status: "needs_update",
  issues: [
    { field: "action.config.providerId", message: "选择供应商" },
    { field: "action.config.modelTier", message: "选择模型" },
  ],
})
```

Add enable and manual-run assertions:

```ts
await expect(service.schedulerTaskEnable("task:legacy")).rejects.toThrow("任务配置需要更新")
expect((await taskItems.get("task:legacy"))?.enabled).toBe(false)
await expect(service.runTaskNow("task:legacy")).rejects.toThrow("任务配置需要更新")
expect(await runItems.list()).toHaveLength(0)
expect(execution.runTask).not.toHaveBeenCalled()
```

Add scheduled trigger assertion:

```ts
const run = await service.triggerForTest("task:legacy", "schedule")
expect(run?.status).toBe("skipped")
expect(run?.error).toBe("任务配置需要更新")
```

- [ ] **Step 2: Run the failing scheduler tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts
```

Expected: FAIL because task validation is not part of service deps or task DTOs.

- [ ] **Step 3: Add validation type to task entries**

In `desktop/electron/services/task-scheduler/types.ts`, add:

```ts
export type ScheduledTaskValidation =
  | { readonly status: "valid"; readonly issues: readonly [] }
  | {
      readonly status: "needs_update"
      readonly issues: readonly { readonly field: string; readonly message: string }[]
    }
```

Add to `ScheduledTaskEntryV2`:

```ts
  readonly validation?: ScheduledTaskValidation
```

- [ ] **Step 4: Inject action registry into scheduler service**

In `desktop/electron/services/task-scheduler/task-scheduler-service.ts`, import `MainActionRegistry` and add to `TaskSchedulerServiceDeps`:

```ts
  readonly actions: MainActionRegistry
```

Update the descriptor in `desktop/electron/bootstrap/descriptors.ts` if construction requires the new dependency:

```ts
actions: ctx.registry.get<MainActionRegistry>("core.action-runtime"),
```

- [ ] **Step 5: Implement runtime validation helpers**

Add these methods to `TaskSchedulerService`:

```ts
  private validateTask(task: ScheduledTaskEntry): ScheduledTaskValidation {
    try {
      return this.deps.actions.validateStoredConfig(task.action.type, task.action.config)
    } catch {
      return {
        status: "needs_update",
        issues: [{ field: "action.type", message: "检查执行内容" }],
      }
    }
  }

  private withRuntimeState(task: ScheduledTaskEntry): ScheduledTaskEntry {
    const validation = this.validateTask(task)
    const activeRun = this.runningTaskIds.has(task.id)
      ? { status: "running" as const, id: this.deps.execution.getActiveRunIdForTask(task.id) }
      : undefined
    return {
      ...task,
      validation,
      ...(activeRun ? { activeRun } : {}),
    }
  }
```

Replace the existing `withRuntimeState` implementation rather than keeping two copies.

- [ ] **Step 6: Enforce validation before scheduling and execution**

In `scheduleOnStartup`, return early when validation fails:

```ts
if (this.validateTask(task).status === "needs_update") return
```

In `schedule`, after loading `task`, return early when validation fails:

```ts
if (this.validateTask(task).status === "needs_update") return
```

In `setTaskEnabled`, before `tasks.setEnabled(id, true)`:

```ts
if (enabled && oldTask && this.validateTask(oldTask).status === "needs_update") {
  throw new Error("任务配置需要更新")
}
```

In `runNow`, before calling `executeOrSkip`:

```ts
if (this.validateTask(task).status === "needs_update") {
  throw new Error("任务配置需要更新")
}
```

In `runScheduled`, after disabled and active-day checks but before scheduling the next run:

```ts
if (this.validateTask(task).status === "needs_update") {
  return this.recordSkipped(task.id, triggeredBy, "任务配置需要更新")
}
```

- [ ] **Step 7: Return validation after create/update/enable**

Wrap successful mutation returns:

```ts
return this.withRuntimeState(task)
```

Apply this to `schedulerTaskCreate`, `schedulerTaskUpdate`, and `setTaskEnabled`.

- [ ] **Step 8: Run scheduler tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/services/task-scheduler/types.ts desktop/electron/services/task-scheduler/task-scheduler-service.ts desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "feat: freeze invalid scheduled tasks at runtime"
```

## Task 3: IPC and Renderer Types

**Files:**
- Modify: `desktop/electron/modules/task-scheduler/ipc.ts`
- Modify: `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`
- Modify: `desktop/src/types/task-scheduler.ts`

- [ ] **Step 1: Add failing IPC/type tests**

In `desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts`, add or extend the task response fixture to include:

```ts
validation: {
  status: "needs_update",
  issues: [{ field: "action.config.providerId", message: "选择供应商" }],
}
```

Assert the IPC response accepts and returns this field unchanged.

- [ ] **Step 2: Run the failing IPC test**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/modules/task-scheduler/__tests__/ipc.test.ts
```

Expected: FAIL because `taskSchema` strips or rejects `validation`.

- [ ] **Step 3: Add IPC validation schemas**

In `desktop/electron/modules/task-scheduler/ipc.ts`, add near `taskActionSchema`:

```ts
const taskValidationIssueSchema = z.object({
  field: z.string().min(1),
  message: z.string().min(1),
})

const taskValidationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid"), issues: z.array(taskValidationIssueSchema).length(0) }),
  z.object({ status: z.literal("needs_update"), issues: z.array(taskValidationIssueSchema).min(1) }),
])
```

Add to `taskSchema`:

```ts
  validation: taskValidationSchema.optional(),
```

- [ ] **Step 4: Add renderer task validation type**

In `desktop/src/types/task-scheduler.ts`, add:

```ts
export type ScheduledTaskValidationIssue = {
  field: string
  message: string
}

export type ScheduledTaskValidation =
  | { status: "valid"; issues: [] }
  | { status: "needs_update"; issues: ScheduledTaskValidationIssue[] }
```

Add to `ScheduledTask`:

```ts
  validation?: ScheduledTaskValidation
```

- [ ] **Step 5: Run IPC and typecheck slice**

Run:

```bash
pnpm --filter @synapse/desktop test -- electron/modules/task-scheduler/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/task-scheduler/ipc.ts desktop/electron/modules/task-scheduler/__tests__/ipc.test.ts desktop/src/types/task-scheduler.ts
git commit -m "feat: expose scheduled task validation state"
```

## Task 4: Task List Frozen State UI

**Files:**
- Modify: `desktop/src/modules/task-scheduler/components/task-card.tsx`
- Modify: `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`

- [ ] **Step 1: Add failing task card test**

In `desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx`, add:

```ts
it("shows invalid tasks as needing update and blocks runtime controls", async () => {
  const onRun = vi.fn()
  const onToggleEnabled = vi.fn()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          providers={providers}
          task={createTask({
            enabled: true,
            nextRunAt: "2026-05-21T01:00:00.000Z",
            validation: {
              status: "needs_update",
              issues: [{ field: "action.config.providerId", message: "选择供应商" }],
            },
          })}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onRun={onRun}
          onStop={vi.fn()}
          onToggleEnabled={onToggleEnabled}
        />
      </TooltipProvider>,
    )
  })

  expect(container.textContent).toContain("需要更新")
  const runButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("运行"))
  const switchButton = container.querySelector<HTMLButtonElement>("button[role='switch']")
  expect(runButton?.disabled).toBe(true)
  expect(switchButton?.disabled).toBe(true)

  await act(async () => {
    runButton?.click()
    switchButton?.click()
  })
  expect(onRun).not.toHaveBeenCalled()
  expect(onToggleEnabled).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the failing card test**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/components/__tests__/task-card.test.tsx
```

Expected: FAIL because `TaskCard` does not render validation state.

- [ ] **Step 3: Implement frozen state in `TaskCard`**

In `TaskCard`, derive:

```ts
const needsUpdate = task.validation?.status === "needs_update"
const disabled = !task.enabled || needsUpdate
const switchChecked = task.enabled && !needsUpdate
const nextRun = needsUpdate ? "需要更新" : formatTaskNextRun(task)
```

Update `getStatusBadge`:

```ts
if (task.validation?.status === "needs_update") {
  return { label: "需要更新", variant: "outline" }
}
```

Update switch props:

```tsx
checked={switchChecked}
disabled={busy || needsUpdate}
```

Update run button:

```tsx
disabled={disabled || busy}
```

- [ ] **Step 4: Run card tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/components/__tests__/task-card.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-card.tsx desktop/src/modules/task-scheduler/components/__tests__/task-card.test.tsx
git commit -m "feat: show invalid scheduled tasks in list"
```

## Task 5: Edit Warning Dialog and Renderer Guards

**Files:**
- Modify: `desktop/src/modules/task-scheduler/index.tsx`
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

- [ ] **Step 1: Add failing module tests**

In `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`, add:

```ts
it("shows update guidance before editing a task that needs update", async () => {
  mocks.useTaskSchedulerTasks.mockReturnValue({
    tasks: [
      createTask({
        validation: {
          status: "needs_update",
          issues: [
            { field: "action.config.providerId", message: "选择供应商" },
            { field: "action.config.modelTier", message: "选择模型" },
          ],
        },
      }),
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<TaskSchedulerModule />)
  })

  const editItem = [...container.querySelectorAll<HTMLElement>("[role='menuitem'],button")]
    .find((node) => node.textContent?.includes("编辑"))
  expect(editItem).toBeTruthy()

  await act(async () => {
    editItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })

  expect(container.textContent).toContain("任务需要更新")
  expect(container.textContent).toContain("选择供应商")
  expect(container.textContent).toContain("选择模型")
})
```

Add a second test for valid tasks:

```ts
it("opens the edit form directly for valid tasks", async () => {
  mocks.useTaskSchedulerTasks.mockReturnValue({
    tasks: [createTask({ validation: { status: "valid", issues: [] } })],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })
  const html = renderToStaticMarkup(<TaskSchedulerModule />)
  expect(html).not.toContain("任务需要更新")
})
```

- [ ] **Step 2: Run the failing module tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: FAIL because there is no update guidance dialog.

- [ ] **Step 3: Add dialog state and edit handler**

In `TaskSchedulerModule`, add state:

```ts
const [updateTarget, setUpdateTarget] = useState<ScheduledTask | null>(null)
```

Add helper:

```ts
function openTaskEditor(task: ScheduledTask) {
  setFormState({ mode: "edit", task })
  setIsFormOpen(true)
}

function handleEditTask(task: ScheduledTask) {
  if (task.validation?.status === "needs_update") {
    setUpdateTarget(task)
    return
  }
  openTaskEditor(task)
}
```

Use in `TaskCardGrid`:

```tsx
onEdit={handleEditTask}
```

Add renderer guards:

```ts
if (task.validation?.status === "needs_update") {
  notify({ message: "任务需要更新", tone: "destructive" })
  return
}
```

Place that guard at the top of `handleRunTask` and before calling `setTaskEnabled` in `onToggleEnabled`.

- [ ] **Step 4: Render the update dialog**

Below the delete dialog, add:

```tsx
<AlertDialog open={updateTarget !== null} onOpenChange={(open) => !open && setUpdateTarget(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>任务需要更新</AlertDialogTitle>
      <AlertDialogDescription asChild>
        <div className="space-y-2">
          <p>完成以下项目后才能启用。</p>
          <ul className="list-disc space-y-1 pl-5">
            {(updateTarget?.validation?.status === "needs_update"
              ? updateTarget.validation.issues
              : []
            ).map((issue) => (
              <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>取消</AlertDialogCancel>
      <AlertDialogAction
        onClick={() => {
          const task = updateTarget
          setUpdateTarget(null)
          if (task) openTaskEditor(task)
        }}
      >
        去编辑
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Use existing shadcn alert dialog components and token classes only.

- [ ] **Step 5: Run module tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/task-scheduler/index.tsx desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
git commit -m "feat: guide users to update invalid scheduled tasks"
```

## Task 6: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- action-packages/builtin/agent/__tests__/schema.test.ts electron/action-runtime/__tests__/action-registry.test.ts electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts electron/modules/task-scheduler/__tests__/ipc.test.ts src/modules/task-scheduler/components/__tests__/task-card.test.tsx src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only files from this plan are changed after the last implementation commit. Existing unrelated dirty files from before implementation must not be staged or modified.
