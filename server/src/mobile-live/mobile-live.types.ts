import type { LiveMobileServerMessage } from "@synapse/shared"

/**
 * DI token for the phone-side connection registry.
 *
 * It is a second instance of `LiveClientRegistry` rather than a new state
 * machine: same supersede, staleness, and offline-retention semantics, but a
 * separate map. Sharing one map would let a phone whose `clientInstanceId`
 * collided with a desktop's supersede that desktop, and would make
 * `broadcastToUser` — which means "every device this user has" — start reaching
 * phones.
 */
export const MOBILE_CLIENT_REGISTRY = "MOBILE_CLIENT_REGISTRY"

export interface MobileLiveFanout {
  readonly sendToMobile: (input: {
    readonly userId: string
    readonly clientInstanceId: string
    readonly message: LiveMobileServerMessage
  }) => "sent" | "offline" | "send_failed"
}

export const MOBILE_LIVE_HEARTBEAT_INTERVAL_MS = 20_000
export const MOBILE_LIVE_HEARTBEAT_TIMEOUT_MS = 45_000

/**
 * Phones send far less than desktops: a few intents and a keepalive, plus the
 * occasional pasted command. 32 KiB is generous for that while staying far below
 * what an abusive client could use to pin memory.
 */
export const MOBILE_LIVE_MAX_PAYLOAD_BYTES = 32 * 1024

/** Inbound message budget per connection. The desktop channel has no equivalent. */
export const MOBILE_LIVE_RATE_WINDOW_MS = 10_000
export const MOBILE_LIVE_RATE_MESSAGES_PER_WINDOW = 300

/** A phone that stops heartbeating is dropped after this, so its leases can be freed. */
export const MOBILE_DETACH_REASON_CLOSED = "socket_close"
export const MOBILE_DETACH_REASON_TIMEOUT = "heartbeat_timeout"
export const MOBILE_DETACH_REASON_SHUTDOWN = "server_shutdown"
