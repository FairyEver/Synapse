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
  portal?: PortalCredentialBindingV1
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  tokenType?: string
  scope?: string
  updatedAt: string
}

export type ConnectorProbeErrorCodeV1 =
  | "invalid_endpoint"
  | "permission_denied"
  | "transport_error"
  | "probe_timeout"
  | "initialize_failed"
  | "tools_list_failed"
  | "required_tools_missing"
  | "redirect_not_allowed"
  | "legacy_probe_failed"

export interface ConnectorLocalStateV1 extends Record<string, unknown> {
  enabled: boolean
  lastProbe?: {
    at: string
    status: "success" | "failed"
    errorCode?: ConnectorProbeErrorCodeV1
  }
}

export interface PortalCredentialBindingV1 {
  ownerUserId: string
  connectorId: string
  environmentId: string
  tenantId: string
  portalUserId: string
}

export interface PortalConnectionBindingV1 extends PortalCredentialBindingV1 {
  credentialRef: string
  enabled: boolean
  displayName?: string
  tenantName?: string
  connectedAt: string
  lastValidatedAt: string
}

export interface ConnectorStateStoreV1 extends Record<string, unknown> {
  schemaVersion: 1
  connectors: Record<string, ConnectorLocalStateV1>
  portalBinding?: PortalConnectionBindingV1
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
      && (value.portal === undefined || isPortalCredentialBinding(value.portal))
  },
}

const connectorProbeErrorCodes = new Set<ConnectorProbeErrorCodeV1>([
  "invalid_endpoint",
  "permission_denied",
  "transport_error",
  "probe_timeout",
  "initialize_failed",
  "tools_list_failed",
  "required_tools_missing",
  "redirect_not_allowed",
  "legacy_probe_failed",
])

export const connectorsStateSchema: NamespaceSchema<ConnectorStateStoreV1> = {
  name: "app.connectors.state",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: false,
  validate: (value): value is ConnectorStateStoreV1 => {
    if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.connectors)) return false
    if (value.portalBinding !== undefined && !isPortalConnectionBinding(value.portalBinding)) return false
    return Object.values(value.connectors).every((state) => {
      if (!isRecord(state) || typeof state.enabled !== "boolean") return false
      if (state.lastProbe === undefined) return true
      if (!isRecord(state.lastProbe) || !isDate(state.lastProbe.at)) return false
      if (state.lastProbe.status !== "success" && state.lastProbe.status !== "failed") return false
      return state.lastProbe.errorCode === undefined
        || connectorProbeErrorCodes.has(state.lastProbe.errorCode as ConnectorProbeErrorCodeV1)
    })
  },
}

function isPortalCredentialBinding(value: unknown): value is PortalCredentialBindingV1 {
  return isRecord(value) && ["ownerUserId", "connectorId", "environmentId", "tenantId", "portalUserId"]
    .every((key) => typeof value[key] === "string" && value[key].length > 0)
}
function isPortalConnectionBinding(value: unknown): value is PortalConnectionBindingV1 {
  return isRecord(value) && isPortalCredentialBinding(value) && typeof value.credentialRef === "string"
    && typeof value.enabled === "boolean" && isDate(value.connectedAt) && isDate(value.lastValidatedAt)
    && (value.displayName === undefined || typeof value.displayName === "string")
    && (value.tenantName === undefined || typeof value.tenantName === "string")
}
