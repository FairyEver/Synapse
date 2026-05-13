/**
 * Phase 0.7 — Business schemas for CC Connect foundations.
 *
 * These namespaces were introduced as v1 placeholders in Phase 0.2. They keep
 * schemaVersion=1 here because no production business data has been written
 * yet; this file upgrades the v1 shape before AgentRuntime/Connector/Scheduler
 * services start using it.
 */

import type { Migration, NamespaceSchema } from "../types"

const isAnyRecord = <T extends Record<string, unknown>>(value: unknown): value is T => {
  return typeof value === "object" && value !== null
}

const noMigrations: readonly Migration[] = []

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string"

const isOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === "boolean"

const isOptionalNumber = (value: unknown): boolean =>
  value === undefined || typeof value === "number"

const isOptionalRecord = (value: unknown): value is Record<string, unknown> | undefined =>
  value === undefined || isAnyRecord<Record<string, unknown>>(value)

export interface SecretEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  /** Cipher-resolved value lives in EncryptedJsonBackend storage; this struct is wrapper metadata. */
  kind: "api-key" | "oauth-token" | "webhook-secret" | "generic"
  value?: string
  description?: string
}

export const secretsSchema: NamespaceSchema<SecretEntryV1> = {
  name: "secrets",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (v): v is SecretEntryV1 =>
    isAnyRecord<SecretEntryV1>(v)
    && (v as SecretEntryV1).schemaVersion === 1
    && typeof (v as SecretEntryV1).id === "string"
    && ["api-key", "oauth-token", "webhook-secret", "generic"].includes(
      (v as SecretEntryV1).kind,
    ),
}

export interface ProviderModelEntryV1 extends Record<string, unknown> {
  id: string
  display?: string
  alias?: string
}

export interface ProviderCodexOptionsV1 extends Record<string, unknown> {
  envKey?: string
  wireApi?: string
  httpHeaders?: Record<string, string>
  codexHome?: string
}

export interface ProviderOptionsV1 extends Record<string, unknown> {
  env?: Record<string, string>
  thinking?: string
  effort?: string
  endpoints?: Record<string, string>
  agentModels?: Record<string, string>
  agentModelLists?: Record<string, ProviderModelEntryV1[]>
  codex?: ProviderCodexOptionsV1
}

export interface ProviderEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  /** "global" provider definition or "project" provider selection/ref state. */
  scope: "global" | "project"
  kind: string
  projectId?: string
  display?: string
  baseUrl?: string
  secretRef?: string
  models?: ProviderModelEntryV1[]
  activeProviderId?: string
  activeModel?: string
  activeMode?: string
  providerRefs?: string[]
  agentType?: string
  agentTypes?: string[]
  env?: Record<string, string>
  thinking?: string
  options?: ProviderOptionsV1
  createdAt?: string
  updatedAt?: string
}

export const providersSchema: NamespaceSchema<ProviderEntryV1> = {
  name: "providers",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ProviderEntryV1 =>
    isAnyRecord<ProviderEntryV1>(v)
    && (v as ProviderEntryV1).schemaVersion === 1
    && typeof (v as ProviderEntryV1).id === "string"
    && ((v as ProviderEntryV1).scope === "global" || (v as ProviderEntryV1).scope === "project")
    && typeof (v as ProviderEntryV1).kind === "string"
    && isOptionalString((v as ProviderEntryV1).projectId)
    && isOptionalString((v as ProviderEntryV1).baseUrl)
    && isOptionalString((v as ProviderEntryV1).secretRef)
    && isOptionalString((v as ProviderEntryV1).activeMode)
    && ((v as ProviderEntryV1).models === undefined || isProviderModelArray((v as ProviderEntryV1).models))
    && ((v as ProviderEntryV1).providerRefs === undefined || isStringArray((v as ProviderEntryV1).providerRefs))
    && ((v as ProviderEntryV1).agentTypes === undefined || isStringArray((v as ProviderEntryV1).agentTypes))
    && ((v as ProviderEntryV1).env === undefined || isStringRecord((v as ProviderEntryV1).env))
    && isOptionalString((v as ProviderEntryV1).thinking)
    && ((v as ProviderEntryV1).options === undefined || isProviderOptions((v as ProviderEntryV1).options)),
}

export interface ProjectEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  workspacePath?: string
  activeProviderId?: string
  activeModel?: string
  activeMode?: string
  createdAt?: string
  updatedAt?: string
}

export const projectsSchema: NamespaceSchema<ProjectEntryV1> = {
  name: "projects",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ProjectEntryV1 =>
    isAnyRecord<ProjectEntryV1>(v)
    && (v as ProjectEntryV1).schemaVersion === 1
    && typeof (v as ProjectEntryV1).id === "string"
    && typeof (v as ProjectEntryV1).name === "string"
    && isOptionalString((v as ProjectEntryV1).workspacePath),
}

export type ConnectorStatusV1 =
  | "disabled"
  | "connecting"
  | "connected"
  | "degraded"
  | "error"

export interface ConnectorAllowlistV1 extends Record<string, unknown> {
  mode: "all" | "users"
  userIds?: string[]
  adminIds?: string[]
}

export interface ConnectorSessionKeyPolicyV1 extends Record<string, unknown> {
  mode: "per-user" | "per-channel" | "thread"
  format?: string
}

export interface ConnectorReconnectStateV1 extends Record<string, unknown> {
  attempts: number
  lastConnectedAt?: string
  nextRetryAt?: string
  lastError?: string
}

