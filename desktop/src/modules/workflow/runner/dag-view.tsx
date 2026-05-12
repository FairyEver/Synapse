import { useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  PanOnScrollMode,
  SelectionMode,
  type Node,
  type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { WorkflowDefinition, NodeRunResult, WorkflowRunStatus } from "@/types/workflow"
import { RunnerNodeResultsContext, runnerNodeTypes } from "./runner-node-wrappers"
import { BranchEdge } from "../editor/custom-edge"

const edgeTypes = { branch: BranchEdge }

interface DagViewProps {
  definition: WorkflowDefinition
  nodeResults: Record<string, NodeRunResult>
  runState: WorkflowRunStatus["status"]
  selectedNodeId?: string | null
  onNodeSelect: (nodeId: string | null) => void
}

function resolveBranchLabel(def: WorkflowDefinition, fromId: string, branchId: string): string {
  const node = def.nodes.find((n) => n.id === fromId)
  if (!node || node.type !== "switch") return branchId
  const branches = (node.config as { branches?: Array<{ id: string; label: string }> }).branches
  return branches?.find((b) => b.id === branchId)?.label ?? branchId
}

function DagViewInner({ definition, nodeResults, selectedNodeId, onNodeSelect }: DagViewProps) {
  const nodes: Node[] = useMemo(() =>
    definition.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.config, name: n.name },
      selectable: true,
      draggable: false,
      selected: n.id === selectedNodeId,
    })),
    [definition, selectedNodeId],
  )

  const edges: Edge[] = useMemo(() =>
    definition.edges.map((e) => {
      const label = e.branch ? resolveBranchLabel(definition, e.from, e.branch) : undefined
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        sourceHandle: e.branch,
        type: e.branch ? "branch" : "default",
        data: label ? { label } : undefined,
      }
    }),
    [definition],
  )

  return (
    <RunnerNodeResultsContext.Provider value={nodeResults}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={runnerNodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_e, node) => onNodeSelect(node.id)}
        onPaneClick={() => onNodeSelect(null)}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </RunnerNodeResultsContext.Provider>
  )
}

export function DagView(props: DagViewProps) {
  return (
    <ReactFlowProvider>
      <DagViewInner {...props} />
    </ReactFlowProvider>
  )
}
