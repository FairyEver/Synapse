import { useState } from "react"
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

  return (
    <>
      <SettingsGroup>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">配置</p>
          <div className="flex gap-2">
            <Button
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
              type="button"
              variant="outline"
              onClick={() => {
                logger.info("Config backup export initiated.")
                void promise(
                  () => exportConfigBackup(),
                  {
                    loading: "正在导出配置...",
                    success: (result) => result ? "配置已导出。" : null,
                    error: (error) => error instanceof Error ? error.message : "导出配置失败。",
                  },
                ).catch((err) => { logger.warn("config backup export failed", err) })
              }}
            >
              导出
            </Button>
          </div>
        </div>
      </SettingsGroup>

      <AlertDialog open={isImportOpen} onOpenChange={setIsImportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>导入配置</AlertDialogTitle>
            <AlertDialogDescription>
              导入后会覆盖当前设置和身份，完成后会刷新窗口。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                logger.info("Config backup import confirmed.")
                void promise(
                  () => importConfigBackup(),
                  {
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
                  .catch((err) => { logger.warn("config import close dialog failed", err) })
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
