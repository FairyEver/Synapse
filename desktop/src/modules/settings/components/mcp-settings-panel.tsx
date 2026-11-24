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

const MCP_ICON_BY_TARGET = new Map<string, string>(
  MCP_SERVER_META.map((definition) => [definition.id, definition.icon]),
)

type McpRegistrationRow = {
  id: McpTarget
  label: string
  icon: string | undefined
  registered: boolean
  settingsFileExists: boolean
  mode: "http" | "stdio" | null
  readError?: string
}

function buildRegistrationRows(registrationList: McpRegistrationInfo[]): McpRegistrationRow[] {
  const stateByTarget = new Map<string, McpRegistrationInfo>(
    registrationList.map((registration) => [registration.target, registration]),
  )
  const staticTargets = new Set<string>(MCP_SERVER_META.map((server) => server.id))
  const dynamicRegistrations = registrationList.filter((registration) => !staticTargets.has(registration.target))
  const insertedDynamicTargets = new Set<string>()
  const rows: McpRegistrationRow[] = []

  const toDynamicRow = (registration: McpRegistrationInfo): McpRegistrationRow => ({
    id: registration.target,
    label: registration.label ?? registration.target,
    icon: MCP_ICON_BY_TARGET.get(registration.iconTarget ?? registration.target),
    registered: registration.registered,
    settingsFileExists: registration.settingsFileExists,
    mode: registration.mode,
    readError: registration.readError,
  })

  for (const server of MCP_SERVER_META) {
    const state = stateByTarget.get(server.id)
    rows.push({
      id: server.id,
      label: server.label,
      icon: server.icon,
      registered: Boolean(state?.registered),
      settingsFileExists: Boolean(state?.settingsFileExists),
      mode: state?.mode ?? null,
      readError: state?.readError,
    })

    for (const dynamic of dynamicRegistrations) {
      if (dynamic.iconTarget === server.id && !insertedDynamicTargets.has(dynamic.target)) {
        insertedDynamicTargets.add(dynamic.target)
        rows.push(toDynamicRow(dynamic))
      }
    }
  }

  for (const dynamic of dynamicRegistrations) {
    if (!insertedDynamicTargets.has(dynamic.target)) {
      rows.push(toDynamicRow(dynamic))
    }
  }

  return rows
}

function McpSettingsPanel() {
  const { promise, notify } = useAppNotifications()
  const [registrationList, setRegistrationList] = useState<McpRegistrationInfo[]>([])
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
      setRegistrationList(result)
      return result
    } finally {
      setRegistrationsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshRegistrations().catch((error) => {
      logger.error("Failed to load MCP registrations.", error)
      setRegistrationList([])
      setRegistrationsLoading(false)
    })
  }, [refreshRegistrations])

  const registrations = buildRegistrationRows(registrationList)

  const handleRegisterMcp = useCallback(
    async (target: McpTarget, label: string) => {
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
            success: `MCP Server 已注册到 ${label}`,
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
            <Button variant="outline" size="default" onClick={() => void refreshServerStatus()}>
              重试
            </Button>
          </div>
        ) : null}
        {serverStatus?.url ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              {serverStatus.url}
            </code>
            <Button variant="outline" size="default" onClick={handleCopyMcpUrl}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
          </div>
        ) : null}
        <Separator />
        {registrationsLoading ? <Skeleton className="h-10 w-full" /> : null}
        <ul role="list" className="flex flex-col gap-2">
          {registrations.map((server) => {
            const registerActionLabel = server.registered ? "重新注册" : "注册"
            return (
              <li
                key={server.id}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {server.icon ? (
                    <img
                      src={server.icon}
                      alt=""
                      className="size-5 shrink-0 clip-path-[inset(6%)]"
                    />
                  ) : null}
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
                    size="default"
                    disabled={!server.settingsFileExists}
                    aria-label={`打开文件：${server.label}`}
                    onClick={() => handleOpenSettings(server.id)}
                  >
                    打开文件
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    disabled={Boolean(server.readError) || registrationDisabled}
                    aria-label={`${registerActionLabel}：${server.label}`}
                    onClick={() => handleRegisterMcp(server.id, server.label)}
                  >
                    {registerActionLabel}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export { McpSettingsPanel }
