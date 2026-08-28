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

const {
  autoLayoutNodesMock,
  exportWorkflowViewportAsPngMock,
  fitViewMock,
  getNodesBoundsMock,
  setViewportMock,
  updateNodeInternalsMock,
  reactFlowProps,
  controlsProps,
  toastErrorMock,
} = vi.hoisted(() => ({
  autoLayoutNodesMock: vi.fn((nodes: Array<{ position: { x: number; y: number } }>) =>
    nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + 10, y: node.position.y + 20 },
    }))),
  exportWorkflowViewportAsPngMock: vi.fn(async () => {}),
  fitViewMock: vi.fn(),
  getNodesBoundsMock: vi.fn(() => ({ x: 0, y: 0, width: 300, height: 120 })),
  setViewportMock: vi.fn(),
  updateNodeInternalsMock: vi.fn(),
  reactFlowProps: [] as Array<Record<string, unknown>>,
  controlsProps: [] as Array<Record<string, unknown>>,
  toastErrorMock: vi.fn(),
}))

vi.mock("@xyflow/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    ReactFlow: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>((props, ref) => {
      reactFlowProps.push(props as unknown as Record<string, unknown>)
      return (
        <div ref={ref} data-testid="react-flow">
          <div className="react-flow__viewport" />
          {props.children}
        </div>
      )
    }),
    Background: () => <div data-testid="background" />,
    ControlButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props} />,
    Controls: (props: { children?: React.ReactNode; onFitView?: () => void }) => {
      controlsProps.push(props as unknown as Record<string, unknown>)
      return (
        <div data-testid="controls">
          <button type="button" aria-label="适应视图" onClick={props.onFitView}>
            fit
          </button>
          {props.children}
        </div>
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
      getNodesBounds: getNodesBoundsMock,
      setViewport: setViewportMock,
    }),
    useUpdateNodeInternals: () => updateNodeInternalsMock,
    useOnSelectionChange: vi.fn(),
    addEdge: vi.fn((_connection: unknown, edges: unknown[]) => edges),
    applyEdgeChanges: vi.fn((_changes: unknown[], edges: unknown[]) => edges),
    applyNodeChanges: vi.fn((changes: Array<{ type: string; id?: string }>, nodes: Array<{ id: string }>) => {
      const removedIds = new Set(changes.filter((change) => change.type === "remove").map((change) => change.id))
      return nodes.filter((node) => !removedIds.has(node.id))
    }),
  }
})

vi.mock("../auto-layout", () => ({
  autoLayoutNodes: autoLayoutNodesMock,
}))

