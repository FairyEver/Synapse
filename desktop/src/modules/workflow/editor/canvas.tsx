import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  PanOnScrollMode,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
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
import { Clipboard } from "lucide-react"
import { nodeTypes, NodeResultsContext } from "./node-wrappers"
import { BranchEdge } from "./custom-edge"
import { CanvasActionsContext, type NodeClipboard } from "./canvas-context"
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, NodeRunResult } from "@/types/workflow"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("workflow.editor.canvas")

const edgeTypes = { branch: BranchEdge }

type WorkflowFlowNode = Node<Record<string, unknown>, string>
type WorkflowFlowEdge = Edge<{ label?: string }, string>

export interface WorkflowCanvasHandle {
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  removeEdgesByIds: (edgeIds: string[]) => void
  updateEdgeLabels: (sourceNodeId: string, branches: Array<{ id: string; label: string }>) => void
  deleteNodes: (nodeIds: string[]) => void
  copyNodes: (nodeIds: string[]) => void
}

function resolveBranchLabel(def: WorkflowDefinition, fromId: string, branchId: string): string | undefined {
  const node = def.nodes.find((n) => n.id === fromId)
  if (!node || node.type !== "switch") return undefined
  const branches = (node.config as { branches?: Array<{ id: string; label: string }> }).branches
  return branches?.find((b) => b.id === branchId)?.label ?? branchId
}

function defToFlow(def: WorkflowDefinition) {
  const nodes: WorkflowFlowNode[] = def.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { ...n.config, name: n.name }, selected: false, deletable: n.type !== "end" }))
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
  if (type === "switch") return { agent: "", prompt: "", variables: [], branches: [{ id: "branch1", label: "分支 1" }] }
  if (type === "end") return { outputType: "text", template: "", variables: [] }
  return { agent: "", prompt: "", variables: [] }
}

function defaultName(type: string): string {
  if (type === "switch") return "新分支"
  if (type === "end") return "结束"
  return "新提示词"
}

function flowNodeToWorkflowNode(node: WorkflowFlowNode): WorkflowNode {
  const { name, ...config } = node.data
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
  nodeResults?: Record<string, NodeRunResult>
  runState?: string
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}

