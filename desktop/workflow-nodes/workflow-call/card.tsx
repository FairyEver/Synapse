import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { createRendererLogger } from "@/app-shell/logging"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { errorDiagnostic } from "@/modules/workflow/lib/error-utils"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { workflowCallNodeManifest } from "./manifest"
import type { WorkflowCallNodeConfig } from "./schema"

const logger = createRendererLogger("workflow.call-node-card")

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
  const paramCount = new Set([...Object.keys(config.paramTemplates), ...Object.keys(config.paramBindings ?? {})]).size
  const [workflowName, setWorkflowName] = useState<string | null>(null)
  const [workflowMissing, setWorkflowMissing] = useState(false)
  const workflowId = typeof config.workflowId === "string" ? config.workflowId.trim() : ""

  useEffect(() => {
    setWorkflowName(null)
    setWorkflowMissing(false)
    if (!workflowId) return
    const workflowApi = window.synapse?.workflow
    if (!workflowApi) return
    let cancelled = false
    void workflowApi.get(workflowId)
      .then((workflow) => {
        if (cancelled) return
        setWorkflowName(workflow?.name?.trim() || null)
        setWorkflowMissing(!workflow)
      })
      .catch((err) => {
        if (cancelled) return
        logger.warn("workflow call child name load failed", {
          workflowId,
          boundary: "renderer.workflow.call-node-card.load-child-name",
          ...errorDiagnostic(err),
        })
      })
    return () => {
      cancelled = true
    }
  }, [workflowId])

  const workflowDisplay = workflowId
    ? workflowMissing ? "子工作流不存在" : workflowName ?? "已选择工作流"
    : "未选择工作流"

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
          <p className={cn("truncate text-[11px] text-muted-foreground", workflowMissing && "text-destructive")}>{workflowDisplay}</p>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">{paramCount > 0 ? `${paramCount} 个参数` : "无参数映射"}</p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
