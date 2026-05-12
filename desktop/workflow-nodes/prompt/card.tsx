import { cn } from "@/lib/utils"
import { promptNodeManifest } from "./manifest"
import { AgentIcon, getAgentLabel } from "../agent-icon"
import type { PromptNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
  switch (status) {
    case "pending": return "border-dashed border-muted-foreground"
    case "running": return "border-primary"
    case "success": return "border-primary"
    case "failed": return "border-destructive"
    case "skipped": return "opacity-40 border-dashed"
    default: return ""
  }
}

export function PromptNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: PromptNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = promptNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56 shadow-sm", status === "running" && "pb-5", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "Prompt"}</span>
        {status === "running" && timer && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-1">
            {config.agent ? (
              <>
                <AgentIcon agentId={config.agent} />
                <span className="text-[11px] text-muted-foreground truncate">{getAgentLabel(config.agent)}</span>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground">未选择 Agent</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">
            {config.prompt || "无 Prompt"}
          </p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
