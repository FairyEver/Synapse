import { useEffect, useMemo, useState } from "react"
import { formatBytes } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import type { SynapseKnowledgeBaseStorageMigrationProgress } from "@/types/knowledge-base"

type KnowledgeBaseStorageMigrationDialogProps = {
  progress: SynapseKnowledgeBaseStorageMigrationProgress
  onCancel: () => Promise<void> | void
}

const TERMINAL_PHASES = new Set<SynapseKnowledgeBaseStorageMigrationProgress["phase"]>([
  "completed",
  "completed-with-warning",
  "failed",
  "cancelled",
])

function KnowledgeBaseStorageMigrationDialog({
  progress,
  onCancel,
}: KnowledgeBaseStorageMigrationDialogProps) {
  const [dismissedPhase, setDismissedPhase] = useState<
    SynapseKnowledgeBaseStorageMigrationProgress["phase"] | null
  >(null)
  const terminal = TERMINAL_PHASES.has(progress.phase) && !progress.active
  const open = progress.active || (terminal && dismissedPhase !== progress.phase)
  const progressValue = useMemo(() => {
    if (!progress.totalBytes || progress.totalBytes <= 0) return undefined
    return Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
  }, [progress.copiedBytes, progress.totalBytes])
  const statsText = useMemo(() => migrationStatsText(progress), [progress])

  useEffect(() => {
    if (progress.active) {
      setDismissedPhase(null)
    }
  }, [progress.active])

  return (
    <Dialog
      data-track="knowledge-base-storage-migration-dialog"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && terminal) {
          setDismissedPhase(progress.phase)
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>迁移知识库存储</DialogTitle>
          <DialogDescription role="status" aria-live="polite">
            {progress.message || migrationPhaseText(progress.phase)}
          </DialogDescription>
        </DialogHeader>
        <Progress value={progressValue ?? 0} aria-label="迁移进度" />
        {statsText ? (
          <p className="text-sm text-muted-foreground">{statsText}</p>
        ) : null}
        {progress.warningCode ? (
          <p className="text-sm text-muted-foreground">{warningText(progress.warningCode)}</p>
        ) : null}
        {progress.errorMessage ? (
          <p className="text-sm text-destructive">{progress.errorMessage}</p>
        ) : null}
        <DialogFooter>
          {terminal ? (
            <Button type="button" onClick={() => setDismissedPhase(progress.phase)}>
              关闭
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={!progress.cancellable}
              onClick={() => void onCancel()}
            >
              {progress.cancellable ? "取消迁移" : (
                progress.message || migrationPhaseText(progress.phase)
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function migrationStatsText(progress: SynapseKnowledgeBaseStorageMigrationProgress): string | null {
  if (progress.phase === "preparing" && progress.totalBytes === null && progress.copiedBytes > 0) {
    return `已统计 ${formatBytes(progress.copiedBytes)}`
  }
  return null
}

function migrationPhaseText(phase: SynapseKnowledgeBaseStorageMigrationProgress["phase"]): string {
  switch (phase) {
    case "preparing":
      return "正在准备"
    case "copying":
      return "正在复制"
    case "verifying":
      return "正在校验"
    case "switching":
      return "正在切换"
    case "cleaning":
      return "正在清理"
    case "recovering":
      return "正在恢复"
    case "completed":
    case "completed-with-warning":
      return "迁移完成"
    case "failed":
      return "迁移失败"
    case "cancelled":
      return "已取消"
    case "idle":
    default:
      return "等待迁移"
  }
}

function warningText(
  code: NonNullable<SynapseKnowledgeBaseStorageMigrationProgress["warningCode"]>,
): string {
  if (code === "free-space-unknown") {
    return "无法确认剩余空间，迁移会继续。"
  }
  return "旧副本仍保留在原位置。"
}

export { KnowledgeBaseStorageMigrationDialog }
