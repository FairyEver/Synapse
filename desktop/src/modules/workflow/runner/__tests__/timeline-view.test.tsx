/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"
import { TimelineView } from "../timeline-view"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  track,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
  track.mockClear()
})

describe("TimelineView", () => {
  it("tracks node selection with workflow and node status metadata", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onNodeSelect = vi.fn()

    await act(async () => {
      root.render(
        <TimelineView
          definition={definition()}
          nodeResults={{
            "node-1": nodeResult(),
          }}
          selectedNodeId={null}
          onNodeSelect={onNodeSelect}
        />,
      )
    })

    const nodeRow = Array.from(container.querySelectorAll("div"))
      .find((candidate) => (
        candidate.textContent?.includes("Prompt node")
        && candidate.className.includes("cursor-pointer")
      ))
    expect(nodeRow).toBeInstanceOf(HTMLDivElement)

    await act(async () => {
      nodeRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onNodeSelect).toHaveBeenCalledWith("node-1")
    expect(track).toHaveBeenCalledWith({
      component: "workflow.runner",
      name: "workflow-runner-timeline-node-select",
      action: "select",
      value: "node-1",
      metadata: {
        boundary: "renderer.workflow.runner.timeline",
        workflowId: "workflow-1",
        nodeId: "node-1",
        nodeType: "prompt",
        status: "failed",
        hasError: true,
        hasOutput: false,
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("secret output")

    await act(async () => {
      root.unmount()
    })
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 1,
    updatedAt: 1,
    nodes: [{
      id: "node-1",
      name: "Prompt node",
      type: "prompt",
      position: { x: 0, y: 0 },
      config: {},
    }],
    edges: [],
    params: [],
  }
}

function nodeResult(): NodeRunResult {
  return {
    nodeId: "node-1",
    status: "failed",
    input: { variables: {}, prompt: "secret output" },
    error: "failed",
  }
}
