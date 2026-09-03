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
  readonly probeDesktopServer?: () => Promise<DesktopServerProbeResult | boolean>
}

export type DesktopServerProbeResult = {
  readonly ok: boolean
  readonly errorMessage?: string
  readonly stage?: "transport" | "initialize" | "tools"
  readonly toolCount?: number
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
    const connecting = {
      ...current,
      endpoint: FIGMA_ENDPOINT,
      authType: "none" as const,
      status: "connecting" as const,
      errorMessage: undefined,
      updatedAt: now(),
    }
    await deps.items.upsert(connecting)
    await emit()

    let probe: DesktopServerProbeResult
    try {
      const result = await (deps.probeDesktopServer ?? probeFigmaDesktopServer)()
      probe = typeof result === "boolean"
        ? { ok: result, ...(!result ? { errorMessage: "未检测到 Figma Desktop MCP，请先在 Figma Dev Mode 中开启 MCP Server。" } : {}) }
        : result
    } catch (error) {
      deps.logger.warn("Figma Desktop MCP probe failed.", {
        boundary: "connectors.figma.probe",
        stage: "transport",
        errorMessage: error instanceof Error ? error.message : "unknown error",
      })
      probe = { ok: false, stage: "transport" }
    }
    if (!probe.ok) {
      const unavailable = {
        ...connecting,
        endpoint: FIGMA_ENDPOINT,
        authType: "none" as const,
        status: "error" as const,
        errorMessage: probe.errorMessage ?? "Figma Desktop MCP 未完成连接。请打开 Figma 文件，并在 Dev Mode 中重启 MCP Server 后重试。",
        updatedAt: now(),
      }
      await deps.items.upsert(unavailable)
      await emit()
      deps.logger.warn("Figma Desktop MCP is not ready.", {
        boundary: "connectors.figma.probe",
        stage: probe.stage ?? "transport",
        toolCount: probe.toolCount ?? 0,
      })
      throw new Error(unavailable.errorMessage)
    }

    const connected = {
      ...connecting,
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

export async function probeFigmaDesktopServer(): Promise<DesktopServerProbeResult> {
  const timeoutMs = 4_000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const initialized = await mcpRequest(controller.signal, {
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Synapse", version: "1.0.0" },
      },
    })
    const sessionId = initialized.sessionId
    if (!sessionId || !initialized.result || typeof initialized.result !== "object") {
      return { ok: false, stage: "initialize", errorMessage: "Figma Desktop MCP 返回了无效的初始化响应。请重启 Figma 的 MCP Server。" }
    }

    await mcpRequest(controller.signal, {
      method: "notifications/initialized",
      params: {},
      sessionId,
      allowEmpty: true,
    })
    const tools = await mcpRequest(controller.signal, {
      id: 2,
      method: "tools/list",
      params: {},
      sessionId,
    })
    const toolList = tools.result && typeof tools.result === "object" && "tools" in tools.result
      ? (tools.result as { tools?: unknown }).tools
      : undefined
    if (!Array.isArray(toolList)) {
      return { ok: false, stage: "tools", errorMessage: "Figma Desktop MCP 未返回工具列表。请确认已打开 Figma 文件后重启 MCP Server。" }
    }
    return { ok: true, toolCount: toolList.length }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError"
    return {
      ok: false,
      stage: timedOut ? "tools" : "transport",
      errorMessage: timedOut
        ? "Figma Desktop MCP 工具加载超时。请确认已打开 Figma 文件，并在 Dev Mode 中重启 MCP Server。"
        : "未检测到可用的 Figma Desktop MCP。请在 Figma Dev Mode 中开启 MCP Server。",
    }
  } finally {
    clearTimeout(timeout)
  }
}

type McpRequest = {
  readonly id?: number
  readonly method: string
  readonly params: Record<string, unknown>
  readonly sessionId?: string
  readonly allowEmpty?: boolean
}

async function mcpRequest(signal: AbortSignal, request: McpRequest): Promise<{ readonly result?: unknown; readonly sessionId?: string }> {
  const response = await fetch(FIGMA_ENDPOINT, {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18",
      ...(request.sessionId ? { "Mcp-Session-Id": request.sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(request.id === undefined ? {} : { id: request.id }), method: request.method, params: request.params }),
  })
  if (!response.ok) {
    if (request.allowEmpty && response.status === 202) return { sessionId: request.sessionId }
    throw new Error(`MCP HTTP ${response.status}`)
  }
  if (request.allowEmpty && response.status === 202) return { sessionId: request.sessionId }
  const body = await response.text()
  const payload = parseMcpPayload(body)
  if (!payload || typeof payload !== "object" || "error" in payload) throw new Error("Invalid MCP response")
  return { result: (payload as { result?: unknown }).result, sessionId: response.headers.get("mcp-session-id") ?? request.sessionId }
}

function parseMcpPayload(body: string): unknown {
  const trimmed = body.trim()
  if (!trimmed) return undefined
  try { return JSON.parse(trimmed) }
  catch { /* Streamable HTTP may return one or more SSE data frames. */ }
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue
    try { return JSON.parse(line.slice(5).trim()) }
    catch { continue }
  }
  return undefined
}

function toPublic(item: ConnectorItemEntryV1): ConnectorItem { return { ...item } }
