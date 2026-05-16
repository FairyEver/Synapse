import { useState } from "react"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { track } from "@/lib/ui-tracking"

const STATUS_LABEL: Record<string, string> = { running: "执行中", success: "完成", failed: "失败", cancelled: "已取消", skipped: "跳过", pending: "等待" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", success: "secondary", failed: "destructive", cancelled: "secondary", skipped: "outline", pending: "outline",
}
const RUN_STATE_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" } | null> = {
  running: { label: "执行中", variant: "default" },
  completed: { label: "全部完成", variant: "secondary" },
  failed: { label: "执行失败", variant: "destructive" },
  cancelled: { label: "已取消", variant: "outline" },
}

interface ExecutionOverlayProps {
  nodeResults: Record<string, NodeRunResult>
  runState: RunState
  runError?: string | null
  definition: WorkflowDefinition
  viewingNodeId?: string | null
  onViewClose?: () => void
}

function resolveActiveBranchLabel(nodeId: string, branchId: string, definition: WorkflowDefinition): string {
  const node = definition.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== "switch") return branchId
  const branches = (node.config as { branches?: Array<{ id: string; label: string }> }).branches
  return branches?.find((b) => b.id === branchId)?.label ?? branchId
}

export function ExecutionOverlay({ nodeResults, runState, runError, definition, viewingNodeId, onViewClose }: ExecutionOverlayProps) {
  const [selected, setSelected] = useState<NodeRunResult | null>(null)
  const nodeOrder = new Map(definition.nodes.map((node, index) => [node.id, index]))
  const results = Object.values(nodeResults).sort((a, b) => {
    if (a.startedAt != null && b.startedAt != null && a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
    if (a.startedAt != null && b.startedAt == null) return -1
    if (a.startedAt == null && b.startedAt != null) return 1
    return (nodeOrder.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (nodeOrder.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER)
  })

  if (runState === "idle" && results.length === 0) return null

  const nameOf = (nodeId: string) => definition.nodes.find((n) => n.id === nodeId)?.name ?? nodeId
  const typeOf = (nodeId: string) => definition.nodes.find((n) => n.id === nodeId)?.type ?? "unknown"

  const externalResult = viewingNodeId ? (nodeResults[viewingNodeId] ?? null) : null
  const dialogTarget = selected ?? externalResult
  const handleDialogClose = () => {
    if (selected) setSelected(null)
    else onViewClose?.()
  }
  const handleResultOpen = (result: NodeRunResult) => {
    if (result.status !== "success" && result.status !== "failed" && result.status !== "cancelled" && result.status !== "skipped") return
    track({
      component: "workflow.editor",
      name: "workflow-editor-execution-node-detail-open",
      action: "select",
      value: result.nodeId,
      metadata: {
        boundary: "renderer.workflow.editor.execution-overlay",
        workflowId: definition.id,
        nodeId: result.nodeId,
        nodeType: typeOf(result.nodeId),
        status: result.status,
        hasError: Boolean(result.error),
        hasOutput: (result.output != null && result.output !== "")
          || (result.outputs != null && Object.keys(result.outputs).length > 0),
        hasPrompt: Boolean(result.input.prompt),
      },
    })
    setSelected(result)
  }

  return (
    <>
      <div className="absolute bottom-4 right-4 bg-background/90 border rounded-lg shadow-sm p-3 flex flex-col gap-1.5 max-h-64 overflow-auto z-10">
        <p className="text-xs font-medium text-muted-foreground mb-1">运行状态</p>
        {RUN_STATE_BADGE[runState] && (
          <div className="flex flex-col gap-1 pb-1.5 mb-0.5 border-b">
            <Badge variant={RUN_STATE_BADGE[runState]!.variant} className="text-xs w-fit">{RUN_STATE_BADGE[runState]!.label}</Badge>
            {runState === "failed" && runError && (
              <p className="text-xs text-destructive break-words max-w-64" title={runError ?? undefined}>{runError}</p>
            )}
          </div>
        )}
        {results.map((r) => (
          <div
            key={r.nodeId}
            className={`flex items-center gap-2 ${r.status === "success" || r.status === "failed" || r.status === "cancelled" || r.status === "skipped" ? "cursor-pointer hover:opacity-75" : ""}`}
            onClick={() => handleResultOpen(r)}
          >
            <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs shrink-0">{STATUS_LABEL[r.status] ?? r.status}</Badge>
            <span className="text-xs text-muted-foreground truncate max-w-32" title={nameOf(r.nodeId)}>{nameOf(r.nodeId)}</span>
          </div>
        ))}
      </div>
      <Dialog open={!!dialogTarget} onOpenChange={(o) => { if (!o) handleDialogClose() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{dialogTarget ? nameOf(dialogTarget.nodeId) : ""} — 执行详情</DialogTitle>
            <DialogDescription className="sr-only">查看该节点的输入、输出和错误信息。</DialogDescription>
          </DialogHeader>
          {dialogTarget && (
            <div className="grid gap-3 text-xs overflow-auto max-h-[60vh]">
              {dialogTarget.input.prompt && (
                <div className="grid gap-1">
                  <p className="font-medium text-muted-foreground">完整 Prompt</p>
                  <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all">{dialogTarget.input.prompt}</pre>
                </div>
              )}
              {dialogTarget.output != null && dialogTarget.output !== "" && (
                <div className="grid gap-1">
                  <p className="font-medium text-muted-foreground">输出</p>
                  <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all">{dialogTarget.output}</pre>
                </div>
              )}
              {dialogTarget.error && (
                <div className="grid gap-1">
                  <p className="font-medium text-destructive">错误</p>
                  <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all text-destructive">{dialogTarget.error}</pre>
                </div>
              )}
              {dialogTarget.activeBranch && (
                <div className="grid gap-1">
                  <p className="font-medium text-muted-foreground">激活分支</p>
                  <span className="font-mono">{resolveActiveBranchLabel(dialogTarget.nodeId, dialogTarget.activeBranch, definition)}</span>
                </div>
              )}
              {!dialogTarget.input.prompt && !dialogTarget.error && !dialogTarget.activeBranch && (dialogTarget.output == null || dialogTarget.output === "") && (
                <p className="text-xs text-muted-foreground">
                  {dialogTarget.status === "skipped" ? "节点因工作流分支逻辑被跳过，未执行" : dialogTarget.status === "cancelled" ? "节点执行被取消" : dialogTarget.status === "pending" ? "节点等待执行" : dialogTarget.status === "running" ? "节点正在执行…" : "（无可展示的输出）"}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
