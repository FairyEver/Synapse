import { useState } from "react"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const STATUS_LABEL: Record<string, string> = { running: "执行中", success: "完成", failed: "失败", skipped: "跳过", pending: "等待" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", success: "secondary", failed: "destructive", skipped: "outline", pending: "outline",
}

interface ExecutionOverlayProps {
  nodeResults: Record<string, NodeRunResult>
  runState: RunState
  definition: WorkflowDefinition
}

export function ExecutionOverlay({ nodeResults, runState, definition }: ExecutionOverlayProps) {
  const [selected, setSelected] = useState<NodeRunResult | null>(null)

  if (runState === "idle") return null

  const nameOf = (nodeId: string) => definition.nodes.find((n) => n.id === nodeId)?.name ?? nodeId

  return (
    <>
      <div className="absolute bottom-4 right-4 bg-background/90 border rounded-lg shadow-sm p-3 flex flex-col gap-1.5 max-h-64 overflow-auto z-10">
        <p className="text-xs font-medium text-muted-foreground mb-1">运行状态</p>
        {Object.values(nodeResults).map((r) => (
          <div
            key={r.nodeId}
            className={`flex items-center gap-2 ${r.status === "success" || r.status === "failed" ? "cursor-pointer hover:opacity-75" : ""}`}
            onClick={() => { if (r.status === "success" || r.status === "failed") setSelected(r) }}
          >
            <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs shrink-0">{STATUS_LABEL[r.status] ?? r.status}</Badge>
            <span className="text-xs text-muted-foreground truncate max-w-32">{nameOf(r.nodeId)}</span>
          </div>
        ))}
      </div>
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{selected ? nameOf(selected.nodeId) : ""} — 执行详情</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="grid gap-3 text-xs overflow-auto max-h-[60vh]">
              {selected.input.prompt && (
                <div className="grid gap-1">
                  <p className="font-medium text-muted-foreground">完整 Prompt</p>
                  <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all">{selected.input.prompt}</pre>
                </div>
              )}
              {selected.output !== undefined && (
                <div className="grid gap-1">
                  <p className="font-medium text-muted-foreground">输出</p>
                  <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all">{selected.output}</pre>
                </div>
              )}
              {selected.error && (
                <div className="grid gap-1">
                  <p className="font-medium text-destructive">错误</p>
                  <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-all text-destructive">{selected.error}</pre>
                </div>
              )}
              {selected.activeBranch && (
                <div className="grid gap-1">
                  <p className="font-medium text-muted-foreground">激活分支</p>
                  <span className="font-mono">{selected.activeBranch}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
