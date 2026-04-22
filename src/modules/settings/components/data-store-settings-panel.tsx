import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { SettingsGroup } from "./settings-group"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import {
  exportDB,
  importDB,
  installCLI,
  registerMCP,
  useDataStoreStatus,
} from "@/modules/data-store/hooks/use-data-store"
import { requireSynapseBridge } from "@/lib/electron-bridge"

const logger = createRendererLogger("settings.data-store")

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DataStoreSettingsPanel() {
  const { status, refresh: refreshStatus } = useDataStoreStatus()
  const { promise } = useAppNotifications()
  const [cliStatus, setCliStatus] = useState<{ installed: boolean; path: string } | null>(null)
  const [mcpStatus, setMcpStatus] = useState<{ claude: boolean; codex: boolean } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const result = await requireSynapseBridge().dataStore.installCLI()
        setCliStatus({ installed: result.success, path: result.path ?? "" })
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

  return (
    <div className="flex flex-col gap-4">
      <SettingsGroup>
        <div>
          <h3 className="mb-3 text-sm font-semibold">服务状态</h3>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">HTTP 端口</span>
              <span className="flex items-center gap-2">
                {status?.port ?? "—"}
                {status?.running ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-600">
                    <span className="size-1.5 rounded-full bg-green-500" />
                    运行中
                  </span>
                ) : null}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">数据库大小</span>
              <span>{status ? formatBytes(status.dbSize) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">表数量</span>
              <span>{status?.tableCount ?? "—"}</span>
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div>
          <h3 className="mb-3 text-sm font-semibold">CLI</h3>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">安装状态</span>
              <span>{cliStatus?.installed ? "✓ 已安装" : "✗ 未安装"}</span>
            </div>
            {cliStatus?.path ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">路径</span>
                <span className="font-mono text-xs">{cliStatus.path}</span>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleInstallCLI}>
                {cliStatus?.installed ? "重新安装 CLI" : "安装 CLI"}
              </Button>
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div>
          <h3 className="mb-3 text-sm font-semibold">MCP Server</h3>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Claude Code</span>
              <div className="flex items-center gap-2">
                <span>{mcpStatus?.claude ? "✓ 已注册" : "✗ 未注册"}</span>
                <Button variant="outline" size="sm" onClick={() => handleRegisterMCP("claude")}>
                  {mcpStatus?.claude ? "重新注册" : "注册"}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Codex</span>
              <div className="flex items-center gap-2">
                <span>{mcpStatus?.codex ? "✓ 已注册" : "✗ 未注册"}</span>
                <Button variant="outline" size="sm" onClick={() => handleRegisterMCP("codex")}>
                  {mcpStatus?.codex ? "重新注册" : "注册"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div>
          <h3 className="mb-3 text-sm font-semibold">数据管理</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={handleExport}>
                导出数据库
              </Button>
              <Button variant="outline" size="sm" onClick={handleImport}>
                导入数据库
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              ⚠ 导入将替换当前所有数据，请先导出备份
            </p>
          </div>
        </div>
      </SettingsGroup>
    </div>
  )
}

export { DataStoreSettingsPanel }
