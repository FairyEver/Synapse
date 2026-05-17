import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import { track } from "@/lib/ui-tracking"
import { NODE_STATUS_LABEL, NODE_STATUS_VARIANT } from "../lib/status-display"
import { resolveBranchLabel } from "../lib/branch-label"

interface NodeResultPanelProps {
  result: NodeRunResult
  nodeName: string
  definition?: WorkflowDefinition
  onClose: () => void
}

export function NodeResultPanel({ result, nodeName, definition, onClose }: NodeResultPanelProps) {
  // Resolve activeBranch ID to user-configured label when definition is available
  const activeBranchLabel = (() => {
    if (!result.activeBranch || !definition) return result.activeBranch
    return resolveBranchLabel(definition, result.nodeId, result.activeBranch)
  })()
  const handleClose = () => {
    track({
      component: "workflow.runner",
      name: "workflow-runner-node-result-close",
      action: "close",
      value: result.nodeId,
      metadata: {
        boundary: "renderer.workflow.runner.node-result",
        nodeId: result.nodeId,
        status: result.status,
        hasOutput: Boolean(result.output),
        hasError: Boolean(result.error),
        hasPrompt: Boolean(result.input.prompt),
        variableCount: Object.keys(result.input.variables).length,
        outputLength: result.output?.length ?? 0,
        errorLength: result.error?.length ?? 0,
        promptLength: result.input.prompt?.length ?? 0,
      },
    })
    onClose()
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-sm font-medium truncate flex-1">{nodeName}</span>
        <Badge variant={NODE_STATUS_VARIANT[result.status] ?? "outline"} className="text-xs">
          {NODE_STATUS_LABEL[result.status] ?? result.status}
        </Badge>
        {result.status === "running" && result.progressLabel && (
          <span className="text-xs text-muted-foreground animate-pulse">{result.progressLabel}</span>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label="关闭节点详情"
          data-track="workflow-runner-node-result-close-button"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-3 text-xs space-y-3">
        {Object.keys(result.input.variables).length > 0 && (
          <div className="grid gap-1">
            <p className="font-medium text-muted-foreground">输入变量</p>
            <div className="bg-muted rounded p-2 space-y-0.5">
              {Object.entries(result.input.variables).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="font-mono text-muted-foreground shrink-0">${k}</span>
                  <span className="break-all">{v || <span className="text-muted-foreground italic">（空）</span>}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {result.input.prompt && (
          <div className="grid gap-1">
            <p className="font-medium text-muted-foreground">完整 Prompt</p>
            <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all">{result.input.prompt}</pre>
          </div>
        )}
        {result.output != null && result.output !== "" && (
          <div className="grid gap-1">
            <p className="font-medium text-muted-foreground">输出</p>
            <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all">{result.output}</pre>
          </div>
        )}
        {result.error && (
          <div className="grid gap-1">
            <p className={`font-medium ${result.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}`}>错误</p>
            <pre className={`bg-muted rounded p-2 whitespace-pre-wrap break-all ${result.status === "cancelled" ? "text-muted-foreground" : "text-destructive"}`}>{result.error}</pre>
          </div>
        )}
        {result.outputs && Object.keys(result.outputs).length > 0 && (
          <div className="grid gap-1">
            <p className="font-medium text-muted-foreground">结构化输出</p>
            <div className="bg-muted rounded p-2 space-y-1">
              {Object.entries(result.outputs).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
                  <span className="font-mono text-muted-foreground text-xs">{k}</span>
                  <span className="break-all">{formatOutputValue(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeBranchLabel && (
          <div className="grid gap-1">
            <p className="font-medium text-muted-foreground">激活分支</p>
            <span className="font-mono">{activeBranchLabel}</span>
          </div>
        )}
        {!result.input.prompt && !result.error && !activeBranchLabel
          && (result.output == null || result.output === "")
          && (!result.outputs || Object.keys(result.outputs).length === 0) && (
          <p className="text-muted-foreground">
            {result.status === "skipped" ? "节点因工作流分支逻辑被跳过，未执行" : result.status === "pending" ? "节点等待执行" : result.status === "running" ? "节点正在执行…" : result.status === "cancelled" ? "节点执行被取消" : "（无可展示的输出）"}
          </p>
        )}
      </div>
    </div>
  )
}

function formatOutputValue(value: unknown): string {
  if (value === null || value === undefined) return "（空）"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
