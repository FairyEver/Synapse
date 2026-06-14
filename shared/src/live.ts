import { isWebhookDeliveryReceivedPayload } from "./webhook.js"

export const LIVE_MESSAGE_TYPES = {
  hello: "live.hello",
  welcome: "live.welcome",
  ping: "live.ping",
  pong: "live.pong",
  webhookDeliveryReceived: "webhook.delivery.received",
  webhookDeliveryAck: "webhook.delivery.ack",
} as const

export const LIVE_HELLO_FIELD_LIMITS = {
  clientInstanceId: 120,
  deviceName: 120,
  platform: 80,
  appVersion: 80,
} as const

export type LiveMessageType = typeof LIVE_MESSAGE_TYPES[keyof typeof LIVE_MESSAGE_TYPES]

export interface LiveEnvelope<TType extends string, TPayload> {
  readonly type: TType
  readonly id: string
  readonly sentAt: string
  readonly payload: TPayload
}

export interface LiveDesktopHelloPayload {
  readonly clientInstanceId: string
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
}

export interface LiveDesktopWelcomePayload {
  readonly connectionId: string
  readonly serverTime: string
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
}

export interface LiveDesktopPingPayload {
  readonly sentAt: string
}

export interface LiveDesktopPongPayload {
  readonly serverTime: string
}

export interface LiveWebhookDeliveryAckPayload {
  readonly deliveryId: string
}

export type LiveDesktopClientMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.hello, LiveDesktopHelloPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.ping, LiveDesktopPingPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.webhookDeliveryAck, LiveWebhookDeliveryAckPayload>

export type LiveDesktopServerMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.welcome, LiveDesktopWelcomePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.pong, LiveDesktopPongPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.webhookDeliveryReceived, import("./webhook.js").WebhookDeliveryReceivedPayload>

export function createLiveEnvelope<TType extends LiveMessageType, TPayload>(
  type: TType,
  payload: TPayload,
  metadata: { readonly id: string; readonly sentAt: string },
): LiveEnvelope<TType, TPayload> {
  return { type, id: metadata.id, sentAt: metadata.sentAt, payload }
}

export function isLiveEnvelope(value: unknown): value is LiveEnvelope<string, unknown> {
  if (!isRecord(value)) return false
  return typeof value.type === "string" &&
    typeof value.id === "string" &&
    typeof value.sentAt === "string" &&
    "payload" in value &&
    isRecord(value.payload)
}

export function isLiveDesktopClientMessage(value: unknown): value is LiveDesktopClientMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.hello) return isHelloPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.ping) return isPingPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.webhookDeliveryAck) return isWebhookDeliveryAckPayload(value.payload)
  return false
}

export function isLiveDesktopServerMessage(value: unknown): value is LiveDesktopServerMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.welcome) return isWelcomePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.pong) return isPongPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived) {
    return isWebhookDeliveryReceivedPayload(value.payload)
  }
  return false
}

function isHelloPayload(value: unknown): value is LiveDesktopHelloPayload {
  return isRecord(value) &&
    boundedString(value.clientInstanceId, LIVE_HELLO_FIELD_LIMITS.clientInstanceId) &&
    boundedString(value.appVersion, LIVE_HELLO_FIELD_LIMITS.appVersion) &&
    boundedString(value.platform, LIVE_HELLO_FIELD_LIMITS.platform) &&
    boundedString(value.deviceName, LIVE_HELLO_FIELD_LIMITS.deviceName)
}

function isWelcomePayload(value: unknown): value is LiveDesktopWelcomePayload {
  return isRecord(value) &&
    nonEmptyString(value.connectionId) &&
    nonEmptyString(value.serverTime) &&
    positiveNumber(value.heartbeatIntervalMs) &&
    positiveNumber(value.heartbeatTimeoutMs)
}

function isPingPayload(value: unknown): value is LiveDesktopPingPayload {
  return isRecord(value) && nonEmptyString(value.sentAt)
}

function isPongPayload(value: unknown): value is LiveDesktopPongPayload {
  return isRecord(value) && nonEmptyString(value.serverTime)
}

function isWebhookDeliveryAckPayload(value: unknown): value is LiveWebhookDeliveryAckPayload {
  return isRecord(value) && nonEmptyString(value.deliveryId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function boundedString(value: unknown, maxLength: number): value is string {
  return nonEmptyString(value) && value.length <= maxLength
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}
