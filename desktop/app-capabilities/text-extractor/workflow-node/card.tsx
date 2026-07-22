import { cn } from "../../../src/lib/utils"
import { CopyIdButton } from "../../../src/modules/workflow/components/copy-id-button"
import {
  NodeProgressBar,
  useRunningTimer,
} from "../../../src/modules/workflow/runner/node-progress-bar"
import { statusClass, type NodeStatus } from "../../../workflow-nodes/node-status-utils"
import { textExtractNodeManifest } from "./manifest"
import type { TextExtractNodeConfig } from "./schema"

export function TextExtractNodeCard({
  config,
  name,
  selected,
  status,
  progressLabel,
  startedAt,
  nodeId,
}: {
  config: TextExtractNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = textExtractNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")

  return (
    <div className={cn(
      "relative w-56 rounded-lg border bg-card px-3 py-2",
      status === "running" && "pb-4",
      selected && "ring-2 ring-primary",
      statusClass(status),
    )}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {name || "文本提取"}
        </span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timer}</span>
        ) : null}
      </div>
      <p className="truncate text-[11px] text-muted-foreground">
        {status === "running" && progressLabel
          ? progressLabel
          : config.filePath || "未设置文档文件"}
      </p>
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
