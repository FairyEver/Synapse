# Task Scheduler Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add import/export functionality to the task scheduler module, allowing users to export selected tasks as JSON and import tasks from JSON files.

**Architecture:** Two new IPC methods handle file dialog + I/O in the main process (following the existing `databaseExport`/`databaseTableImportInspect` pattern). The renderer handles task selection UI via two new dialog components. Imported tasks are created one-by-one via the existing `tasks:create` IPC with `enabled: false`.

**Tech Stack:** React 19, shadcn/ui (Dialog, Checkbox, Button), Electron dialog API, existing IPC module pattern (Zod-validated)

---

### Task 1: Add IPC methods for file I/O

**Files:**
- Modify: `desktop/electron/modules/task-scheduler/ipc.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/preload.ts`

- [ ] **Step 1: Add `exportTasksToFile` IPC method**

In `desktop/electron/modules/task-scheduler/ipc.ts`, add imports at the top:

```typescript
import { BrowserWindow, dialog } from "electron"
import { writeFile, readFile } from "node:fs/promises"
```

Add to the `methods` object after `listRuns`:

```typescript
exportTasksToFile: {
  channel: "synapse:task-scheduler:tasks:export-to-file",
  kind: "invoke",
  request: z.object({ json: z.string() }),
  response: z.object({ success: z.boolean(), path: z.string().optional() }),
  handler: async (_ctx, request: { json: string }) => {
    const parentWindow = BrowserWindow.getFocusedWindow()
      ?? BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isDestroyed())
      ?? undefined
    const defaultName = `synapse-tasks-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.json`
    const result = await dialog.showSaveDialog(parentWindow as unknown as Electron.BaseWindow, {
      title: "导出任务",
      defaultPath: defaultName,
      filters: [{ name: "JSON", extensions: ["json"] }],
    })
    if (result.canceled || !result.filePath) {
      return { success: false }
    }
    await writeFile(result.filePath, request.json, "utf-8")
    return { success: true, path: result.filePath }
  },
},
```

- [ ] **Step 2: Add `importTasksFromFile` IPC method**

In the same file, add after `exportTasksToFile`:

```typescript
importTasksFromFile: {
  channel: "synapse:task-scheduler:tasks:import-from-file",
  kind: "invoke",
  request: z.void().optional(),
  response: z.object({ success: z.boolean(), content: z.string().optional() }),
  handler: async () => {
    const parentWindow = BrowserWindow.getFocusedWindow()
      ?? BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isDestroyed())
      ?? undefined
    const result = await dialog.showOpenDialog(parentWindow as unknown as Electron.BaseWindow, {
      title: "导入任务",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false }
    }
    const content = await readFile(result.filePaths[0], "utf-8")
    return { success: true, content }
  },
},
```

- [ ] **Step 3: Add bridge type definitions**

In `desktop/src/types/bridge.ts`, add to the `taskScheduler` section:

```typescript
exportTasksToFile: (json: string) => Promise<{ success: boolean; path?: string }>
importTasksFromFile: () => Promise<{ success: boolean; content?: string }>
```

- [ ] **Step 4: Add preload bridge wiring**

In `desktop/electron/preload.ts`, add channel entries to the `IPC_CHANNELS["task-scheduler"]` object (around line 150):

```typescript
"exportTasksToFile": "synapse:task-scheduler:tasks:export-to-file",
"importTasksFromFile": "synapse:task-scheduler:tasks:import-from-file",
```

Then add bridge methods to the `taskScheduler` section (around line 516, after `listRuns`):

```typescript
exportTasksToFile: (json: string) => invoke(IPC_CHANNELS["task-scheduler"].exportTasksToFile)({ json }),
importTasksFromFile: () => invoke(IPC_CHANNELS["task-scheduler"].importTasksFromFile)(),
```

- [ ] **Step 5: Verify build compiles**

Run: `cd desktop && pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/modules/task-scheduler/ipc.ts desktop/src/types/bridge.ts desktop/electron/preload.ts
git commit -m "feat(scheduler): add IPC methods for task import/export file I/O"
```

---

### Task 2: Add export types and serialization utility

**Files:**
- Modify: `desktop/src/modules/task-scheduler/types.ts`
- Modify: `desktop/src/modules/task-scheduler/utils.ts`

- [ ] **Step 1: Add export file format type**

In `desktop/src/modules/task-scheduler/types.ts`, add:

```typescript
type TaskExportEntry = {
  name: string
  description?: string
  scope: ScheduledTaskScope
  cwd?: string
  trigger: ScheduledTaskTrigger
  action: ScheduledTaskActionRef
  missedRunPolicy: "skip" | "run_once"
}

type TaskExportFile = {
  version: 1
  exportedAt: string
  tasks: TaskExportEntry[]
}
```

Add imports for `ScheduledTaskScope`, `ScheduledTaskTrigger`, `ScheduledTaskActionRef` from `@/types/task-scheduler`.

Export the new types.

- [ ] **Step 2: Add serialization functions and widen `formatTaskTrigger`**

In `desktop/src/modules/task-scheduler/utils.ts`, add imports for `TaskExportEntry` and `TaskExportFile` from `./types`.

