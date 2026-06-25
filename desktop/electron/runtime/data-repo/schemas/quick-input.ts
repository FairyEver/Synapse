import type { Migration, NamespaceSchema } from "../types"

export interface QuickInputItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface QuickInputSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  legacyConfigMigratedAt: string | null
  defaultSeededVersion: string | null
}

const noMigrations: readonly Migration[] = []

export const quickInputItemsSchema: NamespaceSchema<QuickInputItemEntryV1> = {
  name: "app.quick-input.items",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isQuickInputItemEntryV1,
  encrypted: false,
}

export const quickInputSettingsSchema: NamespaceSchema<QuickInputSettingsEntryV1> = {
  name: "app.quick-input.settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isQuickInputSettingsEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 1,
    legacyConfigMigratedAt: null,
    defaultSeededVersion: null,
  }),
}

function isQuickInputItemEntryV1(value: unknown): value is QuickInputItemEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.content === "string"
    && value.content.trim().length > 0
    && typeof value.sortOrder === "number"
    && Number.isFinite(value.sortOrder)
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isQuickInputSettingsEntryV1(value: unknown): value is QuickInputSettingsEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && isNullableIsoDateString(value.legacyConfigMigratedAt)
    && (value.defaultSeededVersion === null || typeof value.defaultSeededVersion === "string")
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value)
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