export interface ConnectorDedupeStateV1 extends Record<string, unknown> {
  ttlMs: number
  lastMessageIds?: string[]
  ignoreBefore?: string
}

export interface ConnectorWorkspaceConfigV1 extends Record<string, unknown> {
  enabled: boolean
  baseDir?: string
  autoBindByChannelName?: boolean
  idleTimeoutMs?: number
}

export interface ConnectorEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  platform: string
  secretRef?: string
  status: ConnectorStatusV1
  allowlist: ConnectorAllowlistV1
  sessionKeyPolicy: ConnectorSessionKeyPolicyV1
  reconnect?: ConnectorReconnectStateV1
  dedupe?: ConnectorDedupeStateV1
  workspaceConfig?: ConnectorWorkspaceConfigV1
  createdAt?: string
  updatedAt?: string
}

export const connectorsSchema: NamespaceSchema<ConnectorEntryV1> = {
  name: "connectors",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ConnectorEntryV1 =>
    isAnyRecord<ConnectorEntryV1>(v)
    && (v as ConnectorEntryV1).schemaVersion === 1
    && typeof (v as ConnectorEntryV1).id === "string"
    && typeof (v as ConnectorEntryV1).projectId === "string"
    && typeof (v as ConnectorEntryV1).platform === "string"
    && isConnectorStatus((v as ConnectorEntryV1).status)
    && isConnectorAllowlist((v as ConnectorEntryV1).allowlist)
    && isConnectorSessionKeyPolicy((v as ConnectorEntryV1).sessionKeyPolicy)
    && ((v as ConnectorEntryV1).reconnect === undefined || isReconnectState((v as ConnectorEntryV1).reconnect))
    && ((v as ConnectorEntryV1).dedupe === undefined || isDedupeState((v as ConnectorEntryV1).dedupe))
    && ((v as ConnectorEntryV1).workspaceConfig === undefined || isConnectorWorkspaceConfig((v as ConnectorEntryV1).workspaceConfig)),
}

