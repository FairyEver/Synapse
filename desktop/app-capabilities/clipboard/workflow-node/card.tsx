import { cn } from "@/lib/utils"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import {
  NodeProgressBar,
  useRunningTimer,
} from "@/modules/workflow/runner/node-progress-bar"
import {
  statusClass,
  type NodeStatus,
} from "../../../workflow-nodes/node-status-utils"
import type { LucideIcon } from "lucide-react"

type ClipboardCardManifest = {
  readonly title: string
  readonly icon: LucideIcon
}

export function ClipboardNodeCard({
  manifest,
  name,
  selected,
  status,
  startedAt,
  nodeId,
}: {
  manifest: ClipboardCardManifest
  name?: string
  selected?: boolean
  status?: NodeStatus
  startedAt?: number
  nodeId?: string
}) {
  const Icon = manifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  return (
    <div className={cn(
      "relative w-56 rounded-lg border bg-card px-3 py-2",
      status === "running" && "pb-4",
      selected && "ring-2 ring-primary",
      statusClass(status),
    )}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {name || manifest.title}
        </span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer ? (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {timer}
          </span>
        ) : null}
      </div>
      {status === "running" ? <NodeProgressBar /> : null}
    </div>
  )
}
