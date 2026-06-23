import { cn } from "@/lib/utils"
import { switchNodeManifest } from "./manifest"
import { SWITCH_HEADER_H, SWITCH_BRANCH_H } from "./constants"
import type { SwitchNodeConfig } from "./schema"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { useProviderLookup } from "../provider-lookup-context"
import { statusClass, type NodeStatus } from "../node-status-utils"

export function SwitchNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: SwitchNodeConfig; name?: string; selected?: boolean; status?: NodeStatus
  progressLabel?: string; startedAt?: number; nodeId?: string
}) {
  const Icon = switchNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const { getProviderName, getModelName, getModelDisplayName } = useProviderLookup()
  const providerDisplay = config.providerId ? (getProviderName(config.providerId) ?? config.providerId) : undefined
  const modelDisplay = config.providerId
    ? (getModelDisplayName(config.providerId, config.modelTier ?? "default")
      ?? getModelName(config.providerId, config.modelTier ?? "default")
      ?? config.modelTier
      ?? "default")
    : undefined
  const progressPadding = status === "running" ? 12 : 0
  const totalHeight = SWITCH_HEADER_H + config.branches.length * SWITCH_BRANCH_H + progressPadding
  return (
    <div
      className={cn("relative rounded-lg border bg-card w-56 overflow-hidden flex flex-col", selected && "ring-2 ring-primary", statusClass(status))}
      style={{ height: totalHeight }}
    >
      <div className="px-3 py-2 flex flex-col justify-center shrink-0" style={{ height: SWITCH_HEADER_H }}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "Switch"}</span>
          {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
          {status === "running" && timer && (
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">{timer}</span>
          )}
        </div>
        {status === "running" && progressLabel ? (
          <p className="text-[11px] text-muted-foreground truncate">{progressLabel}</p>
        ) : config.providerId ? (
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-1 text-[11px] text-muted-foreground">
            <span>供应商</span>
            <span className="truncate">{providerDisplay}</span>
            <span>模型</span>
            <span className="truncate flex items-center justify-between">
              {modelDisplay}
              <span className="ml-auto shrink-0 pl-2">{config.branches.length} 分支</span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground truncate">未选择供应商</span>
            <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{config.branches.length} 分支</span>
          </div>
        )}
      </div>
      <div className="border-t border-border flex-1">
        {config.branches.map((b) => (
          <div
            key={b.id}
            className="flex items-center px-3 border-b border-border last:border-b-0"
            style={{ height: SWITCH_BRANCH_H }}
          >
            <span className="text-xs text-muted-foreground flex-1 truncate">{b.label}</span>
            <div className="h-px w-3 bg-muted-foreground/40" />
          </div>
        ))}
      </div>
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
