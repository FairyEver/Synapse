/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ScheduledTask, ScheduledTaskRun } from "@/types/task-scheduler"
import { TaskRunsDialog } from "../task-runs-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  listRuns: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.warn,
    error: vi.fn(),
  }),
}))

vi.mock("@/action-runtime/builtin-actions", () => ({
  rendererActionRegistry: {
    getDefaultConfig: vi.fn(() => ({})),
    get: vi.fn(() => {
      throw new Error("agent result view unavailable with secret prompt")
    }),
  },
}))

vi.mock("../../hooks/use-task-scheduler", async () => {
  const actual = await vi.importActual<typeof import("../../hooks/use-task-scheduler")>(
    "../../hooks/use-task-scheduler",
  )

  return {
    ...actual,
    listRuns: mocks.listRuns,
  }
})

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

describe("TaskRunsDialog", () => {
  it("logs run history load failures with task context", async () => {
    mocks.listRuns.mockRejectedValue(new Error("history failed for secret agent prompt"))

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskRunsDialog
          open
          busy={false}
          task={createTask()}
          onOpenChange={vi.fn()}
          onStopRun={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.warn).toHaveBeenCalledWith(
      "Task run history load failed.",
      expect.objectContaining({
        taskId: "task-1",
        actionType: "builtin.agent",
        boundary: "renderer.task-scheduler.runs.list",
        errorName: "Error",
        errorLength: "history failed for secret agent prompt".length,
      }),
    )
    expect(document.body.textContent).toContain("读取历史失败")
    expect(document.body.textContent).not.toContain("secret agent prompt")
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("secret agent prompt")
  })

  it("logs result renderer fallback with task and run context", async () => {
    mocks.listRuns.mockResolvedValue([createRun()])

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <TaskRunsDialog
          open
          busy={false}
          task={createTask()}
          onOpenChange={vi.fn()}
          onStopRun={vi.fn()}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.warn).toHaveBeenCalledWith(
      "Task run result renderer fallback.",
      expect.objectContaining({
        taskId: "task-1",
        runId: "run-1",
        actionType: "builtin.agent",
        runStatus: "success",
        errorName: "Error",
        errorLength: "agent result view unavailable with secret prompt".length,
      }),
    )
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("secret prompt")
  })
})

function createTask(): ScheduledTask {
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
    missedRunPolicy: "skip",
    overlapPolicy: "skip",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
    runCount: 1,
  }
}

function createRun(): ScheduledTaskRun {
  return {
    id: "run-1",
    schemaVersion: 2,
    taskId: "task-1",
    startedAt: "2026-04-29T00:00:00.000Z",
    finishedAt: "2026-04-29T00:00:01.000Z",
    status: "success",
    triggeredBy: "schedule",
    result: {
      status: "success",
      summary: "completed",
    },
  }
}
