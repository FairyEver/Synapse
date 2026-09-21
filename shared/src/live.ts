import {
  isMobileDetachedPayload,
  isMobileFramePayload,
  isMobileIntentPayload,
  isMobileIntentResultPayload,
  isMobileQuickPhrasesPayload,
  isMobileSummaryPayload,
  isMobileToolbarPayload,
  isMobileTransferProgressPayload,
} from "./mobile-live.js"
import { isMobilePresencePayload } from "./mobile-live.js"
import { isMeetingTranscriptionCompletedPayload } from "./meeting.js"
import { isWebhookDeliveryReceivedPayload } from "./webhook.js"

export const LIVE_MESSAGE_TYPES = {
  hello: "live.hello",
  welcome: "live.welcome",
  ping: "live.ping",
  pong: "live.pong",
  webhookDeliveryReceived: "webhook.delivery.received",
  webhookDeliveryAck: "webhook.delivery.ack",
  mobileSummary: "mobile.summary",
  mobileFrame: "mobile.frame",
  mobileIntent: "mobile.intent",
  mobileIntentResult: "mobile.intentResult",
  mobileTransferProgress: "mobile.transferProgress",
  mobileDetached: "mobile.detached",
  mobilePresence: "mobile.presence",
  mobileToolbar: "mobile.toolbar",
  mobileQuickPhrases: "mobile.quickPhrases",
  meetingTranscriptionCompleted: "meeting.transcription.completed",
} as const

/**
 * Close codes the desktop gateway defines beyond the standard ones.
 *
 * Shared rather than written twice, because this one is a decision the two ends
 * have to agree on: the server closes with it and the desktop acts on it, and a
 * literal in each place drifts the first time one of them is edited.
 *
 * `clientInstanceIdConflict` says "this id is already held by a different
 * machine". It exists because an installation's id is generated locally and can
 * be carried to a second machine by a migration or a restored backup, and the
 * registry keeps one entry per id — so the two would otherwise take turns
 * evicting each other, and every phone of the account would see a single
 * computer whose identity flipped between them. The newcomer is the one that
 * can act on it, so it is the one told.
 */
export const LIVE_DESKTOP_CLOSE_CODES = {
  clientInstanceIdConflict: 4009,
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
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileSummary, import("./mobile-live.js").MobileSummaryPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileFrame, import("./mobile-live.js").MobileFramePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileIntentResult, import("./mobile-live.js").MobileIntentResultPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileTransferProgress, import("./mobile-live.js").MobileTransferProgressPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileToolbar, import("./mobile-live.js").MobileToolbarPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileQuickPhrases, import("./mobile-live.js").MobileQuickPhrasesPayload>

export type LiveDesktopServerMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.welcome, LiveDesktopWelcomePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.pong, LiveDesktopPongPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.webhookDeliveryReceived, import("./webhook.js").WebhookDeliveryReceivedPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileIntent, import("./mobile-live.js").MobileIntentPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileDetached, import("./mobile-live.js").MobileDetachedPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.meetingTranscriptionCompleted, import("./meeting.js").MeetingTranscriptionCompletedPayload>

/**
 * A phone reuses the desktop handshake (hello/welcome/ping/pong) so there is one
 * connection lifecycle to reason about, and adds only the terminal families.
 *
 * These unions exist because the phone sits on the opposite side of the same
 * envelopes: it sends what a desktop receives and receives what a desktop sends.
 * Naming them from the phone's perspective keeps the iOS client readable.
 */
export type LiveMobileClientMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.hello, LiveDesktopHelloPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.ping, LiveDesktopPingPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileIntent, import("./mobile-live.js").MobileIntentPayload>

export type LiveMobileServerMessage =
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.welcome, LiveDesktopWelcomePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.pong, LiveDesktopPongPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileSummary, import("./mobile-live.js").MobileSummaryPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileFrame, import("./mobile-live.js").MobileFramePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileIntentResult, import("./mobile-live.js").MobileIntentResultPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileTransferProgress, import("./mobile-live.js").MobileTransferProgressPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobilePresence, import("./mobile-live.js").MobilePresencePayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileToolbar, import("./mobile-live.js").MobileToolbarPayload>
  | LiveEnvelope<typeof LIVE_MESSAGE_TYPES.mobileQuickPhrases, import("./mobile-live.js").MobileQuickPhrasesPayload>

export function isLiveMobileClientMessage(value: unknown): value is LiveMobileClientMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.hello) return isHelloPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.ping) return isPingPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileIntent) return isMobileIntentPayload(value.payload)
  return false
}

export function isLiveMobileServerMessage(value: unknown): value is LiveMobileServerMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.welcome) return isWelcomePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.pong) return isPongPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileSummary) return isMobileSummaryPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileFrame) return isMobileFramePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileIntentResult) {
    return isMobileIntentResultPayload(value.payload)
  }
  if (value.type === LIVE_MESSAGE_TYPES.mobileTransferProgress) {
    return isMobileTransferProgressPayload(value.payload)
  }
  if (value.type === LIVE_MESSAGE_TYPES.mobilePresence) return isMobilePresencePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileToolbar) return isMobileToolbarPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileQuickPhrases) return isMobileQuickPhrasesPayload(value.payload)
  return false
}

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
  if (value.type === LIVE_MESSAGE_TYPES.mobileSummary) return isMobileSummaryPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileFrame) return isMobileFramePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileIntentResult) {
    return isMobileIntentResultPayload(value.payload)
  }
  if (value.type === LIVE_MESSAGE_TYPES.mobileTransferProgress) {
    return isMobileTransferProgressPayload(value.payload)
  }
  if (value.type === LIVE_MESSAGE_TYPES.mobileToolbar) return isMobileToolbarPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileQuickPhrases) return isMobileQuickPhrasesPayload(value.payload)
  return false
}

export function isLiveDesktopServerMessage(value: unknown): value is LiveDesktopServerMessage {
  if (!isLiveEnvelope(value)) return false
  if (value.type === LIVE_MESSAGE_TYPES.welcome) return isWelcomePayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.pong) return isPongPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.webhookDeliveryReceived) {
    return isWebhookDeliveryReceivedPayload(value.payload)
  }
  if (value.type === LIVE_MESSAGE_TYPES.mobileIntent) return isMobileIntentPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.mobileDetached) return isMobileDetachedPayload(value.payload)
  if (value.type === LIVE_MESSAGE_TYPES.meetingTranscriptionCompleted) {
    return isMeetingTranscriptionCompletedPayload(value.payload)
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
