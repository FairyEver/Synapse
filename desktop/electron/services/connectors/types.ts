import type {
  ConnectorAllowlistV1,
  ConnectorDedupeStateV1,
  ConnectorEntryV1,
  ConnectorReconnectStateV1,
  ConnectorSessionKeyPolicyV1,
  ConnectorStatusV1,
  ConnectorWorkspaceConfigV1,
} from "../../runtime/data-repo"

export const CONNECTOR_REPOSITORY_SERVICE_ID = "connectors.repository"

export type ConnectorPlatform = "feishu"
export type ConnectorStatus = ConnectorStatusV1
export type ConnectorAllowlist = ConnectorAllowlistV1
export type ConnectorSessionKeyPolicy = ConnectorSessionKeyPolicyV1
export type ConnectorReconnectState = ConnectorReconnectStateV1
export type ConnectorDedupeState = ConnectorDedupeStateV1
export type ConnectorWorkspaceConfig = ConnectorWorkspaceConfigV1
export type ConnectorRecord = ConnectorEntryV1

export interface ConnectorCreateInput {
  readonly projectId: string
  readonly platform: ConnectorPlatform
  readonly secretRef?: string
  readonly status?: ConnectorStatus
  readonly allowlist?: ConnectorAllowlist
  readonly sessionKeyPolicy?: ConnectorSessionKeyPolicy
  readonly reconnect?: ConnectorReconnectState
  readonly dedupe?: ConnectorDedupeState
  readonly workspaceConfig?: ConnectorWorkspaceConfig
  readonly appId?: string
  readonly ownerOpenId?: string
  readonly metadata?: Record<string, unknown>
}

export interface ConnectorUpdateInput {
  readonly secretRef?: string
  readonly status?: ConnectorStatus
  readonly allowlist?: ConnectorAllowlist
  readonly sessionKeyPolicy?: ConnectorSessionKeyPolicy
  readonly reconnect?: ConnectorReconnectState
  readonly dedupe?: ConnectorDedupeState
  readonly workspaceConfig?: ConnectorWorkspaceConfig
  readonly appId?: string
  readonly ownerOpenId?: string
  readonly lastConnectedAt?: string
  readonly lastError?: string
  readonly metadata?: Record<string, unknown>
}

export interface FeishuConnectorSummary {
  readonly id: string
  readonly projectId: string
  readonly platform: "feishu"
  readonly appId?: string
  readonly ownerOpenId?: string
  readonly status: ConnectorStatus
  readonly allowlist: ConnectorAllowlist
  readonly sessionKeyPolicy: ConnectorSessionKeyPolicy
  readonly reconnect?: ConnectorReconnectState
  readonly dedupe?: ConnectorDedupeState
  readonly workspaceConfig?: ConnectorWorkspaceConfig
  readonly lastConnectedAt?: string
  readonly lastError?: string
  readonly createdAt?: string
  readonly updatedAt?: string
}