export interface WorkspaceBindingEntryV1 extends Record<string, unknown> {
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

export const workspaceBindingsSchema: NamespaceSchema<WorkspaceBindingEntryV1> = {
  name: "workspace.bindings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is WorkspaceBindingEntryV1 =>
    isAnyRecord<WorkspaceBindingEntryV1>(v)
    && (v as WorkspaceBindingEntryV1).schemaVersion === 1
    && typeof (v as WorkspaceBindingEntryV1).id === "string"
    && ((v as WorkspaceBindingEntryV1).scope === "project" || (v as WorkspaceBindingEntryV1).scope === "shared")
    && (v as WorkspaceBindingEntryV1).platform === "feishu"
    && isOptionalString((v as WorkspaceBindingEntryV1).projectId)
    && typeof (v as WorkspaceBindingEntryV1).channelKey === "string"
    && typeof (v as WorkspaceBindingEntryV1).workspacePath === "string"
    && isOptionalString((v as WorkspaceBindingEntryV1).channelName)
    && isOptionalString((v as WorkspaceBindingEntryV1).baseDir)
    && isOptionalString((v as WorkspaceBindingEntryV1).boundBy)
    && typeof (v as WorkspaceBindingEntryV1).boundAt === "string"
    && typeof (v as WorkspaceBindingEntryV1).updatedAt === "string",
}

export interface ConversationHistoryEntryV1 extends Record<string, unknown> {
  role: "user" | "assistant" | "system" | "tool"
  content: string
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ConversationUserMetaV1 extends Record<string, unknown> {
  userId?: string
  userName?: string
  chatName?: string
  platform?: string
  channelKey?: string
  workspaceKey?: string
  workspacePath?: string
}

export type ConversationResumePolicyV1 = "resume" | "fresh" | "continue"

export interface ConversationUsageV1 extends Record<string, unknown> {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ConversationEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  sessionKey: string
  providerId?: string
  sdkSessionId?: string
  usage?: ConversationUsageV1
  costUsd?: number
  platform?: string
  channelKey?: string
  workspaceKey?: string
  workspacePath?: string
  agentType?: string
  agentSessionId?: string
  pastAgentSessionIds?: string[]
  agentConfig?: {
    model?: string
    mode?: string
    env?: Record<string, string>
  }
  resumePolicy?: ConversationResumePolicyV1
  history: ConversationHistoryEntryV1[]
  userMeta?: ConversationUserMetaV1
  active: boolean
  name?: string
  createdAt: string
  updatedAt: string
}

export const conversationsSchema: NamespaceSchema<ConversationEntryV1> = {
  name: "conversations",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is ConversationEntryV1 =>
    isAnyRecord<ConversationEntryV1>(v)
    && (v as ConversationEntryV1).schemaVersion === 1
    && typeof (v as ConversationEntryV1).id === "string"
    && typeof (v as ConversationEntryV1).projectId === "string"
    && typeof (v as ConversationEntryV1).sessionKey === "string"
    && isOptionalString((v as ConversationEntryV1).providerId)
    && isOptionalString((v as ConversationEntryV1).sdkSessionId)
    && ((v as ConversationEntryV1).usage === undefined || isConversationUsage((v as ConversationEntryV1).usage))
    && isOptionalNumber((v as ConversationEntryV1).costUsd)
    && isOptionalString((v as ConversationEntryV1).channelKey)
    && isOptionalString((v as ConversationEntryV1).workspaceKey)
    && isOptionalString((v as ConversationEntryV1).workspacePath)
    && Array.isArray((v as ConversationEntryV1).history)
    && (v as ConversationEntryV1).history.every(isConversationHistoryEntry)
    && typeof (v as ConversationEntryV1).active === "boolean"
    && isOptionalString((v as ConversationEntryV1).agentSessionId)
    && ((v as ConversationEntryV1).pastAgentSessionIds === undefined || isStringArray((v as ConversationEntryV1).pastAgentSessionIds))
    && ((v as ConversationEntryV1).resumePolicy === undefined || isConversationResumePolicy((v as ConversationEntryV1).resumePolicy))
    && isOptionalRecord((v as ConversationEntryV1).userMeta)
    && typeof (v as ConversationEntryV1).createdAt === "string"
    && typeof (v as ConversationEntryV1).updatedAt === "string",
}

export interface AgentEventEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: string
}

export const agentEventsSchema: NamespaceSchema<AgentEventEntryV1> = {
  name: "agent.events",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentEventEntryV1 =>
    isAnyRecord<AgentEventEntryV1>(v)
    && (v as AgentEventEntryV1).schemaVersion === 1
    && typeof (v as AgentEventEntryV1).id === "string"
    && typeof (v as AgentEventEntryV1).projectId === "string"
    && typeof (v as AgentEventEntryV1).conversationId === "string"
    && typeof (v as AgentEventEntryV1).turnId === "string"
    && typeof (v as AgentEventEntryV1).eventType === "string"
    && isAnyRecord((v as AgentEventEntryV1).payload)
    && typeof (v as AgentEventEntryV1).createdAt === "string",
}

export interface AuditActorV1 extends Record<string, unknown> {
  kind: "user" | "agent" | "extension" | "system" | "connector"
  id?: string
  display?: string
}

export interface AuditResourceV1 extends Record<string, unknown> {
  type: string
  id?: string
  projectId?: string
}

export interface AuditEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  action: string
  actor: AuditActorV1
  resource: AuditResourceV1
  outcome: "allowed" | "denied" | "failed"
  timestamp: string
  projectId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

export const auditSchema: NamespaceSchema<AuditEntryV1> = {
  name: "audit",
  backend: "jsonl",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AuditEntryV1 =>
    isAnyRecord<AuditEntryV1>(v)
    && (v as AuditEntryV1).schemaVersion === 1
    && typeof (v as AuditEntryV1).id === "string"
    && typeof (v as AuditEntryV1).action === "string"
    && isAuditActor((v as AuditEntryV1).actor)
    && isAuditResource((v as AuditEntryV1).resource)
    && ["allowed", "denied", "failed"].includes((v as AuditEntryV1).outcome)
    && typeof (v as AuditEntryV1).timestamp === "string"
    && isOptionalRecord((v as AuditEntryV1).metadata),
}

export type OutboxStatusV1 =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "dead-letter"

export interface OutboxDestinationV1 extends Record<string, unknown> {
  platform: string
  connectorId?: string
  sessionKey?: string
  replyCtx?: Record<string, unknown>
  externalId?: string
}

export interface OutboxPayloadV1 extends Record<string, unknown> {
  kind: "text" | "image" | "file" | "card" | "event"
  content?: string
  attachments?: Array<Record<string, unknown>>
  metadata?: Record<string, unknown>
}

export interface OutboxEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  destination: OutboxDestinationV1
  payload: OutboxPayloadV1
  attempts: number
  status: OutboxStatusV1
  lastError?: string
  nextAttemptAt?: string
  createdAt: string
  updatedAt: string
}

export const outboxSchema: NamespaceSchema<OutboxEntryV1> = {
  name: "outbox",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is OutboxEntryV1 =>
    isAnyRecord<OutboxEntryV1>(v)
    && (v as OutboxEntryV1).schemaVersion === 1
    && typeof (v as OutboxEntryV1).id === "string"
    && typeof (v as OutboxEntryV1).projectId === "string"
    && isOutboxDestination((v as OutboxEntryV1).destination)
    && isOutboxPayload((v as OutboxEntryV1).payload)
    && typeof (v as OutboxEntryV1).attempts === "number"
    && isOutboxStatus((v as OutboxEntryV1).status)
    && isOptionalString((v as OutboxEntryV1).lastError)
    && typeof (v as OutboxEntryV1).createdAt === "string"
    && typeof (v as OutboxEntryV1).updatedAt === "string",
}

export type AgentCommandKindV1 = "prompt" | "exec"
export type AgentCommandSourceV1 = "runtime" | "file"

