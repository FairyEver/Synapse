import { ClipboardCopy, Download, LoaderCircle, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
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
import {
  Dialog,
  DialogContent,
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getSynapseBridge, requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseLogFileInfo } from "@/types/log"
import { Badge } from "@/components/ui/badge"
import { LOG_CLIPBOARD_MAX_BYTES } from "../../../../config"

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const logger = createRendererLogger("settings.logs")

function getSelectedLogSize(files: SynapseLogFileInfo[], selected: Set<string>): number {
  return files.reduce((sum, file) => selected.has(file.name) ? sum + file.sizeBytes : sum, 0)
}

function formatLogCopyLimitMessage(selectedBytes: number): string {
  return `已选日志 ${formatFileSize(selectedBytes)}，超过复制上限 ${formatFileSize(LOG_CLIPBOARD_MAX_BYTES)}，请导出全部日志。`
}

function LogExportPanel() {
  const { error: showError, promise } = useAppNotifications()
  const [activeAction, setActiveAction] = useState<"clear" | "copy" | "export" | null>(null)
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [logFilePickerState, setLogFilePickerState] = useState<{
    files: SynapseLogFileInfo[]
    selected: Set<string>
  } | null>(null)
  const [totalLogSize, setTotalLogSize] = useState<number | null>(null)

  useEffect(() => {
    getSynapseBridge()?.log.listFiles().then((files) => {
      setTotalLogSize(files.reduce((sum, f) => sum + f.sizeBytes, 0))
    }).catch(() => undefined)
  }, [])

  const isExporting = activeAction === "export"
  const isCopying = activeAction === "copy"
  const isClearing = activeAction === "clear"
  const isBusy = activeAction !== null
  const selectedLogSize = logFilePickerState
    ? getSelectedLogSize(logFilePickerState.files, logFilePickerState.selected)
    : 0
  const isSelectedLogSizeOverLimit = selectedLogSize > LOG_CLIPBOARD_MAX_BYTES

  const handleExport = useCallback(async () => {
    setActiveAction("export")
    logger.info("Log export initiated.")
    try {
      await promise(
        async () => {
          const result = await withTimeout(
            requireSynapseBridge().log.export(),
            "导出日志超时，请稍后重试。",
          )
          if (result.filePath) {
            window.synapse?.shell.showItemInFolder(result.filePath).catch(() => {})
          }
          return result
        },
        {
          loading: "正在导出日志...",
          success: (result) => result.filePath ? `已导出 ${result.fileCount} 个日志文件到 ${result.filePath}` : null,
          error: (error) => error instanceof Error ? error.message : "导出日志失败",
        },
      )
    } catch (error) {
      logger.error("Log export failed.", error)
    } finally {
      setActiveAction(null)
    }
  }, [promise])

  const handleCopyToClipboard = useCallback(async () => {
    setActiveAction("copy")
    logger.info("Log copy to clipboard initiated.")
    try {
      const files = await withTimeout(
        requireSynapseBridge().log.listFiles(),
        "读取日志文件列表超时。",
      )

      if (files.length === 0) {
        await promise(async () => {
          await navigator.clipboard.writeText("")
        }, {
          loading: "正在复制日志...",
          success: () => "当前没有日志文件",
          error: (error) => error instanceof Error ? error.message : "复制日志失败",
        })
        return
      }

      if (files.length === 1) {
        if (files[0].sizeBytes > LOG_CLIPBOARD_MAX_BYTES) {
          showError(formatLogCopyLimitMessage(files[0].sizeBytes))
          return
        }
        await promise(
          async () => {
            const content = await withTimeout(
              requireSynapseBridge().log.readFiles([files[0].name]),
              "读取日志超时，请稍后重试。",
            )
            await navigator.clipboard.writeText(content)
            return content
          },
          {
            loading: "正在复制日志...",
            success: () => "已复制日志到剪切板",
            error: (error) => error instanceof Error ? error.message : "复制日志失败",
          },
        )
        return
      }

      setLogFilePickerState({
        files,
        selected: new Set([files[0].name]),
      })
      logger.info("Log file picker opened.", { fileCount: files.length, defaultSelected: files[0].name })
    } catch (error) {
      logger.error("Failed to prepare log copy to clipboard.", error)
      showError(error instanceof Error ? error.message : "复制日志失败")
    } finally {
      setActiveAction(null)
    }
  }, [promise, showError])

  const handleClear = useCallback(async () => {
    setActiveAction("clear")
    logger.info("Log clear initiated.")
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
      setTotalLogSize(0)
    } catch (error) {
      logger.error("Log clear failed.", error)
    } finally {
      setActiveAction(null)
    }
  }, [promise])

  const handleCopySelectedFiles = useCallback(async () => {
    if (!logFilePickerState) return

    const selectedNames = Array.from(logFilePickerState.selected)
    if (selectedNames.length === 0) return
    const selectedBytes = getSelectedLogSize(logFilePickerState.files, logFilePickerState.selected)
    if (selectedBytes > LOG_CLIPBOARD_MAX_BYTES) {
      showError(formatLogCopyLimitMessage(selectedBytes))
      return
    }

    setActiveAction("copy")
    logger.info("Selected log copy initiated.", { selectedCount: selectedNames.length, selectedNames })
    try {
      await promise(
        async () => {
          const content = await withTimeout(
            requireSynapseBridge().log.readFiles(selectedNames),
            "读取日志超时，请稍后重试。",
          )
          await navigator.clipboard.writeText(content)
          return content
        },
        {
          loading: "正在复制日志...",
          success: () => `已复制 ${selectedNames.length} 个日志文件到剪切板`,
          error: (error) => error instanceof Error ? error.message : "复制日志失败",
        },
      )
      setLogFilePickerState(null)
    } catch (error) {
      logger.error("Copy selected log files failed.", error)
    } finally {
      setActiveAction(null)
    }
  }, [logFilePickerState, promise, showError])

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
          <CardDescription>导出应用运行日志，用于排查问题。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
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
            {!isExporting && totalLogSize !== null && (
              <span className="text-muted-foreground">({formatFileSize(totalLogSize)})</span>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={handleCopyToClipboard}
          >
            {isCopying ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <ClipboardCopy data-icon="inline-start" />
            )}
            {isCopying ? "复制中..." : "复制到剪切板"}
          </Button>

          <Button
            variant="destructive"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              logger.info("Log clear confirm dialog opened.")
              setIsClearDialogOpen(true)
            }}
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

      <Dialog
        open={logFilePickerState !== null}
        onOpenChange={(open) => {
          if (!open) setLogFilePickerState(null)
        }}
      >
        <DialogContent showCloseButton={false} className="overflow-hidden p-0 sm:max-w-md">
          <DialogFrame>
            <DialogFrameHeader
              title="选择要复制的日志文件"
              description={`共 ${logFilePickerState?.files.length ?? 0} 个日志文件，已选 ${formatFileSize(selectedLogSize)}，复制上限 ${formatFileSize(LOG_CLIPBOARD_MAX_BYTES)}。`}
            />
            <DialogFrameBody className="px-5 py-4">
              <ScrollArea className="max-h-64">
                <div className="flex flex-col gap-1">
                  {logFilePickerState?.files.map((file, index) => {
                    const isChecked = logFilePickerState.selected.has(file.name)
                    return (
                      <label
                        key={file.name}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                      >
                        <Checkbox
                          data-track="log-file-picker-checkbox"
                          aria-label={`选择日志文件 ${file.name}`}
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            setLogFilePickerState((prev) => {
                              if (!prev) return prev
                              const next = new Set(prev.selected)
                              if (checked) {
                                next.add(file.name)
                              } else {
                                next.delete(file.name)
                              }
                              return { ...prev, selected: next }
                            })
                          }}
                        />
                        <span className="flex-1 truncate text-sm">{file.name}</span>
                        {index === 0 && (
                          <Badge variant="secondary" className="shrink-0">最新</Badge>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatFileSize(file.sizeBytes)}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
              {isSelectedLogSizeOverLimit ? (
                <p className="mt-2 text-sm text-destructive">{formatLogCopyLimitMessage(selectedLogSize)}</p>
              ) : null}
            </DialogFrameBody>
            <DialogFrameFooter>
              <Button variant="outline" onClick={() => setLogFilePickerState(null)}>
                取消
              </Button>
              <Button
                disabled={isCopying || !logFilePickerState?.selected.size || isSelectedLogSizeOverLimit}
                onClick={() => void handleCopySelectedFiles()}
              >
                {isCopying ? (
                  <LoaderCircle className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ClipboardCopy data-icon="inline-start" />
                )}
                {isCopying ? "复制中..." : `复制选中的 ${logFilePickerState?.selected.size ?? 0} 个文件`}
              </Button>
            </DialogFrameFooter>
          </DialogFrame>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { LogExportPanel }
