import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { track } from "@/lib/ui-tracking"
import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"
import type { SynapseAgentConversationTarget } from "@/types/agent-navigation"
import { agentConversationTargetFromOutputs } from "@/lib/agent-conversation-target"
import { NODE_STATUS_LABEL, NODE_STATUS_VARIANT } from "../lib/status-display"
import { formatDurationMs } from "../lib/duration"
import { useRunningTimer } from "./node-progress-bar"
import { MessageSquare } from "lucide-react"

interface TimelineViewProps {
  definition: WorkflowDefinition
  nodeResults: Record<string, NodeRunResult>
  selectedNodeId?: string | null
  onNodeSelect: (nodeId: string | null) => void
  onOpenAgentConversation?: (target: SynapseAgentConversationTarget) => void
}

export function TimelineView({ definition, nodeResults, selectedNodeId, onNodeSelect, onOpenAgentConversation }: TimelineViewProps) {
  const nodeMeta = useMemo(
    () => new Map(definition.nodes.map((node) => [node.id, { name: node.name, type: node.type }])),
    [definition.nodes],
  )
  const nameOf = (nodeId: string) => nodeMeta.get(nodeId)?.name ?? nodeId
  const typeOf = (nodeId: string) => nodeMeta.get(nodeId)?.type ?? "unknown"

  // Combine active results (sorted by startedAt) with pending nodes (not yet in nodeResults)
  const results = useMemo(() => {
    const activeResults = Object.values(nodeResults)
      .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity))
    const activeNodeIds = new Set(activeResults.map((r) => r.nodeId))
    const pendingNodes = definition.nodes
      .filter((n) => !activeNodeIds.has(n.id))
      .map((n): NodeRunResult => ({ nodeId: n.id, status: "pending", input: { variables: {} } }))
    return [...activeResults, ...pendingNodes]
  }, [definition.nodes, nodeResults])

  function handleNodeSelect(result: NodeRunResult) {
    track({
      component: "workflow.runner",
      name: "workflow-runner-timeline-node-select",
      action: "select",
      value: result.nodeId,
      metadata: {
        boundary: "renderer.workflow.runner.timeline",
        workflowId: definition.id,
        nodeId: result.nodeId,
        nodeType: typeOf(result.nodeId),
        status: result.status,
        hasError: Boolean(result.error),
        hasOutput: result.output != null
          || (result.outputs != null && Object.keys(result.outputs).length > 0),
      },
    })
    onNodeSelect(result.nodeId)
  }

  // Tick every second while any node is still running so the elapsed-time
  // display stays up to date. Stops automatically once all nodes are terminal.
  const hasRunning = results.some((r) => r.status === "running")
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [hasRunning])

  if (results.length === 0) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">暂无节点</div>
  }

  return (
    <ScrollArea className="h-full p-4">
      <div className="space-y-2">
        {results.map((r) => {
          const agentConversation = agentConversationTargetFromOutputs(r.outputs)
          return (
            <div
              key={r.nodeId}
              className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${r.nodeId === selectedNodeId ? "bg-muted" : ""}`}
              tabIndex={0}
              role="button"
              onClick={() => handleNodeSelect(r)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleNodeSelect(r) } }}
            >
              <Badge variant={NODE_STATUS_VARIANT[r.status] ?? "outline"} className="text-xs shrink-0">
                {NODE_STATUS_LABEL[r.status] ?? r.status}
              </Badge>
              <span className="text-sm truncate" title={nameOf(r.nodeId)}>{nameOf(r.nodeId)}</span>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {r.status === "running" && r.startedAt && (
                  <TimelineElapsed startedAt={r.startedAt} />
                )}
                {r.status === "success" && r.durationMs != null && (
                  <span className="text-xs text-muted-foreground">
                    耗时 {formatDurationMs(r.durationMs)}
                  </span>
                )}
                {r.status === "failed" && (r.durationMs != null || r.error) && (
                  <span className="text-xs truncate max-w-48" title={r.error ?? undefined}>
                    {r.durationMs != null && <span className="text-muted-foreground">{formatDurationMs(r.durationMs)}</span>}
                    {r.durationMs != null && r.error && <span className="text-muted-foreground mx-1">·</span>}
                    {r.error && <span className="text-destructive">{r.error}</span>}
                  </span>
                )}
                {r.status === "cancelled" && (
                  <span className="text-xs truncate max-w-48 text-muted-foreground">
                    {r.durationMs != null && <span>{formatDurationMs(r.durationMs)}</span>}
                    {r.durationMs != null && r.error && <span className="mx-1">·</span>}
                    {r.error && <span>{r.error}</span>}
                  </span>
                )}
                {agentConversation ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenAgentConversation?.(agentConversation)
                    }}
                  >
                    <MessageSquare data-icon="inline-start" />
                    打开对话
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function TimelineElapsed({ startedAt }: { startedAt: number }) {
  const elapsed = useRunningTimer(startedAt, true)
  return (
    <span className="text-xs text-muted-foreground">
      已运行 {elapsed}
    </span>
  )
}
