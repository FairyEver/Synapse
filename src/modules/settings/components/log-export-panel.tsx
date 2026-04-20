import { Download, LoaderCircle, Trash2 } from "lucide-react"
import { useCallback, useState } from "react"
import { useAppNotifications } from "@/app-shell/notifications"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireSynapseBridge } from "@/lib/electron-bridge"

const LOG_ACTION_TIMEOUT_MS = 15000

function withTimeout<T>(promise: Promise<T>, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(timeoutMessage))
    }, LOG_ACTION_TIMEOUT_MS)

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId)
        reject(error)
      },
    )
  })
}

function LogExportPanel() {
  const { promise } = useAppNotifications()
  const [activeAction, setActiveAction] = useState<"clear" | "export" | null>(null)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)

  const isExporting = activeAction === "export"
  const isClearing = activeAction === "clear"
  const isBusy = activeAction !== null

  const handleExport = useCallback(async () => {
    setActiveAction("export")
    try {
      await promise(
        () =>
          withTimeout(
            requireSynapseBridge().log.export(),
            "导出日志超时，请稍后重试。",
          ),
        {
          loading: "正在导出日志...",
          success: (result) => `已导出 ${result.fileCount} 个日志文件到 ${result.filePath}`,
          error: (error) => error instanceof Error ? error.message : "导出日志失败",
        },
      )
    } finally {
      setActiveAction(null)
    }
  }, [promise])

  const handleClear = useCallback(async () => {
    setActiveAction("clear")
    try {
      await promise(
        () =>
          withTimeout(
            requireSynapseBridge().log.clear(),
            "删除日志超时，请稍后重试。",
          ),
        {
          loading: "正在删除日志...",
          success: (result) => result.fileCount > 0 ? `已删除 ${result.fileCount} 个日志文件` : "日志已清空",
          error: (error) => error instanceof Error ? error.message : "删除日志失败",
        },
      )
      setIsClearDialogOpen(false)
    } finally {
      setActiveAction(null)
    }
  }, [promise])

  return (
    <>
      <Card className="bg-background">
        <CardHeader>
          <CardTitle>日志</CardTitle>
          <CardDescription>导出应用运行日志，用于排查问题。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={handleExport}
          >
            {isExporting ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            {isExporting ? "导出中..." : "导出全部日志"}
          </Button>

          <Button
            variant="destructive"
            size="sm"
            disabled={isBusy}
            onClick={() => setIsClearDialogOpen(true)}
          >
            {isClearing ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            {isClearing ? "删除中..." : "删除全部日志"}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除全部日志</AlertDialogTitle>
            <AlertDialogDescription>
              会删除当前设备上的全部本地日志文件，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isClearing}
              onClick={(event) => {
                event.preventDefault()
                void handleClear()
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { LogExportPanel }
