import { useEffect, useRef, useState } from "react"
import { exportConfigBackup, importConfigBackup } from "@/app-shell/config-backup"
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
import { SettingsGroup } from "@/modules/settings/components/settings-group"

function ConfigBackupPanel() {
  const { promise } = useAppNotifications()
  const logger = createRendererLogger("settings.backup")
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const importTriggerRef = useRef<HTMLButtonElement | null>(null)
  const importConfirmRef = useRef<HTMLButtonElement | null>(null)
  const exportTriggerRef = useRef<HTMLButtonElement | null>(null)
  const shouldRestoreExportFocusRef = useRef(false)
  const shouldRestoreImportConfirmFocusRef = useRef(false)

  useEffect(() => {
    if (isExporting || !shouldRestoreExportFocusRef.current) return
    shouldRestoreExportFocusRef.current = false
    exportTriggerRef.current?.focus()
  }, [isExporting])

  useEffect(() => {
    if (isImporting || !isImportOpen || !shouldRestoreImportConfirmFocusRef.current) return
    shouldRestoreImportConfirmFocusRef.current = false
    importConfirmRef.current?.focus()
  }, [isImportOpen, isImporting])

  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">配置</p>
          <div className="flex gap-2">
            <Button
              ref={importTriggerRef}
              type="button"
              variant="outline"
              onClick={() => {
                logger.info("Config backup import dialog opened.")
                setIsImportOpen(true)
              }}
            >
              导入
            </Button>
            <Button
              ref={exportTriggerRef}
              type="button"
              variant="outline"
              disabled={isExporting}
              onClick={() => {
                if (isExporting) return
                logger.info("Config backup export initiated.")
                shouldRestoreExportFocusRef.current = true
                setIsExporting(true)
                void promise(
                  () => exportConfigBackup(),
                  {
                    trackingName: "settings.config-backup.export",
                    loading: "正在导出配置...",
                    success: (result) => result ? "配置已导出。" : null,
                    error: (error) => error instanceof Error ? error.message : "导出配置失败。",
                  },
                )
                  .catch((err) => { logger.warn("config backup export failed", err) })
                  .finally(() => { setIsExporting(false) })
              }}
            >
              导出
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">不包含 Agent 对话、终端输出、检查点和已保存命令正文。</p>
        </div>
      </SettingsGroup>

      <AlertDialog
        open={isImportOpen}
        onOpenChange={(open) => {
          if (isImporting) return
          setIsImportOpen(open)
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            importTriggerRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>导入配置</AlertDialogTitle>
            <AlertDialogDescription>
              导入后会覆盖当前设置和身份，完成后会刷新窗口。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isImporting}>取消</AlertDialogCancel>
            <AlertDialogAction
              ref={importConfirmRef}
              disabled={isImporting}
              onClick={(event) => {
                event.preventDefault()
                if (isImporting) return
                logger.info("Config backup import confirmed.")
                setIsImporting(true)
                void promise(
                  () => importConfigBackup(),
                  {
                    trackingName: "settings.config-backup.import",
                    loading: "正在导入配置...",
                    success: (result) => {
                      if (!result) {
                        return null
                      }

                      window.location.reload()
                      return null
                    },
                    error: (error) => error instanceof Error ? error.message : "导入配置失败。",
                  },
                )
                  .then(() => {
                    setIsImportOpen(false)
                  })
                  .catch((err) => {
                    shouldRestoreImportConfirmFocusRef.current = true
                    logger.warn("config import close dialog failed", err)
                  })
                  .finally(() => { setIsImporting(false) })
              }}
            >
              确认导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { ConfigBackupPanel }
