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
  type SecretSkillEnvBatchScanInput,
  type SecretSkillEnvBatchScanResult,
  type SecretSkillEnvQueueInput,
  type SecretSkillEnvQueueResult,
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
  const nameMutationTails = new Map<string, Promise<void>>()

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
    return withNameMutation(name, () => createLocked(name, input))
  }

  async function createLocked(name: string, input: Omit<SecretCreateInput, "name">): Promise<SecretSafeView> {
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
    const name = normalizeName(input.name)
    return withNameMutation(name, () => updateLocked({ ...input, name }))
  }

  async function updateLocked(input: SecretUpdateInput): Promise<SecretSafeView> {
    const existing = await requireByName(input.name)
    const description = Object.prototype.hasOwnProperty.call(input, "description")
      ? normalizeDescription(input.description)
      : existing.description
    const item: SecretItemEntryV1 = {
      ...existing,
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
    return withNameMutation(name, async () => {
      const existing = await findByName(name)

      if (!existing) {
        if (input.value === undefined) throw new Error("创建密钥时必须提供值。")
        const secret = await createLocked(name, {
          value: input.value,
          ...(normalizeDescription(input.description) ? { description: normalizeDescription(input.description) } : undefined),
        })
        return { secret, created: true }
      }

      const secret = await updateLocked({
        name: existing.name,
        ...(input.value !== undefined ? { value: input.value } : undefined),
        ...(Object.prototype.hasOwnProperty.call(input, "description") ? { description: input.description } : undefined),
      })
      return { secret, created: false }
    })
  }

  async function deleteItem(input: SecretDeleteInput): Promise<SecretSafeView> {
    const name = normalizeName(input.name)
    return withNameMutation(name, async () => {
      const existing = await findAllByName(name)
      if (existing.length === 0) throw new Error(`密钥不存在：${name}`)
      const safe = toSafeView(existing[0]!)
      await Promise.all(existing.map((item) => deps.items.remove(item.id)))
      if (existing.length > 1) {
        deps.logger.warn("Duplicate secret records were removed by logical name.", {
          name,
          duplicateCount: existing.length,
        })
      }
      await emitChanged()
      return safe
    })
  }

  async function scanSkillEnvBindings(
    input: SecretSkillEnvScanInput,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvScanResult> {
    const requestedName = normalizeName(input.name)
    const secret = await requireByName(requestedName)
    if (secret.name !== requestedName) {
      throw new Error(`Skill 配置键必须与密钥名称大小写完全一致：${requestedName}`)
    }
    return await deps.skillEnvBindings.scan(secret.name, secret.value, security)
  }

  async function scanSkillEnvBindingsBatch(
    input: SecretSkillEnvBatchScanInput,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvBatchScanResult> {
    const requests = []
    for (const name of input.names) {
      const requestedName = normalizeName(name)
      const secret = await requireByName(requestedName)
      if (secret.name !== requestedName) {
        throw new Error(`Skill 配置键必须与密钥名称大小写完全一致：${requestedName}`)
      }
      requests.push({ name: secret.name, value: secret.value })
    }
    return { groups: await deps.skillEnvBindings.scanMany(requests, security) }
  }

  async function queueSkillEnvBindings(
    input: SecretSkillEnvQueueInput,
    security: SkillEnvBindingSecurity,
  ): Promise<SecretSkillEnvQueueResult> {
    const requestedName = normalizeName(input.name)
    const secret = await requireByName(requestedName)
    if (secret.name !== requestedName) {
      throw new Error(`Skill 配置键必须与密钥名称大小写完全一致：${requestedName}`)
    }
    return await deps.skillEnvBindings.enqueue(
      { ...input, name: secret.name },
      async () => {
        const current = await deps.items.get(secret.id)
        if (!current || current.name !== secret.name) {
          throw new Error(`密钥不存在：${secret.name}`)
        }
        return current.value
      },
      security,
    )
  }

  async function migrateLegacyConfig(): Promise<void> {
    const settings = await loadSettings()
    if (settings.legacyConfigMigratedAt) return

    const config = await deps.loadConfig()
    const legacyVariables = config.global.variables
    const existingNames = new Set((await deps.items.list()).map((item) => item.name.toLowerCase()))
    const incompatibleVariables: SynapseVariable[] = []
    const now = timestamp()
    let migratedCount = 0

    for (const variable of legacyVariables) {
      const name = variable.name.trim()
      if (!name || !SECRET_NAME_REGEX.test(name)) {
        incompatibleVariables.push(variable)
        continue
      }
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
      migratedCount += 1
    }

    if (incompatibleVariables.length !== legacyVariables.length) {
      await deps.updateConfig({ global: { variables: incompatibleVariables } })
    }
    if (incompatibleVariables.length > 0) {
      deps.logger.warn("Some legacy variables were not migrated because their names are incompatible.", {
        incompatibleCount: incompatibleVariables.length,
        migratedCount,
      })
      if (migratedCount > 0) await emitChanged()
      return
    }
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
    const matches = await findAllByName(name)
    if (matches.length > 1) {
      const normalizedName = normalizeName(name)
      deps.logger.warn("Duplicate secret records were detected.", {
        name: normalizedName,
        duplicateCount: matches.length,
      })
      throw new Error(`检测到重复密钥名称：${normalizedName}，请先删除后重新创建。`)
    }
    return matches[0] ?? null
  }

  async function findAllByName(name: string): Promise<SecretItemEntryV1[]> {
    const normalized = normalizeName(name).toLowerCase()
    return (await deps.items.list()).filter((item) => item.name.toLowerCase() === normalized)
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

  async function withNameMutation<T>(name: string, task: () => Promise<T>): Promise<T> {
    const normalized = normalizeName(name).toLowerCase()
    const previous = nameMutationTails.get(normalized) ?? Promise.resolve()
    let release = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    nameMutationTails.set(normalized, tail)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (nameMutationTails.get(normalized) === tail) {
        nameMutationTails.delete(normalized)
      }
    }
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
    scanSkillEnvBindingsBatch,
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
    hasValue: true,
  }
}

function compareSecrets(a: SecretItemEntryV1, b: SecretItemEntryV1): number {
  return a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id)
    || a.name.localeCompare(b.name)
}

export type { SecretUpsertResult, SecretsLogger }
