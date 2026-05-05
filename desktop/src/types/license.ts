export type SynapseLicenseStatusKind = "not_activated" | "active" | "expired" | "invalid"

export interface SynapseLicenseStatus {
  readonly status: SynapseLicenseStatusKind
  readonly email: string | null
  readonly serverUrl: string | null
  readonly deviceIdHash: string | null
  readonly expiresAt: string | null
  readonly lastRenewedAt: string | null
  readonly message?: string
}

export interface SynapseLicenseActivationRequest {
  readonly email: string
  readonly activationCode: string
}
