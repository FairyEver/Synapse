import { useCallback, useContext, useEffect, useMemo, useRef } from "react"
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
  useReactFlow,
  useUpdateNodeInternals,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { WorkflowDefinition, NodeRunResult, WorkflowRunStatus } from "@/types/workflow"
import type { SynapseAgentConversationReference } from "@/types/agent-navigation"
import { Badge } from "@/components/ui/badge"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Maximize2 } from "lucide-react"
import {
  RunnerNodeResultsContext,
  RunnerOpenAgentConversationContext,
  runnerNodeTypes,
} from "./runner-node-wrappers"
import { resolveBranchLabel } from "../lib/branch-label"
import {
  FIT_WORKFLOW_NODES_OPTIONS,
  WORKFLOW_RUNNER_MIN_ZOOM,
  fitWorkflowNodes,
  focusRunningNodes,
  getRunningNodeIds,
} from "./viewport-focus"
import { WorkflowLayoutDirectionProvider } from "../workflow-layout-direction-context"

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
  runState: WorkflowRunStatus["status"]
  selectedNodeId?: string | null
  onNodeSelect: (nodeId: string | null) => void
  onOpenAgentConversation?: (target: SynapseAgentConversationReference) => void
}

function DagViewInner({ definition, nodeResults, runState, selectedNodeId, onNodeSelect, onOpenAgentConversation }: DagViewProps) {
  const reactFlow = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()

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

  const runningNodeIds = useMemo(
    () => getRunningNodeIds(definition, nodeResults),
    [definition, nodeResults],
  )
  const runningNodeKey = runningNodeIds.join("\n")
  const shouldFitInitialView = Object.keys(nodeResults).length === 0
  const allNodeIds = useMemo(
    () => definition.nodes.map((node) => node.id),
    [definition],
  )
  const allNodeKey = allNodeIds.join("\n")
  const previousLayoutDirectionRef = useRef(definition.layoutDirection)

  useEffect(() => {
    updateNodeInternals(allNodeIds)
    if (previousLayoutDirectionRef.current === definition.layoutDirection) return
    previousLayoutDirectionRef.current = definition.layoutDirection
    const frame = window.requestAnimationFrame(() => {
      void fitWorkflowNodes(allNodeIds, reactFlow)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [allNodeIds, definition.layoutDirection, reactFlow, updateNodeInternals])

  const handleFitAllNodes = useCallback(() => {
    void fitWorkflowNodes(allNodeIds, reactFlow)
  }, [allNodeIds, reactFlow])

  useEffect(() => {
    const activeNodeIds = runningNodeKey ? runningNodeKey.split("\n") : []
    if (!reactFlow.viewportInitialized || activeNodeIds.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      void focusRunningNodes(activeNodeIds, reactFlow)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [reactFlow, reactFlow.viewportInitialized, runningNodeKey])

  useEffect(() => {
    if (!reactFlow.viewportInitialized || runState === "running" || !allNodeKey) return
    const frame = window.requestAnimationFrame(() => {
      void fitWorkflowNodes(allNodeKey.split("\n"), reactFlow)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [allNodeKey, reactFlow, reactFlow.viewportInitialized, runState])

  return (
    <WorkflowLayoutDirectionProvider value={definition.layoutDirection}>
      <RunnerOpenAgentConversationContext.Provider value={onOpenAgentConversation}>
        <RunnerNodeResultsContext.Provider value={nodeResults}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="h-full w-full">
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
                  minZoom={WORKFLOW_RUNNER_MIN_ZOOM}
                  fitView={shouldFitInitialView}
                  fitViewOptions={FIT_WORKFLOW_NODES_OPTIONS}
                >
                  <Background />
                  <Controls
                    showInteractive={false}
                    fitViewOptions={FIT_WORKFLOW_NODES_OPTIONS}
                  />
                </ReactFlow>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={handleFitAllNodes}>
                <Maximize2 className="size-4" />
                适应画布
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </RunnerNodeResultsContext.Provider>
      </RunnerOpenAgentConversationContext.Provider>
    </WorkflowLayoutDirectionProvider>
  )
}

export function DagView(props: DagViewProps) {
  return (
    <ReactFlowProvider>
      <DagViewInner {...props} />
    </ReactFlowProvider>
  )
}