Widen `formatTaskTrigger` signature to accept any object with a `trigger` field:

```typescript
function formatTaskTrigger(task: Pick<ScheduledTask, "trigger">): string {
  if (task.trigger.type === "builtin.cron") {
    return `Cron · ${task.trigger.config.expr}`
  }
  return task.trigger.config.anchor === "last_completed_at"
    ? `每 ${task.trigger.config.everyMinutes} 分钟 · 完成后`
    : `每 ${task.trigger.config.everyMinutes} 分钟`
}
```

This is backward-compatible since `ScheduledTask` satisfies `Pick<ScheduledTask, "trigger">`. It also allows `TaskExportEntry` to be passed directly.

Add the serialization functions:

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
      missedRunPolicy: task.missedRunPolicy,
    })),
  }
}

function parseTaskImportFile(content: string): TaskExportFile {
  const data = JSON.parse(content) as unknown
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    !("tasks" in data) ||
    !Array.isArray((data as { tasks: unknown }).tasks)
  ) {
    throw new Error("文件格式无效")
  }
  return data as TaskExportFile
}
```

Export both functions.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/types.ts desktop/src/modules/task-scheduler/utils.ts
git commit -m "feat(scheduler): add task export/import types and serialization"
```

---

### Task 3: Create export dialog component

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/task-export-dialog.tsx`

- [ ] **Step 1: Create the export dialog**

```tsx
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ScheduledTask } from "@/types/task-scheduler"
import { formatTaskTrigger } from "../utils"

