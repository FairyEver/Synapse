/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowEvent, WorkflowRunListItem } from "@/types/workflow"
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
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
          createRunItem({
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
    })

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

  it("shows workflow-level errors when no node error is available", async () => {
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
          createRunItem({
            error: "工作流准备失败",
            nodeResults: {},
          }),
      ]),
    })

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

    expect(document.body.textContent).toContain("工作流准备失败")
  })

  it("marks history records whose workflow structure is unreadable", async () => {
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
          createRunItem({
            definitionMigration: {
              kind: "unsupported_future",
              sourceVersion: "2.0.0",
              targetVersion: "1.0.0",
            },
          }),
      ]),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={vi.fn()} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("结构不可读")
  })

  it("keeps the history list within a wider dialog layout", async () => {
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
          createRunItem({
            endedAt: Date.parse("2026-05-15T00:13:31.900Z"),
            nodeResults: Object.fromEntries(
              Array.from({ length: 15 }, (_, index) => [
                `node-${index}`,
                {
                  nodeId: `node-${index}`,
                  status: "success",
                  input: { variables: {} },
                  startedAt: Date.parse("2026-05-15T00:00:00.000Z") + index,
                },
              ]),
            ),
          }),
      ]),
    })

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

    expect(document.body.querySelector('[data-slot="dialog-content"]')?.className).toContain("sm:max-w-2xl")
    expect(document.body.querySelector('[data-slot="dialog-content"]')?.className).toContain("overflow-hidden")
    expect(document.body.querySelector('[data-slot="scroll-area-viewport"] .pr-3')).toBeTruthy()
    expect(document.body.querySelector('[role="button"]')?.className).toContain("min-w-0")
  })

  it("shows workflow durations with readable minute and second units", async () => {
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
        createRunItem({
          runId: "under-one-minute",
          endedAt: Date.parse("2026-05-15T00:00:45.000Z"),
        }),
        createRunItem({
          runId: "over-one-minute",
          endedAt: Date.parse("2026-05-15T00:01:12.000Z"),
        }),
      ]),
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<RunHistoryDialog open workflowId="workflow-1" onClose={vi.fn()} />)
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("45秒")
    expect(document.body.textContent).toContain("1分钟12秒")
  })

  it("tracks opening a workflow run without recording node output", async () => {
    const openRunner = vi.fn()
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
          createRunItem({
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
    })

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

    const openButton = document.body.querySelector('[role="button"]')
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
    installWorkflowBridge({
      runHistory: vi.fn().mockRejectedValue(new Error(rawError)),
    })

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
      errorMessage: "history failed with token=[redacted] and prompt body at [path]",
    })
  })

  it("shows running records and opens the active runner", async () => {
    const openRunner = vi.fn()
    installWorkflowBridge({
      runHistory: vi.fn().mockResolvedValue([
          createRunItem({
            runId: "active-run",
            status: "running",
            endedAt: undefined,
            nodeResults: {
              nodeA: {
                nodeId: "nodeA",
                status: "running",
                input: { variables: {} },
              },
            },
          }),
      ]),
      openRunner,
    })

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

    expect(document.body.textContent).toContain("执行中")
    expect(document.body.textContent).toContain("1 个节点")
    expect(document.body.textContent).not.toContain("NaN")

    await act(async () => {
      document.body.querySelector('[role="button"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(openRunner).toHaveBeenCalledWith("workflow-1", "active-run")
  })

  it("reloads open history when the active run reaches a terminal event", async () => {
    let eventListener: ((event: WorkflowEvent) => void) | undefined
    const runHistory = vi.fn()
      .mockResolvedValueOnce([
        createRunItem({ runId: "active-run", status: "running", endedAt: undefined }),
      ])
      .mockResolvedValueOnce([
        createRunItem({ runId: "active-run", status: "completed", endedAt: Date.parse("2026-05-15T00:00:02.000Z") }),
      ])
    installWorkflowBridge({
      runHistory,
      onEvent: vi.fn((listener) => {
        eventListener = listener
        return vi.fn()
      }),
    })

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

    expect(document.body.textContent).toContain("执行中")

    await act(async () => {
      eventListener?.({
        type: "workflow:completed",
        runId: "active-run",
        workflowId: "workflow-1",
        result: { status: "completed", nodeResults: {}, durationMs: 2000 },
      })
      await Promise.resolve()
    })

    expect(runHistory).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("已完成")
  })
})

function installWorkflowBridge({
  onEvent = vi.fn(() => vi.fn()),
  openRunner = vi.fn(),
  runHistory,
}: {
  readonly onEvent?: (listener: (event: WorkflowEvent) => void) => () => void
  readonly openRunner?: (workflowId: string, runId: string) => unknown
  readonly runHistory: (workflowId: string) => Promise<WorkflowRunListItem[]>
}): void {
  window.synapse = {
    workflow: {
      run: { list: runHistory },
      operation: { onEvent, openRunner },
    },
  } as unknown as Window["synapse"]
}

function createRunItem(patch: Partial<WorkflowRunListItem> = {}): WorkflowRunListItem {
  return {
    runId: "run-1",
    workflowId: "workflow-1",
    startedAt: Date.parse("2026-05-15T00:00:00.000Z"),
    endedAt: Date.parse("2026-05-15T00:00:01.000Z"),
    status: "failed",
    params: {},
    nodeResults: {},
    ...patch,
  }
}
