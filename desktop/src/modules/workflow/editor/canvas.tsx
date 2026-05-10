import { forwardRef, useCallback, useImperativeHandle } from "react"
import { ReactFlow, Background, Controls, ReactFlowProvider, useNodesState, useEdgesState, useReactFlow, addEdge, type Connection, type OnSelectionChangeParams } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { nodeTypes, NodeResultsContext } from "./node-wrappers"
import { BranchEdge } from "./custom-edge"
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge, NodeRunResult } from "@/types/workflow"

const edgeTypes = { branch: BranchEdge }

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
  const nodes = def.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { ...n.config, name: n.name } as Record<string, unknown>, selected: false }))
  const edges = def.edges.map((e) => {
    const branchLabel = e.branch ? resolveBranchLabel(def, e.from, e.branch) : undefined
    return {
      id: e.id, source: e.from, target: e.to, sourceHandle: e.branch ?? null,
      ...(branchLabel ? { type: "branch", data: { label: branchLabel }, style: { stroke: "#f59e0b" } } : {}),
    }
  })
  return { nodes, edges }
}

function defaultConfig(type: string): Record<string, unknown> {
  if (type === "switch") return { name: "新分支", agent: "", prompt: "", variables: [], branches: [{ id: "branch1", label: "分支 1" }] }
  return { name: "新提示词", agent: "", prompt: "", variables: [] }
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
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)
  const { screenToFlowPosition } = useReactFlow()

  useImperativeHandle(ref, () => ({
    updateNodeConfig: (nodeId, config) => {
      setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: config } : n))
    },
  }))

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => {
      const branchLabel = connection.sourceHandle
        ? resolveBranchLabel(definition, connection.source, connection.sourceHandle)
        : undefined
      const withBranch = branchLabel
        ? { type: "branch", data: { label: branchLabel }, style: { stroke: "#f59e0b" } }
        : {}
      const updated = addEdge({ ...connection, ...withBranch }, eds) as typeof eds
      const wfEdges: WorkflowEdge[] = updated.map((e) => ({ id: e.id, from: e.source, to: e.target, branch: e.sourceHandle ?? undefined }))
      onChange({ ...definition, edges: wfEdges })
      return updated
    })
  }, [definition, onChange, setEdges])

  const onNodeDragStop = useCallback(() => {
    const wfNodes: WorkflowNode[] = nodes.map((n) => ({ id: n.id, name: (n.data as { name?: string }).name ?? n.id, type: n.type ?? "prompt", position: n.position, config: n.data as Record<string, unknown> }))
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
    setNodes((nds) => nds.concat({ id, type, position, data: config, selected: false }))
    const newWfNode: WorkflowNode = { id, name: (config.name as string) ?? type, type, position, config }
    onChange({ ...definition, nodes: [...definition.nodes, newWfNode] })
  }, [screenToFlowPosition, definition, onChange, setNodes])

  const onSelectionChange = useCallback(({ nodes: selected }: OnSelectionChangeParams) => {
    onNodeSelect?.(selected[0]?.id ?? null)
  }, [onNodeSelect])

  return (
    <NodeResultsContext.Provider value={nodeResults ?? {}}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
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
