export interface StateSyncErrorOptions {
  readonly currentRev?: number
  readonly status?: number
  readonly requestId?: string
}

export class StateSyncError extends Error {
  readonly code: string
  readonly currentRev?: number
  readonly status?: number
  readonly requestId?: string

  constructor(code: string, message: string, options?: StateSyncErrorOptions) {
    super(message)
    this.name = "StateSyncError"
    this.code = code
    this.currentRev = options?.currentRev
    this.status = options?.status
    this.requestId = options?.requestId
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export const STATE_SYNC_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  AUTH_FAILED: 4001,
  REVOKED: 4003,
  ROLE_CHANGED: 4004,
  TIMEOUT_OR_SLOW: 4008,
  LIMIT_EXCEEDED: 4029,
} as const
