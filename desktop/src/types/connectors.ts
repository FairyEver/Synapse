export type SynapseConnectorStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "degraded"
  | "error"

export type SynapseFeishuConnectorSummary = {
  id: string
  projectId: string
  platform: "feishu"
  appId?: string
  ownerOpenId?: string
  status: SynapseConnectorStatus
  allowlist: {
    mode: "all" | "users"
    userIds?: string[]
    adminIds?: string[]
  }
  sessionKeyPolicy: {
    mode: "per-user" | "per-channel" | "thread"
    format?: string
  }
  reconnect?: {
    attempts: number
    lastConnectedAt?: string
    nextRetryAt?: string
    lastError?: string
  }
  dedupe?: {
    ttlMs: number
    lastMessageIds?: string[]
    ignoreBefore?: string
  }
  lastConnectedAt?: string
  lastError?: string
  createdAt?: string
  updatedAt?: string
}

export type SynapseFeishuConnectorRuntimeStatus = {
  projectId: string
  configured: boolean
  running: boolean
  connector?: SynapseFeishuConnectorSummary
}

export type SynapseFeishuSetupBeginResult = {
  setupId: string
  deviceCode: string
  qrUrl: string
  intervalSeconds: number
  expiresAt: string
}

export type SynapseFeishuSetupPollResult = {
  status:
    | "pending"
    | "slow_down"
    | "denied"
    | "expired"
    | "completed"
    | "unsupported_platform"
    | "error"
  intervalSeconds?: number
  appId?: string
  ownerOpenId?: string
  message?: string
}

export type SynapseFeishuManualCredentialsPayload = {
  projectId: string
  appId: string
  appSecret: string
  ownerOpenId?: string
}
