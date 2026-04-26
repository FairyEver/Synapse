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

export type SynapseFeishuScheduledJob = {
  id: string
  schemaVersion: 1
  projectId: string
  platform: "feishu"
  connectorId: string
  sessionKey: string
  channelKey?: string
  channelName?: string
  workspaceKey?: string
  workspacePath?: string
  kind: "prompt" | "exec"
  cronExpr: string
  prompt?: string
  exec?: string
  workDir?: string
  description?: string
  enabled: boolean
  silent: boolean
  mute: boolean
  sessionMode: "reuse" | "new_per_run"
  modeOverride?: string
  timeoutMins?: number
  createdAt: string
  updatedAt: string
  createdBy?: string
  lastRunAt?: string
  lastError?: string
  lastStatus?: "success" | "failed" | "timeout" | "skipped"
  nextRunAt?: string
  runCount: number
}

export type SynapseFeishuAutomationProjectFields = {
  projectName?: string
  connectorStatus?: SynapseConnectorStatus
  connectorConfigured: boolean
  connectorRunning: boolean
}

export type SynapseFeishuScheduledJobWithProject =
  SynapseFeishuScheduledJob & SynapseFeishuAutomationProjectFields

export type SynapseFeishuScheduledJobPayload = {
  projectId: string
  connectorId: string
  sessionKey: string
  channelKey?: string
  channelName?: string
  workspaceKey?: string
  workspacePath?: string
  kind: "prompt" | "exec"
  cronExpr: string
  prompt?: string
  exec?: string
  workDir?: string
  description?: string
  enabled?: boolean
  silent?: boolean
  mute?: boolean
  sessionMode?: "reuse" | "new_per_run" | "new-per-run"
  modeOverride?: string
  timeoutMins?: number
}

export type SynapseFeishuHeartbeat = {
  id: string
  schemaVersion: 1
  projectId: string
  platform: "feishu"
  connectorId: string
  sessionKey: string
  channelKey?: string
  workspaceKey?: string
  workspacePath?: string
  enabled: boolean
  paused: boolean
  intervalMins: number
  prompt: string
  silent: boolean
  mute: boolean
  timeoutMins?: number
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  lastError?: string
  lastStatus?: "success" | "failed" | "timeout" | "skipped"
  nextRunAt?: string
  runCount: number
}

export type SynapseFeishuHeartbeatWithProject =
  SynapseFeishuHeartbeat & SynapseFeishuAutomationProjectFields

export type SynapseFeishuHeartbeatPayload = {
  projectId: string
  connectorId: string
  sessionKey: string
  channelKey?: string
  workspaceKey?: string
  workspacePath?: string
  intervalMins: number
  prompt?: string
  enabled?: boolean
  paused?: boolean
  silent?: boolean
  mute?: boolean
  timeoutMins?: number
}
