import type { NamespaceSchema } from "../types"

export interface CoreLicenseV1 {
  readonly id: "license"
  readonly schemaVersion: 1
  readonly deviceId: string
  readonly deviceIdHash: string | null
  readonly serverUrl: string | null
  readonly email: string | null
  readonly publicKey: string | null
  readonly keyId: string | null
  readonly leaseToken: string | null
  readonly leaseExpiresAt: string | null
  readonly activatedAt: string | null
  readonly lastRenewedAt: string | null
}

export const coreLicenseSchema: NamespaceSchema<CoreLicenseV1> = {
  name: "core.license",
  backend: "encrypted-json",
  currentVersion: 1,
  encrypted: true,
  migrations: [],
  validate: isCoreLicenseV1,
}

export function isCoreLicenseV1(value: unknown): value is CoreLicenseV1 {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return record.id === "license"
    && record.schemaVersion === 1
    && typeof record.deviceId === "string"
    && isNullableString(record.deviceIdHash)
    && isNullableString(record.serverUrl)
    && isNullableString(record.email)
    && isNullableString(record.publicKey)
    && isNullableString(record.keyId)
    && isNullableString(record.leaseToken)
    && isNullableString(record.leaseExpiresAt)
    && isNullableString(record.activatedAt)
    && isNullableString(record.lastRenewedAt)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}
