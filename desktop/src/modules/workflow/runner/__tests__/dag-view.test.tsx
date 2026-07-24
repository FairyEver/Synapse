/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ComponentType, ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"

const reactFlowMock = vi.hoisted(() => ({
  fitView: vi.fn(async (_options?: unknown) => true),
  getNodesBounds: vi.fn(() => ({ x: 0, y: 0, width: 220, height: 80 })),
  getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
  setCenter: vi.fn(async () => true),
  viewportInitialized: true,
}))
const reactFlowProps = vi.hoisted(() => [] as Array<{ fitView?: boolean; minZoom?: number }>)
const updateNodeInternalsMock = vi.hoisted(() => vi.fn())

vi.mock("@xyflow/react", async () => {
  return {
    ReactFlow: ({ nodes, edges, nodeTypes, edgeTypes, children, fitView, minZoom }: {
      nodes: Array<{ id: string; type?: string; data?: unknown; selected?: boolean }>
      edges: Array<{ id: string; source: string; target: string; type?: string; sourceHandle?: string; data?: unknown }>
      nodeTypes: Record<string, ComponentType<Record<string, unknown>>>
      edgeTypes: Record<string, ComponentType<Record<string, unknown>>>
      children?: ReactNode
      fitView?: boolean
      minZoom?: number
    }) => {
      reactFlowProps.push({ fitView, minZoom })
      return (
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
          {nodes.map((node) => {
            const NodeComponent = node.type ? nodeTypes[node.type] : undefined
            if (!NodeComponent) return null
            return (
              <NodeComponent
                key={node.id}
                id={node.id}
                data={node.data}
                selected={node.selected}
              />
            )
          })}
          {children}
        </div>
      )
    },
    Background: () => null,
    Controls: ({ fitViewOptions }: { fitViewOptions?: unknown }) => (
      <button
        type="button"
        data-testid="controls-fit-view"
        onClick={() => void reactFlowMock.fitView(fitViewOptions)}
      >
        fit
      </button>
    ),
    EdgeLabelRenderer: ({ children }: { children?: ReactNode }) => <>{children}</>,
    PanOnScrollMode: { Free: "free" },
    ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
    SelectionMode: { Partial: "partial" },
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    getBezierPath: () => ["M 0 0 L 120 0", 60, 0],
    useReactFlow: () => ({ ...reactFlowMock }),
    useUpdateNodeInternals: () => updateNodeInternalsMock,
  }
})

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ContextMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) => (
    <button type="button" data-testid="context-menu-item" onClick={onSelect}>
      {children}
    </button>
  ),
  ContextMenuTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

vi.mock("../runner-node-wrappers", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  const RunnerOpenAgentConversationContext = React.createContext<
    ((target: { projectId: string; conversationId: string; sessionKey: string; platform: "workflow" }) => void) | undefined
  >(undefined)
  return {
    RunnerOpenAgentConversationContext,
    RunnerNodeResultsContext: React.createContext({}),
    runnerNodeTypes: {
      prompt: () => {
        const onOpen = React.useContext(RunnerOpenAgentConversationContext)
        if (!onOpen) return null
        return (
          <button
            type="button"
            data-testid="dag-agent-action"
            onClick={() => onOpen({
              projectId: "project-1",
              conversationId: "conversation-1",
              sessionKey: "workflow:project-1:conversation-1",
              platform: "workflow",
            })}
          >
            open
          </button>
        )
      },
    },
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
  reactFlowProps.length = 0
  reactFlowMock.viewportInitialized = true
  vi.restoreAllMocks()
  vi.clearAllMocks()
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
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })

    const path = container.querySelector("path")
    expect(path?.getAttribute("stroke")).toBe("var(--border)")
    expect(path?.getAttribute("stroke")).not.toContain("hsl(var(")
    expect(reactFlowProps.at(-1)?.fitView).toBe(true)
    expect(reactFlowProps.at(-1)?.minZoom).toBe(0.05)
  })

  it("waits for the React Flow viewport before focusing a running node", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    reactFlowMock.viewportInitialized = false
    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{ b: nodeResult("b", "running") }}
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })

    expect(reactFlowMock.fitView).not.toHaveBeenCalled()

    reactFlowMock.viewportInitialized = true
    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{ b: nodeResult("b", "running") }}
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })

    expect(reactFlowMock.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 1,
      minZoom: 1,
      nodes: [{ id: "b" }],
      padding: 0.2,
    })
    expect(reactFlowProps.at(-1)?.fitView).toBe(false)
    rafSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it("fits all nodes from the controls fit button and the context menu", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{}}
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='controls-fit-view']")?.click()
    })
    expect(reactFlowMock.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 1,
      minZoom: 0.05,
      padding: 0.2,
    })

    reactFlowMock.fitView.mockClear()
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='context-menu-item']")?.click()
    })
    expect(reactFlowMock.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 1,
      minZoom: 0.05,
      nodes: [{ id: "a" }, { id: "b" }],
      padding: 0.2,
    })
  })

  it("fits all nodes when the run reaches a terminal state", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0)
      return 1
    })
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{ b: nodeResult("b", "running") }}
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })
    reactFlowMock.fitView.mockClear()

    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{ b: nodeResult("b", "success") }}
          runState="completed"
          onNodeSelect={vi.fn()}
        />,
      )
    })

    expect(reactFlowMock.fitView).toHaveBeenCalledWith({
      duration: 300,
      maxZoom: 1,
      minZoom: 0.05,
      nodes: [{ id: "a" }, { id: "b" }],
      padding: 0.2,
    })
    rafSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it("passes the agent conversation open callback to runner nodes", async () => {
    const onOpenAgentConversation = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <DagView
          definition={definition()}
          nodeResults={{}}
          runState="running"
          onNodeSelect={vi.fn()}
          onOpenAgentConversation={onOpenAgentConversation}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='dag-agent-action']")?.click()
    })

    expect(onOpenAgentConversation).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:conversation-1",
      platform: "workflow",
    })
  })

  it("refreshes node internals before fitting when snapshot direction changes", async () => {
    const order: string[] = []
    updateNodeInternalsMock.mockImplementation(() => {
      order.push("internals")
    })
    reactFlowMock.fitView.mockImplementation(async () => {
      order.push("fit")
      return true
    })
    const frameCallbacks: FrameRequestCallback[] = []
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const horizontal = definition()

    await act(async () => {
      root.render(
        <DagView
          definition={horizontal}
          nodeResults={{}}
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })
    updateNodeInternalsMock.mockClear()
    order.length = 0

    await act(async () => {
      root.render(
        <DagView
          definition={{ ...horizontal, layoutDirection: "vertical" }}
          nodeResults={{}}
          runState="running"
          onNodeSelect={vi.fn()}
        />,
      )
    })

    expect(updateNodeInternalsMock).toHaveBeenCalledWith(["a", "b"])
    expect(order).toEqual(["internals"])
    await act(async () => {
      frameCallbacks[0]?.(0)
    })
    expect(order).toEqual(["internals", "fit"])
    rafSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })
})

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
    ],
    edges: [{ id: "edge-1", from: "a", to: "b" }],
  }
}