const CanvasContent = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
function CanvasContent({ definition, nodeResults, runState, onChange, onNodeSelect, onRequestRename }, ref) {
  const { nodes: initNodes, edges: initEdges } = defToFlow(definition)
  const [nodes, setNodes] = useNodesState(initNodes)
  const [edges, setEdges] = useEdgesState(initEdges)
  const { screenToFlowPosition } = useReactFlow()
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  // Synchronous definition ref — updated immediately on each onChange call so that
  // sequential handlers (e.g. node-delete + edge-delete in the same event) always
  // read the latest combined state instead of a stale closure capture.
  const definitionRef = useRef(definition)
  definitionRef.current = definition
  const [clipboard, setClipboard] = useState<NodeClipboard | null>(null)
  // Refs for imperative handle — declared early so useImperativeHandle closure can access them
  const deleteNodesRef = useRef<(nodeIds: string[]) => void>(() => {})
  const copyNodesRef = useRef<(nodeIds: string[]) => void>(() => {})

  useImperativeHandle(ref, () => ({
    updateNodeConfig: (nodeId, config) => {
      setNodes((nds) => nds.map((n) => {
        if (n.id !== nodeId) return n
        const previousName = (n.data as { name?: unknown }).name
        const nextName = (config as { name?: unknown }).name ?? previousName
        return { ...n, data: { ...config, ...(typeof nextName === "string" ? { name: nextName } : {}) } }
      }))
    },
    removeEdgesByIds: (edgeIds) => {
      if (edgeIds.length === 0) return
      const idSet = new Set(edgeIds)
      setEdges((eds) => eds.filter((e) => !idSet.has(e.id)))
    },
    updateEdgeLabels: (sourceNodeId, branches) => {
      const labelMap = new Map(branches.map((b) => [b.id, b.label]))
      setEdges((eds) => eds.map((e) => {
        if (e.source !== sourceNodeId || !e.sourceHandle) return e
        const newLabel = labelMap.get(e.sourceHandle)
        if (!newLabel) return e
        const currentLabel = (e.data as { label?: string } | undefined)?.label
        if (currentLabel === newLabel) return e
        return { ...e, type: "branch", data: { ...e.data, label: newLabel } }
      }))
    },
    deleteNodes: (nodeIds) => deleteNodesRef.current(nodeIds),
    copyNodes: (nodeIds) => copyNodesRef.current(nodeIds),
  }))

  const getSelectedNodeIds = useCallback((): string[] => {
    return nodesRef.current.filter((n) => n.selected).map((n) => n.id)
  }, [])

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    const blockedEnd = changes.some((c) => c.type === "remove" && nodesRef.current.find((n) => n.id === c.id)?.type === "end")
    if (blockedEnd) toast("结束节点不能删除")
    setNodes((currentNodes) => {
      const filteredChanges = changes.filter((change) => {
        if (change.type !== "remove") return true
        const node = currentNodes.find((n) => n.id === change.id)
        return node?.type !== "end"
      })
      const updated = applyNodeChanges(filteredChanges, currentNodes)
      // Only propagate structural changes (add/remove) to the definition.
      // Position changes are propagated on drag-end via onNodeDragStop to avoid
      // excessive re-renders and premature dirty-marking during drag.
      if (filteredChanges.some((change) => change.type !== "select" && change.type !== "dimensions" && change.type !== "position")) {
        const newDef = { ...definitionRef.current, nodes: updated.map(flowNodeToWorkflowNode) }
        definitionRef.current = newDef
        onChange(newDef)
      }
      return updated
    })
  }, [onChange, setNodes])

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    setEdges((currentEdges) => {
      const updated = applyEdgeChanges(changes, currentEdges)
      if (changes.some((change) => change.type !== "select")) {
        const newDef = { ...definitionRef.current, edges: updated.map(flowEdgeToWorkflowEdge) }
        definitionRef.current = newDef
        onChange(newDef)
      }
      return updated
    })
  }, [onChange, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => {
      const branchLabel = connection.sourceHandle
        ? resolveBranchLabel(definitionRef.current, connection.source, connection.sourceHandle)
        : undefined
      const withBranch = branchLabel
        ? { type: "branch", data: { label: branchLabel } }
        : {}
      const updated = addEdge({ ...connection, ...withBranch }, eds) as typeof eds
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
      return updated
    })
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

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const type = event.dataTransfer.getData("application/workflow-node-type")
    if (!type) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const id = crypto.randomUUID()
    const config = defaultConfig(type)
    const name = defaultName(type)
    // Unselect existing nodes and add the new node as selected, matching pasteNodes
    // behaviour so the user can immediately configure the dropped node.
    setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat({ id, type, position, data: { ...config, name }, selected: true, deletable: true }))
    const newWfNode: WorkflowNode = { id, name, type, position, config }
    const newDef = { ...definitionRef.current, nodes: [...definitionRef.current.nodes, newWfNode] }
    definitionRef.current = newDef
    logger.info("node dropped", {
      nodeId: id,
      type,
      position,
      nodeCount: newDef.nodes.length,
    })
    onChange(newDef)
    onNodeSelect?.(id)
  }, [screenToFlowPosition, onChange, setNodes, onNodeSelect])

  const selectionChangeHandler = useCallback(({ nodes: selectedNodes }: { nodes: WorkflowFlowNode[] }) => {
    if (runState && runState !== "idle") return
    logger.info("selection changed", {
      selectedNodeIds: selectedNodes.map((node) => node.id),
      selectedCount: selectedNodes.length,
    })
    onNodeSelect?.(selectedNodes.length === 1 ? selectedNodes[0].id : null)
  }, [runState, onNodeSelect])

  useOnSelectionChange({ onChange: selectionChangeHandler })

  const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowFlowNode) => {
    if (runState && runState !== "idle") {
      onNodeSelect?.(node.id)
    }
  }, [runState, onNodeSelect])

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

    const flowNodes = newNodes.map((n) => ({
      id: n.id, type: n.type, position: n.position,
      data: { ...n.config, name: n.name }, selected: true, deletable: n.type !== "end",
    }))
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
    const changes: NodeChange<WorkflowFlowNode>[] = deletableIds.map((id) => ({ type: "remove", id }))
    handleNodesChange(changes)
  }, [handleNodesChange])

  const requestRename = useCallback((nodeId: string) => {
    onNodeSelect?.(nodeId)
    onRequestRename?.(nodeId)
  }, [onNodeSelect, onRequestRename])

  const canvasActions = useMemo(() => ({
    clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, requestRename,
  }), [clipboard, getSelectedNodeIds, copyNodes, pasteNodes, disconnectNodes, deleteNodes, requestRename])

  // Update refs for imperative handle and keyboard shortcuts
  deleteNodesRef.current = deleteNodes
  copyNodesRef.current = copyNodes
  const pasteNodesRef = useRef(pasteNodes)
  pasteNodesRef.current = pasteNodes
  const getSelectedNodeIdsRef = useRef(getSelectedNodeIds)
  getSelectedNodeIdsRef.current = getSelectedNodeIds
  const onNodeSelectRef = useRef(onNodeSelect)
  onNodeSelectRef.current = onNodeSelect

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

  return (
    <CanvasActionsContext.Provider value={canvasActions}>
      <NodeResultsContext.Provider value={nodeResults ?? {}}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onNodeDragStop={onNodeDragStop}
          onDrop={onDrop} onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={closePaneMenu}
          onMoveStart={closePaneMenu}
          onPaneContextMenu={onPaneContextMenu}
          edgeTypes={edgeTypes}
          selectionOnDrag selectionMode={SelectionMode.Partial}
          fitView panOnScroll panOnScrollMode={PanOnScrollMode.Free}>
          <Background />
          <Controls />
        </ReactFlow>
        {paneMenu && (
          <div
            className="fixed z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            style={{ left: paneMenu.screenX, top: paneMenu.screenY }}
            onMouseDown={(e) => e.stopPropagation()}
          >
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
      </NodeResultsContext.Provider>
    </CanvasActionsContext.Provider>
  )
})

export const WorkflowCanvas = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
function WorkflowCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <CanvasContent ref={ref} {...props} />
    </ReactFlowProvider>
  )
})
