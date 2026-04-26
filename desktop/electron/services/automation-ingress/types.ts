export const AUTOMATION_INGRESS_SERVICE_ID = "core.automation-ingress"

export interface WebhookStatus {
  readonly enabled: boolean
  readonly bindAddress: string
  readonly path: string
  readonly preferredPort?: number
  readonly assignedPort?: number
  readonly maxBodyBytes: number
  readonly rateLimitPerMinute: number
  readonly serviceRestartRequired?: boolean
  readonly lastError?: string
}

export interface WebhookConfigUpdate {
  readonly enabled?: boolean
  readonly bindAddress?: string
  readonly preferredPort?: number
  readonly path?: string
  readonly maxBodyBytes?: number
  readonly rateLimitPerMinute?: number
  readonly resetToken?: boolean
}

export interface WebhookConfigUpdateResult {
  readonly status: WebhookStatus
  readonly token?: string
}

