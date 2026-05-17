/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"

const { setViewportMock } = vi.hoisted(() => ({
  setViewportMock: vi.fn(),
}))

vi.mock("@xyflow/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    ReactFlow: ({ children }: { children?: React.ReactNode }) => <div data-testid="react-flow">{children}</div>,
    Background: () => <div data-testid="background" />,
    Controls: ({ onFitView }: { onFitView?: () => void }) => (
      <button type="button" aria-label="适应视图" onClick={onFitView}>
        fit
      </button>
    ),
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    PanOnScrollMode: { Free: "free" },
    SelectionMode: { Partial: "partial" },
    useNodesState: (initial: unknown[]) => React.useState(initial),
    useEdgesState: (initial: unknown[]) => React.useState(initial),
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      fitView: vi.fn(),
      setViewport: setViewportMock,
    }),
    useOnSelectionChange: vi.fn(),
    addEdge: vi.fn((_connection: unknown, edges: unknown[]) => edges),
    applyEdgeChanges: vi.fn((_changes: unknown[], edges: unknown[]) => edges),
    applyNodeChanges: vi.fn((_changes: unknown[], nodes: unknown[]) => nodes),
  }
})

vi.mock("../node-wrappers", () => ({
  NodeResultsContext: {
    Provider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  },
  nodeTypes: {},
}))

vi.mock("../custom-edge", () => ({
  BranchEdge: () => null,
}))

vi.mock("../../../../../workflow-nodes/registry", () => ({
  nodeTypeRegistry: {
    getManifest: vi.fn(),
  },
}))

import { WorkflowCanvas } from "../canvas"

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
  vi.clearAllMocks()
})

describe("WorkflowCanvas", () => {
  it("resets the viewport when fit view is clicked on an empty canvas", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowCanvas definition={definition()} onChange={vi.fn()} />)
    })

    await act(async () => {
      buttonByText("fit").click()
    })

    expect(setViewportMock).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1 }, { duration: 200 })
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
    nodes: [],
    edges: [],
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
