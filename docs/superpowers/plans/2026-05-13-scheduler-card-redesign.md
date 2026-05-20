# Scheduler Task Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign scheduler task cards so enabled, disabled, failed, next-run, trigger, scope, and primary action states are easier to scan.

**Architecture:** Keep the change renderer-only and module-local. Add focused SSR tests first, then pass existing project config into `TaskCard`, reuse task scheduler formatting helpers, and replace the card body with a shadcn/Radix-aligned status-driven layout.

**Tech Stack:** Electron renderer, React, TypeScript, Tailwind token classes, shadcn/ui, Radix primitives, Vitest SSR tests.

---

## File Structure

- Modify `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`: add static rendering coverage for card status, primary action labels, secondary menu items, description, and project scope.
- Modify `desktop/src/modules/task-scheduler/index.tsx`: pass `config.global.projects` into `TaskCardGrid`.
- Modify `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`: accept `projects` and forward it to each card.
- Modify `desktop/src/modules/task-scheduler/components/task-card.tsx`: implement the status-driven card layout using existing UI primitives.
- Inspect `desktop/src/modules/task-scheduler/utils.ts`: reuse existing exported formatting helpers; this plan does not require changing it.

Create no production files. Do not add dependencies, CSS files, CSS modules, inline styles, or theme changes.

---

### Task 1: Add Failing Card Rendering Tests

**Files:**
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

- [ ] **Step 1: Update the mocked project config**

Replace the current `projects: []` mock with this project list so the card can prove it renders scope through `formatTaskScope`:

```tsx
projects: [
  {
    id: "project-1",
    name: "Synapse",
    path: "/Users/liyang/Documents/code/github/Synapse",
  },
],
```

- [ ] **Step 2: Add card hierarchy tests**

Append these tests inside `describe("TaskSchedulerModule", () => { ... })`, after the existing tests:

```tsx
it("renders enabled task card status, next run, description, and primary run action", () => {
  useTaskSchedulerTasksMock.mockReturnValue({
    tasks: [
      createTask({
        name: "同步项目工作日志",
        description: "Codex 工作日志汇总",
        scope: { type: "project", projectId: "project-1" },
        nextRunAt: "2026-05-13T10:30:00.000Z",
        lastRunAt: "2026-05-13T01:00:00.000Z",
        lastStatus: "success",
      }),
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const html = renderToStaticMarkup(<TaskSchedulerModule />)

  expect(html).toContain("已启用")
  expect(html).toContain("同步项目工作日志")
  expect(html).toContain("Codex 工作日志汇总")
  expect(html).toContain("下次执行")
  expect(html).toContain("运行")
  expect(html).toContain("上次")
  expect(html).toContain("成功")
  expect(html).toContain("范围")
  expect(html).toContain("Synapse")
})

it("renders failed task card as retryable", () => {
  useTaskSchedulerTasksMock.mockReturnValue({
    tasks: [
      createTask({
        name: "仓库健康检查",
        lastStatus: "failed",
        lastRunAt: "2026-05-13T02:12:00.000Z",
      }),
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const html = renderToStaticMarkup(<TaskSchedulerModule />)

  expect(html).toContain("上次失败")
  expect(html).toContain("重试")
  expect(html).toContain("失败")
})

it("renders disabled task card with stopped schedule state", () => {
  useTaskSchedulerTasksMock.mockReturnValue({
    tasks: [
      createTask({
        name: "夜间归档",
        enabled: false,
        nextRunAt: "2026-05-13T18:00:00.000Z",
      }),
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const html = renderToStaticMarkup(<TaskSchedulerModule />)

  expect(html).toContain("已停用")
  expect(html).toContain("停用中")
})

it("renders secondary actions through the task card menu", () => {
  useTaskSchedulerTasksMock.mockReturnValue({
    tasks: [createTask({ name: "Backup" })],
    loading: false,
    error: null,
    refresh: vi.fn(),
  })

  const html = renderToStaticMarkup(<TaskSchedulerModule />)

  expect(html).toContain("编辑")
  expect(html).toContain("历史")
  expect(html).toContain("删除")
})
```

