import { useContext, useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  PanOnScrollMode,
  SelectionMode,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type EdgeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"
import { Badge } from "@/components/ui/badge"
import { RunnerNodeResultsContext, runnerNodeTypes } from "./runner-node-wrappers"

const edgeTypes = { default: RunnerEdge, branch: RunnerEdge }

function RunnerEdge({
  id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, sourceHandleId,
}: EdgeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const sourceResult = nodeResults[source]
  const sourceStatus = sourceResult?.status
  const activated = sourceStatus === "success" && (
    !sourceHandleId || sourceResult?.activeBranch === sourceHandleId
  )

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
  })

  const label = (data as { label?: string } | undefined)?.label

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={activated ? "var(--primary)" : "var(--border)"}
        strokeWidth={2}
        strokeOpacity={activated ? 0.6 : 1}
        strokeDasharray={activated ? undefined : "4 4"}
      />
      {label && (
        <EdgeLabelRenderer>
          <Badge
            variant="outline"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
            className="absolute bg-background text-xs pointer-events-none nodrag nopan"
          >
            {label}
          </Badge>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

interface DagViewProps {
  definition: WorkflowDefinition
  nodeResults: Record<string, NodeRunResult>
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
