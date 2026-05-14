/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkflowRun } from "../use-workflow-run"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rendererLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

let roots: Root[] = []

beforeEach(() => {
  rendererLogger.error.mockClear()
  rendererLogger.info.mockClear()
  rendererLogger.warn.mockClear()
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

describe("useWorkflowRun", () => {
  it("logs run IPC failures without raw backend error text", async () => {
    const run = vi.fn(async () => {
      throw new Error("workflow failed with token=secret-value and prompt body")
    })
    ;(window as unknown as { synapse: { workflow: { run: typeof run } } }).synapse = {
      workflow: { run },
    }
    let hook: ReturnType<typeof useWorkflowRun> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
    })

    await act(async () => {
      await hook?.start({ prompt: "secret prompt" })
    })

    expect(rendererLogger.error).toHaveBeenCalledWith("run IPC call failed, resetting to idle", {
      workflowId: "workflow-1",
      boundary: "renderer.workflow.run.start",
      errorName: "Error",
      errorLength: 55,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("token=secret-value")
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("secret prompt")
  })

  it("logs cancel IPC failures without raw backend error text", async () => {
    const rawError = "cancel failed with token=secret-value and prompt body"
    const cancel = vi.fn(async () => {
      throw new Error(rawError)
    })
    const runStatus = vi.fn(async () => ({
      status: "running" as const,
      nodeResults: {},
    }))
    ;(window as unknown as { synapse: { workflow: { cancel: typeof cancel; runStatus: typeof runStatus } } }).synapse = {
      workflow: { cancel, runStatus },
    }
    let hook: ReturnType<typeof useWorkflowRun> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe initialRunId="run-1" onChange={(next) => { hook = next }} />)
    })

    await act(async () => {
      await expect(hook?.cancel()).resolves.toBeUndefined()
    })

    expect(cancel).toHaveBeenCalledWith("run-1")
    expect(rendererLogger.error).toHaveBeenCalledWith("cancel IPC call failed", {
      workflowId: "workflow-1",
      runId: "run-1",
      boundary: "renderer.workflow.run.cancel",
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("token=secret-value")
  })

  it("logs initial run status failures without raw backend error text", async () => {
    const rawError = "status failed with token=secret-value and prompt body"
    const runStatus = vi.fn(async () => {
      throw new Error(rawError)
    })
    ;(window as unknown as { synapse: { workflow: { runStatus: typeof runStatus } } }).synapse = {
      workflow: { runStatus },
    }
    let hook: ReturnType<typeof useWorkflowRun> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe initialRunId="run-1" onChange={(next) => { hook = next }} />)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(runStatus).toHaveBeenCalledWith("run-1")
    expect(hook?.runState).toBe("idle")
    expect(rendererLogger.error).toHaveBeenCalledWith("initial run status IPC call failed, resetting to idle", {
      workflowId: "workflow-1",
      initialRunId: "run-1",
      boundary: "renderer.workflow.run.initial-status",
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(rendererLogger.error.mock.calls)).not.toContain("token=secret-value")
  })
})

function HookProbe({
  initialRunId,
  onChange,
}: {
  readonly initialRunId?: string
  readonly onChange: (hook: ReturnType<typeof useWorkflowRun>) => void
}): ReactNode {
  const hook = useWorkflowRun("workflow-1", initialRunId)

  useEffect(() => {
    onChange(hook)
  }, [hook, onChange])

  return null
}