export interface AgentCommandEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  name: string
  description?: string
  kind: AgentCommandKindV1
  prompt?: string
  exec?: string
  shell?: "posix" | "cmd" | "powershell"
  workDir?: string
  enabled: boolean
  source: AgentCommandSourceV1
  allowedPlatforms?: string[]
  adminOnly: boolean
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export const agentCommandsSchema: NamespaceSchema<AgentCommandEntryV1> = {
  name: "agent.commands",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentCommandEntryV1 =>
    isAnyRecord<AgentCommandEntryV1>(v)
    && (v as AgentCommandEntryV1).schemaVersion === 1
    && typeof (v as AgentCommandEntryV1).id === "string"
    && typeof (v as AgentCommandEntryV1).projectId === "string"
    && typeof (v as AgentCommandEntryV1).name === "string"
    && isOptionalString((v as AgentCommandEntryV1).description)
    && ((v as AgentCommandEntryV1).kind === "prompt" || (v as AgentCommandEntryV1).kind === "exec")
    && isOptionalString((v as AgentCommandEntryV1).prompt)
    && isOptionalString((v as AgentCommandEntryV1).exec)
    && ((v as AgentCommandEntryV1).shell === undefined
      || (v as AgentCommandEntryV1).shell === "posix"
      || (v as AgentCommandEntryV1).shell === "cmd"
      || (v as AgentCommandEntryV1).shell === "powershell")
    && isOptionalString((v as AgentCommandEntryV1).workDir)
    && typeof (v as AgentCommandEntryV1).enabled === "boolean"
    && ((v as AgentCommandEntryV1).source === "runtime" || (v as AgentCommandEntryV1).source === "file")
    && ((v as AgentCommandEntryV1).allowedPlatforms === undefined || isStringArray((v as AgentCommandEntryV1).allowedPlatforms))
    && typeof (v as AgentCommandEntryV1).adminOnly === "boolean"
    && typeof (v as AgentCommandEntryV1).createdAt === "string"
    && typeof (v as AgentCommandEntryV1).updatedAt === "string"
    && isOptionalString((v as AgentCommandEntryV1).createdBy),
}

export interface AgentCommandSettingsEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  agentNativeSlashAllowlist: string[]
  remoteAgentNativeSlashAllowlist: string[]
  updatedAt: string
}

export const agentCommandSettingsSchema: NamespaceSchema<AgentCommandSettingsEntryV1> = {
  name: "agent.command-settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentCommandSettingsEntryV1 =>
    isAnyRecord<AgentCommandSettingsEntryV1>(v)
    && (v as AgentCommandSettingsEntryV1).schemaVersion === 1
    && typeof (v as AgentCommandSettingsEntryV1).id === "string"
    && typeof (v as AgentCommandSettingsEntryV1).projectId === "string"
    && isStringArray((v as AgentCommandSettingsEntryV1).agentNativeSlashAllowlist)
    && isStringArray((v as AgentCommandSettingsEntryV1).remoteAgentNativeSlashAllowlist)
    && typeof (v as AgentCommandSettingsEntryV1).updatedAt === "string",
}

export type ScheduledTaskTriggerV1 =
  | { type: "builtin.cron"; config: { expr: string; timezone?: string } }
  | { type: "builtin.interval"; config: { everyMinutes: number; anchor?: "created_at" | "last_completed_at" } }

export type ScheduledTaskScopeV1 =
  | { type: "global" }
  | { type: "project"; projectId: string }

export type ScheduledTaskActionV1 = {
  type: string
  config: Record<string, unknown>
}

export type ScheduledTaskStatusV1 = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type ScheduledTaskRunStatusV1 = "running" | ScheduledTaskStatusV1
export type ScheduledTaskRunTriggerV1 = "schedule" | "manual" | "missed_run"

export interface ScheduledTaskEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 2
  name: string
  description?: string
  scope: ScheduledTaskScopeV1
  cwd?: string
  trigger: ScheduledTaskTriggerV1
  action: ScheduledTaskActionV1
  enabled: boolean
  missedRunPolicy: "skip" | "run_once"
  overlapPolicy: "skip"
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: ScheduledTaskStatusV1
  runCount: number
}

export interface ScheduledTaskRunEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 2
  taskId: string
  startedAt: string
  finishedAt?: string
  status: ScheduledTaskRunStatusV1
  triggeredBy: ScheduledTaskRunTriggerV1
  result?: Record<string, unknown>
  error?: string
}

export const taskSchedulerTasksSchema: NamespaceSchema<ScheduledTaskEntryV1> = {
  name: "task-scheduler.tasks",
  backend: "json",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (v): v is ScheduledTaskEntryV1 =>
    isAnyRecord<ScheduledTaskEntryV1>(v)
    && (v as ScheduledTaskEntryV1).schemaVersion === 2
    && typeof (v as ScheduledTaskEntryV1).id === "string"
    && typeof (v as ScheduledTaskEntryV1).name === "string"
    && isOptionalString((v as ScheduledTaskEntryV1).description)
    && isTaskScope((v as ScheduledTaskEntryV1).scope)
    && isOptionalString((v as ScheduledTaskEntryV1).cwd)
    && isTaskTrigger((v as ScheduledTaskEntryV1).trigger)
    && isTaskAction((v as ScheduledTaskEntryV1).action)
    && typeof (v as ScheduledTaskEntryV1).enabled === "boolean"
    && ((v as ScheduledTaskEntryV1).missedRunPolicy === "skip" || (v as ScheduledTaskEntryV1).missedRunPolicy === "run_once")
    && (v as ScheduledTaskEntryV1).overlapPolicy === "skip"
    && typeof (v as ScheduledTaskEntryV1).createdAt === "string"
    && typeof (v as ScheduledTaskEntryV1).updatedAt === "string"
    && isOptionalString((v as ScheduledTaskEntryV1).nextRunAt)
    && isOptionalString((v as ScheduledTaskEntryV1).lastRunAt)
    && isOptionalTaskStatus((v as ScheduledTaskEntryV1).lastStatus)
    && typeof (v as ScheduledTaskEntryV1).runCount === "number",
}

