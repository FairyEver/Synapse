import { EventEmitter } from "node:events"

import type { SynapseAccountState } from "../../../src/types/account"
import type { AgentPersonaCache } from "./cache"
import type { RemoteAgentPersonaClient } from "./remote-client"
import type {
  AgentPersona,
  AgentPersonaBuiltinModelUpdateInput,
  AgentPersonaCreateInput,
  AgentPersonaIdInput,
  AgentPersonaListResult,
  AgentPersonaUpdateInput,
} from "../shared/schema"

type AgentPersonaLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

type AgentPersonaAccountPort = {
  readonly getState: () => SynapseAccountState
}

export type AgentPersonaServiceDeps = {
  readonly remote: RemoteAgentPersonaClient
  readonly cache: AgentPersonaCache
  readonly account: AgentPersonaAccountPort
  readonly now?: () => Date
  readonly logger: AgentPersonaLogger
}

type AgentPersonaServiceEvents = {
  changed: [result: AgentPersonaListResult]
}

type ListForUserOptions = {
  readonly emitRemoteChange?: boolean
}

class TypedAgentPersonaEventEmitter extends EventEmitter {
  override on<K extends keyof AgentPersonaServiceEvents>(
    eventName: K,
    listener: (...args: AgentPersonaServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof AgentPersonaServiceEvents>(
    eventName: K,
    ...args: AgentPersonaServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

export function createAgentPersonaService(deps: AgentPersonaServiceDeps) {
  const events = new TypedAgentPersonaEventEmitter()
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const remoteListFingerprints = new Map<string, string>()

  async function list(): Promise<AgentPersonaListResult> {
    const state = deps.account.getState()
    if (state.status !== "authenticated") return { status: "unauthenticated", items: [] }
    return listForUser(state.profile.user.id)
  }

  async function create(input: AgentPersonaCreateInput): Promise<AgentPersona> {
    const { userId } = requireOnlineAccount()
    const saved = await deps.remote.create(input)
    await emitChangedForUser(userId)
    return saved
  }

  async function update(input: AgentPersonaUpdateInput): Promise<AgentPersona> {
    const { userId } = requireOnlineAccount()
    const saved = await deps.remote.update(input)
    await emitChangedForUser(userId)
    return saved
  }

  async function updateBuiltinModel(input: AgentPersonaBuiltinModelUpdateInput): Promise<AgentPersona> {
    const { userId } = requireOnlineAccount()
    const saved = await deps.remote.updateBuiltinModel(input)
    await emitChangedForUser(userId)
    return saved
  }

  async function deleteItem(input: AgentPersonaIdInput): Promise<void> {
    const { userId } = requireOnlineAccount()
    await deps.remote.delete(input)
    await emitChangedForUser(userId)
  }

  async function listForUser(userId: string, options: ListForUserOptions = {}): Promise<AgentPersonaListResult> {
    try {
      const items = await deps.remote.list()
      const syncedAt = timestamp()
      await deps.cache.write(userId, items, syncedAt)
      const result: AgentPersonaListResult = { status: "online", items, syncedAt }
      const nextFingerprint = fingerprintItems(items)
      const previousFingerprint = remoteListFingerprints.get(userId)
      remoteListFingerprints.set(userId, nextFingerprint)
      if (options.emitRemoteChange !== false
        && previousFingerprint !== undefined
        && previousFingerprint !== nextFingerprint) {
        events.emit("changed", result)
      }
      return result
    } catch (error) {
      deps.logger.warn("Agent personas remote list failed.", {
        error,
        boundary: "agent-personas.remote.list",
      })
      const cached = await deps.cache.read(userId)
      if (!cached) return { status: "offline-empty", items: [] }
      return { status: "offline-cache", items: [...cached.items], syncedAt: cached.syncedAt }
    }
  }

  async function emitChangedForUser(userId: string): Promise<void> {
    events.emit("changed", await listForUser(userId, { emitRemoteChange: false }))
  }

  function requireOnlineAccount(): { userId: string } {
    const state = deps.account.getState()
    if (state.status !== "authenticated") throw new Error("请先登录。")
    if (state.connectivity !== "online") throw new Error("当前离线，无法保存智能体。")
    return { userId: state.profile.user.id }
  }

  return {
    events,
    list,
    create,
    update,
    updateBuiltinModel,
    delete: deleteItem,
  }
}

export type AgentPersonaService = ReturnType<typeof createAgentPersonaService>

function fingerprintItems(items: readonly AgentPersona[]): string {
  return JSON.stringify(sortJson(items))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, sortJson(item)]))
}
