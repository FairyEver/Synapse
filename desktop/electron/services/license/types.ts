export type DesktopLicenseStatusKind = "not_activated" | "active" | "expired" | "invalid"
export type ManagedLicenseStatus = "active" | "disabled" | "revoked" | "expired"

export interface DesktopLicenseStatus {
  readonly status: DesktopLicenseStatusKind
  readonly email: string | null
  readonly serverUrl: string | null
  readonly deviceIdHash: string | null
  readonly expiresAt: string | null
  readonly lastRenewedAt: string | null
  readonly message?: string
}

export interface DesktopLicenseActivationRequest {
  readonly email: string
  readonly activationCode: string
}

export interface LicenseLeasePayload {
  readonly tokenId: string
  readonly accountId: string
  readonly email: string
  readonly licenseId: string
  readonly deviceIdHash: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly maxDevices: number
  readonly licenseStatus: ManagedLicenseStatus
  readonly keyId: string
}

export interface DeviceMetadata {
  readonly deviceId: string
  readonly name: string
  readonly platform: string
  readonly appVersion: string
}

export interface LicenseServerConfig {
  readonly keyId: string
  readonly leaseDays: number
  readonly serverTime: string
  readonly publicKey: string
}

export interface LicenseServerResponse {
  readonly email: string
  readonly deviceIdHash: string
  readonly leaseToken: string
}

export interface LicenseServerValidationResponse {
  readonly ok: true
}
