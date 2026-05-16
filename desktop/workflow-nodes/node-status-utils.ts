import type { NodeRunResult } from "../src/types/workflow"

export type NodeStatus = NodeRunResult["status"]

export function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "cancelled": return "opacity-60 border-muted-foreground"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}
