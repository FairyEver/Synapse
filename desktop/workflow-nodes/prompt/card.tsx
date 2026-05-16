import { cn } from "@/lib/utils"
import { promptNodeManifest } from "./manifest"
import type { PromptNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { useProviderLookup } from "../provider-lookup-context"

type NodeStatus = NodeRunResult["status"]

function statusClass(status?: NodeStatus): string {
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

export function PromptNodeCard({ config, name, selected, status, progressLabel, startedAt }: {
  config: PromptNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number
}) {
  const Icon = promptNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const { getProviderName, getModelName } = useProviderLookup()
  const providerDisplay = config.providerId ? (getProviderName(config.providerId) ?? config.providerId) : undefined
  const modelDisplay = config.providerId ? (getModelName(config.providerId, config.modelTier ?? "default") ?? config.modelTier ?? "default") : undefined
  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56 shadow-sm", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">{name || "Prompt"}</span>
        {status === "running" && timer && (
          <span className="ml-auto text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
      ) : config.providerId ? (
        <>
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-1 text-[11px] text-muted-foreground mb-1">
            <span>供应商</span>
            <span className="truncate">{providerDisplay}</span>
            <span>模型</span>
            <span className="truncate">{modelDisplay}</span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate opacity-70">
            {config.prompt || "无 Prompt"}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] text-muted-foreground truncate">未选择供应商</span>
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
