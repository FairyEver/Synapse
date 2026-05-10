import { MessageSquare } from "lucide-react"
import type { PromptNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed"
    case "running": return "border-blue-500 animate-pulse"
    case "success": return "border-green-500"
    case "failed": return "border-red-500"
    case "skipped": return "opacity-40"
    default: return ""
  }
}

export function PromptNodeCard({ config, selected, status }: { config: PromptNodeConfig; selected?: boolean; status?: NodeStatus }) {
  return (
    <div className={`rounded-lg border bg-card px-3 py-2 w-52 shadow-sm ${selected ? "ring-2 ring-primary" : ""} ${statusClass(status)}`}>
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium text-foreground truncate">{config.agent || "Prompt"}</span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{config.prompt.slice(0, 50) || "无 Prompt"}</p>
    </div>
  )
}
