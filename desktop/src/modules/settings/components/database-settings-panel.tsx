import { useCallback, useEffect, useState } from "react"
import { Copy, LoaderCircle } from "lucide-react"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import type {
  DatabaseCliDebugInfo,
  DatabaseCliStatus,
} from "@/types/database"
import {
  databaseExport,
  databaseCliDebugInfoGet,
  databaseCliStatusGet,
  databaseImport,
  databaseCliInstall,
  useDatabaseStatus,
} from "@/modules/database/hooks/use-database"
import { StatusPill } from "@/modules/settings/components/status-pill"

const logger = createRendererLogger("settings.database")

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatCliDebugInfo(debugInfo: DatabaseCliDebugInfo): string {
  return JSON.stringify(debugInfo, null, 2)
}

function formatCliDetailsForCopy(debugInfo: DatabaseCliDebugInfo): string {
  return [
    "CLI 详细信息",
    "",
    `状态: ${getCliStatusLabel(debugInfo.status)}`,
    `平台: ${debugInfo.platform || "—"}`,
    `Shell: ${debugInfo.shell || "—"}`,
    `测试命令: ${debugInfo.testCommand || "—"}`,
    `脚本最新: ${debugInfo.status.shimCurrent ? "是" : "否"}`,
    `脚本已就绪: ${debugInfo.status.bundledScriptExists ? "是" : "否"}`,
    "",
    `CLI 路径: ${debugInfo.status.path || "—"}`,
    `已安装路径: ${debugInfo.installedPath ?? "—"}`,
    `目标路径: ${debugInfo.preferredInstallPath || "—"}`,
    `运行时: ${debugInfo.runtimePath || "—"}`,
    `脚本入口: ${debugInfo.bundledScriptPath || "—"}`,
    "",
    "完整调试信息:",
    formatCliDebugInfo(debugInfo),
  ].join("\n")
}

function getCliStatusLabel(status: DatabaseCliStatus | null): string {
  if (!status?.installed) return "未安装"
  return status.available ? "可用" : "不可用"
}

function getCliIssueText(status: DatabaseCliStatus | null): string | null {
  if (!status || !status.installed || status.available) return null
  if (!status.pathInShell) return "当前 shell 的 PATH 里没有这个目录，终端里可能找不到 synapse。"
  if (!status.shimCurrent) return "当前 CLI 脚本不是最新版本，请重新安装。"
  if (!status.bundledScriptExists) return "CLI 依赖的本地脚本还未准备好，请重新安装。"
  if (!status.runtimeExists) return "CLI 运行时不可用，请重新安装应用。"
  if (!status.executable) return "CLI 文件当前不可执行，请重新安装。"
  return "CLI 当前不可用，请查看详细信息。"
}

type StatusRowProps = {
  label: string
  value: React.ReactNode
}

function StatusRow({ label, value }: StatusRowProps) {
  return (
    <div className="flex items-start gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 break-all text-right text-foreground">
        {value}
      </div>
    </div>
  )
}

type DetailFieldProps = {
  label: string
  value: React.ReactNode
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-sm text-foreground break-all whitespace-pre-wrap">
        {value}
      </div>
    </div>
  )
}

