/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentProvider } from "@/types/bridge"
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
  it("does not expose a stop action while only a scheduler mutation is busy", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy
          projects={projects}
          providers={providers}
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
            providers={providers}
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
    const moreButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("更多操作"))

    expect(switchButton?.disabled).toBe(true)
    expect(moreButton?.disabled).toBe(true)

    await act(async () => {
      switchButton?.click()
      moreButton?.click()
    })

    expect(onToggleEnabled).not.toHaveBeenCalled()
  })

  it("disables manual runs while a task is already running", async () => {
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
            providers={providers}
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

    const runButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("运行中"))

    expect(runButton).toBeTruthy()
    expect(runButton?.disabled).toBe(true)

    await act(async () => {
      runButton?.click()
    })

    expect(onRun).not.toHaveBeenCalled()
  })

  it("renders provider and model for agent tasks", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          providers={providers}
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

    expect(html).toContain("供应商")
    expect(html).toContain("My Provider")
    expect(html).toContain("模型")
    expect(html).toContain("claude-sonnet-4-20250514")
  })

  it("resolves provider name from providers list when providerName is missing", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          providers={providers}
          task={createTask({
            action: {
              type: "builtin.agent",
              config: {
                agentType: "claude-code",
                projectId: "project-1",
                providerId: "provider-1",
                modelTier: "haiku",
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

    expect(html).toContain("供应商")
    expect(html).toContain("Test Provider")
    expect(html).not.toContain("provider-1")
    expect(html).toContain("claude-3-5-haiku-20241022")
    expect(html).not.toContain(">haiku<")
  })

  it("does not render provider/model for non-agent tasks", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <TaskCard
          busy={false}
          projects={projects}
          providers={providers}
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
})

const projects: SynapseProjectConfig[] = [
  {
    id: "project-1",
    name: "Synapse",
    path: "/Users/liyang/Documents/code/github/Synapse",
  },
]

const providers: SynapseAgentProvider[] = [
  {
    id: "provider-1",
    name: "Test Provider",
    category: "custom",
    apiKeyField: "ANTHROPIC_API_KEY",
    haikuModel: "claude-3-5-haiku-20241022",
    sonnetModel: "claude-sonnet-4-20250514",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
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
