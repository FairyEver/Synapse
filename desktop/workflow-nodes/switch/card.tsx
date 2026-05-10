import { GitBranch } from "lucide-react"
import type { SwitchNodeConfig } from "./schema"

export function SwitchNodeCard({ config, selected }: { config: SwitchNodeConfig; selected?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card px-3 py-2 w-52 shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium text-foreground truncate">{config.agent || "Switch"}</span>
      </div>
      <p className="text-xs text-muted-foreground">{config.branches.length} 个分支</p>
    </div>
  )
}