function DatabaseSettingsPanel() {
  const { status, refresh: refreshStatus } = useDatabaseStatus()
  const { promise } = useAppNotifications()
  const [cliStatus, setCliStatus] = useState<DatabaseCliStatus | null>(null)
  const [cliDebugInfo, setCliDebugInfo] = useState<DatabaseCliDebugInfo | null>(null)
  const [isCliDetailsOpen, setIsCliDetailsOpen] = useState(false)
  const [isCliTestOpen, setIsCliTestOpen] = useState(false)
  const [isCliDebugLoading, setIsCliDebugLoading] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const result = await databaseCliStatusGet()
        setCliStatus(result)
      } catch (error) {
        logger.error("Failed to load CLI status.", error)
        setCliStatus({
          installed: false,
          path: "",
          executable: false,
          pathInShell: false,
          runtimeExists: false,
          bundledScriptExists: false,
          shimCurrent: false,
          available: false,
        })
      }
    })()
  }, [])

  const handleInstallCLI = useCallback(async () => {
    await promise(
      async () => {
        const result = await databaseCliInstall()
        if (!result.success) throw new Error(result.error ?? "安装失败")
        const status = await databaseCliStatusGet()
        setCliStatus(status)
        logger.info("CLI installed.", { available: status.available, path: status.path })
      },
      { loading: "正在安装 CLI...", success: "CLI 已安装" },
    )
  }, [promise])

  const refreshCliDebugInfo = useCallback(async () => {
    setIsCliDebugLoading(true)
    try {
      const result = await databaseCliDebugInfoGet()
      setCliDebugInfo(result)
      return result
    } catch (error) {
      logger.error("Failed to load CLI debug info.", error)
      setCliDebugInfo(null)
      return null
    } finally {
      setIsCliDebugLoading(false)
    }
  }, [])

  const handleOpenCliDetails = useCallback(() => {
    logger.info("CLI details dialog opened.")
    setIsCliDetailsOpen(true)
    void refreshCliDebugInfo()
  }, [refreshCliDebugInfo])

  const handleOpenCliTest = useCallback(() => {
    logger.info("CLI test dialog opened.")
    setIsCliTestOpen(true)
    void refreshCliDebugInfo()
  }, [refreshCliDebugInfo])

  const handleCopyCliDebugInfo = useCallback(() => {
    void promise(
      async () => {
        const debugInfo = cliDebugInfo ?? await refreshCliDebugInfo()
        if (!debugInfo) throw new Error("读取 CLI 调试信息失败。")
        await navigator.clipboard.writeText(formatCliDetailsForCopy(debugInfo))
      },
      {
        loading: "正在复制调试信息...",
        success: "调试信息已复制。",
        error: (error) => error instanceof Error ? error.message : "复制失败。",
      },
    )
  }, [cliDebugInfo, promise, refreshCliDebugInfo])

  const handleCopyCliTestCommand = useCallback(() => {
    void promise(
      async () => {
        const debugInfo = cliDebugInfo ?? await refreshCliDebugInfo()
        if (!debugInfo) throw new Error("读取 CLI 调试信息失败。")
        await navigator.clipboard.writeText(debugInfo.testCommand)
      },
      {
        loading: "正在复制测试命令...",
        success: "测试命令已复制。",
        error: (error) => error instanceof Error ? error.message : "复制失败。",
      },
    )
  }, [cliDebugInfo, promise, refreshCliDebugInfo])

  const handleExport = useCallback(async () => {
    await promise(
      async () => {
        const result = await databaseExport()
        if (!result.success) return
        logger.info("Database exported.", { path: result.path })
      },
      { loading: "正在导出...", success: "数据库已导出" },
    )
  }, [promise])

  const handleImport = useCallback(async () => {
    await promise(
      async () => {
        const result = await databaseImport()
        if (!result.success) return
        await refreshStatus()
        logger.info("Database imported.")
      },
      { loading: "正在导入...", success: "数据库已导入" },
    )
  }, [promise, refreshStatus])

  const handleOpenDbDirectory = useCallback(() => {
    if (!status?.dbDirectoryPath) return
    logger.info("Opening database directory.", { path: status.dbDirectoryPath })
    window.synapse?.shell.showItemInFolder(status.dbDirectoryPath)
  }, [status?.dbDirectoryPath])

  return (
    <div className="flex flex-col gap-4">
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

      <Card>
        <CardHeader className="pb-0">
          <CardTitle>CLI</CardTitle>
          <CardAction>
            {cliStatus == null ? (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <StatusPill
                active={Boolean(cliStatus.available)}
                activeLabel="可用"
                inactiveLabel={cliStatus.installed ? "不可用" : "未安装"}
              />
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StatusRow
            label="Shell 可用"
            value={
              cliStatus == null
                ? "—"
                : cliStatus.available
                  ? "是"
                  : cliStatus.installed
                    ? "否"
                    : "—"
            }
          />
          {cliStatus?.path ? (
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={cliStatus.path}
            >
              {cliStatus.path}
            </p>
          ) : null}
          {getCliIssueText(cliStatus) ? (
            <p className="text-sm text-muted-foreground">{getCliIssueText(cliStatus)}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleOpenCliDetails}>
              详细信息
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenCliTest}>
              测试
            </Button>
            <Button variant="outline" size="sm" onClick={handleInstallCLI}>
              {cliStatus?.installed ? "重新安装" : "安装 CLI"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle>数据管理</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
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
          <div className="flex items-start gap-4 text-sm">
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

      <Dialog open={isCliDetailsOpen} onOpenChange={setIsCliDetailsOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>CLI 详细信息</DialogTitle>
            <DialogDescription>
              这里会显示当前环境下 CLI 安装、PATH 和运行时的调试信息。
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] w-full">
            <div className="flex min-w-0 flex-col gap-4 pr-4">
              <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                <DetailField label="状态" value={getCliStatusLabel(cliDebugInfo?.status ?? null)} />
                <DetailField label="平台" value={cliDebugInfo?.platform ?? "—"} />
                <DetailField label="Shell" value={cliDebugInfo?.shell || "—"} />
                <DetailField
                  label="测试命令"
                  value={<code className="font-mono text-xs">{cliDebugInfo?.testCommand ?? "synapse help"}</code>}
                />
              </div>

              <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-3">
                <DetailField
                  label="脚本最新"
                  value={cliDebugInfo?.status.shimCurrent ? "是" : cliDebugInfo ? "否" : "—"}
                />
                <DetailField
                  label="脚本已就绪"
                  value={cliDebugInfo?.status.bundledScriptExists ? "是" : cliDebugInfo ? "否" : "—"}
                />
              </div>

              <Separator />

              <div className="grid min-w-0 gap-3">
                <DetailField
                  label="CLI 路径"
                  value={<code className="font-mono text-xs">{cliDebugInfo?.status.path ?? "—"}</code>}
                />
                <DetailField
                  label="已安装路径"
                  value={<code className="font-mono text-xs">{cliDebugInfo?.installedPath ?? "—"}</code>}
                />
                <DetailField
                  label="目标路径"
                  value={<code className="font-mono text-xs">{cliDebugInfo?.preferredInstallPath ?? "—"}</code>}
                />
                <DetailField
                  label="运行时"
                  value={<code className="font-mono text-xs">{cliDebugInfo?.runtimePath ?? "—"}</code>}
                />
                <DetailField
                  label="脚本入口"
                  value={<code className="font-mono text-xs">{cliDebugInfo?.bundledScriptPath ?? "—"}</code>}
                />
              </div>

              <Separator />

              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-sm font-medium">完整调试信息</p>
                <pre className="w-full max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs text-foreground">
                  {isCliDebugLoading && !cliDebugInfo ? "正在读取..." : cliDebugInfo ? formatCliDebugInfo(cliDebugInfo) : "暂无数据"}
                </pre>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => void refreshCliDebugInfo()}>
              刷新
            </Button>
            <Button onClick={handleCopyCliDebugInfo}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isCliTestOpen} onOpenChange={setIsCliTestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>测试 CLI</DialogTitle>
            <DialogDescription>
              在你自己的终端里运行下面这条命令。如果 CLI 已正确安装，你会看到 `synapse` 的帮助信息。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-muted p-3">
              <code className="font-mono text-sm text-foreground">
                {cliDebugInfo?.testCommand ?? "synapse help"}
              </code>
            </div>
            <p className="text-sm text-muted-foreground">
              如果终端提示找不到 `synapse`，或者在 Windows 上提示“不是内部或外部命令”，通常说明 PATH 还没有生效。
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCopyCliTestCommand}>
              <Copy data-icon="inline-start" />
              复制命令
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export { DatabaseSettingsPanel }
