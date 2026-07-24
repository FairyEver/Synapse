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
  extractLabel: () => "button",
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

  it("opens the Agent conversation attached to a node result", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onOpenAgentConversation = vi.fn()

    await act(async () => {
      root.render(
        <TimelineView
          definition={definition()}
          nodeResults={{
            "node-1": {
              ...nodeResult(),
              outputs: { agentConversation: target },
            },
          }}
          selectedNodeId={null}
          onNodeSelect={vi.fn()}
          onOpenAgentConversation={onOpenAgentConversation}
        />,
      )
    })

    const openButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("打开对话"))
    expect(openButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onOpenAgentConversation).toHaveBeenCalledWith(target)

    await act(async () => {
      root.unmount()
    })
  })

  it("tracks an empty string as a present output", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <TimelineView
          definition={definition()}
          nodeResults={{ "node-1": { ...nodeResult(), output: "" } }}
          selectedNodeId={null}
          onNodeSelect={vi.fn()}
        />,
      )
    })

    const nodeRow = Array.from(container.querySelectorAll("div"))
      .find((candidate) => candidate.textContent?.includes("Prompt node") && candidate.className.includes("cursor-pointer"))
    await act(async () => {
      nodeRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(track).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ hasOutput: true }),
    }))

    await act(async () => {
      root.unmount()
    })
  })

  it("shows completed node durations with readable minute and second units", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <TimelineView
          definition={definition()}
          nodeResults={{
            "node-1": {
              ...nodeResult(),
              status: "success",
              durationMs: 72_000,
              error: undefined,
            },
          }}
          selectedNodeId={null}
          onNodeSelect={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain("耗时 1分钟12秒")

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
    layoutDirection: "horizontal" as const,
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
