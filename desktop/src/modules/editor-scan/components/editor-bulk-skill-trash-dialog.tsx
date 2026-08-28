import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { LoaderCircle } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { getSynapseBridge } from "@/lib/electron-bridge"
import { runSkillUninstallBatches } from "../../../../app-capabilities/skill-uninstaller/shared/batch"
import {
  buildBulkSkillTrashSummary,
  createBulkSkillUninstallTargets,
  mapBulkSkillUninstallResults,
  type BulkSkillTrashResultItem,
} from "@/modules/editor-scan/lib/bulk-skill-trash"
import type { EditorScanSkillCopyItem } from "@/modules/editor-scan/lib/editor-copy-source"

type EditorBulkSkillTrashDialogProps = {
  fallbackFocusRef?: RefObject<HTMLElement | null>
  items: EditorScanSkillCopyItem[]
  onOpenChange: (open: boolean) => void
  onTrashed?: (trashedKeys: string[]) => Promise<void> | void
  open: boolean
  restoreFocusRef?: RefObject<HTMLElement | null>
}

const logger = createRendererLogger("editor-scan.bulk-trash")

function EditorBulkSkillTrashDialog({
  fallbackFocusRef,
  items,
  onOpenChange,
  onTrashed,
  open,
  restoreFocusRef,
}: EditorBulkSkillTrashDialogProps) {
  const { error: notifyError, success, warning } = useAppNotifications()
  const [results, setResults] = useState<BulkSkillTrashResultItem[]>([])
  const [isTrashing, setIsTrashing] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const activeOperationIdRef = useRef<string | null>(null)
  const cancelRequestedRef = useRef(false)
  const restoreFallbackOnCloseRef = useRef(false)

  useEffect(() => {
    if (open) {
      restoreFallbackOnCloseRef.current = false
    } else {
      setResults([])
      setIsTrashing(false)
      setIsCancelling(false)
      setProgress(null)
    }
  }, [open])

  useEffect(() => () => {
    cancelRequestedRef.current = true
    const operationId = activeOperationIdRef.current
    activeOperationIdRef.current = null
    const bridge = getSynapseBridge()
    if (operationId && bridge) {
      void bridge.skillUninstaller.cancelUninstall({ operationId }).catch((error) => {
        logger.warn("Bulk Skill uninstall cancellation on unmount failed.", { error })
      })
    }
  }, [])

  const failedResults = useMemo(
    () => results.filter((result): result is Extract<BulkSkillTrashResultItem, { status: "failed" }> => result.status === "failed"),
    [results],
  )
  const attemptItems = failedResults.length > 0
    ? failedResults.map((result) => result.item)
    : items
  const visibleItems = attemptItems.slice(0, 5)
  const hiddenCount = Math.max(attemptItems.length - visibleItems.length, 0)

  const cancelTrash = async () => {
    if (!isTrashing || isCancelling) return
    cancelRequestedRef.current = true
    setIsCancelling(true)
    const operationId = activeOperationIdRef.current
    if (!operationId) {
      setIsCancelling(false)
      return
    }
    const bridge = getSynapseBridge()
    if (!bridge) {
      setIsCancelling(false)
      return
    }
    try {
      await bridge.skillUninstaller.cancelUninstall({ operationId })
    } catch (error) {
      logger.warn("Bulk Skill uninstall cancellation failed.", { error })
    }
  }

  const runTrash = async () => {
    if (isTrashing || attemptItems.length === 0) return

    const bridge = getSynapseBridge()
    if (!bridge) {
      notifyError("移到废纸篓失败")
      setResults(attemptItems.map((item) => ({
        item,
        message: "当前窗口无法处理本机内容。",
        status: "failed",
      })))
      return
    }

    setIsTrashing(true)
    setIsCancelling(false)
    setProgress({ completed: 0, total: attemptItems.length })
    cancelRequestedRef.current = false
    let nextResults: BulkSkillTrashResultItem[]
    let cancelled = false

    try {
      const result = await runSkillUninstallBatches({
        targets: createBulkSkillUninstallTargets(attemptItems),
        invoke: (request) => bridge.skillUninstaller.uninstall(request),
        shouldCancel: () => cancelRequestedRef.current,
        onOperationChange: (operationId) => {
          activeOperationIdRef.current = operationId
        },
        onProgress: (completed) => {
          setProgress({ completed, total: attemptItems.length })
        },
      })
      cancelled = result.cancelled === true
      nextResults = mapBulkSkillUninstallResults(attemptItems, result)
    } catch (error) {
      logger.error("Bulk Skill uninstall failed.", {
        errorType: error instanceof Error ? error.name : typeof error,
        itemCount: attemptItems.length,
        operation: "skill-uninstall-batch",
      })
      nextResults = attemptItems.map((item) => ({
        item,
        message: error instanceof Error ? error.message : "移到废纸篓失败。",
        status: "failed",
      }))
    }

    setResults(nextResults)
    const summary = buildBulkSkillTrashSummary(nextResults)
    const trashedKeys = nextResults
      .filter((result): result is Extract<BulkSkillTrashResultItem, { status: "trashed" }> => result.status === "trashed")
      .map((result) => result.item.key)
    const uninstallWarnings = [...new Set(nextResults.flatMap((result) => (
      result.status === "trashed" && result.warning ? [result.warning] : []
    )))]

    if (trashedKeys.length > 0) {
      restoreFallbackOnCloseRef.current = true
      try {
        await onTrashed?.(trashedKeys)
      } catch (error) {
        logger.warn("Scan refresh after bulk Skill trash failed.", { error })
        warning("已移到废纸篓，刷新失败")
      }
    }

    if (cancelled) {
      warning(`已停止，已移到废纸篓 ${summary.trashed}/${attemptItems.length} 个 Skill`)
    } else if (summary.trashed === attemptItems.length) {
      if (uninstallWarnings.length > 0) {
        warning(uninstallWarnings.join("；"))
      } else {
        success(`已移到废纸篓 ${summary.trashed} 个 Skill`)
      }
      onOpenChange(false)
    } else if (summary.trashed > 0) {
      warning([
        `已移到废纸篓 ${summary.trashed}/${attemptItems.length} 个 Skill`,
        ...uninstallWarnings,
      ].join("；"))
    } else {
      notifyError("移到废纸篓失败")
    }

    activeOperationIdRef.current = null
    cancelRequestedRef.current = false
    setIsCancelling(false)
    setProgress(null)
    setIsTrashing(false)
  }

  if (items.length === 0) return null

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isTrashing) onOpenChange(nextOpen)
      }}
      data-track="editor-scan-bulk-skill-trash-confirm"
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (restoreFallbackOnCloseRef.current) {
            fallbackFocusRef?.current?.focus()
            return
          }
          const restoreTarget = restoreFocusRef?.current
          if (restoreTarget?.isConnected) {
            restoreTarget.focus()
            return
          }
          fallbackFocusRef?.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
          <AlertDialogDescription aria-live="polite">
            <span className="block">
              {progress ? `已处理 ${progress.completed}/${progress.total} 个 Skill。` : `已选 ${items.length} 个 Skill。`}
            </span>
            <span className="block">可从系统废纸篓恢复。</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-1 text-sm">
          {visibleItems.map((item) => (
            <span key={item.key} className="truncate">{item.name}</span>
          ))}
          {hiddenCount > 0 ? (
            <span className="text-muted-foreground">还有 {hiddenCount} 个</span>
          ) : null}
        </div>

        {failedResults.length > 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              <span className="block">以下 Skill 未处理：</span>
              {failedResults.map((result) => (
                <span key={result.item.key} className="block">
                  {result.item.name}：{result.message}
                </span>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}

        <AlertDialogFooter>
          {isTrashing ? (
            <Button
              type="button"
              variant="outline"
              disabled={isCancelling}
              onClick={() => void cancelTrash()}
            >
              {isCancelling ? "正在停止" : "停止处理"}
            </Button>
          ) : <AlertDialogCancel>取消</AlertDialogCancel>}
          <AlertDialogAction
            variant="destructive"
            disabled={isTrashing}
            onClick={(event) => {
              event.preventDefault()
              void runTrash()
            }}
          >
            {isTrashing ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
            {failedResults.length > 0 ? "重试未处理项" : "移到废纸篓"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { EditorBulkSkillTrashDialog }
export type { EditorBulkSkillTrashDialogProps }
