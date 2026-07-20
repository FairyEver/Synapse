/**
 * @vitest-environment jsdom
 */
import { useEffect } from "react"
import type { ReactNode } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useWorkflowList } from "../use-workflow-list"

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

describe("useWorkflowList", () => {
  it("loads workflows and migration diagnostics independently", async () => {
    const list = vi.fn(async () => ({
      items: [{ id: "workflow-1", name: "Workflow", version: "v1", nodeCount: 1, createdAt: 1, updatedAt: 2 }],
      migrationDiagnostics: [{ id: "legacy:workflow-2", workflowId: "workflow-2", status: "failed" as const, targetSchemaVersion: "2.0.0", updatedAt: 3 }],
    }))
    ;(window as unknown as { synapse: { workflow: { definition: { list: typeof list }; editor: { onDefinitionUpdated: () => () => void } } } }).synapse = {
      workflow: { definition: { list }, editor: { onDefinitionUpdated: () => () => undefined } },
    }
    let hook: ReturnType<typeof useWorkflowList> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(hook?.items).toEqual([expect.objectContaining({ id: "workflow-1" })])
    expect(hook?.migrationDiagnostics).toEqual([expect.objectContaining({ workflowId: "workflow-2", status: "failed" })])
  })

  it("logs list failures without exposing raw backend error text", async () => {
    const rawError = "list failed with token=secret-value and prompt body"
    const list = vi.fn(async () => {
      throw new Error(rawError)
    })
    ;(window as unknown as { synapse: { workflow: { definition: { list: typeof list }; editor: { onDefinitionUpdated: () => () => void } } } }).synapse = {
      workflow: { definition: { list }, editor: { onDefinitionUpdated: () => () => undefined } },
    }
    let hook: ReturnType<typeof useWorkflowList> | undefined
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<HookProbe onChange={(next) => { hook = next }} />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(hook?.error).toBe("加载失败，请重试")
    expect(rendererLogger.warn).toHaveBeenCalledWith("Workflow list refresh failed.", {
      boundary: "renderer.workflow.definition.list",
      errorName: "Error",
      errorLength: rawError.length,
      errorMessage: "list failed with token=[redacted] and prompt body",
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("token=secret-value")
  })
})

function HookProbe({
  onChange,
}: {
  readonly onChange: (hook: ReturnType<typeof useWorkflowList>) => void
}): ReactNode {
  const hook = useWorkflowList()

  useEffect(() => {
    onChange(hook)
  }, [hook, onChange])

  return null
}
