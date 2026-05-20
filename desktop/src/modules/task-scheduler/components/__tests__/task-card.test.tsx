/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseProjectConfig } from "@/types/config"
import type { ScheduledTask } from "@/types/task-scheduler"
import { TooltipProvider } from "@/components/ui/tooltip"
import { TaskCard } from "../task-card"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("TaskCard", () => {
  it("does not show a tooltip for the labeled run button", async () => {
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
            task={createTask()}
            onDelete={vi.fn()}
            onEdit={vi.fn()}
            onHistory={vi.fn()}
            onRun={vi.fn()}
            onStop={vi.fn()}
            onToggleEnabled={vi.fn()}
          />
        </TooltipProvider>,
      )
    })

    const runButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "运行")

    expect(runButton?.getAttribute("data-state")).toBeNull()
  })

  it("does not expose a stop action while only a scheduler mutation is busy", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy
          projects={projects}
          task={createTask()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html).toContain("运行")
    expect(html).toContain("disabled")
    expect(html).not.toContain("停止")
  })

  it("disables secondary mutation controls while busy", async () => {
    const onToggleEnabled = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TooltipProvider>
          <TaskCard
            busy
            projects={projects}
            task={createTask()}
            onDelete={vi.fn()}
            onEdit={vi.fn()}
            onHistory={vi.fn()}
            onRun={vi.fn()}
            onStop={vi.fn()}
            onToggleEnabled={onToggleEnabled}
          />
        </TooltipProvider>,
      )
    })

    const switchButton = document.querySelector<HTMLButtonElement>("button[role='switch']")
    const editButton = document.querySelector<HTMLButtonElement>('button[aria-label="编辑"]')
    const historyButton = document.querySelector<HTMLButtonElement>('button[aria-label="历史"]')
    const deleteButton = document.querySelector<HTMLButtonElement>('button[aria-label="删除"]')

    expect(switchButton?.disabled).toBe(true)
    expect(editButton?.disabled).toBe(true)
    expect(historyButton?.disabled).toBe(true)
    expect(deleteButton?.disabled).toBe(true)

    await act(async () => {
      switchButton?.click()
      editButton?.click()
      historyButton?.click()
      deleteButton?.click()
    })

    expect(onToggleEnabled).not.toHaveBeenCalled()
  })

  it("offers stop instead of manual run while a task is already running", async () => {
    const onRun = vi.fn()
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
            task={createTask({ activeRun: { status: "running" } })}
            onDelete={vi.fn()}
            onEdit={vi.fn()}
            onHistory={vi.fn()}
            onRun={onRun}
            onStop={vi.fn()}
            onToggleEnabled={vi.fn()}
          />
        </TooltipProvider>,
      )
    })

    const stopButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("停止"))
    const runButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("运行"))

    expect(stopButton).toBeTruthy()
    expect(stopButton?.disabled).toBe(false)
    expect(runButton).toBeUndefined()

    await act(async () => {
      stopButton?.click()
    })

    expect(onRun).not.toHaveBeenCalled()
  })

  it("uses a stable remarks line when description is missing", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          task={createTask()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html).toContain("暂无备注")
  })

  it("does not render provider/model for agent tasks", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          task={createTask({
            action: {
              type: "builtin.agent",
              config: {
                agentType: "claude-code",
                projectId: "project-1",
                providerId: "provider-1",
                modelTier: "sonnet",
                providerName: "My Provider",
                modelName: "claude-sonnet-4-20250514",
                prompt: "run",
                sessionPolicy: "fresh",
              },
            },
          })}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html).not.toContain("供应商")
    expect(html).not.toContain("My Provider")
    expect(html).not.toContain("模型")
    expect(html).not.toContain("claude-sonnet-4-20250514")
    expect(html).toContain("上次")
    expect(html).toContain("范围")
  })

  it("does not render provider/model for non-agent tasks", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          task={createTask({
            action: {
              type: "builtin.command",
              config: { command: "echo hello" },
            },
          })}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html).not.toContain("供应商")
    expect(html).not.toContain("模型")
    expect(html).toContain("上次")
    expect(html).toContain("范围")
  })

  it("renders management actions as icon buttons with tooltip labels", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          task={createTask()}
          onDelete={vi.fn()}
          onEdit={vi.fn()}
          onHistory={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html).toContain('aria-label="编辑"')
    expect(html).toContain('aria-label="历史"')
    expect(html).toContain('aria-label="删除"')
    expect(html).not.toContain(">编辑</button>")
    expect(html).not.toContain(">历史</button>")
    expect(html).not.toContain(">删除</button>")
    expect(html).not.toContain("更多操作")
  })

  it("shows needs-update tasks as frozen", async () => {
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
            task={createTask({
              enabled: false,
              validation: {
                status: "needs_update",
                issues: [{ field: "action.config.providerId", message: "选择供应商" }],
              },
            })}
            onDelete={vi.fn()}
            onEdit={vi.fn()}
            onHistory={vi.fn()}
            onRun={vi.fn()}
            onStop={vi.fn()}
            onToggleEnabled={onToggleEnabled}
          />
        </TooltipProvider>,
      )
    })

    const switchButton = document.querySelector<HTMLButtonElement>("button[role='switch']")
    const runButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("运行"))

    expect(document.body.textContent).toContain("需要更新")
    expect(document.body.textContent).toContain("停用中")
    expect(switchButton?.disabled).toBe(true)
    expect(runButton?.disabled).toBe(true)

    await act(async () => {
      switchButton?.click()
    })
    expect(onToggleEnabled).not.toHaveBeenCalled()
  })
})

const projects: SynapseProjectConfig[] = [
  {
    id: "project-1",
    name: "Synapse",
    path: "/Users/liyang/Documents/code/github/Synapse",
  },
]

function createTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    schemaVersion: 2,
    name: "Agent Followup",
    scope: { type: "project", projectId: "project-1" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 1, anchor: "created_at" },
    },
    action: {
      type: "builtin.agent",
      config: {
        agentType: "claude-code",
        projectId: "project-1",
        prompt: "run",
        sessionPolicy: "fresh",
      },
    },
    enabled: true,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    runCount: 0,
    ...overrides,
  }
}
