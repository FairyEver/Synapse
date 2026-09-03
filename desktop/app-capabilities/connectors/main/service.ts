import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  ConnectorItemEntryV1,
  ConnectorLocalStateV1,
  ConnectorProbeErrorCodeV1,
  ConnectorStateStoreV1,
} from "../../../electron/runtime/data-repo/schemas/connectors"
import type { ConnectorItem } from "../shared/schema"
import { builtinConnectors } from "./definitions"
import type { ConnectorDriverRegistry } from "./driver-registry"
import type { AgentContribution, BuiltinConnectorDefinition, ProbeResult } from "./types"

export type ConnectorServiceDeps = {
  readonly state: DataNamespace<ConnectorStateStoreV1>
  readonly legacyItems: DataNamespace<ConnectorItemEntryV1>
  readonly drivers: ConnectorDriverRegistry
  readonly definitions?: readonly BuiltinConnectorDefinition[]
  readonly logger: { warn(message: string, meta?: Record<string, unknown>): void }
  readonly now?: () => Date
}

type ConnectorEvents = { changed: [payload: { items: ConnectorItem[] }] }

export function createConnectorsService(deps: ConnectorServiceDeps) {
  const definitions = deps.definitions ?? builtinConnectors
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))
  const listeners = new Set<(payload: ConnectorEvents["changed"][0]) => void>()
  const probingIds = new Set<string>()
  const now = () => (deps.now ?? (() => new Date()))().toISOString()

  if (definitionsById.size !== definitions.length) throw new Error("Builtin connector ids must be unique.")

  async function initialize(): Promise<void> {
    const existing = await deps.state.getSingleton()
    if (!existing) await deps.state.setSingleton(await migrateLegacyState())
    await removeMigratedLegacyFigmaItem()
  }

  async function list(): Promise<{ items: ConnectorItem[] }> {
    const store = await readState()
    return {
      items: definitions
        .map((definition) => toPublic(definition, store.connectors[definition.id], probingIds.has(definition.id)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  async function connect(id: string): Promise<ConnectorItem> {
    const definition = requireDefinition(id)
    probingIds.add(id)
    await emit()

    try {
      let result: ProbeResult
      try {
        result = await deps.drivers.resolve(definition).probe(definition)
      } catch {
        result = { ok: false as const, errorCode: "transport_error" as const }
      }
      if (!result.ok) {
        await updateConnectorState(id, {
          enabled: false,
          lastProbe: { at: now(), status: "failed", errorCode: result.errorCode },
        })
        deps.logger.warn("Connector probe failed.", {
          boundary: "connectors.probe",
          connectorId: id,
          errorCode: result.errorCode,
        })
        throw new Error(probeErrorMessage(definition, result.errorCode))
      }

      await updateConnectorState(id, {
        enabled: true,
        lastProbe: { at: now(), status: "success" },
      })
    } finally {
      probingIds.delete(id)
      await emit()
    }

    return currentPublicItem(definition)
  }

  async function disconnect(id: string): Promise<void> {
    requireDefinition(id)
    const store = await readState()
    await updateConnectorState(id, {
      ...(store.connectors[id] ?? { enabled: false }),
      enabled: false,
    })
    await emit()
  }

  async function getEnabledConnectorIds(): Promise<string[]> {
    const store = await readState()
    return definitions
      .filter((definition) => store.connectors[definition.id]?.enabled === true)
      .map((definition) => definition.id)
  }

  function createAgentContribution(connectorIds: readonly string[]): AgentContribution {
    const mcpServers: AgentContribution["mcpServers"][number][] = []
    const skillPackageIds = new Set<string>()
    const serverNames = new Set<string>()

    for (const id of new Set(connectorIds)) {
      const definition = requireDefinition(id)
      const contribution = deps.drivers.resolve(definition).createAgentContribution(definition)
      for (const server of contribution.mcpServers) {
        if (serverNames.has(server.name)) throw new Error(`Duplicate connector MCP server name: ${server.name}`)
        serverNames.add(server.name)
        mcpServers.push(server)
      }
      for (const skillPackageId of contribution.skillPackageIds) skillPackageIds.add(skillPackageId)
    }

    return { mcpServers, skillPackageIds: [...skillPackageIds] }
  }

  function onChanged(listener: (payload: ConnectorEvents["changed"][0]) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  async function emit(): Promise<void> {
    const payload = await list()
    for (const listener of listeners) listener(payload)
  }

  async function currentPublicItem(definition: BuiltinConnectorDefinition): Promise<ConnectorItem> {
    const store = await readState()
    return toPublic(definition, store.connectors[definition.id], probingIds.has(definition.id))
  }

  async function updateConnectorState(id: string, state: ConnectorLocalStateV1): Promise<void> {
    const store = await readState()
    await deps.state.setSingleton({
      schemaVersion: 1,
      connectors: { ...store.connectors, [id]: state },
    })
  }

  async function readState(): Promise<ConnectorStateStoreV1> {
    return await deps.state.getSingleton() ?? { schemaVersion: 1, connectors: {} }
  }

  function requireDefinition(id: string): BuiltinConnectorDefinition {
    const definition = definitionsById.get(id)
    if (!definition) throw new Error("连接器不存在。")
    return definition
  }

  async function migrateLegacyState(): Promise<ConnectorStateStoreV1> {
    const definition = definitionsById.get("figma")
    const legacy = definition ? await deps.legacyItems.get(definition.id) : null
    if (!definition || !legacy || definition.integration.kind !== "mcp-streamable-http") {
      return { schemaVersion: 1, connectors: {} }
    }

    const matchesCurrentLocalDefinition = legacy.endpoint === definition.integration.endpoint
      && legacy.authType === "none"
    const enabled = matchesCurrentLocalDefinition && legacy.status === "connected"
    const lastProbe = enabled
      ? { at: legacy.lastConnectedAt ?? legacy.updatedAt, status: "success" as const }
      : legacy.status === "error"
        ? { at: legacy.updatedAt, status: "failed" as const, errorCode: "legacy_probe_failed" as const }
        : undefined
    return {
      schemaVersion: 1,
      connectors: { [definition.id]: { enabled, ...(lastProbe ? { lastProbe } : {}) } },
    }
  }

  async function removeMigratedLegacyFigmaItem(): Promise<void> {
    const legacy = await deps.legacyItems.get("figma")
    if (!legacy) return
    try {
      await deps.legacyItems.remove("figma")
    } catch (error) {
      deps.logger.warn("Failed to remove migrated connector state.", {
        boundary: "connectors.state.legacy-cleanup",
        connectorId: "figma",
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  }

  return {
    initialize,
    list,
    connect,
    disconnect,
    getEnabledConnectorIds,
    createAgentContribution,
    onChanged,
  }
}

function toPublic(
  definition: BuiltinConnectorDefinition,
  state: ConnectorLocalStateV1 | undefined,
  checking: boolean,
): ConnectorItem {
  const probeStatus = checking
    ? "checking" as const
    : state?.lastProbe?.status === "failed"
      ? "error" as const
      : state?.lastProbe?.status === "success"
        ? "ready" as const
        : "idle" as const
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    documentationUrl: definition.documentationUrl,
    enabled: state?.enabled ?? false,
    probeStatus,
    ...(state?.lastProbe?.status === "failed" && state.lastProbe.errorCode
      ? { errorMessage: probeErrorMessage(definition, state.lastProbe.errorCode) }
      : {}),
  }
}

function probeErrorMessage(
  definition: BuiltinConnectorDefinition,
  errorCode: ConnectorProbeErrorCodeV1,
): string {
  switch (errorCode) {
    case "invalid_endpoint": return `${definition.name} MCP 地址无效。`
    case "permission_denied": return `没有权限检测 ${definition.name} MCP。`
    case "probe_timeout": return `${definition.name} MCP 检测超时，请确认本机服务已启动。`
    case "initialize_failed": return `${definition.name} MCP 初始化失败，请重启本机服务后重试。`
    case "tools_list_failed": return `${definition.name} MCP 未返回工具列表，请重启本机服务后重试。`
    case "required_tools_missing": return `${definition.name} MCP 缺少必要工具，请更新或重启本机服务。`
    case "redirect_not_allowed": return `${definition.name} MCP 返回了不允许的重定向。`
    case "legacy_probe_failed":
    case "transport_error": return `未检测到可用的 ${definition.name} MCP，请确认本机服务已启动。`
  }
}