function TaskExportDialog({
  open,
  onOpenChange,
  tasks,
  onExport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tasks: ScheduledTask[]
  onExport: (selectedIds: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected = selected.size === tasks.length && tasks.length > 0
  const someSelected = selected.size > 0 && selected.size < tasks.length

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(tasks.map((t) => t.id)))
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出任务</DialogTitle>
          <DialogDescription>选择要导出的任务</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b pb-2">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
          />
          <span className="text-sm text-muted-foreground">
            已选 {selected.size} 项
          </span>
        </div>
        <ScrollArea className="max-h-64">
          <div className="flex flex-col gap-1">
            {tasks.map((task) => (
              <label
                key={task.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={selected.has(task.id)}
                  onCheckedChange={() => toggle(task.id)}
                />
                <span className="flex-1 truncate text-sm">{task.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTaskTrigger(task)}
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => onExport(Array.from(selected))}
          >
            导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TaskExportDialog }
```

- [ ] **Step 2: Verify build compiles**

Run: `cd desktop && pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-export-dialog.tsx
git commit -m "feat(scheduler): add task export dialog component"
```

---

### Task 4: Create import dialog component

**Files:**
- Create: `desktop/src/modules/task-scheduler/components/task-import-dialog.tsx`

- [ ] **Step 1: Create the import dialog**

```tsx
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { TaskExportEntry } from "../types"
import { formatTaskTrigger } from "../utils"

function TaskImportDialog({
  open,
  onOpenChange,
  entries,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: TaskExportEntry[]
  onImport: (indices: number[]) => void
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(entries.map((_, i) => i)),
  )

  const allSelected = selected.size === entries.length && entries.length > 0
  const someSelected = selected.size > 0 && selected.size < entries.length

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(entries.map((_, i) => i)))
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导入任务</DialogTitle>
          <DialogDescription>选择要导入的任务</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b pb-2">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
          />
          <span className="text-sm text-muted-foreground">
            已选 {selected.size} 项
          </span>
        </div>
        <ScrollArea className="max-h-64">
          <div className="flex flex-col gap-1">
            {entries.map((entry, index) => (
              <label
                key={index}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  checked={selected.has(index)}
                  onCheckedChange={() => toggle(index)}
                />
                <span className="flex-1 truncate text-sm">{entry.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatTaskTrigger(entry)}
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">
          导入的任务默认为未启用状态
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => onImport(Array.from(selected))}
          >
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TaskImportDialog }
```

- [ ] **Step 2: Verify build compiles**

Run: `cd desktop && pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/task-scheduler/components/task-import-dialog.tsx
git commit -m "feat(scheduler): add task import dialog component"
```

---

### Task 5: Wire up import/export in the module index

**Files:**
- Modify: `desktop/src/modules/task-scheduler/index.tsx`
- Modify: `desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts`

- [ ] **Step 1: Add IPC wrapper functions to hooks**

In `desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts`, add:

```typescript
async function exportTasksToFile(json: string): Promise<{ success: boolean; path?: string }> {
  return requireSynapseBridge().taskScheduler.exportTasksToFile(json)
}

async function importTasksFromFile(): Promise<{ success: boolean; content?: string }> {
  return requireSynapseBridge().taskScheduler.importTasksFromFile()
}
```

Export both functions.

- [ ] **Step 2: Add import/export buttons and dialog state to index**

In `desktop/src/modules/task-scheduler/index.tsx`:

Add imports:
```typescript
import { Download, Upload } from "lucide-react"
import { TaskExportDialog } from "./components/task-export-dialog"
import { TaskImportDialog } from "./components/task-import-dialog"
import type { TaskExportEntry } from "./types"
import {
  exportTasksToFile,
  importTasksFromFile,
} from "./hooks/use-task-scheduler"
import { parseTaskImportFile, serializeTasksForExport } from "./utils"
```

Add state inside `TaskSchedulerModule`:
```typescript
const [isExportOpen, setIsExportOpen] = useState(false)
const [importEntries, setImportEntries] = useState<TaskExportEntry[] | null>(null)
```

Add handler functions:
```typescript
async function handleExport(selectedIds: string[]) {
  const selectedTasks = tasks.filter((t) => selectedIds.includes(t.id))
  const exportData = serializeTasksForExport(selectedTasks)
  const json = JSON.stringify(exportData, null, 2)
  const result = await exportTasksToFile(json)
  if (result.success) {
    setIsExportOpen(false)
  }
}

async function handleImportStart() {
  const result = await importTasksFromFile()
  if (!result.success || !result.content) return
  try {
    const parsed = parseTaskImportFile(result.content)
    setImportEntries(parsed.tasks)
  } catch {
    promise(
      () => Promise.reject(new Error("文件格式无效")),
      { loading: "", success: "", error: "文件格式无效" },
    )
  }
}

async function handleImport(indices: number[]) {
  if (!importEntries) return
  const selected = indices.map((i) => importEntries[i])
  let successCount = 0
  let failCount = 0
  for (const entry of selected) {
    try {
      await createTask({
        name: entry.name,
        description: entry.description,
        scope: entry.scope,
        cwd: entry.cwd,
        trigger: entry.trigger,
        action: entry.action,
        enabled: false,
        missedRunPolicy: entry.missedRunPolicy,
      })
      successCount++
    } catch {
      failCount++
    }
  }
  setImportEntries(null)
  await refresh()
  const msg = failCount > 0
    ? `已导入 ${successCount} 个任务，${failCount} 个失败`
    : `已导入 ${successCount} 个任务`
  promise(
    () => Promise.resolve(null),
    { loading: "", success: msg, error: "" },
  )
}
```

- [ ] **Step 3: Add buttons to toolbar**

Replace the toolbar `<div className="flex items-center gap-2">` section:

```tsx
<div className="flex items-center gap-2">
  <IconButton
    label="刷新"
    onClick={() => {
      void refresh()
    }}
  >
    <RefreshCw />
  </IconButton>
  <IconButton
    label="导入"
    onClick={() => void handleImportStart()}
  >
    <Upload />
  </IconButton>
  <IconButton
    label="导出"
    disabled={tasks.length === 0}
    onClick={() => setIsExportOpen(true)}
  >
    <Download />
  </IconButton>
  <Button
    onClick={() => {
      setFormState({ mode: "create" })
      setIsFormOpen(true)
    }}
  >
    <Plus />
    新建任务
  </Button>
</div>
```

Update `IconButton` props type to include optional `disabled`:
```typescript
function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  label: string
  onClick: () => void
}) {
```

(Already has `disabled` — no change needed.)

- [ ] **Step 4: Add dialog components to JSX**

Before the closing `</TooltipProvider>`, add:

```tsx
<TaskExportDialog
  open={isExportOpen}
  onOpenChange={setIsExportOpen}
  tasks={tasks}
  onExport={(ids) => void handleExport(ids)}
/>
{importEntries ? (
  <TaskImportDialog
    open={true}
    onOpenChange={(open) => { if (!open) setImportEntries(null) }}
    entries={importEntries}
    onImport={(indices) => void handleImport(indices)}
  />
) : null}
```

- [ ] **Step 5: Verify build compiles**

Run: `cd desktop && pnpm tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/task-scheduler/index.tsx desktop/src/modules/task-scheduler/hooks/use-task-scheduler.ts
git commit -m "feat(scheduler): wire up import/export UI in task scheduler module"
```

---

### Task 6: Manual testing

- [ ] **Step 1: Start dev server**

Run: `pnpm dev`

- [ ] **Step 2: Test export flow**

1. Navigate to task scheduler
2. Create 2-3 test tasks if none exist
3. Click export (Download) icon button
4. Verify modal shows all tasks with checkboxes
5. Test select all / deselect / partial select
6. Click export, verify save dialog appears
7. Save file, verify JSON content is correct (has version, exportedAt, tasks array with correct fields, no id/enabled/timestamps)

- [ ] **Step 3: Test import flow**

1. Click import (Upload) icon button
2. Select the previously exported JSON file
3. Verify modal shows tasks with all checked by default
4. Deselect one task, click import
5. Verify toast shows correct count
6. Verify imported tasks appear in list with enabled=false
7. Verify no deduplication (import same file again, get duplicates)

- [ ] **Step 4: Test error cases**

1. Try importing a non-JSON file → verify "文件格式无效" toast
2. Try importing a JSON file without `tasks` array → verify error toast
3. Cancel file dialog → verify nothing happens
4. Try export with 0 tasks selected → verify button is disabled

- [ ] **Step 5: Commit any fixes**

If any issues found during testing, fix and commit.
