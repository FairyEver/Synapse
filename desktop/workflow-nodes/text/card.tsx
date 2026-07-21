import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { cn } from "@/lib/utils"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { textNodeManifest } from "./manifest"
import type { TextNodeConfig } from "./schema"

export function TextNodeCard({ config, name, selected, status, nodeId }: {
  config: TextNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  nodeId?: string
}) {
  const Icon = textNodeManifest.icon
  const preview = config.template === "" ? "空字符串" : config.template.replace(/[\r\n]+/g, " ")

  return (
    <div className={cn("w-56 rounded-lg border bg-card px-3 py-2", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "文本"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
      </div>
      <p className="truncate text-xs text-muted-foreground">{preview}</p>
    </div>
  )
}