export const taskSchedulerRunsSchema: NamespaceSchema<ScheduledTaskRunEntryV1> = {
  name: "task-scheduler.runs",
  backend: "json",
  currentVersion: 2,
  migrations: noMigrations,
  validate: (v): v is ScheduledTaskRunEntryV1 =>
    isAnyRecord<ScheduledTaskRunEntryV1>(v)
    && (v as ScheduledTaskRunEntryV1).schemaVersion === 2
    && typeof (v as ScheduledTaskRunEntryV1).id === "string"
    && typeof (v as ScheduledTaskRunEntryV1).taskId === "string"
    && typeof (v as ScheduledTaskRunEntryV1).startedAt === "string"
    && isOptionalString((v as ScheduledTaskRunEntryV1).finishedAt)
    && isTaskRunStatus((v as ScheduledTaskRunEntryV1).status)
    && isTaskRunTrigger((v as ScheduledTaskRunEntryV1).triggeredBy)
    && ((v as ScheduledTaskRunEntryV1).result === undefined || isAnyRecord((v as ScheduledTaskRunEntryV1).result))
    && isOptionalString((v as ScheduledTaskRunEntryV1).error),
}

export type RunAsCheckStatusV1 = "pass" | "fail" | "unsupported"

export interface RunAsConfigEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  enabled: boolean
  user?: string
  envAllowlist: string[]
  requirePreflight: boolean
  lastPreflightAt?: string
  lastPreflightStatus?: RunAsCheckStatusV1
  lastAuditProbeAt?: string
  lastAuditProbeStatus?: RunAsCheckStatusV1
  lastError?: string
  createdAt: string
  updatedAt: string
}

export const runAsConfigSchema: NamespaceSchema<RunAsConfigEntryV1> = {
  name: "run_as.config",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is RunAsConfigEntryV1 =>
    isAnyRecord<RunAsConfigEntryV1>(v)
    && (v as RunAsConfigEntryV1).schemaVersion === 1
    && typeof (v as RunAsConfigEntryV1).id === "string"
    && typeof (v as RunAsConfigEntryV1).projectId === "string"
    && typeof (v as RunAsConfigEntryV1).enabled === "boolean"
    && isOptionalString((v as RunAsConfigEntryV1).user)
    && isStringArray((v as RunAsConfigEntryV1).envAllowlist)
    && typeof (v as RunAsConfigEntryV1).requirePreflight === "boolean"
    && isOptionalString((v as RunAsConfigEntryV1).lastPreflightAt)
    && ((v as RunAsConfigEntryV1).lastPreflightStatus === undefined
      || isRunAsCheckStatus((v as RunAsConfigEntryV1).lastPreflightStatus))
    && isOptionalString((v as RunAsConfigEntryV1).lastAuditProbeAt)
    && ((v as RunAsConfigEntryV1).lastAuditProbeStatus === undefined
      || isRunAsCheckStatus((v as RunAsConfigEntryV1).lastAuditProbeStatus))
    && isOptionalString((v as RunAsConfigEntryV1).lastError)
    && typeof (v as RunAsConfigEntryV1).createdAt === "string"
    && typeof (v as RunAsConfigEntryV1).updatedAt === "string",
}

export interface RunAsPreflightEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  user: string
  status: RunAsCheckStatusV1
  workspacePath?: string
  checks?: Record<string, unknown>
  warnings?: string[]
  error?: string
  createdAt: string
  updatedAt: string
}

export const runAsPreflightSchema: NamespaceSchema<RunAsPreflightEntryV1> = {
  name: "run_as.preflight",
  backend: "jsonl",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is RunAsPreflightEntryV1 =>
    isAnyRecord<RunAsPreflightEntryV1>(v)
    && (v as RunAsPreflightEntryV1).schemaVersion === 1
    && typeof (v as RunAsPreflightEntryV1).id === "string"
    && typeof (v as RunAsPreflightEntryV1).projectId === "string"
    && typeof (v as RunAsPreflightEntryV1).user === "string"
    && isRunAsCheckStatus((v as RunAsPreflightEntryV1).status)
    && isOptionalString((v as RunAsPreflightEntryV1).workspacePath)
    && isOptionalRecord((v as RunAsPreflightEntryV1).checks)
    && ((v as RunAsPreflightEntryV1).warnings === undefined || isStringArray((v as RunAsPreflightEntryV1).warnings))
    && isOptionalString((v as RunAsPreflightEntryV1).error)
    && typeof (v as RunAsPreflightEntryV1).createdAt === "string"
    && typeof (v as RunAsPreflightEntryV1).updatedAt === "string",
}

export interface WebhookConfigEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  enabled: boolean
  bindAddress: string
  preferredPort?: number
  assignedPort?: number
  path: string
  token?: string
  maxBodyBytes: number
  rateLimitPerMinute: number
  serviceRestartRequired?: boolean
  lastError?: string
  createdAt: string
  updatedAt: string
}

export const webhookConfigSchema: NamespaceSchema<WebhookConfigEntryV1> = {
  name: "webhook.config",
  backend: "encrypted-json",
  currentVersion: 1,
  migrations: noMigrations,
  encrypted: true,
  validate: (v): v is WebhookConfigEntryV1 =>
    isAnyRecord<WebhookConfigEntryV1>(v)
    && (v as WebhookConfigEntryV1).schemaVersion === 1
    && typeof (v as WebhookConfigEntryV1).id === "string"
    && typeof (v as WebhookConfigEntryV1).enabled === "boolean"
    && typeof (v as WebhookConfigEntryV1).bindAddress === "string"
    && isOptionalNumber((v as WebhookConfigEntryV1).preferredPort)
    && isOptionalNumber((v as WebhookConfigEntryV1).assignedPort)
    && typeof (v as WebhookConfigEntryV1).path === "string"
    && isOptionalString((v as WebhookConfigEntryV1).token)
    && typeof (v as WebhookConfigEntryV1).maxBodyBytes === "number"
    && typeof (v as WebhookConfigEntryV1).rateLimitPerMinute === "number"
    && isOptionalBoolean((v as WebhookConfigEntryV1).serviceRestartRequired)
    && isOptionalString((v as WebhookConfigEntryV1).lastError)
    && typeof (v as WebhookConfigEntryV1).createdAt === "string"
    && typeof (v as WebhookConfigEntryV1).updatedAt === "string",
}

