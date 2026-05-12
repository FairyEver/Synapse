import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"

const STATUS_LABEL: Record<string, string> = { pending: "等待", running: "执行中", success: "完成", failed: "失败", skipped: "跳过" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", running: "default", success: "secondary", failed: "destructive", skipped: "outline",
}

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
    const node = definition.nodes.find((n) => n.id === result.nodeId)
    if (!node || node.type !== "switch") return result.activeBranch
    const branches = (node.config as { branches?: Array<{ id: string; label: string }> }).branches
    return branches?.find((b) => b.id === result.activeBranch)?.label ?? result.activeBranch
  })()
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <span className="text-sm font-medium truncate flex-1">{nodeName}</span>
        <Badge variant={STATUS_VARIANT[result.status] ?? "outline"} className="text-xs">
          {STATUS_LABEL[result.status] ?? result.status}
        </Badge>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
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
            <p className="font-medium text-destructive">错误</p>
            <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all text-destructive">{result.error}</pre>
          </div>
        )}
        {activeBranchLabel && (
          <div className="grid gap-1">
            <p className="font-medium text-muted-foreground">激活分支</p>
            <span className="font-mono">{activeBranchLabel}</span>
          </div>
        )}
        {!result.input.prompt && !result.error && !activeBranchLabel && (result.output == null || result.output === "") && (
          <p className="text-muted-foreground">
            {result.status === "skipped" ? "节点因工作流分支逻辑被跳过，未执行" : result.status === "pending" ? "节点等待执行" : "（无可展示的输出）"}
          </p>
        )}
      </div>
    </div>
  )
}