vi.mock("../workflow-image-export", () => ({
  exportWorkflowViewportAsPng: exportWorkflowViewportAsPngMock,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastErrorMock }),
}))

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
  it("restores persisted direction and coordinates without auto-layout on load", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const persisted = {
      ...definitionWithConnectedPrompt(),
      layoutDirection: "vertical" as const,
      nodes: definitionWithConnectedPrompt().nodes.map((node, index) => ({
        ...node,
        position: { x: 17 + index, y: 43 + index },
      })),
    }

    await act(async () => {
      root.render(<WorkflowCanvas definition={persisted} onChange={vi.fn()} />)
    })

    expect(autoLayoutNodesMock).not.toHaveBeenCalled()
    expect((reactFlowProps.at(-1)?.nodes as Array<{ position: unknown }>).map((node) => node.position))
      .toEqual(persisted.nodes.map((node) => node.position))
  })

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

  it("appends the PNG export control and disables it for an empty workflow", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowCanvas definition={definition()} onChange={vi.fn()} />)
    })

    const controls = document.querySelector('[data-testid="controls"]')
    const labels = Array.from(controls?.querySelectorAll("button") ?? [])
      .map((button) => button.getAttribute("aria-label"))
    expect(labels).toEqual(["适应视图", "导出 PNG"])
    expect(buttonByLabel("导出 PNG").disabled).toBe(true)
  })

  it("exports the scoped full workflow viewport once while a download is pending", async () => {
    let finishExport: (() => void) | undefined
    exportWorkflowViewportAsPngMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishExport = resolve
    }))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowCanvas definition={definitionWithConnectedPrompt()} onChange={vi.fn()} />)
    })

    const exportButton = buttonByLabel("导出 PNG")
    await act(async () => {
      exportButton.click()
      exportButton.click()
      await Promise.resolve()
    })

    const flowNodes = reactFlowProps.at(-1)?.nodes
    const viewport = document.querySelector<HTMLElement>('[data-testid="react-flow"] .react-flow__viewport')
    expect(getNodesBoundsMock).toHaveBeenCalledWith(flowNodes)
    expect(exportWorkflowViewportAsPngMock).toHaveBeenCalledWith({
      viewport,
      bounds: { x: 0, y: 0, width: 300, height: 120 },
      workflowName: "Workflow",
    })
    expect(exportWorkflowViewportAsPngMock).toHaveBeenCalledTimes(1)
    expect(exportButton.disabled).toBe(true)

    await act(async () => {
      finishExport?.()
    })
    expect(exportButton.disabled).toBe(false)
  })

  it("reports PNG export failures without exposing the raw error", async () => {
    exportWorkflowViewportAsPngMock.mockRejectedValueOnce(new Error("renderer details"))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<WorkflowCanvas definition={definitionWithConnectedPrompt()} onChange={vi.fn()} />)
    })
    await act(async () => {
      buttonByLabel("导出 PNG").click()
    })

    expect(toastErrorMock).toHaveBeenCalledWith("导出图片失败，请重试")
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

  it("uses the persisted product direction for manual auto-layout", async () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const vertical = {
      ...definitionWithConnectedPrompt(),
      layoutDirection: "vertical" as const,
    }

    await act(async () => {
      root.render(<WorkflowCanvas definition={vertical} onChange={vi.fn()} />)
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
      buttonByText("自动布局").click()
    })

    expect(autoLayoutNodesMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      { layoutDirection: "vertical" },
    )
    rafSpy.mockRestore()
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

  it("adds and selects a palette node through the imperative handle", async () => {
    vi.mocked(nodeTypeRegistry.getManifest).mockReturnValue({
      type: "text",
      title: "文本",
      icon: Square,
      color: "bg-primary/10",
      defaultConfig: { template: "" },
      ports: { inputs: [], outputs: [] },
      cardSummary: () => ({ title: "文本", subtitle: "" }),
      configFields: [],
      configSchema: {} as never,
      share: {
        selfContained: true,
        capability: { id: "workflow.node.text", minVersion: "1.0.0" },
      },
    })
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000002")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const canvasRef = createRef<WorkflowCanvasHandle>()
    const onChange = vi.fn()
    const onNodeSelect = vi.fn()

    await act(async () => {
      root.render(
        <WorkflowCanvas
          ref={canvasRef}
          definition={definitionWithEndOnly()}
          onChange={onChange}
          onNodeSelect={onNodeSelect}
        />,
      )
    })

    await act(async () => {
      canvasRef.current?.addNode("text")
    })

    expect(onChange.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({
        id: "00000000-0000-4000-8000-000000000002",
        type: "text",
        config: { template: "" },
      })]),
    }))
    expect(onNodeSelect).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002")
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
      share: {
        selfContained: false,
        capability: { id: "workflow.node.claude_code", minVersion: "1.0.0" },
      },
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

  it("atomically changes direction and coordinates before refreshing internals then fitting", async () => {
    const order: string[] = []
    updateNodeInternalsMock.mockImplementation(() => {
      order.push("internals")
    })
    fitViewMock.mockImplementation(() => {
      order.push("fit")
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
    const canvasRef = createRef<WorkflowCanvasHandle>()
    const onChange = vi.fn()
    const initial = definitionWithConnectedPrompt()

    await act(async () => {
      root.render(<WorkflowCanvas ref={canvasRef} definition={initial} onChange={onChange} />)
    })
    await act(async () => {
      canvasRef.current?.updateLayoutDirection("vertical")
    })

    const next = onChange.mock.lastCall?.[0] as WorkflowDefinition
    expect(next.layoutDirection).toBe("vertical")
    expect(next.nodes.map((node) => node.position)).toEqual(
      initial.nodes.map((node) => ({ x: node.position.x + 10, y: node.position.y + 20 })),
    )
    expect(onChange).toHaveBeenCalledTimes(1)

    await act(async () => {
      root.render(<WorkflowCanvas ref={canvasRef} definition={next} onChange={onChange} />)
    })

    expect(updateNodeInternalsMock).toHaveBeenCalledWith(["start-1", "prompt-1", "end-1"])
    expect(order).toEqual(["internals"])
    await act(async () => {
      frameCallbacks[0]?.(0)
    })
    expect(order).toEqual(["internals", "fit"])
    rafSpy.mockRestore()
    cancelAnimationFrameSpy.mockRestore()
  })

  it("keeps the original draft when direction layout fails", async () => {
    autoLayoutNodesMock.mockImplementationOnce(() => {
      throw new Error("layout failed")
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const canvasRef = createRef<WorkflowCanvasHandle>()
    const onChange = vi.fn()

    await act(async () => {
      root.render(
        <WorkflowCanvas
          ref={canvasRef}
          definition={definitionWithConnectedPrompt()}
          onChange={onChange}
        />,
      )
    })
    await act(async () => {
      canvasRef.current?.updateLayoutDirection("vertical")
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(updateNodeInternalsMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledWith("布局失败，请重试")
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    layoutDirection: "horizontal" as const,
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

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}
