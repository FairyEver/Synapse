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
  workspaceConfig?: SynapseFeishuWorkspaceConfig
  lastConnectedAt?: string
  lastError?: string
  createdAt?: string
  updatedAt?: string
}

export type SynapseFeishuWorkspaceConfig = {
  enabled: boolean
  baseDir?: string
  autoBindByChannelName?: boolean
  idleTimeoutMs?: number
}

export type SynapseFeishuWorkspaceBinding = {
  id: string
  schemaVersion: 1
  projectId?: string
  scope: "project" | "shared"
  platform: "feishu"
  channelKey: string
  channelName?: string
  workspacePath: string
  baseDir?: string
  boundBy?: string
  boundAt: string
  updatedAt: string
}

export type SynapseFeishuWorkspaceBindingsSummary = {
  project: SynapseFeishuWorkspaceBinding[]
  shared: SynapseFeishuWorkspaceBinding[]
}

export type SynapseFeishuWorkspaceConfigPayload = {
  projectId: string
  enabled: boolean
  baseDir?: string
  autoBindByChannelName?: boolean
  idleTimeoutMs?: number
}

export type SynapseFeishuWorkspaceRoutePayload = {
  projectId: string
  scope: "project" | "shared"
  channelKey: string
  workspacePath: string
  channelName?: string
}

export type SynapseFeishuWorkspaceUnbindPayload = {
  projectId: string
  scope: "project" | "shared"
  channelKey: string
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
