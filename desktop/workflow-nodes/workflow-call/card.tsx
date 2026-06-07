import { cn } from "@/lib/utils"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { workflowCallNodeManifest } from "./manifest"
import type { WorkflowCallNodeConfig } from "./schema"

export function WorkflowCallNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: WorkflowCallNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = workflowCallNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const paramCount = Object.keys(config.paramTemplates).length

  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "调用工作流"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <p className="truncate text-[11px] text-muted-foreground">{config.workflowId || "未选择工作流"}</p>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">{paramCount > 0 ? `${paramCount} 个参数` : "无参数映射"}</p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
