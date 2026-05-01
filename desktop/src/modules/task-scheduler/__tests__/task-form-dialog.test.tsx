import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { TaskFormDialog } from "../components/task-form-dialog"
import type { ScheduledTask } from "@/types/task-scheduler"

const noop = vi.fn()

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

describe("TaskFormDialog", () => {
  it("renders the four lightweight sections in create mode", () => {
    const html = renderDialog()

    expect(html).toContain("基础信息")
    expect(html).toContain("触发计划")
    expect(html).toContain("执行内容")
    expect(html).toContain("运行设置")
  })

  it("renders section navigation beside a single form column", () => {
    const html = renderDialog()

    expect(html).toContain("task-form-dialog-layout")
    expect(html).toContain("task-form-section-nav")
    expect(html).toContain("task-form-section-list")
    expect(html).toContain("task-form-section-select")
    expect(html).toContain("task-form-section-fields")
    expect(html).toContain('aria-current="page"')
  })

  it("uses independent sidebar and form scroll panes inside the dialog body", () => {
    const html = renderDialog()

    expect(html).toContain("h-[calc(100vh-2rem)]")
    expect(html).toContain("flex h-full min-h-0")
    expect(html).toContain("flex-col overflow-hidden")
    expect(html).toContain("min-h-0 flex-1 px-5 py-4 overflow-hidden")
    expect(html).toContain("task-form-section-fields")
    expect(html).toContain("task-form-section-sidebar")
    expect(html).toContain("task-form-section-scroll")
    expect(html).toContain("min-h-0 overflow-y-auto")
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

  it("uses compact grids for short controls", () => {
    const html = renderDialog({
      task: createTask({
        scope: { type: "project", projectId: "project-1" },
        trigger: { type: "interval", everyMinutes: 15, anchor: "last_completed_at" },
      }),
    })

    expect(html).toContain("task-form-basic-grid")
    expect(html).toContain("task-form-trigger-grid")
    expect(html).toContain("task-form-run-settings-grid")
    expect(html).not.toContain("sm:grid-cols-[auto_1fr]")
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
