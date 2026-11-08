export { WEBHOOK_PUBLIC_PATH_PREFIX } from "./urls.js"

export const WEBHOOK_DELIVERY_STATUS = {
  received: "received",
  noOnlineClients: "no_online_clients",
  sent: "sent",
  delivered: "delivered",
  rejected: "rejected",
  broadcastFailed: "broadcast_failed",
} as const

export type WebhookDeliveryStatus = typeof WEBHOOK_DELIVERY_STATUS[keyof typeof WEBHOOK_DELIVERY_STATUS]

export const WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS = {
  sent: "sent",
  acknowledged: "acknowledged",
  sendFailed: "send_failed",
} as const

export type WebhookDeliveryClientReceiptStatus =
  typeof WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS[keyof typeof WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS]

export interface WebhookDeliveryReceivedPayload {
  /** Live-only; never persist this credential-bearing envelope. */
  readonly rawRequest?: WebhookRawRequest
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

export interface WebhookRawRequest {
  readonly version: 1
  readonly method: string
  readonly query: string
  readonly headers: readonly (readonly [string, string])[]
  readonly bodyBase64: string
  readonly bodyBytes: number
  readonly bodySha256: string
}

export function isWebhookRawRequest(value: unknown): value is WebhookRawRequest {
  if (!isRecord(value) || value.version !== 1) return false
  return typeof value.method === "string" && /^(GET|POST|PUT|PATCH|DELETE)$/u.test(value.method) &&
    typeof value.query === "string" && value.query.length <= 32768 && !/[\r\n#]/u.test(value.query) &&
    Array.isArray(value.headers) && value.headers.length <= 2000 && value.headers.every((pair) =>
      Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" &&
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(pair[0]) && typeof pair[1] === "string" && !/[\r\n\0]/u.test(pair[1])) &&
    Number.isInteger(value.bodyBytes) && Number(value.bodyBytes) >= 0 && Number(value.bodyBytes) <= 256 * 1024 &&
    typeof value.bodyBase64 === "string" && value.bodyBase64.length === 4 * Math.ceil(Number(value.bodyBytes) / 3) &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value.bodyBase64) &&
    typeof value.bodySha256 === "string" && /^[a-f0-9]{64}$/u.test(value.bodySha256)
}

export interface DashboardWebhookDto {
  readonly id: string
  readonly publicId: string
  readonly name: string
  readonly enabled: boolean
  readonly url: string | null
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
  readonly acknowledgedClientCount: number
  readonly clientReceipts: readonly WebhookDeliveryClientReceiptDto[]
  readonly status: WebhookDeliveryStatus
  readonly error?: string
}

export interface WebhookDeliveryHistoryWebhookDto {
  readonly id: string
  readonly publicId: string
  readonly name: string
  readonly currentName?: string
  readonly deletedAt?: string
}

export interface WebhookDeliveryHistoryUserDto {
  readonly id: string
  readonly email: string
  readonly handle: string
}

export interface WebhookDeliveryHistoryDto extends WebhookDeliveryDto {
  readonly webhook: WebhookDeliveryHistoryWebhookDto
  readonly user?: WebhookDeliveryHistoryUserDto
}

export interface WebhookDeliveryClientReceiptDto {
  readonly id: string
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly platform: string
  readonly appVersion: string
  readonly sentAt: string
  readonly acknowledgedAt?: string
  readonly status: WebhookDeliveryClientReceiptStatus
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
/** Immutable, sanitized body snapshot; never a raw credential-bearing request. */
export interface WebhookDeliveryBodyDto {
  readonly schemaVersion: 1
  readonly payloadVersion: 1
  readonly deliveryId: string
  readonly webhookPublicId: string
  readonly receivedAt: string
  readonly contentType: string | null
  readonly bodyKind: string
  readonly bodyText: string
  readonly bodyBytes: number
  readonly bodySha256: string
  readonly complete: true
  readonly redactionPolicy: "webhook-v1"
  readonly retention: "latest-100-per-webhook"
  readonly expiresAt: null
}
