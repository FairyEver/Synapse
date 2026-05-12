import { cn } from "@/lib/utils"
import { endNodeManifest } from "./manifest"
import type { EndNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "skipped": return "opacity-40 border-dashed"
    default: return "border-primary"
  }
}

export function EndNodeCard({ config, name, selected, status, progressLabel: _progressLabel, startedAt: _startedAt }: {
  config: EndNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = endNodeManifest.icon
  return (
    <div className={cn("rounded-lg border-2 bg-card px-3 py-2 w-56 shadow-sm", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "结束"}</span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{config.template.slice(0, 40) || "返回文本"}</p>
    </div>
  )
}
