import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type {
  QuickInputItemEntryV1,
  QuickInputSettingsEntryV1,
} from "../../../electron/runtime/data-repo/schemas/quick-input"
import type { SynapseConfig, SynapseConfigPatch } from "../../../src/types/config"
import { DEFAULT_QUICK_INPUT_CONTENTS } from "../shared/defaults"
import type {
  QuickInputCreateInput,
  QuickInputIdInput,
  QuickInputItem,
  QuickInputUpdateInput,
} from "../shared/schema"

type QuickInputLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type QuickInputServiceDeps = {
  readonly items: DataNamespace<QuickInputItemEntryV1>
  readonly settings: DataNamespace<QuickInputSettingsEntryV1>
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly appVersion: string
  readonly now?: () => Date
  readonly createId?: () => string
  readonly logger: QuickInputLogger
}

type QuickInputServiceEvents = {
  changed: [payload: { items: QuickInputItem[] }]
}

class TypedQuickInputEventEmitter extends EventEmitter {
  override on<K extends keyof QuickInputServiceEvents>(
    eventName: K,
    listener: (...args: QuickInputServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof QuickInputServiceEvents>(
    eventName: K,
    ...args: QuickInputServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

export function createQuickInputService(deps: QuickInputServiceDeps) {
  const events = new TypedQuickInputEventEmitter()
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = () => deps.createId?.() ?? randomUUID()

  async function initialize(): Promise<void> {
    await migrateLegacyConfig()
    await seedDefaults()
  }

  async function list(): Promise<QuickInputItem[]> {
    return (await deps.items.list())
      .sort(compareQuickInputItems)
      .map(toPublicItem)
  }

  async function create(input: QuickInputCreateInput): Promise<QuickInputItem> {
    const content = normalizeContent(input.content)
    const now = timestamp()
    const item: QuickInputItemEntryV1 = {
      id: createId(),
      schemaVersion: 1,
      content,
      sortOrder: await nextSortOrder(),
      createdAt: now,
      updatedAt: now,
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toPublicItem(item)
  }

  async function update(input: QuickInputUpdateInput): Promise<QuickInputItem> {
    const existing = await requireItem(input.id)
    const item: QuickInputItemEntryV1 = {
      ...existing,
      content: normalizeContent(input.content),
      updatedAt: timestamp(),
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toPublicItem(item)
  }

  async function deleteItem(input: QuickInputIdInput): Promise<void> {
    await deps.items.remove(input.id)
    await normalizeSortOrders()
    await emitChanged()
  }

  async function migrateLegacyConfig(): Promise<void> {
    const settings = await loadSettings()
    if (settings.legacyConfigMigratedAt) return

    const config = await deps.loadConfig()
    const legacyItems = config.global.quickInputs.filter((item) => item.content.trim().length > 0)
    const existing = await deps.items.list()

    if (legacyItems.length > 0 && existing.length === 0) {
      const now = timestamp()
      for (const [index, legacy] of legacyItems.entries()) {
        await deps.items.upsert({
          id: legacy.id,
          schemaVersion: 1,
          content: legacy.content,
          sortOrder: (index + 1) * 10,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    const migratedAt = timestamp()
    await deps.updateConfig({ global: { quickInputs: [] } })
    await deps.settings.setSingleton({
      ...settings,
      legacyConfigMigratedAt: migratedAt,
    })
  }

  async function seedDefaults(): Promise<void> {
    const settings = await loadSettings()
    if (settings.defaultSeededVersion === deps.appVersion) return

    if ((await deps.items.list()).length === 0) {
      const now = timestamp()
      for (const [index, item] of DEFAULT_QUICK_INPUT_CONTENTS.entries()) {
        await deps.items.upsert({
          id: item.id,
          schemaVersion: 1,
          content: item.content,
          sortOrder: (index + 1) * 10,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    await deps.settings.setSingleton({
      ...settings,
      defaultSeededVersion: deps.appVersion,
    })
    await emitChanged()
  }

  async function loadSettings(): Promise<QuickInputSettingsEntryV1> {
    return await deps.settings.getSingleton() ?? {
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
      defaultSeededVersion: null,
    }
  }

  async function requireItem(id: string): Promise<QuickInputItemEntryV1> {
    const item = await deps.items.get(id)
    if (!item) throw new Error("快捷输入不存在。")
    return item
  }

  async function nextSortOrder(): Promise<number> {
    const items = await deps.items.list()
    return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10
  }

  async function normalizeSortOrders(): Promise<void> {
    const ordered = (await deps.items.list()).sort(compareQuickInputItems)
    for (const [index, item] of ordered.entries()) {
      const sortOrder = (index + 1) * 10
      if (item.sortOrder !== sortOrder) {
        await deps.items.upsert({ ...item, sortOrder })
      }
    }
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", { items: await list() })
  }

  return {
    events,
    initialize,
    list,
    create,
    update,
    delete: deleteItem,
  }
}

export type QuickInputService = ReturnType<typeof createQuickInputService>

function normalizeContent(content: string): string {
  if (content.trim().length === 0) throw new Error("内容不能为空。")
  return content
}

function compareQuickInputItems(a: QuickInputItemEntryV1, b: QuickInputItemEntryV1): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
}

function toPublicItem(item: QuickInputItemEntryV1): QuickInputItem {
  return {
    id: item.id,
    schemaVersion: 1,
    content: item.content,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}
