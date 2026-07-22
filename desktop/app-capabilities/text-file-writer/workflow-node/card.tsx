import { CopyIdButton } from "../../../src/modules/workflow/components/copy-id-button"
import { NodeProgressBar, useRunningTimer } from "../../../src/modules/workflow/runner/node-progress-bar"
import { cn } from "../../../src/lib/utils"
import { statusClass, type NodeStatus } from "../../../workflow-nodes/node-status-utils"
import { textFileWriterNodeManifest } from "./manifest"
import type { TextFileWriterNodeConfig } from "./schema"

export function TextFileWriterNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: TextFileWriterNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = textFileWriterNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "文本写入文件"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timer}</span> : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <p className="truncate text-[11px] text-muted-foreground">{config.path || "未设置文件路径"}</p>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">{config.encoding.toUpperCase()}</p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
