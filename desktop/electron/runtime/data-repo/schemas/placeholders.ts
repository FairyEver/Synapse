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
    && ((v as ConnectorEntryV1).dedupe === undefined || isDedupeState((v as ConnectorEntryV1).dedupe)),
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
}

export type ConversationResumePolicyV1 = "resume" | "fresh" | "continue"

export interface ConversationEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  sessionKey: string
  platform?: string
  agentType?: string
  agentSessionId?: string
  pastAgentSessionIds?: string[]
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

function isConversationHistoryEntry(value: unknown): value is ConversationHistoryEntryV1 {
  return isAnyRecord<ConversationHistoryEntryV1>(value)
    && ["user", "assistant", "system", "tool"].includes(value.role)
    && typeof value.content === "string"
    && typeof value.timestamp === "string"
    && isOptionalRecord(value.metadata)
}

function isConversationResumePolicy(value: unknown): value is ConversationResumePolicyV1 {
  return ["resume", "fresh", "continue"].includes(String(value))
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
  return ["pending", "sending", "delivered", "failed", "dead-letter"].includes(
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
