/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"
import { ExecutionOverlay } from "../execution-overlay"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ui-tracking")>("@/lib/ui-tracking")
  return {
    ...actual,
    track,
  }
})

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
  track.mockClear()
})

describe("ExecutionOverlay", () => {
  it("renders node results in execution order instead of object insertion order", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ExecutionOverlay
          definition={definition([
            { id: "node-1", name: "Start" },
            { id: "node-2", name: "Transform" },
          ])}
          runState="completed"
          nodeResults={{
            "node-2": {
              nodeId: "node-2",
              status: "success",
              input: { variables: {} },
              startedAt: 200,
            },
            "node-1": {
              nodeId: "node-1",
              status: "success",
              input: { variables: {} },
              startedAt: 100,
            },
          }}
        />,
      )
    })

    const start = textElement(container, "Start")
    const transform = textElement(container, "Transform")
    expect(start.compareDocumentPosition(transform) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("tracks node detail opens without logging prompt, output, or error text", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const rawPrompt = "prompt with token=sk-secret"
    const rawOutput = "output from /Users/example/project/file.txt"
    const rawError = "authorization failed Bearer abc123"

    await act(async () => {
      root.render(
        <ExecutionOverlay
          definition={definition()}
          runState="failed"
          nodeResults={{
            "node-1": {
              nodeId: "node-1",
              status: "failed",
              input: {
                variables: {},
                prompt: rawPrompt,
              },
              output: rawOutput,
              error: rawError,
            },
          }}
        />,
      )
    })

    await act(async () => {
      textElement(container, "Transform").click()
    })

    expect(track).toHaveBeenCalledWith({
      component: "workflow.editor",
      name: "workflow-editor-execution-node-detail-open",
      action: "select",
      value: "node-1",
      metadata: {
        boundary: "renderer.workflow.editor.execution-overlay",
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "prompt",
        status: "failed",
        hasError: true,
        hasOutput: true,
        hasPrompt: true,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain(rawPrompt)
    expect(JSON.stringify(track.mock.calls)).not.toContain(rawOutput)
    expect(JSON.stringify(track.mock.calls)).not.toContain(rawError)
    expect(`${JSON.stringify(warnSpy.mock.calls)}${JSON.stringify(errorSpy.mock.calls)}`).not.toContain("Missing `Description`")
  })

  it("clears external node viewing state when closing a locally selected detail", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onViewClose = vi.fn()

    await act(async () => {
      root.render(
        <ExecutionOverlay
          definition={definition([
            { id: "node-1", name: "External" },
            { id: "node-2", name: "Local" },
          ])}
          runState="completed"
          viewingNodeId="node-1"
          onViewClose={onViewClose}
          nodeResults={{
            "node-1": {
              nodeId: "node-1",
              status: "success",
              input: { variables: {} },
            },
            "node-2": {
              nodeId: "node-2",
              status: "success",
              input: { variables: {} },
            },
          }}
        />,
      )
    })

    await act(async () => {
      textElement(container, "Local").click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')?.click()
    })

    expect(onViewClose).toHaveBeenCalledTimes(1)
  })
})

function definition(nodes: Array<{ id: string; name: string }> = [{ id: "node-1", name: "Transform" }]): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      type: "prompt",
      position: { x: 0, y: 0 },
      config: {},
    })),
    edges: [],
  }
}

function textElement(container: HTMLElement, text: string): HTMLElement {
  const element = Array.from(container.querySelectorAll("*"))
    .find((candidate): candidate is HTMLElement =>
      candidate instanceof HTMLElement && candidate.textContent === text
    )
  if (!element) throw new Error(`Element not found: ${text}`)
  return element
}