export type WebhookRunStatusV1 = "queued" | "running" | "success" | "failed" | "timeout"

export interface WebhookRunEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  requestId: string
  projectId: string
  kind: "prompt" | "exec"
  status: WebhookRunStatusV1
  source: string
  sessionKey?: string
  workspacePath?: string
  startedAt: string
  finishedAt?: string
  resultText?: string
  lastError?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export const webhookRunsSchema: NamespaceSchema<WebhookRunEntryV1> = {
  name: "webhook.runs",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is WebhookRunEntryV1 =>
    isAnyRecord<WebhookRunEntryV1>(v)
    && (v as WebhookRunEntryV1).schemaVersion === 1
    && typeof (v as WebhookRunEntryV1).id === "string"
    && typeof (v as WebhookRunEntryV1).requestId === "string"
    && typeof (v as WebhookRunEntryV1).projectId === "string"
    && ((v as WebhookRunEntryV1).kind === "prompt" || (v as WebhookRunEntryV1).kind === "exec")
    && isWebhookRunStatus((v as WebhookRunEntryV1).status)
    && typeof (v as WebhookRunEntryV1).source === "string"
    && isOptionalString((v as WebhookRunEntryV1).sessionKey)
    && isOptionalString((v as WebhookRunEntryV1).workspacePath)
    && typeof (v as WebhookRunEntryV1).startedAt === "string"
    && isOptionalString((v as WebhookRunEntryV1).finishedAt)
    && isOptionalString((v as WebhookRunEntryV1).resultText)
    && isOptionalString((v as WebhookRunEntryV1).lastError)
    && isOptionalRecord((v as WebhookRunEntryV1).metadata)
    && typeof (v as WebhookRunEntryV1).createdAt === "string"
    && typeof (v as WebhookRunEntryV1).updatedAt === "string",
}

export interface RelayBindingEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  sourceProjectId: string
  targetProjectId: string
  sourceSessionKey?: string
  sourceChannelKey?: string
  workspaceKey?: string
  workspacePath?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export const relayBindingsSchema: NamespaceSchema<RelayBindingEntryV1> = {
  name: "relay.bindings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is RelayBindingEntryV1 =>
    isAnyRecord<RelayBindingEntryV1>(v)
    && (v as RelayBindingEntryV1).schemaVersion === 1
    && typeof (v as RelayBindingEntryV1).id === "string"
    && typeof (v as RelayBindingEntryV1).sourceProjectId === "string"
    && typeof (v as RelayBindingEntryV1).targetProjectId === "string"
    && isOptionalString((v as RelayBindingEntryV1).sourceSessionKey)
    && isOptionalString((v as RelayBindingEntryV1).sourceChannelKey)
    && isOptionalString((v as RelayBindingEntryV1).workspaceKey)
    && isOptionalString((v as RelayBindingEntryV1).workspacePath)
    && typeof (v as RelayBindingEntryV1).enabled === "boolean"
    && typeof (v as RelayBindingEntryV1).createdAt === "string"
    && typeof (v as RelayBindingEntryV1).updatedAt === "string"
    && isOptionalString((v as RelayBindingEntryV1).createdBy),
}

export type RelayRunStatusV1 = "running" | "success" | "failed" | "timeout"

export interface RelayRunEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  requestId: string
  sourceProjectId: string
  targetProjectId: string
  sourceSessionKey: string
  targetSessionKey: string
  status: RelayRunStatusV1
  visible: boolean
  startedAt: string
  finishedAt?: string
  partialText?: string
  resultText?: string
  lastError?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export const relayRunsSchema: NamespaceSchema<RelayRunEntryV1> = {
  name: "relay.runs",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is RelayRunEntryV1 =>
    isAnyRecord<RelayRunEntryV1>(v)
    && (v as RelayRunEntryV1).schemaVersion === 1
    && typeof (v as RelayRunEntryV1).id === "string"
    && typeof (v as RelayRunEntryV1).requestId === "string"
    && typeof (v as RelayRunEntryV1).sourceProjectId === "string"
    && typeof (v as RelayRunEntryV1).targetProjectId === "string"
    && typeof (v as RelayRunEntryV1).sourceSessionKey === "string"
    && typeof (v as RelayRunEntryV1).targetSessionKey === "string"
    && isRelayRunStatus((v as RelayRunEntryV1).status)
    && typeof (v as RelayRunEntryV1).visible === "boolean"
    && typeof (v as RelayRunEntryV1).startedAt === "string"
    && isOptionalString((v as RelayRunEntryV1).finishedAt)
    && isOptionalString((v as RelayRunEntryV1).partialText)
    && isOptionalString((v as RelayRunEntryV1).resultText)
    && isOptionalString((v as RelayRunEntryV1).lastError)
    && isOptionalRecord((v as RelayRunEntryV1).metadata)
    && typeof (v as RelayRunEntryV1).createdAt === "string"
    && typeof (v as RelayRunEntryV1).updatedAt === "string",
}

