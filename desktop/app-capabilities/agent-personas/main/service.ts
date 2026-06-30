import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentPersonaItemEntryV1 } from "../../../electron/runtime/data-repo/schemas/agent-personas"
import {
  BUILTIN_AGENT_PERSONAS,
  isBuiltinAgentPersonaId,
} from "../shared/defaults"
import type {
  AgentPersona,
  AgentPersonaCreateInput,
  AgentPersonaIdInput,
  AgentPersonaProviderModel,
  AgentPersonaUpdateInput,
} from "../shared/schema"

type AgentPersonaLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type AgentPersonaServiceDeps = {
  readonly items: DataNamespace<AgentPersonaItemEntryV1>
  readonly now?: () => Date
  readonly createId?: () => string
  readonly logger: AgentPersonaLogger
}

type AgentPersonaServiceEvents = {
  changed: [payload: { items: AgentPersona[] }]
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
  const createId = () => deps.createId?.() ?? randomUUID()

  async function list(): Promise<AgentPersona[]> {
    const userItems = (await deps.items.list())
      .sort(compareUserItems)
      .map(toPublicUserItem)
    return [...BUILTIN_AGENT_PERSONAS, ...userItems]
  }

  async function create(input: AgentPersonaCreateInput): Promise<AgentPersona> {
    const now = timestamp()
    const item: AgentPersonaItemEntryV1 = {
      id: createId(),
      schemaVersion: 1,
      name: normalizeRequired(input.name, "名称不能为空。"),
      description: normalizeRequired(input.description, "简介不能为空。"),
      systemPrompt: normalizeRequired(input.systemPrompt, "系统提示词不能为空。"),
      providerModel: normalizeProviderModel(input.providerModel ?? null),
      source: "user",
      createdAt: now,
      updatedAt: now,
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toPublicUserItem(item)
  }

  async function update(input: AgentPersonaUpdateInput): Promise<AgentPersona> {
    if (isBuiltinAgentPersonaId(input.id)) {
      throw new Error("内置智能体不可编辑。")
    }

    const existing = await requireUserItem(input.id)
    const item: AgentPersonaItemEntryV1 = {
      ...existing,
      name: normalizeRequired(input.name, "名称不能为空。"),
      description: normalizeRequired(input.description, "简介不能为空。"),
      systemPrompt: normalizeRequired(input.systemPrompt, "系统提示词不能为空。"),
      providerModel: normalizeProviderModel(input.providerModel ?? null),
      updatedAt: timestamp(),
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toPublicUserItem(item)
  }

  async function deleteItem(input: AgentPersonaIdInput): Promise<void> {
    if (isBuiltinAgentPersonaId(input.id)) {
      throw new Error("内置智能体不可删除。")
    }
    await requireUserItem(input.id)
    await deps.items.remove(input.id)
    await emitChanged()
  }

  async function requireUserItem(id: string): Promise<AgentPersonaItemEntryV1> {
    const item = await deps.items.get(id)
    if (!item) throw new Error("智能体不存在。")
    return item
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", { items: await list() })
  }

  return {
    events,
    list,
    create,
    update,
    delete: deleteItem,
  }
}

export type AgentPersonaService = ReturnType<typeof createAgentPersonaService>

function normalizeRequired(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function normalizeProviderModel(value: AgentPersonaProviderModel | null): AgentPersonaProviderModel | null {
  if (!value) return null
  return {
    providerId: normalizeRequired(value.providerId, "模型供应商不能为空。"),
    modelTier: value.modelTier,
  }
}

function compareUserItems(a: AgentPersonaItemEntryV1, b: AgentPersonaItemEntryV1): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)
}

function toPublicUserItem(item: AgentPersonaItemEntryV1): AgentPersona {
  return {
    id: item.id,
    schemaVersion: 1,
    name: item.name,
    description: item.description,
    systemPrompt: item.systemPrompt,
    providerModel: item.providerModel,
    source: "user",
    readonly: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}
