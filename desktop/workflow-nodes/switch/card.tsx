import { cn } from "@/lib/utils"
import { switchNodeManifest } from "./manifest"
import { AgentIcon, getAgentLabel } from "../agent-icon"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "./constants"
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
  const Icon = switchNodeManifest.icon
  const totalHeight = SWITCH_HEADER_H + config.branches.length * SWITCH_BRANCH_H
  return (
    <div
      className={cn("rounded-lg border bg-card w-56 shadow-sm overflow-hidden flex flex-col", selected && "ring-2 ring-primary", statusClass(status))}
      style={{ height: totalHeight }}
    >
      <div className="px-3 py-2 flex flex-col justify-center shrink-0" style={{ height: SWITCH_HEADER_H }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground truncate">{name || "Switch"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {config.agent ? (
            <>
              <AgentIcon agentId={config.agent} />
              <span className="text-[11px] text-muted-foreground truncate">{getAgentLabel(config.agent)}</span>
            </>
          ) : (
            <span className="text-[11px] text-muted-foreground">未选择 Agent</span>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{config.branches.length} 分支</span>
        </div>
      </div>
      <div className="border-t border-border flex-1">
        {config.branches.map((b) => (
          <div
            key={b.id}
            className="flex items-center px-3 border-b border-border last:border-b-0"
            style={{ height: SWITCH_BRANCH_H }}
          >
            <span className="text-xs text-muted-foreground flex-1 truncate">{b.label}</span>
            <div className="h-px w-3 bg-muted-foreground/40" />
          </div>
        ))}
      </div>
    </div>
  )
}
