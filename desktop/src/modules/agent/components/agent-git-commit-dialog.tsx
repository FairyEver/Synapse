import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PendingAgentGitCommit } from "../hooks/use-project-git-actions"

type AgentGitCommitDialogProps = {
  readonly busy: boolean
  readonly error: string | null
  readonly pending: PendingAgentGitCommit | null
  readonly onCancelOperation: () => void
  readonly onConfirm: () => void
  readonly onOpenChange: (open: boolean) => void
  readonly onReprepare: () => void
}

export function AgentGitCommitDialog({
  busy,
  error,
  pending,
  onCancelOperation,
  onConfirm,
  onOpenChange,
  onReprepare,
}: AgentGitCommitDialogProps) {
  const needsReprepare = pending?.selectionId === null
  const title = pending?.action === "commit-and-push" ? "提交并推送" : "提交全部改动"

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => {
      if (!busy) onOpenChange(open)
    }}>
      <DialogContent showCloseButton={!busy} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>提交失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
            <Label>改动文件</Label>
            <span className="text-sm">{pending?.changeCount ?? 0} 个</span>
            <Label htmlFor="agent-git-commit-message">提交说明</Label>
            <Input
              id="agent-git-commit-message"
              value={pending?.message ?? ""}
              readOnly
            />
          </div>
        </div>
        <DialogFooter>
          {busy ? (
            <Button type="button" variant="outline" onClick={onCancelOperation}>
              取消操作
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
          )}
          <Button
            type="button"
            disabled={busy}
            onClick={needsReprepare ? onReprepare : onConfirm}
          >
            {busy ? "处理中" : needsReprepare ? "重新检查" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
