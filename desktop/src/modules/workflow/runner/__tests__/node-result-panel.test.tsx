/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { NodeRunResult } from "@/types/workflow"
import { NodeResultPanel } from "../node-result-panel"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  track,
}))

const warn = vi.hoisted(() => vi.fn())

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => ({ warn }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
  track.mockClear()
  warn.mockClear()
})

describe("NodeResultPanel", () => {
  it("tracks close actions with node metadata without raw result content", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={nodeResult()}
          nodeName="Prompt node"
          onClose={onClose}
        />,
      )
    })

    const closeButton = container.querySelector("button")
    expect(closeButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      closeButton?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "workflow.runner",
      name: "workflow-runner-node-result-close",
      action: "close",
      value: "node-1",
      metadata: {
        boundary: "renderer.workflow.runner.node-result",
        nodeId: "node-1",
        status: "failed",
        hasOutput: true,
        hasError: true,
        hasPrompt: true,
        variableCount: 1,
        outputLength: 32,
        errorLength: 36,
        promptLength: 30,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("token=secret-value")
    expect(JSON.stringify(track.mock.calls)).not.toContain("raw backend error")
    expect(JSON.stringify(track.mock.calls)).not.toContain("prompt body")

    await act(async () => {
      root.unmount()
    })
  })

  it("renders non-JSON-safe structured outputs without crashing", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const result = nodeResult()
    const cyclic: Record<string, unknown> = { label: "cyclic" }
    cyclic.self = cyclic

    await act(async () => {
      root.render(
        <NodeResultPanel
          result={{ ...result, outputs: { big: BigInt(1), cyclic } }}
          nodeName="Prompt node"
          onClose={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("1")
    expect(container.textContent).toContain("[Circular]")

    await act(async () => {
      root.unmount()
    })
  })
})

function nodeResult(): NodeRunResult {
  return {
    nodeId: "node-1",
    status: "failed",
    input: {
      variables: { userInput: "token=secret-value" },
      prompt: "prompt body token=secret-value",
    },
    output: "result output token=secret-value",
    error: "raw backend error token=secret-value",
  }
}
