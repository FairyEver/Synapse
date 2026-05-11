import { forwardRef, useCallback, useImperativeHandle } from "react"
import { toast } from "sonner"
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
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
  type OnSelectionChangeParams,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { nodeTypes, NodeResultsContext } from "./node-wrappers"
import { BranchEdge } from "./custom-edge"
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, NodeRunResult } from "@/types/workflow"

const edgeTypes = { branch: BranchEdge }

type WorkflowFlowNode = Node<Record<string, unknown>, string>
type WorkflowFlowEdge = Edge<{ label?: string }, string>

export interface WorkflowCanvasHandle {
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void
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
}

const CanvasContent = forwardRef<WorkflowCanvasHandle, WorkflowCanvasProps>(
function CanvasContent({ definition, nodeResults, onChange, onNodeSelect }, ref) {
  const { nodes: initNodes, edges: initEdges } = defToFlow(definition)
  const [nodes, setNodes] = useNodesState(initNodes)
  const [edges, setEdges] = useEdgesState(initEdges)
  const { screenToFlowPosition } = useReactFlow()

  useImperativeHandle(ref, () => ({
    updateNodeConfig: (nodeId, config) => {
      setNodes((nds) => nds.map((n) => {
        if (n.id !== nodeId) return n
        const previousName = (n.data as { name?: unknown }).name
        const nextName = (config as { name?: unknown }).name ?? previousName
        return { ...n, data: { ...config, ...(typeof nextName === "string" ? { name: nextName } : {}) } }
      }))
    },
  }))

  const handleNodesChange = useCallback((changes: NodeChange<WorkflowFlowNode>[]) => {
    const blockedEnd = changes.some((c) => c.type === "remove" && nodes.find((n) => n.id === c.id)?.type === "end")
    if (blockedEnd) toast("结束节点不能删除")
    setNodes((currentNodes) => {
      const filteredChanges = changes.filter((change) => {
        if (change.type !== "remove") return true
        const node = currentNodes.find((n) => n.id === change.id)
        return node?.type !== "end"
      })
      const updated = applyNodeChanges(filteredChanges, currentNodes)
      if (filteredChanges.some((change) => change.type !== "select")) {
        onChange({ ...definition, nodes: updated.map(flowNodeToWorkflowNode) })
      }
      return updated
    })
  }, [definition, onChange, setNodes, nodes])

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkflowFlowEdge>[]) => {
    setEdges((currentEdges) => {
      const updated = applyEdgeChanges(changes, currentEdges)
      if (changes.some((change) => change.type !== "select")) {
        onChange({ ...definition, edges: updated.map(flowEdgeToWorkflowEdge) })
      }
      return updated
    })
  }, [definition, onChange, setEdges])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => {
      const branchLabel = connection.sourceHandle
        ? resolveBranchLabel(definition, connection.source, connection.sourceHandle)
        : undefined
      const withBranch = branchLabel
        ? { type: "branch", data: { label: branchLabel } }
        : {}
      const updated = addEdge({ ...connection, ...withBranch }, eds) as typeof eds
      const wfEdges: WorkflowEdge[] = updated.map(flowEdgeToWorkflowEdge)
      onChange({ ...definition, edges: wfEdges })
      return updated
    })
  }, [definition, onChange, setEdges])

  const onNodeDragStop = useCallback(() => {
    const wfNodes: WorkflowNode[] = nodes.map(flowNodeToWorkflowNode)
    onChange({ ...definition, nodes: wfNodes })
  }, [nodes, definition, onChange])

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
    onChange({ ...definition, nodes: [...definition.nodes, newWfNode] })
  }, [screenToFlowPosition, definition, onChange, setNodes])

  const onSelectionChange = useCallback(({ nodes: selected }: OnSelectionChangeParams) => {
    onNodeSelect?.(selected[0]?.id ?? null)
  }, [onNodeSelect])

  return (
    <NodeResultsContext.Provider value={nodeResults ?? {}}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange}
        onConnect={onConnect} onNodeDragStop={onNodeDragStop}
        onDrop={onDrop} onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        edgeTypes={edgeTypes}
        fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </NodeResultsContext.Provider>
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
