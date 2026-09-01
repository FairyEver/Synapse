import { useCallback } from "react"
import { formatBytes } from "@synapse/shared"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import {
  databaseExport,
  databaseImport,
  useDatabaseStatus,
} from "@/modules/database/hooks/use-database"
import { StatusPill } from "@/modules/settings/components/status-pill"
import type { DatabaseStatus } from "@/types/database"

const logger = createRendererLogger("settings.database")

type StatusRowProps = {
  label: string
  value: React.ReactNode
}

function StatusRow({ label, value }: StatusRowProps) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 break-all text-right text-foreground">
        {value}
      </div>
    </div>
  )
}

type DatabaseStatusCardProps = {
  readonly status: DatabaseStatus | null
}

type DatabaseManagementCardProps = DatabaseStatusCardProps & {
  readonly onRefreshStatus: () => Promise<void>
}

function DatabaseServiceStatusCard({ status }: DatabaseStatusCardProps) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>服务状态</CardTitle>
        <CardAction>
          <StatusPill
            active={Boolean(status?.running)}
            activeLabel="运行中"
            inactiveLabel="未启动"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <StatusRow label="HTTP 端口" value={status?.port ?? "—"} />
        <StatusRow label="数据库大小" value={status ? formatBytes(status.dbSize) : "—"} />
        <StatusRow label="表数量" value={status?.tableCount ?? "—"} />
      </CardContent>
    </Card>
  )
}

function DatabaseManagementCard({ status, onRefreshStatus }: DatabaseManagementCardProps) {
  const { error: notifyError, promise } = useAppNotifications()

  const handleExport = useCallback(async () => {
    try {
      await promise(
        async () => {
          const result = await databaseExport()
          if (!result.success) return null
          logger.info("Database exported.")
          return result
        },
        { trackingName: "settings.database.export", loading: "正在导出...", success: (value) => value ? "数据库已导出" : null },
      )
    } catch (error) {
      logger.warn("Database export failed.", {
        error: error instanceof Error ? error.name : typeof error,
      })
    }
  }, [promise])

  const handleImport = useCallback(async () => {
    try {
      await promise(
        async () => {
          const result = await databaseImport()
          if (!result.success) return null
          await onRefreshStatus()
          logger.info("Database imported.")
          return result
        },
        { trackingName: "settings.database.import", loading: "正在导入...", success: (value) => value ? "数据库已导入" : null },
      )
    } catch (error) {
      logger.warn("Database import failed.", {
        error: error instanceof Error ? error.name : typeof error,
      })
    }
  }, [onRefreshStatus, promise])

  const handleOpenDbDirectory = useCallback(() => {
    if (!status?.dbDirectoryPath) return
    logger.info("Opening database directory.")
    const shell = window.synapse?.shell
    if (!shell?.showItemInFolder) {
      notifyError("无法打开数据库目录。")
      return
    }
    void shell.showItemInFolder(status.dbDirectoryPath).catch((error) => {
      logger.warn("Failed to open database directory.", {
        pathLength: status.dbDirectoryPath.length,
        error: error instanceof Error ? error.name : typeof error,
      })
      notifyError("无法打开数据库目录。")
    })
  }, [notifyError, status?.dbDirectoryPath])

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>数据管理</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            导出数据库
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                导入数据库
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>导入数据库</AlertDialogTitle>
                <AlertDialogDescription>
                  导入将替换当前所有数据，请注意先导出备份。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleImport}>
                  确认导入
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="flex items-start gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">数据库目录</span>
          {status?.dbDirectoryPath ? (
            <button
              type="button"
              className="min-w-0 flex-1 break-all text-right text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              title={status.dbDirectoryPath}
              onClick={handleOpenDbDirectory}
            >
              {status.dbDirectoryPath}
            </button>
          ) : (
            <span className="min-w-0 flex-1 break-all text-right text-muted-foreground">—</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DatabaseSettingsPanel() {
  const { status, refresh: refreshStatus } = useDatabaseStatus()

  return (
    <div className="flex flex-col gap-2">
      <DatabaseServiceStatusCard status={status} />
      <DatabaseManagementCard status={status} onRefreshStatus={refreshStatus} />
    </div>
  )
}

export { DatabaseManagementCard, DatabaseServiceStatusCard, DatabaseSettingsPanel }
