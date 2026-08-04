import { formatBytes } from "@synapse/shared"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type {
  SynapseKnowledgeBaseImportPreview,
  SynapseKnowledgeBaseTransferProgress,
} from "@/types/knowledge-base"

const logger = createRendererLogger("settings.knowledge-base-import")

const IDLE_PROGRESS: SynapseKnowledgeBaseTransferProgress = {
  active: false,
  operation: "idle",
  phase: "idle",
  cancellable: false,
  copiedBytes: 0,
  totalBytes: null,
  message: "",
}

type KnowledgeBaseImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
}

function KnowledgeBaseImportDialog({ open, onOpenChange, onImported }: KnowledgeBaseImportDialogProps) {
  const [preview, setPreview] = useState<SynapseKnowledgeBaseImportPreview | null>(null)
  const [name, setName] = useState("")
  const [trusted, setTrusted] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(IDLE_PROGRESS)

  useEffect(() => {
    const bridge = window.synapse?.knowledgeBase
    const unsubscribe = bridge?.onTransferChanged?.((nextProgress) => {
      if (nextProgress.operation === "import" || nextProgress.operation === "idle") {
        setProgress(nextProgress)
      }
    })
    if (open) {
      void bridge?.getTransferState?.().then((nextProgress) => {
        if (nextProgress.operation === "import" || nextProgress.operation === "idle") {
          setProgress(nextProgress)
        }
      }).catch((stateError) => {
        logger.warn("Failed to read Knowledge Base transfer state.", stateError)
      })
    }
    return () => unsubscribe?.()
  }, [open])

  const progressValue = useMemo(() => {
    if (!progress.totalBytes || progress.totalBytes <= 0) return 0
    return Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
  }, [progress.copiedBytes, progress.totalBytes])

  const reset = () => {
    setPreview(null)
    setName("")
    setTrusted(false)
    setSelecting(false)
    setImporting(false)
    setError(null)
    setProgress(IDLE_PROGRESS)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && progress.active) return
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const handleSelectFolder = async () => {
    setSelecting(true)
    setError(null)
    try {
      const result = await requireBridgeDomain("knowledgeBase").selectImportFolder()
      if (!result) return
      setPreview(result)
      setName(result.suggestedName)
      setTrusted(false)
    } catch (selectError) {
      setError(errorMessage(selectError, "读取知识库文件夹失败。"))
    } finally {
      setSelecting(false)
    }
  }

  const handleImport = async () => {
    if (!preview || importing) return
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError("知识库名称不能为空。")
      return
    }
    if (!trusted) {
      setError("请确认知识库文件夹来自可信来源。")
      return
    }
    setImporting(true)
    setError(null)
    try {
      await requireBridgeDomain("knowledgeBase").importManagedFolder({
        token: preview.token,
        name: trimmedName,
        trusted,
      })
      await onImported().catch((refreshError) => {
        logger.warn("Knowledge Base was imported but settings refresh failed.", refreshError)
      })
      toast("已复制到 Synapse 知识库存储。原文件夹可自行保留或删除。")
      onOpenChange(false)
      reset()
    } catch (importError) {
      setError(errorMessage(importError, "导入知识库失败。"))
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>导入知识库</DialogTitle>
          <DialogDescription className="sr-only">选择并校验知识库文件夹。</DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-3">
          <Field>
            <Label>知识库文件夹</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={selecting || progress.active} onClick={() => void handleSelectFolder()}>
                {selecting ? "校验中..." : "选择文件夹"}
              </Button>
              {preview ? <span className="min-w-0 truncate text-sm text-muted-foreground" title={preview.folderName}>{preview.folderName}</span> : null}
            </div>
          </Field>

          {preview ? (
            <>
              <p className="text-sm text-muted-foreground">
                {preview.fileCount} 个文件，{formatBytes(preview.totalBytes)}
              </p>
              {preview.warnings.includes("legacy-export-metadata-missing") ? (
                <p className="text-sm text-muted-foreground">未找到导出信息，将按旧版知识库恢复。</p>
              ) : null}
              <Field>
                <Label htmlFor="knowledge-base-import-name">知识库名称</Label>
                <Input
                  id="knowledge-base-import-name"
                  value={name}
                  disabled={progress.active}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="knowledge-base-import-trusted"
                  checked={trusted}
                  disabled={progress.active}
                  onCheckedChange={(checked) => setTrusted(checked === true)}
                />
                <Label htmlFor="knowledge-base-import-trusted" className="font-normal">
                  该文件夹来自可信来源
                </Label>
              </div>
            </>
          ) : null}

          {progress.active && progress.operation === "import" ? (
            <div className="space-y-2" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{progress.message}</span>
                {progress.totalBytes ? <span className="tabular-nums text-muted-foreground">{progressValue}%</span> : null}
              </div>
              <Progress value={progressValue} />
            </div>
          ) : null}

          <FieldError>{error}</FieldError>
        </FieldGroup>

        <DialogFooter>
          {progress.active && progress.cancellable ? (
            <Button type="button" variant="outline" onClick={() => void requireBridgeDomain("knowledgeBase").cancelTransfer()}>
              取消导入
            </Button>
          ) : (
            <Button type="button" variant="outline" disabled={progress.active} onClick={() => handleOpenChange(false)}>
              取消
            </Button>
          )}
          <Button type="button" disabled={!preview || !trusted || importing || progress.active} onClick={() => void handleImport()}>
            {importing ? "导入中..." : "导入知识库"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export { KnowledgeBaseImportDialog }
