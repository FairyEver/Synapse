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
import { StatusPill } from "@/modules/settings/components/status-pill"
import type { McpRegistrationInfo, McpServerStatus, McpTarget } from "@/types/mcp"
import {
  mcpRegistrationOpenSettings,
  mcpRegistrationRegister,
  mcpRegistrationsList,
  mcpServerGet,
} from "../hooks/use-mcp"

const logger = createRendererLogger("mcp")

const MCP_SERVER_META = mcpDefinitions.map((definition) => ({
  id: definition.target,
  label: definition.label,
  icon: definition.icon,
}))

function McpSettingsPanel() {
  const { promise, notify } = useAppNotifications()
  const [registrationsByTarget, setRegistrationsByTarget] = useState<
    Partial<Record<McpTarget, McpRegistrationInfo>>
  >({})
  const [serverStatus, setServerStatus] = useState<McpServerStatus | null>(null)
  const [serverStatusLoading, setServerStatusLoading] = useState(true)
  const [serverStatusError, setServerStatusError] = useState<string | null>(null)
  const [registrationsLoading, setRegistrationsLoading] = useState(true)

  const refreshServerStatus = useCallback(async () => {
    setServerStatusLoading(true)
    setServerStatusError(null)
    try {
      const status = await mcpServerGet()
      setServerStatus(status)
    } catch (error) {
      logger.error("Failed to load MCP HTTP status.", error)
      setServerStatus(null)
      setServerStatusError("状态读取失败")
    } finally {
      setServerStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshServerStatus()
  }, [refreshServerStatus])

  const serverStatusLabel = serverStatusError
    ? "状态读取失败"
    : serverStatusLoading
      ? "检测中"
      : serverStatus?.running
        ? "运行中"
        : "未启动"

  const refreshRegistrations = useCallback(async () => {
    setRegistrationsLoading(true)
    try {
      const result = await mcpRegistrationsList()
      setRegistrationsByTarget(
        result.reduce<Partial<Record<McpTarget, McpRegistrationInfo>>>((registrations, registration) => {
          registrations[registration.target] = registration
          return registrations
        }, {}),
      )
      return result
    } finally {
      setRegistrationsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshRegistrations().catch((error) => {
      logger.error("Failed to load MCP registrations.", error)
      setRegistrationsByTarget({})
      setRegistrationsLoading(false)
    })
  }, [refreshRegistrations])

  const handleRegisterMcp = useCallback(
    async (target: McpTarget) => {
      try {
        await promise(
          async () => {
            const result = await mcpRegistrationRegister(target)
            if (!result.success) throw new Error(result.error ?? "注册失败")
            await refreshRegistrations()
            logger.info("MCP registered.", { target })
          },
          {
            trackingName: "settings.mcp.register",
            loading: "正在注册 MCP...",
            success: `MCP Server 已注册到 ${MCP_SERVER_META.find((item) => item.id === target)?.label ?? target}`,
          },
        )
      } catch {
        // promise() re-throws on error — catch to prevent unhandled rejection.
      }
    },
    [promise, refreshRegistrations],
  )

  const handleOpenSettings = useCallback(
    async (target: McpTarget) => {
      try {
        await promise(
          async () => {
            const result = await mcpRegistrationOpenSettings(target)
            if (!result.success) throw new Error(result.error ?? "打开失败")
            logger.info("MCP settings opened.", { target })
          },
          {
            trackingName: "settings.mcp.open-settings",
            loading: "正在打开配置文件...",
            success: null,
            error: (error) => error instanceof Error ? error.message : "打开失败。",
          },
        )
      } catch {
        // promise() re-throws on error — catch to prevent unhandled rejection.
      }
    },
    [promise],
  )

  const registrations = MCP_SERVER_META.map((server) => {
    const state = registrationsByTarget[server.id]
    return {
      ...server,
      registered: Boolean(state?.registered),
      settingsFileExists: Boolean(state?.settingsFileExists),
      mode: state?.mode ?? null,
      readError: state?.readError,
    }
  })
  const registrationDisabled = !serverStatus?.running || !serverStatus?.url

  const handleCopyMcpUrl = useCallback(async () => {
    if (!serverStatus?.url) return
    try {
      await navigator.clipboard.writeText(serverStatus.url)
    } catch {
      notify({ message: "复制失败", tone: "destructive" })
    }
  }, [notify, serverStatus])

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle>MCP Server</CardTitle>
        <CardAction>
          <StatusPill
            active={Boolean(serverStatus?.running)}
            activeLabel={serverStatusLabel}
            inactiveLabel={serverStatusLabel}
            variant={serverStatusError || serverStatusLoading ? "warning" : "default"}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {serverStatusError ? (
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>{serverStatusError}</span>
            <Button variant="outline" size="sm" onClick={() => void refreshServerStatus()}>
              重试
            </Button>
          </div>
        ) : null}
        {serverStatus?.url ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              {serverStatus.url}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopyMcpUrl}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
          </div>
        ) : null}
        <Separator />
        {registrationsLoading ? <Skeleton className="h-10 w-full" /> : null}
        {registrations.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <img
                src={server.icon}
                alt={server.label}
                className="size-5 shrink-0 clip-path-[inset(6%)]"
              />
              <span className="truncate text-sm">{server.label}</span>
              {registrationsLoading ? (
                <span className="text-xs text-muted-foreground">检测中...</span>
              ) : server.readError ? (
                <StatusPill active={false} activeLabel="" inactiveLabel="配置读取失败" variant="warning" />
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
                onClick={() => handleOpenSettings(server.id)}
              >
                打开文件
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(server.readError) || registrationDisabled}
                onClick={() => handleRegisterMcp(server.id)}
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
