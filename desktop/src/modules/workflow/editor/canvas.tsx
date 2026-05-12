import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  PanOnScrollMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
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
import { nodeTypes, NodeResultsContext } from "./node-wrappers"
import { BranchEdge } from "./custom-edge"
import { CanvasActionsContext, type NodeClipboard } from "./canvas-context"
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, NodeRunResult } from "@/types/workflow"

const edgeTypes = { branch: BranchEdge }

type WorkflowFlowNode = Node<Record<string, unknown>, string>
type WorkflowFlowEdge = Edge<{ label?: string }, string>

export interface WorkflowCanvasHandle {
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
  removeEdgesByIds: (edgeIds: string[]) => void
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
  onChange: (def: WorkflowDefinition) => void
  onNodeSelect?: (nodeId: string | null) => void
  onRequestRename?: (nodeId: string) => void
}

const CanvasContent = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
function CanvasContent({ definition, nodeResults, onChange, onNodeSelect, onRequestRename }, ref) {
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
      onChange(newDef)
      return updated
    })
  }, [onChange, setEdges])

  const onNodeDragStop = useCallback(() => {
    const wfNodes: WorkflowNode[] = nodesRef.current.map(flowNodeToWorkflowNode)
    const newDef = { ...definitionRef.current, nodes: wfNodes }
    definitionRef.current = newDef
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
    setNodes((nds) => nds.concat({ id, type, position, data: { ...config, name }, selected: false }))
    const newWfNode: WorkflowNode = { id, name, type, position, config }
    const newDef = { ...definitionRef.current, nodes: [...definitionRef.current.nodes, newWfNode] }
    definitionRef.current = newDef
    onChange(newDef)
  }, [screenToFlowPosition, onChange, setNodes])

  const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowFlowNode) => {
    onNodeSelect?.(node.id)
  }, [onNodeSelect])

  const onPaneClick = useCallback(() => {
    onNodeSelect?.(null)
  }, [onNodeSelect])

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
    toast(`已复制 ${copiedNodes.length} 个节点`)
  }, [])

  const pasteNodes = useCallback((anchorNodeId: string) => {
    if (!clipboard || clipboard.nodes.length === 0) return
    const idMap = new Map<string, string>()
    clipboard.nodes.forEach((n) => idMap.set(n.id, crypto.randomUUID()))

    const newNodes = clipboard.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x + 50, y: n.position.y + 50 },
    }))
    const newEdges = clipboard.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      from: idMap.get(e.from) ?? e.from,
      to: idMap.get(e.to) ?? e.to,
    }))

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

    const newDef = {
      ...definitionRef.current,
      nodes: [...definitionRef.current.nodes, ...newNodes],
      edges: [...definitionRef.current.edges, ...newEdges],
    }
    definitionRef.current = newDef
    onChange(newDef)
  }, [clipboard, onChange, setNodes, setEdges])

  const disconnectNodes = useCallback((nodeIds: string[]) => {
    const idSet = new Set(nodeIds)
    setEdges((currentEdges) => {
      const updated = currentEdges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
      const newDef = { ...definitionRef.current, edges: updated.map(flowEdgeToWorkflowEdge) }
      definitionRef.current = newDef
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

  return (
    <CanvasActionsContext.Provider value={canvasActions}>
      <NodeResultsContext.Provider value={nodeResults ?? {}}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
          onConnect={onConnect} onNodeDragStop={onNodeDragStop}
          onDrop={onDrop} onDragOver={onDragOver}
          onNodeClick={onNodeClick} onPaneClick={onPaneClick}
          edgeTypes={edgeTypes}
          fitView panOnScroll panOnScrollMode={PanOnScrollMode.Free}>
          <Background />
          <Controls />
        </ReactFlow>
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
