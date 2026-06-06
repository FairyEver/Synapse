export type SynapseLiveStatus = "connected" | "reconnecting" | "disconnected" | "unauthenticated"

export type SynapseLiveServerClientStatus = "online" | "stale" | "offline"

export interface SynapseLiveState {
  readonly status: SynapseLiveStatus
  readonly clientInstanceId: string | null
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly lastError: string | null
}

export interface SynapseLiveStateChangedEvent {
  readonly state: SynapseLiveState
}

export interface SynapseLiveClient {
  readonly userId?: string
  readonly clientInstanceId: string
  readonly status: SynapseLiveServerClientStatus
  readonly appVersion: string
  readonly platform: string
  readonly deviceName: string
  readonly connectedAt: string | null
  readonly lastSeenAt: string | null
  readonly disconnectedAt?: string
  readonly disconnectReason?: string
}
