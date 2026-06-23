/**
 * @vitest-environment jsdom
 */
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { Square } from "lucide-react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"
import type { WorkflowCanvasHandle } from "../canvas"
import { nodeTypeRegistry } from "../../../../../workflow-nodes/registry"

const { fitViewMock, setViewportMock, reactFlowProps, controlsProps } = vi.hoisted(() => ({
  fitViewMock: vi.fn(),
  setViewportMock: vi.fn(),
  reactFlowProps: [] as Array<Record<string, unknown>>,
  controlsProps: [] as Array<Record<string, unknown>>,
}))

vi.mock("@xyflow/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    ReactFlow: (props: { children?: React.ReactNode }) => {
      reactFlowProps.push(props as unknown as Record<string, unknown>)
      return <div data-testid="react-flow">{props.children}</div>
    },
    Background: () => <div data-testid="background" />,
    Controls: (props: { onFitView?: () => void }) => {
      controlsProps.push(props as unknown as Record<string, unknown>)
      return (
      <button type="button" aria-label="适应视图" onClick={props.onFitView}>
        fit
      </button>
      )
    },
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    PanOnScrollMode: { Free: "free" },
    SelectionMode: { Partial: "partial" },
    useNodesState: (initial: unknown[]) => React.useState(initial),
    useEdgesState: (initial: unknown[]) => React.useState(initial),
    useReactFlow: () => ({
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      fitView: fitViewMock,
      setViewport: setViewportMock,
    }),
    useOnSelectionChange: vi.fn(),
    addEdge: vi.fn((_connection: unknown, edges: unknown[]) => edges),
    applyEdgeChanges: vi.fn((_changes: unknown[], edges: unknown[]) => edges),
    applyNodeChanges: vi.fn((changes: Array<{ type: string; id?: string }>, nodes: Array<{ id: string }>) => {
      const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id))
      return nodes.filter((node) => !removedIds.has(node.id))
    }),
  }
})

vi.mock("../node-wrappers", () => ({
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
  reactFlowProps.length = 0
  controlsProps.length = 0
  vi.clearAllMocks()
})

describe("WorkflowCanvas", () => {
  it("caps fit view zoom at 100% for a single end node", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowCanvas definition={definitionWithEndOnly()} onChange={vi.fn()} />)
    })

    expect(reactFlowProps.at(-1)?.fitViewOptions).toMatchObject({ padding: 0.1, duration: 200, maxZoom: 1, minZoom: 0.05 })
    expect(controlsProps.at(-1)?.fitViewOptions).toMatchObject({ padding: 0.1, duration: 200, maxZoom: 1, minZoom: 0.05 })
  })

  it("fits the full editor canvas from the pane context menu", async () => {
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
      root.render(<WorkflowCanvas definition={definitionWithConnectedPrompt()} onChange={vi.fn()} />)
    })

    await act(async () => {
      const onPaneContextMenu = reactFlowProps.at(-1)?.onPaneContextMenu as (event: {
        preventDefault: () => void
        clientX: number
        clientY: number
      }) => void
      onPaneContextMenu({ preventDefault: vi.fn(), clientX: 12, clientY: 24 })
    })

    await act(async () => {
      buttonByText("适应画布").click()
    })

    expect(fitViewMock).toHaveBeenCalledWith({ padding: 0.1, duration: 200, maxZoom: 1, minZoom: 0.05 })
    rafSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

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

  it("propagates one definition without connected edges when deleting a node", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const canvasRef = createRef<WorkflowCanvasHandle>()
    const onChange = vi.fn()

    await act(async () => {
      root.render(<WorkflowCanvas ref={canvasRef} definition={definitionWithConnectedPrompt()} onChange={onChange} />)
    })

    await act(async () => {
      canvasRef.current?.deleteNodes(["prompt-1"])
    })

    const lastDefinition = onChange.mock.lastCall?.[0] as WorkflowDefinition | undefined
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(lastDefinition?.nodes.map((node) => node.id)).toEqual(["start-1", "end-1"])
    expect(lastDefinition?.edges).toEqual([])
  })

  it("selects a node through the imperative handle", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const canvasRef = createRef<WorkflowCanvasHandle>()
    const onNodeSelect = vi.fn()

    await act(async () => {
      root.render(
        <WorkflowCanvas
          ref={canvasRef}
          definition={definitionWithConnectedPrompt()}
          onChange={vi.fn()}
          onNodeSelect={onNodeSelect}
        />,
      )
    })

    await act(async () => {
      canvasRef.current?.selectNode("prompt-1")
    })

    expect(onNodeSelect).toHaveBeenCalledWith("prompt-1")
  })

  it("uses all Claude Code setting sources for new nodes", async () => {
    vi.mocked(nodeTypeRegistry.getManifest).mockReturnValue({
      type: "claude_code",
      title: "Claude Code",
      icon: Square,
      color: "bg-primary/10",
      defaultConfig: {
        variables: [],
        prompt: "",
        permissionMode: "acceptEdits",
        outputFormat: "stream-json",
        verbose: true,
        safeMode: false,
        bareMode: false,
        noSessionPersistence: false,
        settingSources: ["user", "project", "local"],
        strictMcpConfig: false,
        additionalDirectories: [],
        allowedTools: [],
        disallowedTools: [],
        captureDebugArtifacts: true,
      },
      ports: { inputs: [], outputs: [] },
      cardSummary: () => ({ title: "Claude Code", subtitle: "" }),
      configFields: [],
      configSchema: {} as never,
    })
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const onChange = vi.fn()

    await act(async () => {
      root.render(<WorkflowCanvas definition={definition()} onChange={onChange} />)
    })

    await act(async () => {
      const onDrop = reactFlowProps.at(-1)?.onDrop as (event: {
        preventDefault: () => void
        clientX: number
        clientY: number
        dataTransfer: { getData: (key: string) => string }
      }) => void
      onDrop({
        preventDefault: vi.fn(),
        clientX: 100,
        clientY: 120,
        dataTransfer: {
          getData: (key) => key === "application/workflow-node-type" ? "claude_code" : "",
        },
      })
    })

    const nextDefinition = onChange.mock.lastCall?.[0] as WorkflowDefinition | undefined
    expect(nextDefinition?.nodes).toContainEqual(expect.objectContaining({
      id: "00000000-0000-4000-8000-000000000001",
      type: "claude_code",
      config: expect.objectContaining({
        settingSources: ["user", "project", "local"],
      }),
    }))
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

function definitionWithConnectedPrompt(): WorkflowDefinition {
  return {
    ...definition(),
    nodes: [
      {
        id: "start-1",
        name: "Start",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "prompt-1",
        name: "Prompt",
        type: "prompt",
        position: { x: 100, y: 0 },
        config: {},
      },
      {
        id: "end-1",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: {},
      },
    ],
    edges: [
      { id: "edge-1", from: "start-1", to: "prompt-1" },
      { id: "edge-2", from: "prompt-1", to: "end-1" },
    ],
  }
}

function definitionWithEndOnly(): WorkflowDefinition {
  return {
    ...definition(),
    nodes: [
      {
        id: "end-1",
        name: "End",
        type: "end",
        position: { x: 600, y: 200 },
        config: { outputType: "text", template: "", variables: [] },
      },
    ],
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
