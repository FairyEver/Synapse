import { cn } from "@/lib/utils"
import { endNodeManifest } from "./manifest"
import type { EndNodeConfig } from "./schema"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { statusClass, type NodeStatus } from "../node-status-utils"

export function EndNodeCard({ config, name, selected, status, progressLabel: _progressLabel, startedAt: _startedAt, nodeId }: {
  config: EndNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number; nodeId?: string
}) {
  const Icon = endNodeManifest.icon
  return (
    <div className={cn("rounded-lg border bg-card px-3 py-2 w-56", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "结束"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
      </div>
      <p className="text-xs text-muted-foreground truncate">{config.template.slice(0, 40) || "返回文本"}</p>
    </div>
  )
}
