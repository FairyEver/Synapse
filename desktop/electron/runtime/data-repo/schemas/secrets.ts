import type { Migration, NamespaceSchema } from "../types"

export interface SecretItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  value: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface SecretSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  legacyConfigMigratedAt: string | null
}

const noMigrations: readonly Migration[] = []

export const secretsItemsSchema: NamespaceSchema<SecretItemEntryV1> = {
  name: "app.secrets.items",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isSecretItemEntryV1,
  encrypted: false,
}

export const secretsSettingsSchema: NamespaceSchema<SecretSettingsEntryV1> = {
  name: "app.secrets.settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isSecretSettingsEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 1,
    legacyConfigMigratedAt: null,
  }),
}

function isSecretItemEntryV1(value: unknown): value is SecretItemEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && /^[A-Za-z0-9_]+$/.test(value.name)
    && typeof value.value === "string"
    && (value.description === undefined || typeof value.description === "string")
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isSecretSettingsEntryV1(value: unknown): value is SecretSettingsEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && (value.legacyConfigMigratedAt === null || isIsoDateString(value.legacyConfigMigratedAt))
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
