/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"

vi.mock("@xyflow/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    ReactFlow: ({ edges, edgeTypes, children }: {
      edges: Array<{ id: string; source: string; target: string; type?: string; sourceHandle?: string; data?: unknown }>
      edgeTypes: Record<string, React.ComponentType<Record<string, unknown>>>
      children?: React.ReactNode
    }) => (
      <div data-testid="react-flow">
        {edges.map((edge) => {
          const Edge = edgeTypes[edge.type ?? "default"]
          return (
            <svg key={edge.id} data-testid={`edge-${edge.id}`}>
              <Edge
                id={edge.id}
                source={edge.source}
                sourceX={0}
                sourceY={0}
                targetX={120}
                targetY={0}
                sourcePosition="right"
                targetPosition="left"
                data={edge.data}
                sourceHandleId={edge.sourceHandle}
              />
            </svg>
          )
        })}
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    PanOnScrollMode: { Free: "free" },
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    SelectionMode: { Partial: "partial" },
    getBezierPath: () => ["M 0 0 L 120 0", 60, 0],
  }
})

vi.mock("../runner-node-wrappers", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    RunnerNodeResultsContext: React.createContext({}),
    runnerNodeTypes: {},
  }
})

import { DagView } from "../dag-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots.length = 0
  document.body.innerHTML = ""
})

describe("DagView", () => {
  it("renders workflow edges with shadcn color variables", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{}}
          onNodeSelect={vi.fn()}
        />,
      )
    })

    const path = container.querySelector("path")
    expect(path?.getAttribute("stroke")).toBe("var(--border)")
    expect(path?.getAttribute("stroke")).not.toContain("hsl(var(")
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [{ id: "edge-1", from: "a", to: "b" }],
  }
}
