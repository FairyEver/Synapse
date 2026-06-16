import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { cn } from "@/lib/utils"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { claudeCodeNodeManifest } from "./manifest"
import type { ClaudeCodeNodeConfig } from "./schema"

export function ClaudeCodeNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: ClaudeCodeNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = claudeCodeNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")

  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "Claude Code"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? (
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{timer}</span>
        ) : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-muted-foreground">{config.permissionMode}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">
            {config.prompt ? config.prompt.slice(0, 60) : "未编写指令"}
          </p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
