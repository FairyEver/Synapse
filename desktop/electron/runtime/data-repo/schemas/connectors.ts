import type { Migration, NamespaceSchema } from "../types"

export interface ConnectorItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  providerKey: string
  name: string
  description?: string
  endpoint: string
  authType: "none" | "oauth2"
  status: "available" | "connecting" | "connected" | "error"
  accountLabel?: string
  lastConnectedAt?: string
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface ConnectorCredentialEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
  updatedAt: string
}

const noMigrations: readonly Migration[] = []
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value))

export const connectorsItemsSchema: NamespaceSchema<ConnectorItemEntryV1> = {
  name: "app.connectors.items",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: false,
  validate: (value): value is ConnectorItemEntryV1 => {
    if (!isRecord(value)) return false
    return value.schemaVersion === 1 && typeof value.id === "string" && typeof value.providerKey === "string"
      && typeof value.name === "string" && typeof value.endpoint === "string" && ["none", "oauth2"].includes(String(value.authType))
      && ["available", "connecting", "connected", "error"].includes(String(value.status))
      && isDate(value.createdAt) && isDate(value.updatedAt)
  },
}

export const connectorsCredentialsSchema: NamespaceSchema<ConnectorCredentialEntryV1> = {
  name: "app.connectors.credentials",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (value): value is ConnectorCredentialEntryV1 => {
    if (!isRecord(value)) return false
    return value.schemaVersion === 1 && typeof value.id === "string" && typeof value.accessToken === "string" && isDate(value.updatedAt)
  },
}
