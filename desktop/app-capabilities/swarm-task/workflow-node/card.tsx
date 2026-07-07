import { CopyIdButton } from "../../../src/modules/workflow/components/copy-id-button"
import { NodeProgressBar, useRunningTimer } from "../../../src/modules/workflow/runner/node-progress-bar"
import { cn } from "../../../src/lib/utils"
import { statusClass, type NodeStatus } from "../../../workflow-nodes/node-status-utils"
import { swarmTaskNodeManifest } from "./manifest"
import type { SwarmTaskNodeConfig } from "./schema"

export function SwarmTaskNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: SwarmTaskNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = swarmTaskNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const taskLabel = config.taskId || "未设置任务"
  const waitLabel = config.waitForCompletion ? "等待完成" : "启动后继续"

  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "蜂群任务"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? (
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{timer}</span>
        ) : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <p className="truncate text-[11px] text-muted-foreground">{taskLabel}</p>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">{waitLabel}</p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
