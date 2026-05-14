/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TaskFormDialog } from "../components/task-form-dialog"
import type { ScheduledTask } from "@/types/task-scheduler"

const noop = vi.fn()

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

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

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
  SelectTrigger: ({
    children,
    className,
    id,
  }: {
    children: React.ReactNode
    className?: string
    id?: string
  }) => (
    <button className={className} id={id} type="button">
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}))

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({
    children,
    className,
    type,
    value,
    "aria-label": ariaLabel,
  }: {
    children: React.ReactNode
    className?: string
    type?: string
    value?: string
    "aria-label"?: string
  }) => (
    <div
      aria-label={ariaLabel}
      className={className}
      data-slot="toggle-group"
      data-type={type}
      data-value={value}
    >
      {children}
    </div>
  ),
  ToggleGroupItem: ({
    children,
    className,
    id,
    value,
  }: {
    children: React.ReactNode
    className?: string
    id?: string
    value: string
  }) => (
    <button className={className} data-slot="toggle-group-item" data-value={value} id={id} type="button">
      {children}
    </button>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

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

  it("does not render a standalone scope selector", () => {
    const html = renderDialog()
    expect(html).not.toContain('aria-label="作用域"')
  })

  it("shows interval anchor only for interval triggers", () => {
    const cronHtml = renderDialog()
    const intervalHtml = renderDialog({
      task: createTask({
        trigger: {
          type: "builtin.interval",
          config: { everyMinutes: 15, anchor: "last_completed_at" },
        },
      }),
    })

    expect(cronHtml).not.toContain("task-form-interval-anchor")
    expect(intervalHtml).toContain("task-form-interval-anchor")
  })

  it("uses single-value toggle groups for short built-in task choices", () => {
    const cronHtml = renderDialog()
    const intervalHtml = renderDialog({
      task: createTask({
        scope: { type: "project", projectId: "project-1" },
        trigger: {
          type: "builtin.interval",
          config: { everyMinutes: 15, anchor: "last_completed_at" },
        },
      }),
    })

    expect(cronHtml).toContain('aria-label="触发方式"')
    expect(cronHtml).toContain('data-slot="toggle-group"')
    expect(cronHtml).toContain('data-type="single"')
    expect(cronHtml).toContain('id="task-form-trigger-type-cron"')
    expect(cronHtml).toContain('id="task-form-trigger-type-interval"')
    expect(cronHtml).not.toContain('id="task-form-trigger-type"')

    expect(intervalHtml).toContain('aria-label="锚点"')
    expect(intervalHtml).toContain('id="task-form-interval-anchor-created_at"')
    expect(intervalHtml).toContain('id="task-form-interval-anchor-last_completed_at"')
    expect(intervalHtml).not.toContain('id="task-form-interval-anchor"')
  })

  it("uses the script label when editing a script task", () => {
    const html = renderDialog({
      task: createTask({
        action: {
          type: "builtin.script",
          config: {
            script: "echo script",
            shell: "posix",
            timeoutMins: 30,
          },
        },
      }),
    })

    expect(html).toContain("脚本")
    expect(html).not.toContain(">命令</label>")
  })

  it("renders action type choices", () => {
    const html = renderDialog()

    expect(html).toContain("命令")
    expect(html).toContain("脚本")
    expect(html).toContain("HTTP 请求")
  })

  it("keeps the action field as a select for registry-backed actions", () => {
    const html = renderDialog()

    expect(html).toContain('id="task-form-action-type"')
    expect(html).toContain("命令")
    expect(html).toContain("脚本")
    expect(html).toContain("HTTP 请求")
  })

  it("renders shell choices as single-value toggle groups", () => {
    const commandHtml = renderDialog()
    const scriptHtml = renderDialog({
      task: createTask({
        action: {
          type: "builtin.script",
          config: {
            script: "echo script",
            shell: "powershell",
            timeoutMins: 30,
          },
        },
      }),
    })

    expect(commandHtml).toContain('aria-label="Shell"')
    expect(commandHtml).toContain('data-slot="toggle-group"')
    expect(commandHtml).toContain('id="task-action-command-shell-posix"')
    expect(commandHtml).toContain('id="task-action-command-shell-cmd"')
    expect(commandHtml).toContain('id="task-action-command-shell-powershell"')
    expect(commandHtml).not.toContain('id="task-action-command-shell"')

    expect(scriptHtml).toContain('aria-label="Shell"')
    expect(scriptHtml).toContain('data-slot="toggle-group"')
    expect(scriptHtml).toContain('id="task-action-script-shell-posix"')
    expect(scriptHtml).toContain('id="task-action-script-shell-cmd"')
    expect(scriptHtml).toContain('id="task-action-script-shell-powershell"')
    expect(scriptHtml).not.toContain('id="task-action-script-shell"')
  })

  it("renders PATH mode toggle and posixLogin checkbox for POSIX shell", () => {
    const html = renderDialog()

    expect(html).toContain('aria-label="PATH strategy"')
    expect(html).toContain('id="task-action-command-path-strategy-merge"')
    expect(html).toContain('id="task-action-command-path-strategy-replace"')
    expect(html).toContain("PATH 模式")
    expect(html).toContain("task-action-command-posix-login")
    expect(html).toContain("以登录 Shell 执行")
  })

  it("renders env field placeholder and description", () => {
    const html = renderDialog()

    expect(html).toContain("KEY=value")
    expect(html).toContain("每行一个 KEY=value")
  })

  it("renders HTTP method and body type as single-value toggle groups", () => {
    const html = renderDialog({
      task: createTask({
        action: {
          type: "builtin.http-request",
          config: {
            method: "POST",
            url: "https://example.com",
            bodyType: "json",
            body: "{}",
            timeoutMins: 5,
          },
        },
      }),
    })

    expect(html).toContain('aria-label="方法"')
    expect(html).toContain('id="task-action-http-method-GET"')
    expect(html).toContain('id="task-action-http-method-POST"')
    expect(html).toContain('id="task-action-http-method-PUT"')
    expect(html).toContain('id="task-action-http-method-PATCH"')
    expect(html).toContain('id="task-action-http-method-DELETE"')
    expect(html).not.toContain('id="task-action-http-method"')

    expect(html).toContain('aria-label="Body"')
    expect(html).toContain('id="task-action-http-body-type-none"')
    expect(html).toContain('id="task-action-http-body-type-json"')
    expect(html).toContain('id="task-action-http-body-type-text"')
    expect(html).not.toContain('id="task-action-http-body-type"')
  })

  it("renders cwd as an editable input with an inline choose action", () => {
    const html = renderDialog()

    expect(html).toMatch(
      /<label[^>]*for="task-form-cwd"[^>]*>工作目录<\/label>[\s\S]*data-slot="input-group"[\s\S]*id="task-form-cwd"[\s\S]*>选择<\/button>/,
    )
  })

  it("logs directory picker failures without exposing the raw error message", async () => {
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        repository: {
          chooseDirectory: vi.fn().mockRejectedValue(
            new Error("dialog failed for /Users/example/secret-agent-project"),
          ),
        },
      },
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskFormDialog
          open
          busy={false}
          platform="darwin"
          projects={[{ id: "project-1", name: "Project One", path: "/tmp/project-one" }]}
          state={{
            mode: "edit",
            task: createTask({
              trigger: {
                type: "builtin.interval",
                config: { everyMinutes: 15, anchor: "created_at" },
              },
            }),
          }}
          onCreate={async () => undefined}
          onOpenChange={noop}
          onUpdate={async () => undefined}
        />,
      )
    })

    const chooseButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "选择")
    expect(chooseButton).toBeTruthy()

    await act(async () => {
      chooseButton?.click()
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Failed to choose task working directory.",
      expect.objectContaining({
        boundary: "task-scheduler.form.cwd-picker",
        action: "chooseDirectory",
        errorName: "Error",
        errorLength: "dialog failed for /Users/example/secret-agent-project".length,
      }),
    )
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret-agent-project")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
  })

  it("logs submit failures without exposing the raw error message", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onUpdate = vi.fn().mockRejectedValue(
      new Error("save failed for token=secret-agent-token in /Users/example/agent-task"),
    )

    await act(async () => {
      root.render(
        <TaskFormDialog
          open
          busy={false}
          platform="darwin"
          projects={[{ id: "project-1", name: "Project One", path: "/tmp/project-one" }]}
          state={{ mode: "edit", task: createTask() }}
          onCreate={async () => undefined}
          onOpenChange={noop}
          onUpdate={onUpdate}
        />,
      )
    })

    const form = container.querySelector("form")
    expect(form).toBeTruthy()

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(rendererLogger.error).toHaveBeenCalledWith(
      "Failed to save scheduled task.",
      expect.objectContaining({
        boundary: "task-scheduler.form.submit",
        action: "update",
        taskId: "task-1",
        actionType: "builtin.command",
        errorName: "Error",
        errorLength: "save failed for token=secret-agent-token in /Users/example/agent-task".length,
      }),
    )
    expect(container.textContent).toContain("保存任务失败。")
    expect(container.textContent).not.toContain("secret-agent-token")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret-agent-token")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("/Users/example")
  })

  it("renders cron as an input group with an inline editor action", () => {
    const html = renderDialog()

    expect(html).toMatch(
      /<label[^>]*for="task-form-cron"[^>]*>Cron<\/label>[\s\S]*data-slot="input-group"[\s\S]*id="task-form-cron"[\s\S]*data-align="inline-end"[\s\S]*>编辑<\/button>/,
    )
  })

  it("uses compact grids for short fields and rows for run settings", () => {
    const html = renderDialog({
      task: createTask({
        scope: { type: "project", projectId: "project-1" },
        trigger: {
          type: "builtin.interval",
          config: { everyMinutes: 15, anchor: "last_completed_at" },
        },
      }),
    })

    expect(html).toContain("task-form-basic-grid")
    expect(html).toContain("task-form-trigger-grid")
    expect(html).toContain("task-form-run-settings-list")
    expect(html).toContain("task-form-run-setting-row")
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
    schemaVersion: 2,
    name: "Backup",
    description: "",
    scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
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
