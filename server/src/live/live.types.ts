export type LiveClientStatus = "online" | "stale" | "offline"

export type LiveClientDisconnectReason =
  | "socket_close"
  | "socket_error"
  | "heartbeat_timeout"
  | "server_shutdown"
  | "superseded"
  | "auth_failed"
  | "user_disabled"

export interface LiveClientInstance {
  readonly userId: string
  readonly clientInstanceId: string
  readonly connectionId: string | null
  readonly status: LiveClientStatus
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  /** Private connection metadata; never included in public device DTOs. */
  readonly machineFingerprint?: string
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: LiveClientDisconnectReason
}

/**
 * One computer a phone can reach right now, with the name its user gave it and
 * the system it reported.
 *
 * Both ride here rather than on `mobile.presence` on purpose: presence is a
 * broadcast to every phone of the account and its payload is byte-budgeted, while
 * this is fetched by the one phone that is drawing a picker. A phone that never
 * opens the picker pays nothing for it.
 *
 * Both are required because every online entry has one — they come from the
 * desktop's `hello` and are required fields on the registry record.
 *
 * `platform` is passed through exactly as the computer reported it
 * (`darwin-arm64`, `win32-x64`): the cloud has no opinion about what a phone
 * should draw with it, and keeping the raw value means the phone's fallback for
 * anything it does not recognise is its own decision rather than a silent
 * normalisation here.
 */
export interface LiveReachableDesktop {
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly platform: string
}

export interface LiveClientPublicDto {
  readonly userId?: string
  readonly clientInstanceId: string
  readonly status: LiveClientStatus
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: LiveClientDisconnectReason
}

export type {
  LiveDesktopClientMessage,
  LiveDesktopHelloPayload as LiveDesktopHello,
  LiveDesktopPingPayload as LiveDesktopPing,
  LiveDesktopPongPayload as LiveDesktopPong,
  LiveDesktopServerMessage,
  LiveDesktopWelcomePayload as LiveDesktopWelcome,
} from "@synapse/shared"

export interface LiveClientChangedEvent {
  readonly type: "live.client.changed"
  readonly client: LiveClientPublicDto
  readonly occurredAt: string
}
