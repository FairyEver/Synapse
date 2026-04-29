export type ManagedStatus = "active" | "disabled" | "revoked" | "expired"

export interface LicenseLeasePayload {
  readonly tokenId: string
  readonly accountId: string
  readonly email: string
  readonly licenseId: string
  readonly deviceIdHash: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly maxDevices: number
  readonly licenseStatus: ManagedStatus
  readonly keyId: string
}

export interface DeviceMetadata {
  readonly deviceId: string
  readonly name: string
  readonly platform: string
  readonly appVersion: string
}
