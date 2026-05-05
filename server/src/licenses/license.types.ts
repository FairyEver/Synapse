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

export type ActivationErrorCode =
  | "ACTIVATION_RATE_LIMITED"
  | "ACTIVATION_RISK_LOCKED"
  | "ACTIVATION_INVALID"
  | "ACTIVATION_BOUND_CONFLICT"
  | "ACTIVATION_RESERVED_MISMATCH"
  | "ACTIVATION_DEVICE_LIMIT"

export type ActivationAttemptOutcome =
  | "success"
  | "invalid_code"
  | "bound_conflict"
  | "reserved_mismatch"
  | "rate_limited"
  | "risk_locked"
  | "device_limit"
  | "blocked"

export interface ActivationRiskSettings {
  readonly attemptRetentionDays: number
  readonly rateWindowMinutes: number
  readonly rateMaxFailuresPerIp: number
  readonly rateMaxFailuresPerEmail: number
  readonly rateMaxFailuresPerDevice: number
  readonly riskWindowMinutes: number
  readonly riskMaxDistinctIpsPerCode: number
  readonly riskMaxDistinctEmailsPerCode: number
  readonly riskMaxDistinctDevicesPerCode: number
  readonly riskMaxBoundConflictsPerCode: number
}

export class ActivationError extends Error {
  constructor(
    readonly code: ActivationErrorCode,
    message: string,
  ) {
    super(message)
  }
}
