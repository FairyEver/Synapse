export const WEBHOOK_PUBLIC_PATH_PREFIX = "/webhooks"

export const WEBHOOK_DELIVERY_STATUS = {
  accepted: "accepted",
  rejected: "rejected",
  received: "received",
  broadcastFailed: "broadcast_failed",
} as const

export type WebhookDeliveryStatus = typeof WEBHOOK_DELIVERY_STATUS[keyof typeof WEBHOOK_DELIVERY_STATUS]

export interface WebhookDeliveryReceivedPayload {
  readonly deliveryId: string
  readonly webhook: {
    readonly id: string
    readonly publicId: string
    readonly name: string
  }
  readonly request: {
    readonly method: string
    readonly url: string
    readonly query: Record<string, string | readonly string[]>
    readonly headers: Record<string, string>
    readonly body: unknown
    readonly bodyText?: string
    readonly contentType?: string
    readonly receivedAt: string
    readonly remoteAddress?: string
  }
}

export interface DashboardWebhookDto {
  readonly id: string
  readonly publicId: string
  readonly name: string
  readonly enabled: boolean
  readonly maskedUrl: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastDeliveryAt?: string
  readonly lastDeliveryStatus?: WebhookDeliveryStatus
}

export interface DashboardWebhookSecretResult {
  readonly webhook: DashboardWebhookDto
  readonly url: string
}

export interface WebhookDeliveryDto {
  readonly id: string
  readonly webhookId: string
  readonly method: string
  readonly path: string
  readonly query: unknown
  readonly headers: unknown
  readonly bodyKind: string
  readonly bodySize: number
  readonly bodyPreview?: string
  readonly receivedAt: string
  readonly onlineClientCount: number
  readonly sentClientCount: number
  readonly failedClientCount: number
  readonly status: WebhookDeliveryStatus
  readonly error?: string
}

export function isWebhookDeliveryReceivedPayload(value: unknown): value is WebhookDeliveryReceivedPayload {
  if (!isRecord(value)) return false
  if (!nonEmptyString(value.deliveryId)) return false
  if (!isRecord(value.webhook) || !nonEmptyString(value.webhook.id) ||
    !nonEmptyString(value.webhook.publicId) || !nonEmptyString(value.webhook.name)) return false
  if (!isRecord(value.request)) return false
  return nonEmptyString(value.request.method) &&
    nonEmptyString(value.request.url) &&
    isWebhookQueryRecord(value.request.query) &&
    isStringRecord(value.request.headers) &&
    "body" in value.request &&
    nonEmptyString(value.request.receivedAt)
}

function isWebhookQueryRecord(value: unknown): value is Record<string, string | readonly string[]> {
  return isRecord(value) && Object.values(value).every((item) =>
    typeof item === "string" || (Array.isArray(item) && item.every((entry) => typeof entry === "string"))
  )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
