import { useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import {
  buildBulkSkillTrashSummary,
  createBulkSkillUninstallTargets,
  mapBulkSkillUninstallResults,
  type BulkSkillTrashResultItem,
} from "@/modules/editor-scan/lib/bulk-skill-trash"
import type { EditorScanSkillCopyItem } from "@/modules/editor-scan/lib/editor-copy-source"

type EditorBulkSkillTrashDialogProps = {
  items: EditorScanSkillCopyItem[]
  onOpenChange: (open: boolean) => void
  onTrashed?: (trashedKeys: string[]) => Promise<void> | void
  open: boolean
}

const logger = createRendererLogger("editor-scan.bulk-trash")

function EditorBulkSkillTrashDialog({
  items,
  onOpenChange,
  onTrashed,
  open,
}: EditorBulkSkillTrashDialogProps) {
  const { error: notifyError, success, warning } = useAppNotifications()
  const [results, setResults] = useState<BulkSkillTrashResultItem[]>([])
  const [isTrashing, setIsTrashing] = useState(false)

  useEffect(() => {
    if (!open) {
      setResults([])
      setIsTrashing(false)
    }
  }, [open])

  const failedResults = useMemo(
    () => results.filter((result): result is Extract<BulkSkillTrashResultItem, { status: "failed" }> => result.status === "failed"),
    [results],
  )
  const attemptItems = failedResults.length > 0
    ? failedResults.map((result) => result.item)
    : items
  const visibleItems = attemptItems.slice(0, 5)
  const hiddenCount = Math.max(attemptItems.length - visibleItems.length, 0)

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
    let nextResults: BulkSkillTrashResultItem[]

    try {
      const result = await bridge.skillUninstaller.uninstall({
        targets: createBulkSkillUninstallTargets(attemptItems),
      })
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

    if (trashedKeys.length > 0) {
      try {
        await onTrashed?.(trashedKeys)
      } catch (error) {
        logger.warn("Scan refresh after bulk Skill trash failed.", { error })
        warning("已移到废纸篓，刷新失败")
      }
    }

    if (summary.trashed === attemptItems.length) {
      success(`已移到废纸篓 ${summary.trashed} 个 Skill`)
      onOpenChange(false)
    } else if (summary.trashed > 0) {
      warning(`已移到废纸篓 ${summary.trashed}/${attemptItems.length} 个 Skill`)
    } else {
      notifyError("移到废纸篓失败")
    }

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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="block">已选 {items.length} 个 Skill。</span>
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
          <AlertDialogCancel disabled={isTrashing}>取消</AlertDialogCancel>
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
