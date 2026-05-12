import { Badge } from "@/components/ui/badge"
import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"

const STATUS_LABEL: Record<string, string> = { running: "执行中", success: "完成", failed: "失败", skipped: "跳过", pending: "等待" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", success: "secondary", failed: "destructive", skipped: "outline", pending: "outline",
}

interface TimelineViewProps {
  definition: WorkflowDefinition
  nodeResults: Record<string, NodeRunResult>
  onNodeSelect: (nodeId: string | null) => void
}

export function TimelineView({ definition, nodeResults, onNodeSelect }: TimelineViewProps) {
  const nameOf = (nodeId: string) => definition.nodes.find((n) => n.id === nodeId)?.name ?? nodeId
  const results = Object.values(nodeResults)

  if (results.length === 0) {
    return <div className="flex items-center justify-center h-full text-sm text-muted-foreground">等待节点开始执行…</div>
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-2">
        {results.map((r) => (
          <div
            key={r.nodeId}
            className="flex items-center gap-3 p-2 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={() => onNodeSelect(r.nodeId)}
          >
            <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs shrink-0">
              {STATUS_LABEL[r.status] ?? r.status}
            </Badge>
            <span className="text-sm truncate">{nameOf(r.nodeId)}</span>
            {r.status === "running" && r.startedAt && (
              <span className="text-xs text-muted-foreground ml-auto">
                已运行 {Math.round((Date.now() - r.startedAt) / 1000)}s
              </span>
            )}
            {r.status === "failed" && r.error && (
              <span className="text-xs text-destructive truncate ml-auto max-w-48">{r.error}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
