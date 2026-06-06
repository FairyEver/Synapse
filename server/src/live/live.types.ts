export type LiveClientStatus = "online" | "stale" | "offline"

export type LiveClientDisconnectReason =
  | "socket_close"
  | "socket_error"
  | "heartbeat_timeout"
  | "superseded"
  | "auth_failed"

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

export interface LiveDesktopHello {
  readonly type: "hello"
  readonly clientInstanceId: string
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
}

export interface LiveDesktopWelcome {
  readonly type: "welcome"
  readonly connectionId: string
  readonly serverTime: string
  readonly heartbeatIntervalMs: number
  readonly heartbeatTimeoutMs: number
}

export interface LiveDesktopPing {
  readonly type: "ping"
  readonly sentAt: string
}

export interface LiveDesktopPong {
  readonly type: "pong"
  readonly serverTime: string
}

export type LiveDesktopClientMessage = LiveDesktopHello | LiveDesktopPing
export type LiveDesktopServerMessage = LiveDesktopWelcome | LiveDesktopPong

export interface LiveClientChangedEvent {
  readonly type: "live.client.changed"
  readonly client: LiveClientPublicDto
  readonly occurredAt: string
}
