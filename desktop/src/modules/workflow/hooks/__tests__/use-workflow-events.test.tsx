/**
 * @vitest-environment jsdom
 */
import { useMemo } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NodeRunResult, WorkflowEvent } from "@/types/workflow"
import { useWorkflowEvents } from "../use-workflow-events"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

let roots: Root[] = []
let workflowListener: ((event: WorkflowEvent) => void) | undefined
let runStatus: ReturnType<typeof vi.fn>

beforeEach(() => {
  rendererLogger.debug.mockClear()
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
  workflowListener = undefined
  runStatus = vi.fn(async () => null)
  ;(window as unknown as { synapse?: unknown }).synapse = {
    workflow: {
      run: { get: runStatus },
      operation: {
        onEvent: vi.fn((listener: (event: WorkflowEvent) => void) => {
          workflowListener = listener
          return () => {
            workflowListener = undefined
          }
        }),
      },
    },
  }
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
})

describe("useWorkflowEvents", () => {
  it("logs hydrated workflow failures without raw error text", async () => {
    const rawError = "hydrated failure token=sk-secret at /Users/example/repo with prompt text"
    const nodeResults = {
      "node-1": {
        nodeId: "node-1",
        status: "failed",
        input: { variables: {} },
        error: rawError,
      },
    } satisfies Record<string, NodeRunResult>
    runStatus.mockResolvedValue({
      runId: "run-1",
      workflowId: "workflow-1",
      status: "failed",
      nodeResults,
      startedAt: 0,
      error: rawError,
    })
    const onFailed = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onFailed={onFailed} />)
      await Promise.resolve()
    })

    await waitFor(() => onFailed.mock.calls.length > 0)

    expect(onFailed).toHaveBeenCalledWith(rawError, nodeResults)
    expect(rendererLogger.info).toHaveBeenCalledWith(
      "hydration applying workflow:failed with authoritative nodeResults",
      expect.objectContaining({
        runId: "run-1",
        errorLength: rawError.length,
        nodeCount: 1,
      }),
    )
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("/Users/example/repo")
  })

  it("logs live workflow failure events with sanitized error text", async () => {
    const rawError = "node failed token=sk-secret at /Users/example/repo with prompt text"
    const onFailed = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onFailed={onFailed} />)
    })

    await act(async () => {
      workflowListener?.({
        type: "workflow:failed",
        runId: "run-1",
        workflowId: "workflow-1",
        error: rawError,
        result: {
          status: "failed",
          nodeResults: {},
          durationMs: 42,
        },
      })
      await Promise.resolve()
    })

    expect(onFailed).toHaveBeenCalledWith(rawError, {})
    expect(rendererLogger.info).toHaveBeenCalledWith(
      "workflow:failed — applying terminal state",
      expect.objectContaining({
        runId: "run-1",
        errorLength: rawError.length,
        hasAuthoritativeResults: true,
        nodeCount: 0,
      }),
    )
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.info.mock.calls)).not.toContain("/Users/example/repo")
  })

  it("logs hydration query failures with sanitized error text", async () => {
    const rawError = "runStatus failed token=sk-secret at /Users/example/repo with prompt text"
    runStatus.mockRejectedValue(new Error(rawError))
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onFailed={vi.fn()} />)
      await Promise.resolve()
    })

    await waitFor(() => rendererLogger.warn.mock.calls.length > 0)

    expect(rendererLogger.warn).toHaveBeenCalledWith(
      "workflow hydration status query failed",
      {
        runId: "run-1",
        boundary: "renderer.workflow.hydration-status",
        errorName: "Error",
        errorLength: rawError.length,
        errorMessage: "runStatus failed token=[redacted] at [path] with prompt text",
      },
    )
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("/Users/example/repo")
  })

  it("notifies when a run snapshot fails to save", async () => {
    const onSnapshotSaveFailed = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(<SnapshotSaveFailureProbe onSnapshotSaveFailed={onSnapshotSaveFailed} />)
    })

    await act(async () => {
      workflowListener?.({
        type: "workflow:snapshot-save-failed",
        runId: "run-1",
        workflowId: "workflow-1",
        status: "completed",
      })
      await Promise.resolve()
    })

    expect(onSnapshotSaveFailed).toHaveBeenCalledWith("completed")
  })

  it("notifies live Agent conversation targets", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const onNodeAgentConversation = vi.fn()
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          onFailed={vi.fn()}
          onNodeAgentConversation={onNodeAgentConversation}
        />,
      )
    })

    await act(async () => {
      workflowListener?.({
        type: "node:agent-conversation",
        runId: "run-1",
        nodeId: "node-1",
        target,
      })
      await Promise.resolve()
    })

    expect(onNodeAgentConversation).toHaveBeenCalledWith("node-1", target)
  })

  it("passes live node started results with resolved input details", async () => {
    const onNodeStarted = vi.fn()
    const startedResult = {
      nodeId: "node-1",
      status: "running",
      input: {
        variables: { customer: "Acme" },
        prompt: "Review Acme contract",
      },
      startedAt: 42,
    } satisfies NodeRunResult
    const root = createRoot(document.createElement("div"))
    roots.push(root)

    await act(async () => {
      root.render(
        <HookProbe
          onFailed={vi.fn()}
          onNodeStarted={onNodeStarted}
        />,
      )
    })

    await act(async () => {
      workflowListener?.({
        type: "node:started",
        runId: "run-1",
        nodeId: "node-1",
        startedAt: 42,
        result: startedResult,
      })
      await Promise.resolve()
    })

    expect(onNodeStarted).toHaveBeenCalledWith("node-1", startedResult)
  })
})

function HookProbe({
  onFailed,
  onNodeStarted,
  onNodeAgentConversation,
}: {
  readonly onFailed: (error: string, nodeResults?: Record<string, NodeRunResult>) => void
  readonly onNodeStarted?: (nodeId: string, partial?: Partial<NodeRunResult>) => void
  readonly onNodeAgentConversation?: (
    nodeId: string,
    target: NonNullable<NodeRunResult["outputs"]>["agentConversation"],
  ) => void
}): ReactNode {
  const callbacks = useMemo(() => ({ onFailed, onNodeStarted, onNodeAgentConversation }), [
    onFailed,
    onNodeStarted,
    onNodeAgentConversation,
  ])
  useWorkflowEvents("run-1", callbacks)
  return null
}

function SnapshotSaveFailureProbe({
  onSnapshotSaveFailed,
}: {
  readonly onSnapshotSaveFailed: (status: "completed" | "failed" | "cancelled") => void
}): ReactNode {
  const callbacks = useMemo(() => ({ onSnapshotSaveFailed }), [onSnapshotSaveFailed])
  useWorkflowEvents("run-1", callbacks)
  return null
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error("Timed out waiting for hook update")
}
