import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ReactFlow,
  Background,
  ControlButton,
  Controls,
  ReactFlowProvider,
  PanOnScrollMode,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  useOnSelectionChange,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Clipboard, Download, LayoutGrid, Maximize2, Trash2 } from "lucide-react"
import { nodeTypes } from "./node-wrappers"
import { BranchEdge } from "./custom-edge"
import { CanvasActionsContext, type NodeClipboard } from "./canvas-context"
import type { WorkflowDefinition, WorkflowLayoutDirection, WorkflowNode, WorkflowEdge } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"
import { autoLayoutNodes } from "./auto-layout"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { resolveBranchLabel } from "../lib/branch-label"
import { errorDiagnostic } from "../lib/error-utils"
import { WorkflowLayoutDirectionProvider } from "../workflow-layout-direction-context"
import { exportWorkflowViewportAsPng } from "./workflow-image-export"

const logger = createRendererLogger("workflow.editor.canvas")

const edgeTypes = { branch: BranchEdge }
const CANVAS_FIT_VIEW_OPTIONS = { padding: 0.1, duration: 200, maxZoom: 1, minZoom: 0.05 }
const EMPTY_CANVAS_VIEWPORT = { x: 0, y: 0, zoom: 1 }
const CONFIG_NAME_DATA_KEY = "__synapseConfigName"
const CONTEXT_MENU_MARGIN = 8
const CONTEXT_MENU_ESTIMATED_WIDTH = 180
const CONTEXT_MENU_ESTIMATED_HEIGHT = 120

function clampContextMenuPosition(x: number, y: number): { left: number; top: number } {
  const { innerWidth, innerHeight } = window
  return {
    left: Math.min(x, innerWidth - CONTEXT_MENU_ESTIMATED_WIDTH - CONTEXT_MENU_MARGIN),
    top: Math.min(y, innerHeight - CONTEXT_MENU_ESTIMATED_HEIGHT - CONTEXT_MENU_MARGIN),
  }
}

type WorkflowFlowNode = Node<Record<string, unknown>, string>
type WorkflowFlowEdge = Edge<{ label?: string }, string>

export interface WorkflowCanvasHandle {
  addNode: (type: string) => void
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  updateNodeName: (nodeId: string, name: string) => void
  removeEdgesByIds: (edgeIds: string[]) => void
  syncSwitchBranchEdges: (sourceNodeId: string, workflowEdges: readonly WorkflowEdge[], branches: Array<{ id: string; label: string }>) => void
  deleteNodes: (nodeIds: string[]) => void
  copyNodes: (nodeIds: string[]) => void
  selectNode: (nodeId: string) => void
  updateLayoutDirection: (direction: WorkflowLayoutDirection) => void
}

function defToFlow(def: WorkflowDefinition) {
  const nodes: WorkflowFlowNode[] = def.nodes.map((n) => {
    const data: Record<string, unknown> = { ...n.config, name: n.name }
    if (Object.prototype.hasOwnProperty.call(n.config, "name")) {
      data[CONFIG_NAME_DATA_KEY] = (n.config as { name?: unknown }).name
    }
    return { id: n.id, type: n.type, position: n.position, data, selected: false, deletable: n.type !== "end" }
  })
  const edges: WorkflowFlowEdge[] = def.edges.map((e) => {
    const branchLabel = e.branch ? resolveBranchLabel(def, e.from, e.branch) : undefined
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: e.branch ?? null,
      ...(branchLabel ? { type: "branch", data: { label: branchLabel } } : {}),
    }
  })
  return { nodes, edges }
}

function defaultConfig(type: string): Record<string, unknown> {
  const manifest = nodeTypeRegistry.getManifest(type)
  return (manifest?.defaultConfig ?? {}) as Record<string, unknown>
}

function defaultName(type: string): string {
  if (type === "switch") return "新分支"
  if (type === "end") return "结束"
  const manifest = nodeTypeRegistry.getManifest(type)
  return manifest?.title || "新提示词"
}

function flowNodeToWorkflowNode(node: WorkflowFlowNode): WorkflowNode {
  const { name, [CONFIG_NAME_DATA_KEY]: configName, ...config } = node.data
  if (configName !== undefined) config.name = configName
  return {
    id: node.id,
    name: typeof name === "string" && name.trim() ? name : node.id,
    type: node.type ?? "prompt",
    position: node.position,
    config,
  }
}