- [ ] **Step 3: Run tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop run test -- task-scheduler-module
```

Expected: at least one new assertion fails because the current card does not render `已启用`, `重试`, `停用中`, project scope, or menu text.

- [ ] **Step 4: Commit failing tests**

Leave the failing test changes unstaged until Task 3 passes. Keep committed checkpoints green.

---

### Task 2: Pass Project Config Into Task Cards

**Files:**
- Modify: `desktop/src/modules/task-scheduler/index.tsx`
- Modify: `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`
- Modify: `desktop/src/modules/task-scheduler/components/task-card.tsx`

- [ ] **Step 1: Add a projects prop to `TaskCardGrid`**

In `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`, import the project config type and add a prop:

```tsx
import type { SynapseProjectConfig } from "@/types/config"
```

Extend `TaskCardGridProps`:

```tsx
type TaskCardGridProps = {
  tasks: ScheduledTask[]
  projects: readonly SynapseProjectConfig[]
  busy: boolean
  onRun: (task: ScheduledTask) => void
  onStop: (task: ScheduledTask) => void
  onToggleEnabled: (task: ScheduledTask, enabled: boolean) => void
  onEdit: (task: ScheduledTask) => void
  onHistory: (task: ScheduledTask) => void
  onDelete: (task: ScheduledTask) => void
  onCreateNew: () => void
}
```

Destructure `projects` in the component parameters and pass it into `TaskCard`:

```tsx
function TaskCardGrid({
  tasks,
  projects,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
  onCreateNew,
}: TaskCardGridProps) {
  // existing empty state stays unchanged

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          projects={projects}
          busy={busy}
          onRun={() => onRun(task)}
          onStop={() => onStop(task)}
          onToggleEnabled={(enabled) => onToggleEnabled(task, enabled)}
          onEdit={() => onEdit(task)}
          onHistory={() => onHistory(task)}
          onDelete={() => onDelete(task)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Add a projects prop to `TaskCard`**

In `desktop/src/modules/task-scheduler/components/task-card.tsx`, import the project type:

```tsx
import type { SynapseProjectConfig } from "@/types/config"
```

Extend `TaskCardProps`:

```tsx
type TaskCardProps = {
  task: ScheduledTask
  projects: readonly SynapseProjectConfig[]
  busy: boolean
  onRun: () => void
  onStop: () => void
  onToggleEnabled: (enabled: boolean) => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}
```

Destructure `projects` in `TaskCard`.

- [ ] **Step 3: Pass projects from the module entry**

In `desktop/src/modules/task-scheduler/index.tsx`, add `projects={config.global.projects}` to the `TaskCardGrid` call:

```tsx
<TaskCardGrid
  busy={busy}
  projects={config.global.projects}
  tasks={tasks}
  onCreateNew={() => {
    setFormState({ mode: "create" })
    setIsFormOpen(true)
  }}
  onDelete={(task) => setDeleteTarget(task)}
  onEdit={(task) => {
    setFormState({ mode: "edit", task })
    setIsFormOpen(true)
  }}
  onHistory={(task) => setHistoryTask(task)}
  onRun={(task) => {
    if (task.action.type === "builtin.agent") {
      const projectId = task.action.config["projectId"]
      if (typeof projectId === "string" && projectId) {
        requestWatchNextAgentSession({ projectId })
      }
    }
    runTask(task.id).catch((err) => {
      logger.error("Failed to run task.", { error: err, taskId: task.id })
    })
    notify({ message: "任务已触发", tone: "success" })
  }}
  onStop={(task) => {
    void runMutation(
      () => stopRun(task.id),
      { loading: "正在停止运行...", success: "运行已停止。", error: "停止运行失败。" },
    )
  }}
  onToggleEnabled={(task, enabled) => {
    void runMutation(
      () => setTaskEnabled(task.id, enabled),
      {
        loading: enabled ? "正在启用任务..." : "正在停用任务...",
        success: enabled ? "任务已启用。" : "任务已停用。",
        error: "更新任务失败。",
      },
    )
  }}
/>
```

- [ ] **Step 4: Run TypeScript-aware tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- task-scheduler-module
```

Expected: tests still fail on visual text assertions until Task 3. There are no missing prop or import runtime errors.

---

### Task 3: Implement the Status-Driven Card Layout

**Files:**
- Modify: `desktop/src/modules/task-scheduler/components/task-card.tsx`
- Inspect: `desktop/src/modules/task-scheduler/utils.ts`

- [ ] **Step 1: Export or reuse status formatting**

`formatTaskStatus` is already exported from `desktop/src/modules/task-scheduler/utils.ts`. Keep it as the status label source. Do not duplicate status label maps in the card.

- [ ] **Step 2: Replace `TaskCard` imports**

In `desktop/src/modules/task-scheduler/components/task-card.tsx`, use these imports:

```tsx
import {
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTask } from "@/types/task-scheduler"
import {
  formatTaskDate,
  formatTaskScope,
  formatTaskStatus,
  formatTaskTrigger,
} from "../utils"
```

- [ ] **Step 3: Add local card display helpers**

Add these helpers above `TaskCard`:

```tsx
function getStatusBadge(task: ScheduledTask): {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
} {
  if (!task.enabled) {
    return { label: "已停用", variant: "outline" }
  }
  if (task.lastStatus === "failed" || task.lastStatus === "timeout") {
    return { label: "上次失败", variant: "destructive" }
  }
  return { label: "已启用", variant: "secondary" }
}

function getPrimaryActionLabel(task: ScheduledTask, busy: boolean): string {
  if (busy) return "停止"
  if (task.lastStatus === "failed" || task.lastStatus === "timeout") return "重试"
  return "运行"
}

function formatLastRun(task: ScheduledTask): string {
  const date = formatTaskDate(task.lastRunAt, "—")
  if (!task.lastStatus) return date
  return `${date} · ${formatTaskStatus(task.lastStatus)}`
}
```

- [ ] **Step 4: Replace the card JSX**

Replace the body of `TaskCard` with this structure. Keep the existing callback names and switch behavior:

```tsx
function TaskCard({
  task,
  projects,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
}: TaskCardProps) {
  const disabled = !task.enabled
  const badge = getStatusBadge(task)
  const primaryLabel = getPrimaryActionLabel(task, busy)
  const nextRun = disabled ? "停用中" : formatTaskDate(task.nextRunAt, "—")
  const lastRun = formatLastRun(task)
  const scope = formatTaskScope(task, projects)

  return (
    <div
      className={`rounded-lg bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 ${disabled ? "opacity-70" : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <Switch
          size="sm"
          checked={task.enabled}
          onCheckedChange={onToggleEnabled}
        />
      </div>

      <div className="mt-4 min-w-0">
        <h3 className="truncate text-sm font-medium">{task.name}</h3>
        {task.description ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {task.description}
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">下次执行</p>
          <p className="mt-1 truncate text-sm font-medium">{nextRun}</p>
        </div>
        <div className="min-w-0 border-l border-border pl-3">
          <p className="text-xs text-muted-foreground">计划</p>
          <p className="mt-1 truncate text-sm font-medium">
            {formatTaskTrigger(task)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-1 text-xs">
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">上次</span>
          <span className="truncate">{lastRun}</span>
        </div>
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
          <span className="text-muted-foreground">范围</span>
          <span className="truncate">{scope}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            {busy ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onStop}
              >
                <Square className="size-3.5" />
                {primaryLabel}
              </Button>
            ) : (
              <Button
                variant={task.lastStatus === "failed" || task.lastStatus === "timeout" ? "default" : "secondary"}
                size="sm"
                disabled={disabled}
                onClick={onRun}
              >
                <Play className="size-3.5" />
                {primaryLabel}
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>{primaryLabel}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-3.5" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHistory}>
              <History className="size-3.5" />
              历史
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
```

`DropdownMenuItem` supports `variant="destructive"` in the current shadcn wrapper, so use that prop for the delete item. Do not add custom destructive text color classes.

- [ ] **Step 5: Run tests and adjust only for real failures**

Run:

```bash
pnpm --filter @synapse/desktop run test -- task-scheduler-module
```

Expected: the task scheduler module tests pass. Keep assertions focused on labels and status text, not locale-specific timestamps.

- [ ] **Step 6: Commit the implementation**

Run:

```bash
git add desktop/src/modules/task-scheduler/index.tsx desktop/src/modules/task-scheduler/components/task-card-grid.tsx desktop/src/modules/task-scheduler/components/task-card.tsx desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
git commit -m "feat: redesign scheduler task cards"
```

---

### Task 4: Final Verification

**Files:**
- Inspect: `desktop/src/modules/task-scheduler/components/task-card.tsx`
- Inspect: `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`
- Inspect: `desktop/src/modules/task-scheduler/index.tsx`
- Inspect: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

- [ ] **Step 1: Run focused task scheduler tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- task-scheduler
```

Expected: all task scheduler tests pass.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: the script exits successfully with no new constraint violations.

- [ ] **Step 3: Run a final style scan**

Run:

```bash
rg -n "style=|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|linear-gradient|styled\\." desktop/src/modules/task-scheduler/components/task-card.tsx desktop/src/modules/task-scheduler/components/task-card-grid.tsx
```

Expected: no matches.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --stat HEAD~1..HEAD
git diff HEAD~1..HEAD -- desktop/src/modules/task-scheduler
```

Expected: diff is limited to the task scheduler module and its tests. No Electron main-process, IPC, persistence, theme, or dependency files changed.

---

## Spec Coverage Checklist

- Status badge: Task 3.
- Next run and trigger schedule block: Task 3.
- Description line: Task 3.
- Scope via project config: Task 2 and Task 3.
- Primary action labels `运行` / `重试` / `停止`: Task 3.
- Secondary actions menu: Task 3.
- Renderer-only implementation: File Structure and Task 4.
- No custom styles or colors: Task 4 style scan.
- Focused tests: Task 1 and Task 4.
