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
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: LiveClientDisconnectReason
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
