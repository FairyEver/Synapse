export const WEBHOOK_MIN_PORT = 1
export const WEBHOOK_MAX_PORT = 65_535
export const WEBHOOK_MAX_BODY_BYTES_LIMIT = 100 * 1024 * 1024
export const WEBHOOK_MAX_RATE_LIMIT_PER_MINUTE = 1_000_000

export interface WebhookNumericConfigInput {
  readonly preferredPort?: number
  readonly assignedPort?: number
  readonly maxBodyBytes?: number
  readonly rateLimitPerMinute?: number
}

export function isValidWebhookPort(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= WEBHOOK_MIN_PORT
    && value <= WEBHOOK_MAX_PORT
}

export function isOptionalValidWebhookPort(value: unknown): boolean {
  return value === undefined || isValidWebhookPort(value)
}

export function isValidWebhookMaxBodyBytes(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0
    && value <= WEBHOOK_MAX_BODY_BYTES_LIMIT
}

export function isValidWebhookRateLimitPerMinute(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0
    && value <= WEBHOOK_MAX_RATE_LIMIT_PER_MINUTE
}

export function assertValidWebhookNumericConfig(input: WebhookNumericConfigInput): void {
  if (input.preferredPort !== undefined && !isValidWebhookPort(input.preferredPort)) {
    throw new Error(`preferredPort 必须是 ${WEBHOOK_MIN_PORT} 到 ${WEBHOOK_MAX_PORT} 的整数。`)
  }
  if (input.assignedPort !== undefined && !isValidWebhookPort(input.assignedPort)) {
    throw new Error(`assignedPort 必须是 ${WEBHOOK_MIN_PORT} 到 ${WEBHOOK_MAX_PORT} 的整数。`)
  }
  if (input.maxBodyBytes !== undefined && !isValidWebhookMaxBodyBytes(input.maxBodyBytes)) {
    throw new Error(`maxBodyBytes 必须是 1 到 ${WEBHOOK_MAX_BODY_BYTES_LIMIT} 的整数。`)
  }
  if (
    input.rateLimitPerMinute !== undefined
    && !isValidWebhookRateLimitPerMinute(input.rateLimitPerMinute)
  ) {
    throw new Error(`rateLimitPerMinute 必须是 1 到 ${WEBHOOK_MAX_RATE_LIMIT_PER_MINUTE} 的整数。`)
  }
}
