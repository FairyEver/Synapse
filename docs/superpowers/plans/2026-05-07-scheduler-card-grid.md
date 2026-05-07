# 定时任务卡片网格重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将定时任务列表页从表格布局重构为 3 列卡片网格，提升视觉轻量感和信息可读性。

**Architecture:** 从 `index.tsx` 中提取卡片组件 `task-card.tsx` 和网格容器 `task-card-grid.tsx`，替换现有 Table 渲染逻辑。页面入口保留工具栏和对话框管理，卡片组件负责单任务展示和操作。

**Tech Stack:** React 19, shadcn/ui (Button, Switch, DropdownMenu, Tooltip), Tailwind CSS 4, Lucide icons

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `desktop/src/modules/task-scheduler/components/task-card.tsx` | Create | 单张任务卡片：标题行(状态圆点+名称)、信息区、操作栏 |
| `desktop/src/modules/task-scheduler/components/task-card-grid.tsx` | Create | 网格容器：3列布局 + 空状态 |
| `desktop/src/modules/task-scheduler/index.tsx` | Modify | 移除 Table 相关代码，引入 TaskCardGrid |
| `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx` | Modify | 更新断言适配卡片结构 |

---

### Task 1: Create TaskCard Component

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/task-card.tsx`

- [ ] **Step 1: Create task-card.tsx with full implementation**

```tsx
import { MoreHorizontal, Pencil, History, Play, Square, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ScheduledTask } from "@/types/task-scheduler"
import { formatTaskDate, formatTaskTrigger } from "../utils"

type TaskCardProps = {
  task: ScheduledTask
  busy: boolean
  onRun: () => void
  onStop: () => void
  onToggleEnabled: (enabled: boolean) => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}

function getStatusColor(task: ScheduledTask): string {
  if (!task.enabled) return "bg-muted-foreground"
  if (task.lastStatus === "failed" || task.lastStatus === "timeout") return "bg-destructive"
  return "bg-green-500"
}

function TaskCard({
  task,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
}: TaskCardProps) {
  const isRunning = task.lastStatus === undefined && task.lastRunAt && !task.lastStatus
  // Note: actual "running" state comes from runtime inspection, not lastStatus.
  // For now we rely on lastStatus being absent with a recent lastRunAt as a heuristic.
  // The parent can pass a `running` prop if runtime state is available.

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg bg-background px-4 py-4 transition-shadow hover:ring-2 hover:ring-muted-foreground/25${!task.enabled ? " opacity-60" : ""}`}
    >
      {/* Title row */}
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 shrink-0 rounded-full ${getStatusColor(task)}`} />
        <span className="truncate text-sm font-medium">{task.name}</span>
      </div>

      {/* Info area */}
      <div className="flex flex-1 flex-col gap-1.5">
        <InfoRow label="触发" value={formatTaskTrigger(task)} />
        <InfoRow label="上次" value={formatTaskDate(task.lastRunAt, "未运行")} />
        <InfoRow label="下次" value={task.enabled ? formatTaskDate(task.nextRunAt, "未排期") : "—"} />
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                disabled={busy || !task.enabled}
                size="icon-sm"
                variant="ghost"
                onClick={onRun}
              >
                <Play />
                <span className="sr-only">运行</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>运行</TooltipContent>
          </Tooltip>
          <Switch
            checked={task.enabled}
            disabled={busy}
            size="sm"
            onCheckedChange={onToggleEnabled}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost">
              <MoreHorizontal />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onHistory}>
              <History />
              运行历史
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate pl-2 text-foreground">{value}</span>
    </div>
  )
}

export { TaskCard }
export type { TaskCardProps }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to task-card.tsx

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-card.tsx
git commit -m "feat(scheduler): add TaskCard component for grid layout"
```

---

### Task 2: Create TaskCardGrid Component

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/task-card-grid.tsx`

- [ ] **Step 1: Create task-card-grid.tsx**

```tsx
import { History, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { ScheduledTask } from "@/types/task-scheduler"
import { TaskCard } from "./task-card"

type TaskCardGridProps = {
  tasks: ScheduledTask[]
  busy: boolean
  onRun: (task: ScheduledTask) => void
  onStop: (task: ScheduledTask) => void
  onToggleEnabled: (task: ScheduledTask, enabled: boolean) => void
  onEdit: (task: ScheduledTask) => void
  onHistory: (task: ScheduledTask) => void
  onDelete: (task: ScheduledTask) => void
  onCreateNew: () => void
}

function TaskCardGrid({
  tasks,
  busy,
  onRun,
  onStop,
  onToggleEnabled,
  onEdit,
  onHistory,
  onDelete,
  onCreateNew,
}: TaskCardGridProps) {
  if (tasks.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyTitle>暂无任务</EmptyTitle>
          <EmptyDescription>新建任务后会按计划执行。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onCreateNew}>
            <Plus />
            新建任务
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          busy={busy}
          task={task}
          onDelete={() => onDelete(task)}
          onEdit={() => onEdit(task)}
          onHistory={() => onHistory(task)}
          onRun={() => onRun(task)}
          onStop={() => onStop(task)}
          onToggleEnabled={(enabled) => onToggleEnabled(task, enabled)}
        />
      ))}
    </div>
  )
}

export { TaskCardGrid }
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-card-grid.tsx
git commit -m "feat(scheduler): add TaskCardGrid container component"
```

