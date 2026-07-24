import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"
import { fitWorkflowNodes, focusRunningNodes, getRunningNodeIds } from "../viewport-focus"

describe("workflow runner viewport focus", () => {
  it("returns running node ids in definition order", () => {
    expect(getRunningNodeIds(definition(), {
      c: nodeResult("c", "running"),
      missing: nodeResult("missing", "running"),
      a: nodeResult("a", "success"),
      b: nodeResult("b", "running"),
    })).toEqual(["b", "c"])
  })

  it("fits a single running node without changing the zoom", async () => {
    const controller = controllerMock({
      zoom: 1.6,
      bounds: { x: 100, y: 200, width: 220, height: 80 },
    })

    await focusRunningNodes(["a"], controller)

    expect(controller.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 1.6,
      minZoom: 1.6,
      nodes: [{ id: "a" }],
      padding: 0.2,
    })
    expect(controller.getNodesBounds).not.toHaveBeenCalled()
    expect(controller.setCenter).not.toHaveBeenCalled()
  })

  it("fits multiple running nodes without zooming in beyond the current zoom", async () => {
    const controller = controllerMock({
      zoom: 0.85,
      bounds: { x: 0, y: 0, width: 800, height: 500 },
    })

    await focusRunningNodes(["a", "d"], controller)

    expect(controller.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 0.85,
      minZoom: 0.05,
      nodes: [{ id: "a" }, { id: "d" }],
      padding: 0.2,
    })
    expect(controller.setCenter).not.toHaveBeenCalled()
  })

  it("does not move the viewport when no nodes are running", async () => {
    const controller = controllerMock({
      zoom: 1,
      bounds: { x: 0, y: 0, width: 220, height: 80 },
    })

    await focusRunningNodes([], controller)

    expect(controller.setCenter).not.toHaveBeenCalled()
    expect(controller.fitView).not.toHaveBeenCalled()
  })

  it("fits all workflow nodes with room around the edges", async () => {
    const controller = controllerMock({
      zoom: 1,
      bounds: { x: 0, y: 0, width: 220, height: 80 },
    })

    await fitWorkflowNodes(["a", "b", "c"], controller)

    expect(controller.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 1,
      minZoom: 0.05,
      nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      padding: 0.2,
    })
  })
})

function controllerMock({
  zoom,
  bounds,
}: {
  zoom: number
  bounds: { x: number; y: number; width: number; height: number }
}) {
  return {
    getViewport: vi.fn(() => ({ x: 0, y: 0, zoom })),
    getNodesBounds: vi.fn(() => bounds),
    setCenter: vi.fn(async () => true),
    fitView: vi.fn(async () => true),
  }
}

function nodeResult(nodeId: string, status: NodeRunResult["status"]): NodeRunResult {
  return { nodeId, status, input: { variables: {} } }
}

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    layoutDirection: "horizontal" as const,
    params: [],
    nodes: [
      { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: {} },
      { id: "c", name: "C", type: "prompt", position: { x: 400, y: 0 }, config: {} },
    ],
    edges: [],
  }
}