export type AgentCompressStatusV1 = "idle" | "success" | "failed" | "unsupported"

export interface AgentCompressStateEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  agentType: string
  enabled: boolean
  maxTokens: number
  minGapMins: number
  lastCompressedAt?: string
  lastStatus?: AgentCompressStatusV1
  lastError?: string
  createdAt: string
  updatedAt: string
}

export const agentCompressStateSchema: NamespaceSchema<AgentCompressStateEntryV1> = {
  name: "agent.compress_state",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentCompressStateEntryV1 =>
    isAnyRecord<AgentCompressStateEntryV1>(v)
    && (v as AgentCompressStateEntryV1).schemaVersion === 1
    && typeof (v as AgentCompressStateEntryV1).id === "string"
    && typeof (v as AgentCompressStateEntryV1).projectId === "string"
    && typeof (v as AgentCompressStateEntryV1).agentType === "string"
    && typeof (v as AgentCompressStateEntryV1).enabled === "boolean"
    && typeof (v as AgentCompressStateEntryV1).maxTokens === "number"
    && typeof (v as AgentCompressStateEntryV1).minGapMins === "number"
    && isOptionalString((v as AgentCompressStateEntryV1).lastCompressedAt)
    && ((v as AgentCompressStateEntryV1).lastStatus === undefined
      || isAgentCompressStatus((v as AgentCompressStateEntryV1).lastStatus))
    && isOptionalString((v as AgentCompressStateEntryV1).lastError)
    && typeof (v as AgentCompressStateEntryV1).createdAt === "string"
    && typeof (v as AgentCompressStateEntryV1).updatedAt === "string",
}

export interface OpsDiagnosticsEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId?: string
  kind: string
  status: "ok" | "degraded" | "error"
  details?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export const opsDiagnosticsSchema: NamespaceSchema<OpsDiagnosticsEntryV1> = {
  name: "ops.diagnostics",
  backend: "jsonl",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is OpsDiagnosticsEntryV1 =>
    isAnyRecord<OpsDiagnosticsEntryV1>(v)
    && (v as OpsDiagnosticsEntryV1).schemaVersion === 1
    && typeof (v as OpsDiagnosticsEntryV1).id === "string"
    && isOptionalString((v as OpsDiagnosticsEntryV1).projectId)
    && typeof (v as OpsDiagnosticsEntryV1).kind === "string"
    && ["ok", "degraded", "error"].includes((v as OpsDiagnosticsEntryV1).status)
    && isOptionalRecord((v as OpsDiagnosticsEntryV1).details)
    && typeof (v as OpsDiagnosticsEntryV1).createdAt === "string"
    && typeof (v as OpsDiagnosticsEntryV1).updatedAt === "string",
}

function isProviderModelArray(value: unknown): value is ProviderModelEntryV1[] {
  return Array.isArray(value)
    && value.every((item) =>
      isAnyRecord<ProviderModelEntryV1>(item)
      && typeof item.id === "string"
      && isOptionalString(item.display)
      && isOptionalString(item.alias),
    )
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isAnyRecord<Record<string, unknown>>(value)
    && Object.values(value).every((item) => typeof item === "string")
}

function isProviderModelListRecord(
  value: unknown,
): value is Record<string, ProviderModelEntryV1[]> {
  return isAnyRecord<Record<string, unknown>>(value)
    && Object.values(value).every(isProviderModelArray)
}

function isProviderCodexOptions(value: unknown): value is ProviderCodexOptionsV1 {
  return isAnyRecord<ProviderCodexOptionsV1>(value)
    && isOptionalString(value.envKey)
    && isOptionalString(value.wireApi)
    && isOptionalString(value.codexHome)
    && (value.httpHeaders === undefined || isStringRecord(value.httpHeaders))
}

function isProviderOptions(value: unknown): value is ProviderOptionsV1 {
  return isAnyRecord<ProviderOptionsV1>(value)
    && (value.env === undefined || isStringRecord(value.env))
    && isOptionalString(value.thinking)
    && isOptionalString(value.effort)
    && (value.endpoints === undefined || isStringRecord(value.endpoints))
    && (value.agentModels === undefined || isStringRecord(value.agentModels))
    && (value.agentModelLists === undefined || isProviderModelListRecord(value.agentModelLists))
    && (value.codex === undefined || isProviderCodexOptions(value.codex))
}

function isConnectorStatus(value: unknown): value is ConnectorStatusV1 {
  return ["disabled", "connecting", "connected", "degraded", "error"].includes(
    String(value),
  )
}

function isConnectorAllowlist(value: unknown): value is ConnectorAllowlistV1 {
  return isAnyRecord<ConnectorAllowlistV1>(value)
    && (value.mode === "all" || value.mode === "users")
    && (value.userIds === undefined || isStringArray(value.userIds))
    && (value.adminIds === undefined || isStringArray(value.adminIds))
}

function isConnectorSessionKeyPolicy(value: unknown): value is ConnectorSessionKeyPolicyV1 {
  return isAnyRecord<ConnectorSessionKeyPolicyV1>(value)
    && ["per-user", "per-channel", "thread"].includes(String(value.mode))
    && isOptionalString(value.format)
}

function isReconnectState(value: unknown): value is ConnectorReconnectStateV1 {
  return isAnyRecord<ConnectorReconnectStateV1>(value)
    && typeof value.attempts === "number"
    && isOptionalString(value.lastConnectedAt)
    && isOptionalString(value.nextRetryAt)
    && isOptionalString(value.lastError)
}

