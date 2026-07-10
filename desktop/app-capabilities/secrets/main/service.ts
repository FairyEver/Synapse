import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  SecretItemEntryV1,
  SecretSettingsEntryV1,
} from "../../../electron/runtime/data-repo/schemas/secrets"
import type { SynapseConfig, SynapseConfigPatch, SynapseVariable } from "../../../src/types/config"
import type { SkillEnvBindingSecurity, SkillEnvBindingService } from "./skill-env-binding-service"
import {
  SECRET_NAME_REGEX,
  type SecretCreateInput,
  type SecretDeleteInput,
  type SecretGetInput,
  type SecretListResult,
  type SecretSkillEnvApplyInput,
  type SecretSkillEnvApplyResult,
  type SecretSkillEnvScanInput,
  type SecretSkillEnvScanResult,
  type SecretSafeView,
  type SecretUpdateInput,
  type SecretUpsertInput,
  type SecretValueView,
} from "../shared/schema"

type SecretsLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type SecretsServiceDeps = {
  readonly items: DataNamespace<SecretItemEntryV1>
  readonly settings: DataNamespace<SecretSettingsEntryV1>
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly skillEnvBindings: SkillEnvBindingService
  readonly now?: () => Date
  readonly createId?: () => string
  readonly logger: SecretsLogger
}

type SecretsServiceEvents = {
  changed: [payload: { secrets: SecretSafeView[] }]
}

type SecretUpsertResult = {
  readonly secret: SecretSafeView
  readonly created: boolean
}

