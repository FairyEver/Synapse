import { CopyIdButton } from "../../../src/modules/workflow/components/copy-id-button"
import { NodeProgressBar, useRunningTimer } from "../../../src/modules/workflow/runner/node-progress-bar"
import { cn } from "../../../src/lib/utils"
import { statusClass, type NodeStatus } from "../../../workflow-nodes/node-status-utils"
import type { DocumentTemplateNodeConfig } from "./schema"
import { documentTemplateNodeManifest } from "./manifest"

export function DocumentTemplateNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: DocumentTemplateNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = documentTemplateNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const outputLabel = config.outputPath || "未设置输出文件"
  const dataLabel = config.dataSource === "inline" ? "内联 JSON" : "JSON 文件"

  return (
    <div className={cn("relative w-56 rounded-lg border bg-card px-3 py-2", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "模板生成文档"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? (
          <span className="shrink-0 text-[10px] font-mono text-muted-foreground">{timer}</span>
        ) : null}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <p className="truncate text-[11px] text-muted-foreground">{outputLabel}</p>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">{dataLabel}</p>
        </>
      )}
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
