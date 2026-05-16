/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowRunSnapshot } from "@/types/workflow"
import { RunHistoryDialog } from "../run-history-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  logger: {
    warn: vi.fn(),
  },
  track: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.logger,
}))

vi.mock("@/lib/ui-tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ui-tracking")>()
  return {
    ...actual,
    track: mocks.track,
    extractLabel: vi.fn(() => "查看"),
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
  vi.restoreAllMocks()
  vi.clearAllMocks()
  delete (window as Partial<Window>).synapse
})

describe("RunHistoryDialog", () => {
  it("shows the earliest node error in run history summaries", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    window.synapse = {
      workflow: {
        runHistory: vi.fn().mockResolvedValue([
          createSnapshot({
            nodeResults: {
              late: {
                nodeId: "late",
                status: "failed",
                input: { variables: {} },
                startedAt: 200,
                error: "late error",
              },
              early: {
                nodeId: "early",
                status: "failed",
                input: { variables: {} },
                startedAt: 100,
                error: "early error",
              },
            },
          }),
        ]),
      },
    } as unknown as Window["synapse"]

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("early error")
    expect(document.body.textContent).not.toContain("late error")
    expect(`${JSON.stringify(warnSpy.mock.calls)}${JSON.stringify(errorSpy.mock.calls)}`).not.toContain("Missing `Description`")
  })

  it("tracks opening a workflow run without recording node output", async () => {
    const openRunner = vi.fn()
    window.synapse = {
      workflow: {
        runHistory: vi.fn().mockResolvedValue([
          createSnapshot({
            nodeResults: {
              nodeSecret: {
                nodeId: "nodeSecret",
                status: "failed",
                input: { variables: {} },
                error: "secret prompt body",
              },
            },
          }),
        ]),
        openRunner,
      },
    } as unknown as Window["synapse"]

    const onClose = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={onClose} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    const openButton = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("查看"))
    expect(openButton).toBeDefined()

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(openRunner).toHaveBeenCalledWith("workflow-1", "run-1")
    expect(onClose).toHaveBeenCalled()
    expect(mocks.track).toHaveBeenCalledWith({
      component: "workflow",
      name: "workflow-run-history-open-runner",
      action: "click",
      metadata: {
        boundary: "renderer.workflow.run-history.open-runner",
        workflowId: "workflow-1",
        runId: "run-1",
      },
    })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret prompt body")
  })

  it("shows a generic load failure and logs sanitized diagnostics", async () => {
    const rawError = "history failed with token=sk-secret and prompt body at /Users/example/repo"
    window.synapse = {
      workflow: {
        runHistory: vi.fn().mockRejectedValue(new Error(rawError)),
      },
    } as unknown as Window["synapse"]

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={vi.fn()} />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("加载失败，请重试")
    expect(document.body.textContent).not.toContain("token=sk-secret")
    expect(document.body.textContent).not.toContain("/Users/example/repo")
    expect(mocks.logger.warn).toHaveBeenCalledWith("Workflow run history load failed.", {
      boundary: "renderer.workflow.run-history.load",
      workflowId: "workflow-1",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: rawError,
    })
  })
})

function createSnapshot(patch: Partial<WorkflowRunSnapshot> = {}): WorkflowRunSnapshot {
  return {
    runId: "run-1",
    workflowId: "workflow-1",
    version: "1",
    startedAt: Date.parse("2026-05-15T00:00:00.000Z"),
    endedAt: Date.parse("2026-05-15T00:00:01.000Z"),
    status: "failed",
    params: {},
    nodeResults: {},
    ...patch,
  }
}