function flowEdgeToWorkflowEdge(edge: WorkflowFlowEdge): WorkflowEdge {
  return { id: edge.id, from: edge.source, to: edge.target, branch: edge.sourceHandle ?? undefined }
}

interface WorkflowCanvasProps {
  definition: WorkflowDefinition
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}

const CanvasContent = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
function CanvasContent({ definition, onChange, onNodeSelect, onRequestRename }, ref) {
  const { nodes: initNodes, edges: initEdges } = defToFlow(definition)
  const [nodes, setNodes] = useNodesState(initNodes)
  const [edges, setEdges] = useEdgesState(initEdges)
  const { screenToFlowPosition, fitView, setViewport, getNodesBounds } = useReactFlow<WorkflowFlowNode, WorkflowFlowEdge>()
  const updateNodeInternals = useUpdateNodeInternals()
  const reactFlowRootRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  // Synchronous definition ref — updated immediately on each onChange call so that
  // sequential handlers (e.g. node-delete + edge-delete in the same event) always
  // read the latest combined state instead of a stale closure capture.
  const definitionRef = useRef(definition)
  definitionRef.current = definition
  const [clipboard, setClipboard] = useState<NodeClipboard | null>(null)
  const [isExportingImage, setIsExportingImage] = useState(false)
  const imageExportInProgressRef = useRef(false)
  // Refs for imperative handle — declared early so useImperativeHandle closure can access them
  const deleteNodesRef = useRef<(nodeIds: string[]) => void>(() => {})
  const copyNodesRef = useRef<(nodeIds: string[]) => void>(() => {})
  const addNodeRef = useRef<(type: string) => void>(() => {})
  const onNodeSelectRef = useRef(onNodeSelect)
  onNodeSelectRef.current = onNodeSelect

  useImperativeHandle(ref, () => ({
    addNode: (type) => addNodeRef.current(type),
    updateNodeConfig: (nodeId, config) => {
      setNodes((nds) => nds.map((n) => {
        if (n.id !== nodeId) return n
        const previousName = (n.data as { name?: unknown }).name
        const nextName = (config as { name?: unknown }).name ?? previousName
        const nextData: Record<string, unknown> = {
          ...config,
          ...(typeof nextName === "string" ? { name: nextName } : {}),
        }
        if (Object.prototype.hasOwnProperty.call(config, "name")) {
          nextData[CONFIG_NAME_DATA_KEY] = config.name
        }
        return { ...n, data: nextData }
      }))
    },
    updateNodeName: (nodeId, name) => {
      setNodes((nds) => nds.map((n) =>
        n.id !== nodeId ? n : { ...n, data: { ...n.data, name } },
      ))
    },
    removeEdgesByIds: (edgeIds) => {
      if (edgeIds.length === 0) return
      const idSet = new Set(edgeIds)
      setEdges((eds) => eds.filter((e) => !idSet.has(e.id)))
    },
    syncSwitchBranchEdges: (sourceNodeId, workflowEdges, branches) => {
      const labelMap = new Map(branches.map((b) => [b.id, b.label]))
      const sourceEdges = new Map(workflowEdges.filter((edge) => edge.from === sourceNodeId).map((edge) => [edge.id, edge]))
      setEdges((eds) => eds.flatMap((edge) => {
        if (edge.source !== sourceNodeId) return [edge]
        const workflowEdge = sourceEdges.get(edge.id)
        if (!workflowEdge) return []
        const label = workflowEdge.branch ? labelMap.get(workflowEdge.branch) : undefined
        return [{
          ...edge,
          sourceHandle: workflowEdge.branch ?? null,
          type: label ? "branch" : undefined,
          data: label ? { ...edge.data, label } : {},
        }]
      }))
    },
    deleteNodes: (nodeIds) => deleteNodesRef.current(nodeIds),
    copyNodes: (nodeIds) => copyNodesRef.current(nodeIds),
    selectNode: (nodeId) => {
      setNodes((nds) => nds.map((node) => ({ ...node, selected: node.id === nodeId })))
      onNodeSelectRef.current?.(nodeId)
    },
    updateLayoutDirection: (layoutDirection) => {
      if (layoutDirection === definitionRef.current.layoutDirection) return
      try {
        const layouted = autoLayoutNodes(nodesRef.current, edgesRef.current, { layoutDirection }) as WorkflowFlowNode[]
        const newDef = {
          ...definitionRef.current,
          layoutDirection,
          nodes: layouted.map(flowNodeToWorkflowNode),
        }
        nodesRef.current = layouted
        definitionRef.current = newDef
        setNodes(layouted)
        onChange(newDef)
        logger.info("layout direction changed", {
          layoutDirection,
          nodeCount: layouted.length,
        })
      } catch {
        toast.error("布局失败，请重试")
      }
    },
  }))

  const previousLayoutDirectionRef = useRef(definition.layoutDirection)
  useEffect(() => {
    if (previousLayoutDirectionRef.current === definition.layoutDirection) return
    previousLayoutDirectionRef.current = definition.layoutDirection
    const nodeIds = nodesRef.current.map((node) => node.id)
    updateNodeInternals(nodeIds)
    const fitFrame = requestAnimationFrame(() => {
      void fitView(CANVAS_FIT_VIEW_OPTIONS)
    })
    return () => cancelAnimationFrame(fitFrame)
  }, [definition.layoutDirection, fitView, updateNodeInternals])

  const getSelectedNodeIds = useCallback((): string[] => {
    return nodesRef.current.filter((n) => n.selected).map((n) => n.id)
  }, [])

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    const blockedEnd = changes.some((c) => c.type === "remove" && nodesRef.current.find((n) => n.id === c.id)?.type === "end")
    if (blockedEnd) toast("结束节点不能删除")
    // Compute changes outside the setNodes updater — React docs say updater
    // functions must be pure (no side effects), and calling onChange (a parent
    // dispatch) inside the updater violates that contract.
    const filteredChanges = changes.filter((change) => {
      if (change.type !== "remove") return true
      const node = nodesRef.current.find((n) => n.id === change.id)
      return node?.type !== "end"
    })
    const updated = applyNodeChanges(filteredChanges, nodesRef.current)
    setNodes(updated)
    // Only propagate structural changes (add/remove) to the definition.
    // Position changes are propagated on drag-end via onNodeDragStop to avoid
    // excessive re-renders and premature dirty-marking during drag.
    if (filteredChanges.some((change) => change.type !== "select" && change.type !== "dimensions" && change.type !== "position")) {
      const newDef = { ...definitionRef.current, nodes: updated.map(flowNodeToWorkflowNode) }
      definitionRef.current = newDef
      onChange(newDef)
    }
  }, [onChange, setNodes])

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    const updated = applyEdgeChanges(changes, edgesRef.current)
    setEdges(updated)
    if (changes.some((change) => change.type !== "select")) {
      const newDef = { ...definitionRef.current, edges: updated.map(flowEdgeToWorkflowEdge) }
      definitionRef.current = newDef
      onChange(newDef)
    }
  }, [onChange, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    const branchLabel = connection.sourceHandle
      ? resolveBranchLabel(definitionRef.current, connection.source, connection.sourceHandle)
      : undefined
    const withBranch = branchLabel
      ? { type: "branch", data: { label: branchLabel } }
      : {}
    const updated = addEdge({ ...connection, ...withBranch }, edgesRef.current) as WorkflowFlowEdge[]
    setEdges(updated)
    const wfEdges: WorkflowEdge[] = updated.map(flowEdgeToWorkflowEdge)
    const newDef = { ...definitionRef.current, edges: wfEdges }
    definitionRef.current = newDef
    logger.info("edge connected", {
      source: connection.source,
      sourceHandle: connection.sourceHandle,
      target: connection.target,
      targetHandle: connection.targetHandle,
      edgeCount: wfEdges.length,
    })
    onChange(newDef)
  }, [onChange, setEdges])

  const onNodeDragStop = useCallback(() => {
    const wfNodes: WorkflowNode[] = nodesRef.current.map(flowNodeToWorkflowNode)
    const newDef = { ...definitionRef.current, nodes: wfNodes }
    definitionRef.current = newDef
    logger.info("node drag stopped", {
      nodeCount: wfNodes.length,
      selectedNodeIds: nodesRef.current.filter((node) => node.selected).map((node) => node.id),
    })
    onChange(newDef)
  }, [onChange])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const addNodeAtScreenPosition = useCallback((type: string, screenPosition: { x: number; y: number }) => {
    const position = screenToFlowPosition(screenPosition)
    const id = crypto.randomUUID()
    const config = defaultConfig(type)
    const name = defaultName(type)
    // Unselect existing nodes and add the new node as selected, matching pasteNodes
    // behaviour so the user can immediately configure the dropped node.
    const data: Record<string, unknown> = { ...config, name }
    if (Object.prototype.hasOwnProperty.call(config, "name")) {
      data[CONFIG_NAME_DATA_KEY] = config.name
    }
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat({ id, type, position, data, selected: true, deletable: true }))
    const newWfNode: WorkflowNode = { id, name, type, position, config }
    const newDef = { ...definitionRef.current, nodes: [...definitionRef.current.nodes, newWfNode] }
    definitionRef.current = newDef
    logger.info("node added", {
      nodeId: id,
      type,
      position,
      nodeCount: newDef.nodes.length,
    })
    onChange(newDef)
    onNodeSelect?.(id)
  }, [screenToFlowPosition, onChange, setNodes, onNodeSelect])

  const addNodeFromPalette = useCallback((type: string) => {
    const bounds = reactFlowRootRef.current?.getBoundingClientRect()
    if (!bounds) return
    addNodeAtScreenPosition(type, {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    })
  }, [addNodeAtScreenPosition])
  addNodeRef.current = addNodeFromPalette

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const type = event.dataTransfer.getData("application/workflow-node-type")
    if (!type) return
    addNodeAtScreenPosition(type, { x: event.clientX, y: event.clientY })
  }, [addNodeAtScreenPosition])

  const selectionChangeHandler = useCallback(({ nodes: selectedNodes }: { nodes: WorkflowFlowNode[] }) => {
    logger.info("selection changed", {
      selectedNodeIds: selectedNodes.map((node) => node.id),
      selectedCount: selectedNodes.length,
    })
    onNodeSelect?.(selectedNodes.length === 1 ? selectedNodes[0].id : null)
  }, [onNodeSelect])

  useOnSelectionChange({ onChange: selectionChangeHandler })

  const copyNodes = useCallback((nodeIds: string[]) => {
    const def = definitionRef.current
    const copyableIds = nodeIds.filter((id) => {
      const node = def.nodes.find((n) => n.id === id)
      return node && node.type !== "end"
    })
    if (copyableIds.length === 0) {
      toast("结束节点不能复制")
      return
    }
    const idSet = new Set(copyableIds)
    const copiedNodes = def.nodes.filter((n) => idSet.has(n.id))
    const copiedEdges = def.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to))
    setClipboard({ nodes: copiedNodes, edges: copiedEdges })
    logger.info("copy nodes", {
      copiedNodeIds: copiedNodes.map((node) => node.id),
      copiedNodeCount: copiedNodes.length,
      copiedEdgeCount: copiedEdges.length,
    })
    toast(`已复制 ${copiedNodes.length} 个节点`)
  }, [])

  const pasteNodes = useCallback((position?: { x: number; y: number }) => {
    if (!clipboard || clipboard.nodes.length === 0) return
    const idMap = new Map<string, string>()
    clipboard.nodes.forEach((n) => idMap.set(n.id, crypto.randomUUID()))

    let offsetX = 50, offsetY = 50
    if (position && clipboard.nodes.length > 0) {
      const first = clipboard.nodes[0]
      offsetX = position.x - first.position.x
      offsetY = position.y - first.position.y
    }

    let rewrittenBindings = 0
    const newNodes = clipboard.nodes.map((n) => {
      // Deep-clone config so rewriting variable bindings doesn't mutate the
      // clipboard entry (which may be pasted again). Then rewrite any
      // `variables[*].source.node` that references a node in this paste set so
      // pasted subgraphs stay internally connected; otherwise the validator
      // would flag them as `unreachable_reference` and block save.
      const clonedConfig = JSON.parse(JSON.stringify(n.config)) as Record<string, unknown>
      const vars = clonedConfig.variables
      if (Array.isArray(vars)) {
        for (const v of vars as Array<Record<string, unknown>>) {
          const src = v.source as Record<string, unknown> | undefined
          if (src?.type === "node_output" && typeof src.node === "string") {
            const mapped = idMap.get(src.node)
            if (mapped) { src.node = mapped; rewrittenBindings++ }
          }
        }
      }
      return {
        ...n,
        id: idMap.get(n.id)!,
        position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
        config: clonedConfig,
      }
    })
    const newEdges = clipboard.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    }))
    logger.info("paste nodes", {
      pastedNodeCount: newNodes.length,
      pastedEdgeCount: newEdges.length,
      rewrittenBindings,
    })

    const newDef = {
      ...definitionRef.current,
      nodes: [...definitionRef.current.nodes, ...newNodes],
      edges: [...definitionRef.current.edges, ...newEdges],
    }
    // Update the ref before constructing flow edges so that branch label
    // resolution (which looks up node configs) can find the freshly pasted
    // Switch nodes.  Without this, resolveBranchLabel returns undefined for
    // pasted Switch branches — edges display without label badges until the
    // editor is reopened.
    definitionRef.current = newDef

    const flowNodes = newNodes.map((n) => {
      const data: Record<string, unknown> = { ...n.config, name: n.name }
      if (Object.prototype.hasOwnProperty.call(n.config, "name")) {
        data[CONFIG_NAME_DATA_KEY] = (n.config as { name?: unknown }).name
      }
      return {
        id: n.id, type: n.type, position: n.position,
        data, selected: true, deletable: n.type !== "end",
      }
    })
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(flowNodes))

    const flowEdges: WorkflowFlowEdge[] = newEdges.map((e) => {
      const branchLabel = e.branch ? resolveBranchLabel(definitionRef.current, e.from, e.branch) : undefined
      return {
        id: e.id, source: e.from, target: e.to, sourceHandle: e.branch ?? null,
        ...(branchLabel ? { type: "branch" as const, data: { label: branchLabel } } : {}),
      }
    })
    setEdges((eds) => eds.concat(flowEdges))

    onChange(newDef)
  }, [clipboard, onChange, setNodes, setEdges])

  const disconnectNodes = useCallback((nodeIds: string[]) => {
    const idSet = new Set(nodeIds)
    setEdges((currentEdges) => {
      const updated = currentEdges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
      const newDef = { ...definitionRef.current, edges: updated.map(flowEdgeToWorkflowEdge) }
      definitionRef.current = newDef
      logger.info("disconnect nodes", {
        nodeIds,
        removedEdgeCount: currentEdges.length - updated.length,
        remainingEdgeCount: updated.length,
      })
      onChange(newDef)
      return updated
    })
  }, [onChange, setEdges])

  const deleteNodes = useCallback((nodeIds: string[]) => {
    const deletableIds = nodeIds.filter((id) => {
      const node = nodesRef.current.find((n) => n.id === id)
      return node && node.type !== "end"
    })
    if (deletableIds.length === 0) {
      toast("结束节点不能删除")
      return
    }
    if (deletableIds.length < nodeIds.length) {
      toast("结束节点已跳过")
    }
    logger.info("delete nodes", {
      requestedNodeIds: nodeIds,
      deletedNodeIds: deletableIds,
    })
    const idSet = new Set(deletableIds)
    const previousEdges = edgesRef.current
    const updatedNodes = nodesRef.current.filter((node) => !idSet.has(node.id))
    const updatedEdges = previousEdges.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target))
    nodesRef.current = updatedNodes
    edgesRef.current = updatedEdges
    setNodes(updatedNodes)
    setEdges(updatedEdges)

    const newDef = {
      ...definitionRef.current,
      nodes: updatedNodes.map(flowNodeToWorkflowNode),
      edges: updatedEdges.map(flowEdgeToWorkflowEdge),
    }
    definitionRef.current = newDef
    logger.info("delete nodes complete", {
      deletedNodeCount: deletableIds.length,
      removedEdgeCount: previousEdges.length - updatedEdges.length,
      remainingNodeCount: updatedNodes.length,
      remainingEdgeCount: updatedEdges.length,
    })
    onChange(newDef)
  }, [onChange, setEdges, setNodes])

  const deleteEdges = useCallback((edgeIds: string[]) => {
    if (edgeIds.length === 0) return
    const idSet = new Set(edgeIds)
    const updated = edgesRef.current.filter((edge) => !idSet.has(edge.id))
    edgesRef.current = updated
    setEdges(updated)
    logger.info("delete edges", {
      deletedEdgeIds: edgeIds,
      remainingEdgeCount: updated.length,
    })
    const newDef = { ...definitionRef.current, edges: updated.map(flowEdgeToWorkflowEdge) }
    definitionRef.current = newDef
    onChange(newDef)
  }, [onChange, setEdges])

  const requestRename = useCallback((nodeId: string) => {
    onNodeSelect?.(nodeId)
    onRequestRename?.(nodeId)
  }, [onNodeSelect, onRequestRename])

  const handleAutoLayout = useCallback(() => {
    const layouted = autoLayoutNodes(nodesRef.current, edgesRef.current, {
      layoutDirection: definitionRef.current.layoutDirection,
    }) as WorkflowFlowNode[]
    nodesRef.current = layouted
    setNodes(layouted)
    const wfNodes: WorkflowNode[] = layouted.map(flowNodeToWorkflowNode)
    const newDef = { ...definitionRef.current, nodes: wfNodes }
    definitionRef.current = newDef
    logger.info("auto layout applied", { nodeCount: layouted.length })
    onChange(newDef)
    requestAnimationFrame(() => {
      void fitView(CANVAS_FIT_VIEW_OPTIONS)
    })
  }, [onChange, setNodes, fitView])

  const handleFitView = useCallback(() => {
    if (nodesRef.current.length === 0) {
      void setViewport(EMPTY_CANVAS_VIEWPORT, { duration: 200 })
      return
    }
    requestAnimationFrame(() => {
      void fitView(CANVAS_FIT_VIEW_OPTIONS)
    })
  }, [fitView, setViewport])

  const handleExportPng = useCallback(async () => {
    if (imageExportInProgressRef.current || nodesRef.current.length === 0) return

    imageExportInProgressRef.current = true
    setIsExportingImage(true)
    try {
      const viewport = reactFlowRootRef.current?.querySelector<HTMLElement>(".react-flow__viewport")
      if (!viewport) throw new Error("React Flow viewport is unavailable.")

      await exportWorkflowViewportAsPng({
        viewport,
        bounds: getNodesBounds(nodesRef.current),
        workflowName: definitionRef.current.name,
      })
    } catch (error) {
      logger.error("workflow PNG export failed", {
        workflowId: definitionRef.current.id,
        ...errorDiagnostic(error),
      })
      toast.error("导出图片失败，请重试")
    } finally {
      imageExportInProgressRef.current = false
      setIsExportingImage(false)
    }
  }, [getNodesBounds])

  const canvasActions = useMemo(() => ({
    clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, deleteEdges, requestRename,
  }), [clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, deleteEdges, requestRename])

  // Update refs for imperative handle and keyboard shortcuts
  deleteNodesRef.current = deleteNodes
  copyNodesRef.current = copyNodes
  const pasteNodesRef = useRef(pasteNodes)
  pasteNodesRef.current = pasteNodes
  const getSelectedNodeIdsRef = useRef(getSelectedNodeIds)
  getSelectedNodeIdsRef.current = getSelectedNodeIds
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || (e.target as HTMLElement)?.isContentEditable) return
      // Delete / Backspace: remove selected nodes (guarded against End node)
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = getSelectedNodeIdsRef.current()
        if (ids.length > 0) deleteNodesRef.current(ids)
        return
      }
      // Escape: deselect all nodes
      if (e.key === "Escape") {
        setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)))
        onNodeSelectRef.current?.(null)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === "c") {
        const ids = getSelectedNodeIdsRef.current()
        if (ids.length > 0) copyNodesRef.current(ids)
      } else if (e.key === "v") {
        pasteNodesRef.current()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const [paneMenu, setPaneMenu] = useState<{ screenX: number; screenY: number; flowX: number; flowY: number } | null>(null)

  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault()
    const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    logger.info("pane context menu opened", {
      flowX: flowPos.x,
      flowY: flowPos.y,
    })
    setPaneMenu({ screenX: event.clientX, screenY: event.clientY, flowX: flowPos.x, flowY: flowPos.y })
  }, [screenToFlowPosition])

  const closePaneMenu = useCallback(() => setPaneMenu(null), [])

  useEffect(() => {
    if (!paneMenu) return
    const handleClose = () => setPaneMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
    window.addEventListener("mousedown", handleClose)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("mousedown", handleClose)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [paneMenu])

  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; screenX: number; screenY: number } | null>(null)

  const onEdgeContextMenu = useCallback((event: MouseEvent | React.MouseEvent, edge: WorkflowFlowEdge) => {
    event.preventDefault()
    event.stopPropagation()
    logger.info("edge context menu opened", { edgeId: edge.id })
    setEdgeMenu({ edgeId: edge.id, screenX: event.clientX, screenY: event.clientY })
  }, [])

  const closeEdgeMenu = useCallback(() => setEdgeMenu(null), [])

  useEffect(() => {
    if (!edgeMenu) return
    const handleClose = () => setEdgeMenu(null)
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
    window.addEventListener("mousedown", handleClose)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("mousedown", handleClose)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [edgeMenu])

  return (
    <CanvasActionsContext.Provider value={canvasActions}>
      <WorkflowLayoutDirectionProvider value={definition.layoutDirection}>
        <ReactFlow ref={reactFlowRootRef} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onNodeDragStop={onNodeDragStop}
          onDrop={onDrop} onDragOver={onDragOver}
          onPaneClick={() => { closePaneMenu(); closeEdgeMenu() }}
          onMoveStart={() => { closePaneMenu(); closeEdgeMenu() }}
          onPaneContextMenu={onPaneContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          edgeTypes={edgeTypes}
          selectionOnDrag selectionMode={SelectionMode.Partial}
          fitView fitViewOptions={CANVAS_FIT_VIEW_OPTIONS}
          panOnScroll panOnScrollMode={PanOnScrollMode.Free}>
          <Background />
          <Controls fitViewOptions={CANVAS_FIT_VIEW_OPTIONS} onFitView={handleFitView}>
            <ControlButton
              aria-label="导出 PNG"
              disabled={nodes.length === 0 || isExportingImage}
              onClick={() => void handleExportPng()}
              title="导出 PNG"
            >
              <Download />
            </ControlButton>
          </Controls>
        </ReactFlow>
      </WorkflowLayoutDirectionProvider>
      {paneMenu && (
        <div
          className="fixed z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={clampContextMenuPosition(paneMenu.screenX, paneMenu.screenY)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
            onClick={() => {
              handleAutoLayout()
              setPaneMenu(null)
            }}
          >
            <LayoutGrid className="size-4" />
            自动布局
          </button>
          <button
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
            onClick={() => {
              handleFitView()
              setPaneMenu(null)
            }}
          >
            <Maximize2 className="size-4" />
            适应画布
          </button>
          <button
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0"
            disabled={!clipboard}
            onClick={() => {
              pasteNodes({ x: paneMenu.flowX, y: paneMenu.flowY })
              setPaneMenu(null)
            }}
          >
            <Clipboard className="size-4" />
            粘贴
            <span className="ml-auto text-xs tracking-widest text-muted-foreground">⌘V</span>
          </button>
        </div>
      )}
      {edgeMenu && (
        <div
          className="fixed z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          style={clampContextMenuPosition(edgeMenu.screenX, edgeMenu.screenY)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground text-destructive [&>svg]:size-4 [&>svg]:shrink-0"
            onClick={() => {
              deleteEdges([edgeMenu.edgeId])
              setEdgeMenu(null)
            }}
          >
            <Trash2 className="size-4" />
            删除连线
          </button>
        </div>
      )}
    </CanvasActionsContext.Provider>
  )
})

export const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
function WorkflowCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <CanvasContent key={`${props.definition.id}:${props.definition.version}`} ref={ref} {...props} />
    </ReactFlowProvider>
  )
})
