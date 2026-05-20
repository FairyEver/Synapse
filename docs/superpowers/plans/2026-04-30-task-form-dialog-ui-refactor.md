# Task Form Dialog UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the task scheduler create/edit dialog into a single-page, fully expanded form with four lightweight sections and a stable dialog footer.

**Architecture:** Keep all behavior in the existing task scheduler module. Use the shared `FormDialog` wrapper for fixed header/body/footer structure and shadcn `Field` primitives for consistent form layout. Preserve existing form state, payload builders, and task scheduler APIs.

**Tech Stack:** Electron renderer, React, TypeScript, shadcn/ui, Tailwind token classes, Vitest, `react-dom/server`.

---

## File Structure

- Modify: `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`
  - Replace the flat `DialogContent` layout with `FormDialog`.
  - Group existing fields into `基础信息`, `触发计划`, `执行内容`, and `运行设置`.
  - Keep helper components local to this file.
- Create: `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`
  - Add SSR markup tests for section headings and conditional fields.
- No changes: `desktop/src/modules/task-scheduler/utils.ts`
  - Existing validation and payload builders stay untouched.

---

### Task 1: Add Dialog Structure Tests

**Files:**
- Create: `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx` with:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TaskFormDialog } from "../components/task-form-dialog"
import type { ScheduledTask } from "@/types/task-scheduler"

const noop = vi.fn()

describe("TaskFormDialog", () => {
  it("renders the four lightweight sections in create mode", () => {
    const html = renderDialog()

    expect(html).toContain("基础信息")
    expect(html).toContain("触发计划")
    expect(html).toContain("执行内容")
    expect(html).toContain("运行设置")
  })

  it("shows the project selector only for project-scoped tasks", () => {
    const globalHtml = renderDialog()
    const projectHtml = renderDialog({
      task: createTask({
        scope: { type: "project", projectId: "project-1" },
      }),
    })

    expect(globalHtml).not.toContain("task-form-project")
    expect(projectHtml).toContain("task-form-project")
  })

  it("shows interval anchor only for interval triggers", () => {
    const cronHtml = renderDialog()
    const intervalHtml = renderDialog({
      task: createTask({
        trigger: { type: "interval", everyMinutes: 15, anchor: "last_completed_at" },
      }),
    })

    expect(cronHtml).not.toContain("task-form-interval-anchor")
    expect(intervalHtml).toContain("task-form-interval-anchor")
  })

  it("uses the script label when editing a script task", () => {
    const html = renderDialog({
      task: createTask({
        action: {
          type: "shell_command",
          mode: "script",
          shell: "posix",
          content: "echo script",
          timeoutMins: 30,
        },
      }),
    })

    expect(html).toContain("脚本")
    expect(html).not.toContain(">命令</label>")
  })
})