function isDedupeState(value: unknown): value is ConnectorDedupeStateV1 {
  return isAnyRecord<ConnectorDedupeStateV1>(value)
    && typeof value.ttlMs === "number"
    && (value.lastMessageIds === undefined || isStringArray(value.lastMessageIds))
    && isOptionalString(value.ignoreBefore)
}

function isConnectorWorkspaceConfig(value: unknown): value is ConnectorWorkspaceConfigV1 {
  return isAnyRecord<ConnectorWorkspaceConfigV1>(value)
    && typeof value.enabled === "boolean"
    && isOptionalString(value.baseDir)
    && isOptionalBoolean(value.autoBindByChannelName)
    && isOptionalNumber(value.idleTimeoutMs)
}

function isConversationHistoryEntry(value: unknown): value is ConversationHistoryEntryV1 {
  return isAnyRecord<ConversationHistoryEntryV1>(value)
    && ["user", "assistant", "system", "tool"].includes(value.role)
    && typeof value.content === "string"
    && typeof value.timestamp === "string"
    && isOptionalRecord(value.metadata)
}

function isConversationUsage(value: unknown): value is ConversationUsageV1 {
  return isAnyRecord<ConversationUsageV1>(value)
    && isOptionalNumber(value.inputTokens)
    && isOptionalNumber(value.outputTokens)
    && isOptionalNumber(value.totalTokens)
}

function isConversationResumePolicy(value: unknown): value is ConversationResumePolicyV1 {
  return ["resume", "fresh", "continue"].includes(String(value))
}

function isRunAsCheckStatus(value: unknown): value is RunAsCheckStatusV1 {
  return ["pass", "fail", "unsupported"].includes(String(value))
}

function isWebhookRunStatus(value: unknown): value is WebhookRunStatusV1 {
  return ["queued", "running", "success", "failed", "timeout"].includes(String(value))
}

function isRelayRunStatus(value: unknown): value is RelayRunStatusV1 {
  return ["running", "success", "failed", "timeout"].includes(String(value))
}

function isAgentCompressStatus(value: unknown): value is AgentCompressStatusV1 {
  return ["idle", "success", "failed", "unsupported"].includes(String(value))
}

function isAuditActor(value: unknown): value is AuditActorV1 {
  return isAnyRecord<AuditActorV1>(value)
    && ["user", "agent", "extension", "system", "connector"].includes(value.kind)
    && isOptionalString(value.id)
    && isOptionalString(value.display)
}

function isAuditResource(value: unknown): value is AuditResourceV1 {
  return isAnyRecord<AuditResourceV1>(value)
    && typeof value.type === "string"
    && isOptionalString(value.id)
    && isOptionalString(value.projectId)
}

function isOutboxStatus(value: unknown): value is OutboxStatusV1 {
  return ["pending", "sending", "sent", "delivered", "failed", "dead-letter"].includes(
    String(value),
  )
}

function isOutboxDestination(value: unknown): value is OutboxDestinationV1 {
  return isAnyRecord<OutboxDestinationV1>(value)
    && typeof value.platform === "string"
    && isOptionalString(value.connectorId)
    && isOptionalString(value.sessionKey)
    && isOptionalRecord(value.replyCtx)
    && isOptionalString(value.externalId)
}

function isOutboxPayload(value: unknown): value is OutboxPayloadV1 {
  return isAnyRecord<OutboxPayloadV1>(value)
    && ["text", "image", "file", "card", "event"].includes(value.kind)
    && isOptionalString(value.content)
    && (value.attachments === undefined || Array.isArray(value.attachments))
    && isOptionalRecord(value.metadata)
}

function isTaskScope(value: unknown): value is ScheduledTaskScopeV1 {
  return isAnyRecord<ScheduledTaskScopeV1>(value)
    && (
      value.type === "global"
      || (value.type === "project" && typeof value.projectId === "string")
    )
}

function isTaskTrigger(value: unknown): value is ScheduledTaskTriggerV1 {
  return isAnyRecord<ScheduledTaskTriggerV1>(value)
    && (
      (
        value.type === "builtin.cron"
        && isAnyRecord(value.config)
        && typeof value.config.expr === "string"
        && isOptionalString(value.config.timezone)
      )
      || (
        value.type === "builtin.interval"
        && isAnyRecord(value.config)
        && typeof value.config.everyMinutes === "number"
        && (
          value.config.anchor === undefined
          || value.config.anchor === "created_at"
          || value.config.anchor === "last_completed_at"
        )
      )
    )
}

function isTaskAction(value: unknown): value is ScheduledTaskActionV1 {
  return isAnyRecord<ScheduledTaskActionV1>(value)
    && typeof value.type === "string"
    && isAnyRecord(value.config)
}

function isOptionalTaskStatus(value: unknown): boolean {
  return value === undefined || isTaskStatus(value)
}

function isTaskStatus(value: unknown): value is ScheduledTaskStatusV1 {
  return ["success", "failed", "timeout", "cancelled", "skipped"].includes(String(value))
}

function isTaskRunStatus(value: unknown): value is ScheduledTaskRunStatusV1 {
  return value === "running" || isTaskStatus(value)
}

function isTaskRunTrigger(value: unknown): value is ScheduledTaskRunTriggerV1 {
  return ["schedule", "manual", "missed_run"].includes(String(value))
}
