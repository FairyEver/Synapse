import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { Options } from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import type { ConnectorCredentialEntryV1, ConnectorItemEntryV1 } from "../../../electron/runtime/data-repo/schemas/connectors"
import type { ConnectorItem } from "../shared/schema"

const FIGMA_ID = "figma"
const FIGMA_ENDPOINT = "http://127.0.0.1:3845/mcp"
const FIGMA_DESCRIPTION = "连接 Figma Desktop MCP"

export type ConnectorServiceDeps = {
  readonly items: DataNamespace<ConnectorItemEntryV1>
  readonly credentials: DataNamespace<ConnectorCredentialEntryV1>
  readonly logger: { warn(message: string, meta?: Record<string, unknown>): void }
  readonly probeDesktopServer?: () => Promise<boolean>
}

type ConnectorEvents = { changed: [payload: { items: ConnectorItem[] }] }

export function createConnectorsService(deps: ConnectorServiceDeps) {
  const listeners = new Set<(payload: ConnectorEvents["changed"][0]) => void>()

  const now = () => new Date().toISOString()
  const emit = async () => {
    const items = (await deps.items.list()).sort((a, b) => a.name.localeCompare(b.name)).map(toPublic)
    for (const listener of listeners) listener({ items })
  }

  async function initialize() {
    const existing = await deps.items.get(FIGMA_ID)
    if (!existing) {
      const timestamp = now()
      await deps.items.upsert({
        id: FIGMA_ID,
        schemaVersion: 1,
        providerKey: FIGMA_ID,
        name: "Figma",
        description: FIGMA_DESCRIPTION,
        endpoint: FIGMA_ENDPOINT,
        authType: "none",
        status: "available",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    } else {
      // Figma Desktop MCP is local and does not persist an OAuth session. Reset
      // stale remote/OAuth metadata when upgrading an existing connector row.
      await deps.items.upsert({
        ...existing,
        description: FIGMA_DESCRIPTION,
        endpoint: FIGMA_ENDPOINT,
        authType: "none",
        status: "available",
        accountLabel: undefined,
        errorMessage: undefined,
        updatedAt: now(),
      })
    }
  }

  async function list() { return { items: (await deps.items.list()).sort((a, b) => a.name.localeCompare(b.name)).map(toPublic) } }

  async function connect(id: string): Promise<ConnectorItem> {
    if (id !== FIGMA_ID) throw new Error("不支持的连接器。")
    const current = await requireItem(id)
    const reachable = await (deps.probeDesktopServer ?? probeFigmaDesktopServer)()
    if (!reachable) {
      const unavailable = {
        ...current,
        endpoint: FIGMA_ENDPOINT,
        authType: "none" as const,
        status: "error" as const,
        errorMessage: "未检测到 Figma Desktop MCP，请先在 Figma Dev Mode 中开启 MCP Server。",
        updatedAt: now(),
      }
      await deps.items.upsert(unavailable)
      await emit()
      throw new Error(unavailable.errorMessage)
    }

    const connected = {
      ...current,
      description: FIGMA_DESCRIPTION,
      endpoint: FIGMA_ENDPOINT,
      authType: "none" as const,
      status: "connected" as const,
      errorMessage: undefined,
      lastConnectedAt: now(),
      updatedAt: now(),
    }
    await deps.items.upsert(connected)
    await emit()
    return toPublic(connected)
  }

  async function disconnect(id: string) {
    const current = await requireItem(id)
    await deps.items.upsert({ ...current, status: "available", accountLabel: undefined, errorMessage: undefined, updatedAt: now() })
    await emit()
  }

  async function getMcpServers(): Promise<NonNullable<Options["mcpServers"]>> {
    const item = await deps.items.get(FIGMA_ID)
    if (!item || item.status !== "connected") return {}
    return { figma: { type: "http", url: item.endpoint } }
  }

  function onChanged(listener: (payload: ConnectorEvents["changed"][0]) => void) { listeners.add(listener); return () => listeners.delete(listener) }
  async function requireItem(id: string): Promise<ConnectorItemEntryV1> {
    const item = await deps.items.get(id)
    if (!item) throw new Error("连接器不存在。")
    return item
  }
  return { initialize, list, connect, disconnect, getMcpServers, onChanged }
}

async function probeFigmaDesktopServer(): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await fetch(FIGMA_ENDPOINT, { method: "GET", signal: controller.signal })
    return response.status !== 404 && response.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function toPublic(item: ConnectorItemEntryV1): ConnectorItem { return { ...item } }