class TypedSecretsEventEmitter extends EventEmitter {
  override on<K extends keyof SecretsServiceEvents>(
    eventName: K,
    listener: (...args: SecretsServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof SecretsServiceEvents>(
    eventName: K,
    ...args: SecretsServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

export function createSecretsService(deps: SecretsServiceDeps) {
  const events = new TypedSecretsEventEmitter()
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = () => deps.createId?.() ?? randomUUID()

  async function initialize(): Promise<void> {
    await migrateLegacyConfig()
  }

  async function list(): Promise<SecretListResult> {
    const secrets = (await deps.items.list())
      .sort(compareSecrets)
      .map(toSafeView)
    return { secrets, total: secrets.length }
  }

  async function get(input: SecretGetInput): Promise<SecretSafeView | SecretValueView> {
    const item = await requireByName(input.name)
    const safe = toSafeView(item)
    return input.includeValue === true ? { ...safe, value: item.value } : safe
  }

  async function create(input: SecretCreateInput): Promise<SecretSafeView> {
    const name = normalizeName(input.name)
    await assertNameAvailable(name)
    const now = timestamp()
    const item: SecretItemEntryV1 = {
      id: createId(),
      schemaVersion: 1,
      name,
      value: input.value,
      ...(normalizeDescription(input.description) ? { description: normalizeDescription(input.description) } : undefined),
      createdAt: now,
      updatedAt: now,
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toSafeView(item)
  }

  async function update(input: SecretUpdateInput): Promise<SecretSafeView> {
    const existing = await requireByName(input.name)
    const nextName = input.newName !== undefined ? normalizeName(input.newName) : existing.name
    await assertNameAvailable(nextName, existing.name)
    const description = Object.prototype.hasOwnProperty.call(input, "description")
      ? normalizeDescription(input.description)
      : existing.description
    const item: SecretItemEntryV1 = {
      ...existing,
      name: nextName,
      value: input.value !== undefined ? input.value : existing.value,
      ...(description ? { description } : { description: undefined }),
      updatedAt: timestamp(),
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toSafeView(item)
  }

  async function upsert(input: SecretUpsertInput): Promise<SecretUpsertResult> {
    const name = normalizeName(input.name)
    const existing = await findByName(name)

    if (!existing) {
      if (input.value === undefined) throw new Error("创建密钥时必须提供值。")
      const secret = await create({
        name,
        value: input.value,
        ...(normalizeDescription(input.description) ? { description: normalizeDescription(input.description) } : undefined),
      })
      return { secret, created: true }
    }

    const secret = await update({
      name: existing.name,
      ...(input.value !== undefined ? { value: input.value } : undefined),
      ...(Object.prototype.hasOwnProperty.call(input, "description") ? { description: input.description } : undefined),
    })
    return { secret, created: false }
  }

  async function deleteItem(input: SecretDeleteInput): Promise<SecretSafeView> {
    const existing = await requireByName(input.name)
    const safe = toSafeView(existing)
    await deps.items.remove(existing.id)
    await emitChanged()
    return safe
  }

  async function scanSkillEnvBindings(
    input: SecretSkillEnvScanInput,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvScanResult> {
    const secret = await requireByName(input.name)
    return await deps.skillEnvBindings.scan(secret.name, secret.value, security)
  }

  async function queueSkillEnvBindings(
    input: SecretSkillEnvApplyInput,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvApplyResult> {
    const secret = await requireByName(input.name)
    return await deps.skillEnvBindings.enqueue({ ...input, name: secret.name }, secret.value, security)
  }

  async function migrateLegacyConfig(): Promise<void> {
    const settings = await loadSettings()
    if (settings.legacyConfigMigratedAt) return

    const config = await deps.loadConfig()
    const legacyVariables = config.global.variables
    const existingNames = new Set((await deps.items.list()).map((item) => item.name.toLowerCase()))
    const now = timestamp()

    for (const variable of legacyVariables) {
      const name = normalizeName(variable.name)
      const normalized = name.toLowerCase()
      if (existingNames.has(normalized)) continue
      await deps.items.upsert({
        id: createId(),
        schemaVersion: 1,
        name,
        value: variable.value,
        ...(normalizeDescription(variable.description) ? { description: normalizeDescription(variable.description) } : undefined),
        createdAt: now,
        updatedAt: now,
      })
      existingNames.add(normalized)
    }

    await deps.updateConfig({ global: { variables: [] } })
    await deps.settings.setSingleton({
      ...settings,
      legacyConfigMigratedAt: now,
    })
    await emitChanged()
  }

  async function loadSettings(): Promise<SecretSettingsEntryV1> {
    return await deps.settings.getSingleton() ?? {
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
    }
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", { secrets: (await list()).secrets })
  }

  async function findByName(name: string): Promise<SecretItemEntryV1 | null> {
    const normalized = normalizeName(name).toLowerCase()
    return (await deps.items.list()).find((item) => item.name.toLowerCase() === normalized) ?? null
  }

  async function requireByName(name: string): Promise<SecretItemEntryV1> {
    const item = await findByName(name)
    if (!item) throw new Error(`密钥不存在：${name}`)
    return item
  }

  async function assertNameAvailable(name: string, allowedExistingName?: string): Promise<void> {
    const normalized = normalizeName(name).toLowerCase()
    const allowed = allowedExistingName?.toLowerCase()
    const duplicate = (await deps.items.list()).some((item) =>
      item.name.toLowerCase() === normalized && item.name.toLowerCase() !== allowed,
    )
    if (duplicate) throw new Error(`密钥已存在：${name}`)
  }

  return {
    events,
    initialize,
    list,
    get,
    create,
    update,
    upsert,
    delete: deleteItem,
    scanSkillEnvBindings,
    queueSkillEnvBindings,
  }
}

export type SecretsService = ReturnType<typeof createSecretsService>

function normalizeName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || !SECRET_NAME_REGEX.test(trimmed)) {
    throw new Error("密钥名称只能包含字母、数字和下划线。")
  }
  return trimmed
}

function normalizeDescription(description: string | undefined): string | undefined {
  const trimmed = description?.trim() ?? ""
  return trimmed ? trimmed : undefined
}

function toSafeView(item: SecretItemEntryV1): SecretSafeView {
  return {
    id: item.id,
    name: item.name,
    ...(item.description ? { description: item.description } : undefined),
    hasValue: item.value.length > 0,
  }
}

function compareSecrets(a: SecretItemEntryV1, b: SecretItemEntryV1): number {
  return a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id)
    || a.name.localeCompare(b.name)
}

export type { SecretUpsertResult, SecretsLogger }
