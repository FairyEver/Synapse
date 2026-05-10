import { useCallback } from "react"
import { ReactFlow, Background, Controls, useNodesState, useEdgesState, addEdge, type Connection } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { nodeTypes } from "./node-wrappers"
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@/types/workflow"

function defToFlow(def: WorkflowDefinition) {
  const nodes = def.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.config, selected: false }))
  const edges = def.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.branch ?? null }))
  return { nodes, edges }
}

interface WorkflowCanvasProps { definition: WorkflowDefinition; onChange: (def: WorkflowDefinition) => void }

export function WorkflowCanvas({ definition, onChange }: WorkflowCanvasProps) {
  const { nodes: initNodes, edges: initEdges } = defToFlow(definition)
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => {
      const updated = addEdge(connection, eds)
      const wfEdges: WorkflowEdge[] = updated.map((e) => ({ id: e.id, from: e.source, to: e.target, branch: e.sourceHandle ?? undefined }))
      onChange({ ...definition, edges: wfEdges })
      return updated
    })
  }, [definition, onChange, setEdges])

  const onNodeDragStop = useCallback(() => {
    const wfNodes: WorkflowNode[] = nodes.map((n) => ({ id: n.id, name: (n.data as { name?: string }).name ?? n.id, type: n.type ?? "prompt", position: n.position, config: n.data as Record<string, unknown> }))
    onChange({ ...definition, nodes: wfNodes })
  }, [nodes, definition, onChange])

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onConnect={onConnect} onNodeDragStop={onNodeDragStop}
      fitView>
      <Background />
      <Controls />
    </ReactFlow>
  )
}
