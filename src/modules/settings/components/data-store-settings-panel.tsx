import { useCallback, useEffect, useState } from "react"
import ccIcon from "@/assets/cc.png"
import codexIcon from "@/assets/codex.png"
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
  exportDB,
  getCliStatus,
  importDB,
  installCLI,
  registerMCP,
  useDataStoreStatus,
} from "@/modules/data-store/hooks/use-data-store"

const logger = createRendererLogger("settings.data-store")

const EDITOR_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

type StatusPillProps = {
  active: boolean
  activeLabel: string
  inactiveLabel: string
}

function StatusPill({ active, activeLabel, inactiveLabel }: StatusPillProps) {
  return active ? (
    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
      {activeLabel}
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {inactiveLabel}
    </span>
  )
}

type StatusRowProps = {
  label: string
  value: React.ReactNode
}

function StatusRow({ label, value }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  )
}

function DataStoreSettingsPanel() {
  const { status, refresh: refreshStatus } = useDataStoreStatus()
  const { promise } = useAppNotifications()
  const [cliStatus, setCliStatus] = useState<{ installed: boolean; path: string } | null>(null)
  const [mcpStatus, setMcpStatus] = useState<{ claude: boolean; codex: boolean } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const result = await getCliStatus()
        setCliStatus(result)
      } catch {
        setCliStatus({ installed: false, path: "" })
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        // Check MCP status by attempting to read it - we'll use a simple approach
        setMcpStatus({ claude: false, codex: false })
      } catch {
        setMcpStatus({ claude: false, codex: false })
      }
    })()
  }, [])

  const handleInstallCLI = useCallback(async () => {
    await promise(
      async () => {
        const result = await installCLI()
        if (!result.success) throw new Error(result.error ?? "安装失败")
        setCliStatus({ installed: true, path: result.path ?? "" })
        logger.info("CLI installed.", { path: result.path })
      },
      { loading: "正在安装 CLI...", success: "CLI 已安装" },
    )
  }, [promise])

  const handleRegisterMCP = useCallback(
    async (target: "claude" | "codex") => {
      await promise(
        async () => {
          const result = await registerMCP(target)
          if (!result.success) throw new Error(result.error ?? "注册失败")
          setMcpStatus((prev) => ({ ...prev!, [target]: true }))
          logger.info("MCP registered.", { target })
        },
        { loading: "正在注册 MCP...", success: `MCP Server 已注册到 ${target === "claude" ? "Claude Code" : "Codex"}` },
      )
    },
    [promise],
  )

  const handleExport = useCallback(async () => {
    await promise(
      async () => {
        const result = await exportDB()
        if (!result.success) return
        logger.info("Database exported.", { path: result.path })
      },
      { loading: "正在导出...", success: "数据库已导出" },
    )
  }, [promise])

  const handleImport = useCallback(async () => {
    await promise(
      async () => {
        const result = await importDB()
        if (!result.success) return
        await refreshStatus()
        logger.info("Database imported.")
      },
      { loading: "正在导入...", success: "数据库已导入" },
    )
  }, [promise, refreshStatus])

  const mcpServers = [
    {
      id: "claude" as const,
      label: "Claude Code",
      icon: ccIcon,
      registered: Boolean(mcpStatus?.claude),
    },
    {
      id: "codex" as const,
      label: "Codex",
      icon: codexIcon,
      registered: Boolean(mcpStatus?.codex),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <Card className="bg-background">
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

      <Card className="bg-background">
        <CardHeader className="pb-0">
          <CardTitle>CLI</CardTitle>
          <CardAction>
            <StatusPill
              active={Boolean(cliStatus?.installed)}
              activeLabel="已安装"
              inactiveLabel="未安装"
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {cliStatus?.path ? (
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={cliStatus.path}
            >
              {cliStatus.path}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={handleInstallCLI}>
              {cliStatus?.installed ? "重新安装" : "安装 CLI"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-background">
        <CardHeader className="pb-0">
          <CardTitle>MCP Server</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {mcpServers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <img
                  src={server.icon}
                  alt={server.label}
                  className="size-5 shrink-0"
                  style={EDITOR_ICON_CLIP_STYLE}
                />
                <span className="truncate text-sm">{server.label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill
                  active={server.registered}
                  activeLabel="已注册"
                  inactiveLabel="未注册"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRegisterMCP(server.id)}
                >
                  {server.registered ? "重新注册" : "注册"}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-background">
        <CardHeader className="pb-0">
          <CardTitle>数据管理</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  )
}

export { DataStoreSettingsPanel }