---

### Task 3: Refactor index.tsx to Use Card Grid

**Files:**
- Modify: `desktop/src/modules/task-scheduler/index.tsx`

- [ ] **Step 1: Replace Table imports and rendering with TaskCardGrid**

Remove these imports from index.tsx:
```tsx
// Remove:
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
```

Add this import:
```tsx
import { TaskCardGrid } from "./components/task-card-grid"
```

Remove the `StatusBadge` function (lines 451-459).

Remove the `IconButton` function (lines 461-488) — it's still used in the toolbar, so keep it but remove the `History`, `Pencil`, `Trash2` imports that are no longer needed at the top level. Actually, `IconButton` is still used for toolbar buttons (refresh, import, export), so keep it. Remove only `History`, `Pencil`, `Trash2`, `Badge` from the top-level imports since they move into the card component.

- [ ] **Step 2: Replace the table rendering block (lines 292-380) with TaskCardGrid**

Replace the entire `{tasks.length > 0 ? ( <div className="overflow-x-auto ..."> ... </div> ) : null}` block with:

```tsx
{!loading && !error ? (
  <TaskCardGrid
    busy={busy}
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
      void runMutation(
        () => runTask(task.id),
        { loading: "正在启动任务...", success: "任务已启动。", error: "启动任务失败。" },
      )
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
) : null}
```

Also remove the separate empty state block (lines 269-289) since `TaskCardGrid` handles it internally.

- [ ] **Step 3: Clean up unused imports**

After refactoring, the top-level imports should be:
- Remove: `Badge`, `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`, `History` (from lucide — it's now in the card), `Pencil`, `Trash2`, `Play`
- Keep: `Download`, `LoaderCircle`, `Plus`, `RefreshCw`, `Upload` (toolbar icons)
- Keep: `Switch` only if still used in toolbar — actually it's not, remove it too (moved to card)
- Remove: `formatTaskAction`, `formatTaskScope`, `formatTaskStatus` from utils import (no longer used in index.tsx)

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd desktop && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/task-scheduler/index.tsx
git commit -m "refactor(scheduler): replace table with card grid layout"
```

---

### Task 4: Update Tests

**Files:**
- Modify: `desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`

- [ ] **Step 1: Update test assertions**

The existing tests use `renderToStaticMarkup` and check HTML content. Update them to work with the new card structure:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TaskSchedulerModule } from "../index"
import type { ScheduledTask } from "@/types/task-scheduler"

const useTaskSchedulerTasksMock = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [],
      },
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: async <T,>(operation: () => Promise<T>) => operation(),
  }),
}))

vi.mock("../hooks/use-task-scheduler", async () => {
  const actual = await vi.importActual<typeof import("../hooks/use-task-scheduler")>(
    "../hooks/use-task-scheduler",
  )

  return {
    ...actual,
    useTaskSchedulerTasks: useTaskSchedulerTasksMock,
  }
})

vi.mock("../components/task-form-dialog", () => ({
  TaskFormDialog: () => null,
}))

vi.mock("../components/task-runs-dialog", () => ({
  TaskRunsDialog: () => null,
}))

describe("TaskSchedulerModule", () => {
  it("renders empty state when no tasks", () => {
    useTaskSchedulerTasksMock.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("暂无任务")
  })

  it("renders task cards with names", () => {
    useTaskSchedulerTasksMock.mockReturnValue({
      tasks: [createTask({ name: "My Backup" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("My Backup")
  })

  it("renders trigger info in cards", () => {
    useTaskSchedulerTasksMock.mockReturnValue({
      tasks: [createTask()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<TaskSchedulerModule />)

    expect(html).toContain("每 1 分钟")
  })
})

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    schemaVersion: 2,
    name: "Backup",
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 1, anchor: "created_at" },
    },
    action: {
      type: "builtin.command",
      config: {
        command: "echo ok",
        shell: "posix",
        timeoutMins: 30,
      },
    },
    enabled: true,
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run tests**

Run: `cd desktop && npx vitest run src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/__tests__/task-scheduler-module.test.tsx
git commit -m "test(scheduler): update module tests for card grid layout"
```

---

### Task 5: Visual Verification

- [ ] **Step 1: Run dev server and verify in browser**

Run: `cd /Users/liyang/Documents/code/github/Synapse && pnpm dev`

Open the app, navigate to the Task Scheduler module. Verify:
- 3-column grid layout renders correctly
- Cards show status dot, name, trigger, last run, next run
- Disabled tasks appear with reduced opacity
- Switch toggles work
- Run button triggers task execution
- More menu opens with Edit, History, Delete options
- Empty state shows when no tasks exist

- [ ] **Step 2: Verify no TypeScript or lint errors**

Run: `cd desktop && npx tsc --noEmit && npx eslint src/modules/task-scheduler/ --ext .ts,.tsx`

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(scheduler): address visual/lint issues from card grid refactor"
```
