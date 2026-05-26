import { cn } from "@/lib/utils"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { fileConversionNodeManifest } from "./manifest"
import type { FileConversionNodeConfig } from "./schema"

export function FileConversionNodeCard({
  config,
  name,
  selected,
  status,
  progressLabel,
  startedAt,
  nodeId,
}: {
  config: FileConversionNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = fileConversionNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const modeLabel = config.outputMode === "markdown-file" ? "Markdown 文件" : "仅返回结果"

  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "文件转换"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timer}</span>
        ) : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <div className="mb-1 flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">{modeLabel}</span>
          </div>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">
            {config.inputPath || "未选择文件"}
          </p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
