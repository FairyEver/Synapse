import { GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SwitchNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary animate-pulse"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}

export function SwitchNodeCard({ config, name, selected, status }: { config: SwitchNodeConfig; name?: string; selected?: boolean; status?: NodeStatus }) {
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2 w-52 shadow-sm", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || config.agent || "Switch"}</span>
      </div>
      <p className="text-xs text-muted-foreground">{config.agent ? `${config.agent} · ` : ""}{config.branches.length} 个分支</p>
    </div>
  )
}
