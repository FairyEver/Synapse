import { useCallback, useEffect, useState } from "react"
import { Copy } from "lucide-react"

import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { mcpDefinitions } from "@/definitions/generated/renderer-registry"
import { EDITOR_ICON_CLIP_STYLE } from "@/lib/editor-icons"
import {
  databaseMcpServersGet,
  databaseMcpHttpStatusGet,
  databaseMcpSettingsOpen,
  databaseMcpRegister,
} from "@/modules/database/hooks/use-database"
import { StatusPill } from "@/modules/settings/components/status-pill"
import type {
  DatabaseMcpHttpStatus,
  DatabaseMcpServerInfo,
  DatabaseMcpTarget,
} from "@/types/database"

const logger = createRendererLogger("settings.mcp")

const MCP_SERVER_META = mcpDefinitions.map((definition) => ({
  id: definition.target,
  label: definition.label,
  icon: definition.icon,
}))

function McpSettingsPanel() {
  const { promise } = useAppNotifications()
  const [mcpServersByTarget, setMcpServersByTarget] = useState<
    Partial<Record<DatabaseMcpTarget, DatabaseMcpServerInfo>>
  >({})
  const [mcpHttpStatus, setMcpHttpStatus] = useState<DatabaseMcpHttpStatus | null>(null)
  const [mcpServersLoading, setMcpServersLoading] = useState(true)

  useEffect(() => {
    void databaseMcpHttpStatusGet().then(setMcpHttpStatus).catch(() => setMcpHttpStatus(null))
  }, [])

  const refreshMcpServers = useCallback(async () => {
    setMcpServersLoading(true)
    const result = await databaseMcpServersGet()
    setMcpServersByTarget(
      result.reduce<Partial<Record<DatabaseMcpTarget, DatabaseMcpServerInfo>>>((servers, server) => {
        servers[server.target] = server
        return servers
      }, {}),
    )
    setMcpServersLoading(false)
    return result
  }, [])

  useEffect(() => {
    void refreshMcpServers().catch((error) => {
      logger.error("Failed to load MCP status.", error)
      setMcpServersByTarget({})
      setMcpServersLoading(false)
    })
  }, [refreshMcpServers])

  const handleRegisterMCP = useCallback(
    async (target: DatabaseMcpTarget) => {
      await promise(
        async () => {
          const result = await databaseMcpRegister(target)
          if (!result.success) throw new Error(result.error ?? "注册失败")
          await refreshMcpServers()
          logger.info("MCP registered.", { target })
        },
        {
          loading: "正在注册 MCP...",
          success: `MCP Server 已注册到 ${MCP_SERVER_META.find((m) => m.id === target)?.label ?? target}`,
        },
      )
    },
    [promise, refreshMcpServers],
  )

  const handleOpenMCPSettings = useCallback(
    async (target: DatabaseMcpTarget) => {
      await promise(
        async () => {
          const result = await databaseMcpSettingsOpen(target)
          if (!result.success) throw new Error(result.error ?? "打开失败")
          logger.info("MCP settings opened.", { target })
        },
        {
          loading: "正在打开配置文件...",
          success: null,
          error: (error) => error instanceof Error ? error.message : "打开失败。",
        },
      )
    },
    [promise],
  )

  const mcpServers = MCP_SERVER_META.map((server) => {
    const state = mcpServersByTarget[server.id]
    return {
      ...server,
      registered: Boolean(state?.registered),
      settingsFileExists: Boolean(state?.settingsFileExists),
      mode: state?.mode ?? null,
    }
  })

  const handleCopyMcpUrl = useCallback(() => {
    if (!mcpHttpStatus?.url) return
    void navigator.clipboard.writeText(mcpHttpStatus.url)
  }, [mcpHttpStatus])

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>MCP Server</CardTitle>
        <CardAction>
          <StatusPill
            active={Boolean(mcpHttpStatus?.running)}
            activeLabel="运行中"
            inactiveLabel="未启动"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mcpHttpStatus?.url ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              {mcpHttpStatus.url}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopyMcpUrl}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
          </div>
        ) : null}
        <Separator />
        {mcpServersLoading ? <Skeleton className="h-10 w-full" /> : null}
        {mcpServers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <img
                src={server.icon}
                alt={server.label}
                className="size-5 shrink-0"
                style={EDITOR_ICON_CLIP_STYLE}
              />
              <span className="truncate text-sm">{server.label}</span>
              {mcpServersLoading ? (
                <span className="text-xs text-muted-foreground">检测中...</span>
              ) : server.registered && server.mode === "http" ? (
                <StatusPill active activeLabel="已注册" inactiveLabel="" />
              ) : server.registered && server.mode === "stdio" ? (
                <StatusPill active activeLabel="需更新" inactiveLabel="" variant="warning" />
              ) : (
                <StatusPill active={false} activeLabel="" inactiveLabel="未注册" />
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!server.settingsFileExists}
                onClick={() => handleOpenMCPSettings(server.id)}
              >
                打开文件
              </Button>
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
  )
}

export { McpSettingsPanel }