function renderDialog(options: { task?: ScheduledTask } = {}) {
  const state = options.task
    ? { mode: "edit" as const, task: options.task }
    : { mode: "create" as const }

  return renderToStaticMarkup(
    <TaskFormDialog
      open
      busy={false}
      platform="darwin"
      projects={[{ id: "project-1", name: "Project One", path: "/tmp/project-one" }]}
      state={state}
      onCreate={async () => undefined}
      onOpenChange={noop}
      onUpdate={async () => undefined}
    />,
  )
}

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    schemaVersion: 1,
    name: "Backup",
    description: "",
    scope: { type: "global" },
    trigger: { type: "cron", expr: "0 9 * * *" },
    action: {
      type: "shell_command",
      mode: "command",
      shell: "posix",
      content: "echo ok",
      timeoutMins: 30,
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

- [ ] **Step 2: Run the new tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: FAIL because `TaskFormDialog` still lacks the section headings and stable test ids.

- [ ] **Step 3: Commit the failing tests**

Run:

```bash
git add desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
git commit -m "test: cover task form dialog sections"
```

---

### Task 2: Refactor Task Form Dialog Layout

**Files:**
- Modify: `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`

- [ ] **Step 1: Update imports**

In `desktop/src/modules/task-scheduler/components/task-form-dialog.tsx`, replace the current dialog and label imports with this shape:

```tsx
import { useEffect, useState, type ReactNode } from "react"

import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTaskCreateInput, ScheduledTaskUpdateInput } from "@/types/task-scheduler"
import type { TaskFormDialogState, TaskFormState } from "../types"
import {
  buildTaskCreateInput,
  buildTaskUpdateInput,
  createTaskFormState,
} from "../utils"
```

- [ ] **Step 2: Convert submit handling to form submit**

Replace `handleSubmit` with:

```tsx
async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault()

  try {
    if (state.mode === "edit") {
      await onUpdate(state.task.id, buildTaskUpdateInput(form))
    } else {
      await onCreate(buildTaskCreateInput(form))
    }
    onOpenChange(false)
  } catch (submitError) {
    setError(submitError instanceof Error ? submitError.message : "保存失败")
  }
}
```

- [ ] **Step 3: Replace the JSX returned by `TaskFormDialog`**

Replace the current `<Dialog>...</Dialog>` return block with:

```tsx
return (
  <Dialog data-track="task-scheduler-form-dialog" open={open} onOpenChange={onOpenChange}>
    <FormDialog
      title={state.mode === "edit" ? "编辑任务" : "新建任务"}
      contentClassName="sm:max-w-[850px]"
      footer={(
        <>
          <FieldError className="sm:mr-auto">{error}</FieldError>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy ? "正在保存..." : state.mode === "edit" ? "保存修改" : "保存"}
            </Button>
          </div>
        </>
      )}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="gap-6">
        <TaskFormSection title="基础信息">
          <div className="grid gap-2 sm:grid-cols-2">
            <TaskField label="名称" htmlFor="task-form-name">
              <Input
                id="task-form-name"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </TaskField>
            <TaskField label="作用域" htmlFor="task-form-scope">
              <Select
                value={form.scopeType}
                onValueChange={(value) => updateField("scopeType", value as TaskFormState["scopeType"])}
              >
                <SelectTrigger id="task-form-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全局</SelectItem>
                  <SelectItem value="project">项目</SelectItem>
                </SelectContent>
              </Select>
            </TaskField>
          </div>

          {form.scopeType === "project" ? (
            <TaskField label="项目" htmlFor="task-form-project">
              <Select value={form.projectId} onValueChange={(value) => updateField("projectId", value)}>
                <SelectTrigger id="task-form-project" className="w-full">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TaskField>
          ) : null}

          <TaskField label="描述" htmlFor="task-form-description">
            <Input
              id="task-form-description"
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
            />
          </TaskField>
        </TaskFormSection>

        <TaskFormSection title="触发计划">
          <div className="grid gap-2 sm:grid-cols-2">
            <TaskField label="触发方式" htmlFor="task-form-trigger-type">
              <Select
                value={form.triggerType}
                onValueChange={(value) => updateField("triggerType", value as TaskFormState["triggerType"])}
              >
                <SelectTrigger id="task-form-trigger-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron</SelectItem>
                  <SelectItem value="interval">固定间隔</SelectItem>
                </SelectContent>
              </Select>
            </TaskField>

            {form.triggerType === "cron" ? (
              <TaskField label="Cron" htmlFor="task-form-cron">
                <Input
                  id="task-form-cron"
                  value={form.cronExpr}
                  onChange={(event) => updateField("cronExpr", event.target.value)}
                />
              </TaskField>
            ) : (
              <TaskField label="间隔分钟" htmlFor="task-form-every-minutes">
                <Input
                  id="task-form-every-minutes"
                  min={1}
                  type="number"
                  value={form.everyMinutes}
                  onChange={(event) => updateField("everyMinutes", event.target.value)}
                />
              </TaskField>
            )}
          </div>

          {form.triggerType === "interval" ? (
            <TaskField label="锚点" htmlFor="task-form-interval-anchor">
              <Select
                value={form.intervalAnchor}
                onValueChange={(value) => updateField("intervalAnchor", value as TaskFormState["intervalAnchor"])}
              >
                <SelectTrigger id="task-form-interval-anchor" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">创建时间</SelectItem>
                  <SelectItem value="last_completed_at">上次完成</SelectItem>
                </SelectContent>
              </Select>
            </TaskField>
          ) : null}
        </TaskFormSection>

        <TaskFormSection title="执行内容">
          <div className="grid gap-2 sm:grid-cols-3">
            <TaskField label="执行类型" htmlFor="task-form-action-mode">
              <Select
                value={form.actionMode}
                onValueChange={(value) => updateField("actionMode", value as TaskFormState["actionMode"])}
              >
                <SelectTrigger id="task-form-action-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="command">命令</SelectItem>
                  <SelectItem value="script">脚本</SelectItem>
                </SelectContent>
              </Select>
            </TaskField>
            <TaskField label="Shell" htmlFor="task-form-shell">
              <Select
                value={form.actionShell}
                onValueChange={(value) => updateField("actionShell", value as TaskFormState["actionShell"])}
              >
                <SelectTrigger id="task-form-shell" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="posix">POSIX sh</SelectItem>
                  <SelectItem value="cmd">cmd.exe</SelectItem>
                  <SelectItem value="powershell">PowerShell</SelectItem>
                </SelectContent>
              </Select>
            </TaskField>
            <TaskField label="工作目录" htmlFor="task-form-cwd">
              <Input
                id="task-form-cwd"
                value={form.cwd}
                onChange={(event) => updateField("cwd", event.target.value)}
              />
            </TaskField>
          </div>

          <TaskField label={form.actionMode === "script" ? "脚本" : "命令"} htmlFor="task-form-action-content">
            <Textarea
              id="task-form-action-content"
              rows={6}
              value={form.actionContent}
              onChange={(event) => updateField("actionContent", event.target.value)}
            />
          </TaskField>
        </TaskFormSection>

        <TaskFormSection title="运行设置">
          <TaskField label="环境变量" htmlFor="task-form-env">
            <Textarea
              id="task-form-env"
              rows={4}
              value={form.envText}
              onChange={(event) => updateField("envText", event.target.value)}
            />
          </TaskField>

          <div className="grid gap-2 sm:grid-cols-2">
            <ToggleField
              checked={form.enabled}
              label="启用"
              onCheckedChange={(checked) => updateField("enabled", checked)}
            />
            <ToggleField
              checked={form.missedRunPolicy === "run_once"}
              label="补跑一次"
              onCheckedChange={(checked) => updateField("missedRunPolicy", checked ? "run_once" : "skip")}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
            <ToggleField
              checked={form.timeoutEnabled}
              label="超时"
              onCheckedChange={(checked) => updateField("timeoutEnabled", checked)}
            />
            <TaskField label="分钟" htmlFor="task-form-timeout-mins">
              <Input
                id="task-form-timeout-mins"
                disabled={!form.timeoutEnabled}
                min={1}
                type="number"
                value={form.timeoutMins}
                onChange={(event) => updateField("timeoutMins", event.target.value)}
              />
            </TaskField>
          </div>
        </TaskFormSection>
      </FieldGroup>
    </FormDialog>
  </Dialog>
)
```

- [ ] **Step 4: Replace local helper components**

Replace the existing `Field` helper with these local helpers, leaving `ToggleField` local:

```tsx
function TaskFormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="grid gap-2">{children}</div>
    </section>
  )
}

function TaskField({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode
  htmlFor: string
  label: string
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      <FieldContent>{children}</FieldContent>
    </Field>
  )
}
```

Update `ToggleField` to use `Field`, `FieldLabel`, and `FieldContent`:

```tsx
function ToggleField({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" className="items-center rounded-lg border border-border p-3">
      <FieldLabel>{label}</FieldLabel>
      <FieldContent className="items-end">
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </FieldContent>
    </Field>
  )
}
```

- [ ] **Step 5: Run the dialog tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the layout refactor**

Run:

```bash
git add desktop/src/modules/task-scheduler/components/task-form-dialog.tsx
git commit -m "refactor: group task form dialog fields"
```

---

### Task 3: Verify Task Scheduler and Constraints

**Files:**
- Verify only; no file edits expected.

- [ ] **Step 1: Run task scheduler tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/task-scheduler
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS with no Phase 0 architecture violations.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff --stat HEAD~2..HEAD
git diff HEAD~2..HEAD -- desktop/src/modules/task-scheduler/components/task-form-dialog.tsx desktop/src/modules/task-scheduler/__tests__/task-form-dialog.test.tsx
```

Expected: Diff is limited to the task form dialog and its focused test file. No custom colors, inline styles, CSS modules, dependencies, or scheduler behavior changes appear.

---

## Self-Review Notes

- Spec coverage: The plan covers four sections, fully expanded single-page layout, `FormDialog`, shadcn field primitives, stable footer, preserved behavior, submit-level errors, local helpers, and focused tests.
- Placeholder scan: No task contains open-ended implementation placeholders.
- Type consistency: The plan uses existing `TaskFormDialogState`, `TaskFormState`, `ScheduledTask`, `ScheduledTaskCreateInput`, and `ScheduledTaskUpdateInput` names from the current module.
