import type { NodeRunResult } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"
import { Badge } from "@/components/ui/badge"

const STATUS_LABEL: Record<string, string> = { running: "执行中", success: "完成", failed: "失败", skipped: "跳过", pending: "等待" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", success: "secondary", failed: "destructive", skipped: "outline", pending: "outline",
}

interface ExecutionOverlayProps { nodeResults: Record<string, NodeRunResult>; runState: RunState }

export function ExecutionOverlay({ nodeResults, runState }: ExecutionOverlayProps) {
  if (runState === "idle") return null
  return (
    <div className="absolute bottom-4 right-4 bg-background/90 border rounded-lg shadow-sm p-3 flex flex-col gap-1.5 max-h-64 overflow-auto pointer-events-none z-10">
      <p className="text-xs font-medium text-muted-foreground mb-1">运行状态</p>
      {Object.values(nodeResults).map((r) => (
        <div key={r.nodeId} className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs">{STATUS_LABEL[r.status] ?? r.status}</Badge>
          <span className="text-xs text-muted-foreground truncate max-w-32">{r.nodeId}</span>
        </div>
      ))}
    </div>
  )
}
