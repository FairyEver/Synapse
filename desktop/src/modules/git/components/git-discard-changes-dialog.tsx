import { useEffect, useState } from "react"
import type { RefObject } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitRepository, SynapseGitWorkingTreeChange } from "@/types/git"

type GitDiscardChangesDialogProps = {
  readonly repository: SynapseGitRepository
  readonly selectedChanges: readonly SynapseGitWorkingTreeChange[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onDiscarded: () => void | Promise<void>
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>
}

const VISIBLE_PATH_LIMIT = 5

export function GitDiscardChangesDialog({
  repository,
  selectedChanges,
  open,
  onOpenChange,
  onDiscarded,
  returnFocusRef,
}: GitDiscardChangesDialogProps) {
  const [selectionId, setSelectionId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedPathsKey = JSON.stringify(selectedChanges.map((change) => change.path))

  useEffect(() => {
    if (!open || selectedPathsKey === "[]") {
      setSelectionId(null)
      setPreparing(false)
      return
    }
    let active = true
    setPreparing(true)
    setSelectionId(null)
    setError(null)
    const paths = JSON.parse(selectedPathsKey) as string[]
    void requireSynapseBridge().git.prepareChangeSelection({ repositoryId: repository.id, paths })
      .then((selection) => {
        if (active) setSelectionId(selection.selectionId)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法确认所选改动。")
      })
      .finally(() => {
        if (active) setPreparing(false)
      })
    return () => {
      active = false
    }
  }, [open, repository.id, selectedPathsKey])

  const discard = async () => {
    if (!selectionId) return
    setBusy(true)
    setError(null)
    try {
      await requireSynapseBridge().git.discardChanges({ repositoryId: repository.id, selectionId })
      setSelectionId(null)
      await onDiscarded()
      onOpenChange(false)
    } catch (cause) {
      const nextError = cause instanceof Error ? cause.message : "丢弃改动失败。"
      if (nextError.includes("重新审阅") || nextError.includes("已过期")) setSelectionId(null)
      setError(nextError)
    } finally {
      setBusy(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (busy) return
    if (!nextOpen) setSelectionId(null)
    onOpenChange(nextOpen)
  }

  const visiblePaths = selectedChanges.slice(0, VISIBLE_PATH_LIMIT)
  const hiddenPathCount = selectedChanges.length - visiblePaths.length

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange} data-track="git-discard-changes-dialog">
      <AlertDialogContent onCloseAutoFocus={(event) => {
        event.preventDefault()
        returnFocusRef.current?.focus()
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>丢弃 {selectedChanges.length} 个改动？</AlertDialogTitle>
          <AlertDialogDescription>
            已跟踪文件将恢复到 HEAD，无法在 Synapse 内撤销；新增、未跟踪及重命名后的文件将移入系统废纸篓。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1 rounded-lg border p-3 text-sm">
          {visiblePaths.map((change) => (
            <div key={`${change.path}:${change.originalPath ?? ""}`} className="truncate" title={change.path}>
              {change.path}
            </div>
          ))}
          {hiddenPathCount > 0 ? <div className="text-muted-foreground">另有 {hiddenPathCount} 个文件</div> : null}
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || preparing || !selectionId}
            onClick={(event) => {
              event.preventDefault()
              void discard()
            }}
          >
            {preparing ? "准备中" : busy ? "正在丢弃" : "丢弃改动"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
