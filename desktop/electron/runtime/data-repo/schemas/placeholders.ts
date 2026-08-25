/**
 * Phase 0.7 — Business schemas for CC Connect foundations.
 *
 * These namespaces were introduced as v1 placeholders in Phase 0.2. They keep
 * schemaVersion=1 here because no production business data has been written
 * yet; this file upgrades the v1 shape before AgentRuntime/Connector/Scheduler
 * services start using it.
 */

import type { Migration, NamespaceSchema } from "../types"
import type { JsonFileEnvelope } from "../backends/json"
import { migration } from "../migrations"
import { WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS } from "../../../../config"
import { AGENT_ATTACHMENT_IMAGE_MIME_TYPES } from "../../../../src/types/agent-attachment"
import {
  isOptionalValidWebhookPort,
  isValidWebhookMaxBodyBytes,
  isValidWebhookRateLimitPerMinute,
} from "../../lib/webhook-config-validation"

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

const isConversationTitleSource = (value: unknown): value is ConversationTitleSourceV1 =>
  value === "automatic" || value === "fallback" || value === "generated" || value === "manual"

const isPlainRecord = <T extends Record<string, unknown>>(value: unknown): value is T => {
  return isAnyRecord<T>(value) && !Array.isArray(value)
}

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
  note?: string
  websiteUrl?: string
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
  settingsConfig?: Record<string, unknown>
  secretEnvRefs?: Record<string, string>
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
    && isOptionalString((v as ProviderEntryV1).note)
    && isOptionalString((v as ProviderEntryV1).websiteUrl)
    && isOptionalString((v as ProviderEntryV1).baseUrl)
    && isOptionalString((v as ProviderEntryV1).secretRef)
    && isOptionalString((v as ProviderEntryV1).activeMode)
    && ((v as ProviderEntryV1).models === undefined || isProviderModelArray((v as ProviderEntryV1).models))
    && ((v as ProviderEntryV1).providerRefs === undefined || isStringArray((v as ProviderEntryV1).providerRefs))
    && ((v as ProviderEntryV1).agentTypes === undefined || isStringArray((v as ProviderEntryV1).agentTypes))
    && ((v as ProviderEntryV1).env === undefined || isStringRecord((v as ProviderEntryV1).env))
    && ((v as ProviderEntryV1).settingsConfig === undefined || isAnyRecord((v as ProviderEntryV1).settingsConfig))
    && ((v as ProviderEntryV1).secretEnvRefs === undefined || isStringRecord((v as ProviderEntryV1).secretEnvRefs))
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
export type ConversationTitleSourceV1 = "automatic" | "fallback" | "generated" | "manual"

export interface ConversationUsageV1 extends Record<string, unknown> {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  totalTokens?: number
}

export interface ConversationMainThreadPersonaSnapshotV1 extends Record<string, unknown> {
  id: string
  name: string
  source: "builtin" | "user"
  definitionHash: string
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
  costCny?: number
  costCurrency?: "CNY"
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
    modelTier?: string
    env?: Record<string, string>
    experimentalSynapseToolRouterEnabled?: boolean
    activeMainThreadPersonaId?: string | null
    activeMainThreadPersonaSnapshot?: ConversationMainThreadPersonaSnapshotV1
  }
  resumePolicy?: ConversationResumePolicyV1
  history: ConversationHistoryEntryV1[]
  userMeta?: ConversationUserMetaV1
  active: boolean
  name?: string
  titleSource?: ConversationTitleSourceV1
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
    && isOptionalNonNegativeFiniteNumber((v as ConversationEntryV1).costUsd)
    && isOptionalNonNegativeFiniteNumber((v as ConversationEntryV1).costCny)
    && ((v as ConversationEntryV1).costCurrency === undefined || (v as ConversationEntryV1).costCurrency === "CNY")
    && isOptionalString((v as ConversationEntryV1).channelKey)
    && isOptionalString((v as ConversationEntryV1).workspaceKey)
    && isOptionalString((v as ConversationEntryV1).workspacePath)
    && Array.isArray((v as ConversationEntryV1).history)
    && (v as ConversationEntryV1).history.every(isConversationHistoryEntry)
    && typeof (v as ConversationEntryV1).active === "boolean"
    && isOptionalString((v as ConversationEntryV1).agentSessionId)
    && ((v as ConversationEntryV1).pastAgentSessionIds === undefined || isStringArray((v as ConversationEntryV1).pastAgentSessionIds))
    && ((v as ConversationEntryV1).agentConfig === undefined || isConversationAgentConfig((v as ConversationEntryV1).agentConfig))
    && ((v as ConversationEntryV1).resumePolicy === undefined || isConversationResumePolicy((v as ConversationEntryV1).resumePolicy))
    && isOptionalRecord((v as ConversationEntryV1).userMeta)
    && ((v as ConversationEntryV1).titleSource === undefined || isConversationTitleSource((v as ConversationEntryV1).titleSource))
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

const supportedAgentArtifactImageMimeTypes = new Set<string>(AGENT_ATTACHMENT_IMAGE_MIME_TYPES)

const isSha256Hex = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value)

const hasNoArtifactBytes = (value: Record<string, unknown>): boolean =>
  value.base64 === undefined && value.data === undefined && value.bytes === undefined

export interface AgentArtifactEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  toolUseId?: string
  toolName?: string
  origin?: "user-message" | "tool-result"
  originalName?: string
  kind: "image"
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  byteSize: number
  sha256: string
  storagePath: string
  createdAt: string
}

export interface AgentArtifactEntryV2 extends Record<string, unknown> {
  id: string
  schemaVersion: 2
  projectId: string
  draftScopeId: string
  lifecycle: "staged" | "committed" | "orphaned"
  kind: "image" | "file" | "directory"
  originalName: string
  mimeType?: string
  byteSize: number
  sha256?: string
  storagePath?: string
  previewStoragePath?: string
  thumbnailStoragePath?: string
  previewMimeType?: string
  previewSha256?: string
  previewByteSize?: number
  sourcePath?: string
  width?: number
  height?: number
  previewWidth?: number
  previewHeight?: number
  conversationId?: string
  turnId?: string
  committedAt?: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  lastError?: string
}

export type AgentArtifactEntry = AgentArtifactEntryV1 | AgentArtifactEntryV2

const agentArtifactMigrations: readonly Migration[] = [
  migration<unknown, unknown>(1, 2, (data) => data),
]

export const agentArtifactsSchema: NamespaceSchema<AgentArtifactEntry> = {
  name: "agent.artifacts",
  backend: "sqlite",
  currentVersion: 2,
  migrations: agentArtifactMigrations,
  validate: (v): v is AgentArtifactEntry => isAgentArtifactEntryV1(v) || isAgentArtifactEntryV2(v),
}

function isAgentArtifactEntryV1(v: unknown): v is AgentArtifactEntryV1 {
  return isAnyRecord<AgentArtifactEntryV1>(v)
    && (v as AgentArtifactEntryV1).schemaVersion === 1
    && typeof (v as AgentArtifactEntryV1).id === "string"
    && typeof (v as AgentArtifactEntryV1).projectId === "string"
    && typeof (v as AgentArtifactEntryV1).conversationId === "string"
    && typeof (v as AgentArtifactEntryV1).turnId === "string"
    && isOptionalString((v as AgentArtifactEntryV1).toolUseId)
    && isOptionalString((v as AgentArtifactEntryV1).toolName)
    && ((v as AgentArtifactEntryV1).origin === undefined
      || (v as AgentArtifactEntryV1).origin === "user-message"
      || (v as AgentArtifactEntryV1).origin === "tool-result")
    && isOptionalString((v as AgentArtifactEntryV1).originalName)
    && (v as AgentArtifactEntryV1).kind === "image"
    && supportedAgentArtifactImageMimeTypes.has((v as AgentArtifactEntryV1).mimeType)
    && typeof (v as AgentArtifactEntryV1).byteSize === "number"
    && Number.isInteger((v as AgentArtifactEntryV1).byteSize)
    && (v as AgentArtifactEntryV1).byteSize > 0
    && isSha256Hex((v as AgentArtifactEntryV1).sha256)
    && typeof (v as AgentArtifactEntryV1).storagePath === "string"
    && typeof (v as AgentArtifactEntryV1).createdAt === "string"
    && hasNoArtifactBytes(v as Record<string, unknown>)
}

function isAgentArtifactEntryV2(v: unknown): v is AgentArtifactEntryV2 {
  if (!isAnyRecord<AgentArtifactEntryV2>(v) || v.schemaVersion !== 2) return false
  if (
    typeof v.id !== "string"
    || typeof v.projectId !== "string"
    || typeof v.draftScopeId !== "string"
    || !["staged", "committed", "orphaned"].includes(v.lifecycle)
    || !["image", "file", "directory"].includes(v.kind)
    || typeof v.originalName !== "string"
    || !Number.isInteger(v.byteSize)
    || v.byteSize < 0
    || typeof v.createdAt !== "string"
    || typeof v.updatedAt !== "string"
    || typeof v.expiresAt !== "string"
    || !isOptionalString(v.conversationId)
    || !isOptionalString(v.turnId)
    || !isOptionalString(v.committedAt)
    || !isOptionalString(v.lastError)
    || !hasNoArtifactBytes(v)
  ) return false
  if (v.lifecycle === "committed" && (
    typeof v.conversationId !== "string"
    || typeof v.turnId !== "string"
    || typeof v.committedAt !== "string"
  )) return false
  if (v.kind === "directory") return v.byteSize === 0 && typeof v.sourcePath === "string"
  if (
    !isSha256Hex(v.sha256)
    || typeof v.storagePath !== "string"
    || !isOptionalString(v.mimeType)
  ) return false
  if (v.kind === "image") {
    return typeof v.mimeType === "string"
      && supportedAgentArtifactImageMimeTypes.has(v.mimeType)
      && typeof v.previewStoragePath === "string"
      && typeof v.thumbnailStoragePath === "string"
      && isOptionalString(v.previewMimeType)
      && (
        v.previewMimeType === undefined
        || (typeof v.previewMimeType === "string" && supportedAgentArtifactImageMimeTypes.has(v.previewMimeType))
      )
      && (v.previewSha256 === undefined || isSha256Hex(v.previewSha256))
      && isOptionalPositiveInteger(v.previewByteSize)
      && isOptionalPositiveInteger(v.width)
      && isOptionalPositiveInteger(v.height)
      && isOptionalPositiveInteger(v.previewWidth)
      && isOptionalPositiveInteger(v.previewHeight)
  }
  return true
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) > 0)
}

export interface AgentUsageSummaryV1 extends Record<string, unknown> {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  reasoningOutputTokens?: number
  totalTokens: number
}

export interface AgentUsageEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  projectId: string
  conversationId: string
  turnId: string
  sdkResultUuid?: string
  sdkSessionId?: string
  source?: string
  taskId?: string
  taskRunId?: string
  workflowId?: string
  workflowRunId?: string
  workflowNodeId?: string
  workflowNodeName?: string
  usage: Record<string, unknown>
  usageSummary: AgentUsageSummaryV1
  modelUsage?: Record<string, unknown>
  createdAt: string
}

export const agentUsageSchema: NamespaceSchema<AgentUsageEntryV1> = {
  name: "agent.usage",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AgentUsageEntryV1 =>
    isAnyRecord<AgentUsageEntryV1>(v)
    && (v as AgentUsageEntryV1).schemaVersion === 1
    && typeof (v as AgentUsageEntryV1).id === "string"
    && typeof (v as AgentUsageEntryV1).projectId === "string"
    && typeof (v as AgentUsageEntryV1).conversationId === "string"
    && typeof (v as AgentUsageEntryV1).turnId === "string"
    && isOptionalString((v as AgentUsageEntryV1).sdkResultUuid)
    && isOptionalString((v as AgentUsageEntryV1).sdkSessionId)
    && isOptionalString((v as AgentUsageEntryV1).source)
    && isOptionalString((v as AgentUsageEntryV1).taskId)
    && isOptionalString((v as AgentUsageEntryV1).taskRunId)
    && isOptionalString((v as AgentUsageEntryV1).workflowId)
    && isOptionalString((v as AgentUsageEntryV1).workflowRunId)
    && isOptionalString((v as AgentUsageEntryV1).workflowNodeId)
    && isOptionalString((v as AgentUsageEntryV1).workflowNodeName)
    && isPlainRecord((v as AgentUsageEntryV1).usage)
    && isAgentUsageSummary((v as AgentUsageEntryV1).usageSummary)
    && isOptionalRecord((v as AgentUsageEntryV1).modelUsage)
    && typeof (v as AgentUsageEntryV1).createdAt === "string",
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

export type AutomationScopeV1 =
  | { type: "global" }
  | { type: "project"; projectId: string }

export type AutomationRefV1 = {
  type: string
  config: Record<string, unknown>
}

export type AutomationRunStatusV1 = "success" | "failed" | "timeout" | "cancelled" | "skipped"
export type AutomationActiveRunStatusV1 = "running" | AutomationRunStatusV1
export type AutomationRunTriggerV1 = "trigger" | "manual" | "missed_run"

export interface AutomationItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  description?: string
  enabled: boolean
  scope: AutomationScopeV1
  cwd?: string
  trigger: AutomationRefV1
  executor: AutomationRefV1
  policy: {
    missedRunPolicy: "skip" | "run_once"
    overlapPolicy: "skip"
  }
  createdAt: string
  updatedAt: string
  nextRunAt?: string
  lastRunAt?: string
  lastStatus?: AutomationRunStatusV1
  runCount: number
  configVersion: number
}

export interface AutomationRunEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  automationId: string
  startedAt: string
  finishedAt?: string
  status: AutomationActiveRunStatusV1
  triggeredBy: AutomationRunTriggerV1
  triggerType: string
  executorType: string
  result?: Record<string, unknown>
  error?: string
}

export const automationItemsSchema: NamespaceSchema<AutomationItemEntryV1> = {
  name: "automation.items",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AutomationItemEntryV1 =>
    isAnyRecord<AutomationItemEntryV1>(v)
    && (v as AutomationItemEntryV1).schemaVersion === 1
    && typeof (v as AutomationItemEntryV1).id === "string"
    && typeof (v as AutomationItemEntryV1).name === "string"
    && isOptionalString((v as AutomationItemEntryV1).description)
    && typeof (v as AutomationItemEntryV1).enabled === "boolean"
    && isAutomationScope((v as AutomationItemEntryV1).scope)
    && isOptionalString((v as AutomationItemEntryV1).cwd)
    && isAutomationRef((v as AutomationItemEntryV1).trigger)
    && isAutomationRef((v as AutomationItemEntryV1).executor)
    && isAutomationPolicy((v as AutomationItemEntryV1).policy)
    && typeof (v as AutomationItemEntryV1).createdAt === "string"
    && typeof (v as AutomationItemEntryV1).updatedAt === "string"
    && isOptionalString((v as AutomationItemEntryV1).nextRunAt)
    && isOptionalString((v as AutomationItemEntryV1).lastRunAt)
    && (
      (v as AutomationItemEntryV1).lastStatus === undefined
      || isAutomationRunStatus((v as AutomationItemEntryV1).lastStatus)
    )
    && typeof (v as AutomationItemEntryV1).runCount === "number"
    && typeof (v as AutomationItemEntryV1).configVersion === "number",
}

export const automationRunsSchema: NamespaceSchema<AutomationRunEntryV1> = {
  name: "automation.runs",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is AutomationRunEntryV1 =>
    isAnyRecord<AutomationRunEntryV1>(v)
    && (v as AutomationRunEntryV1).schemaVersion === 1
    && typeof (v as AutomationRunEntryV1).id === "string"
    && typeof (v as AutomationRunEntryV1).automationId === "string"
    && typeof (v as AutomationRunEntryV1).startedAt === "string"
    && isOptionalString((v as AutomationRunEntryV1).finishedAt)
    && isAutomationActiveRunStatus((v as AutomationRunEntryV1).status)
    && isAutomationRunTrigger((v as AutomationRunEntryV1).triggeredBy)
    && typeof (v as AutomationRunEntryV1).triggerType === "string"
    && typeof (v as AutomationRunEntryV1).executorType === "string"
    && ((v as AutomationRunEntryV1).result === undefined || isAnyRecord((v as AutomationRunEntryV1).result))
    && isOptionalString((v as AutomationRunEntryV1).error),
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
    && isOptionalValidWebhookPort((v as WebhookConfigEntryV1).preferredPort)
    && isOptionalValidWebhookPort((v as WebhookConfigEntryV1).assignedPort)
    && typeof (v as WebhookConfigEntryV1).path === "string"
    && isOptionalString((v as WebhookConfigEntryV1).token)
    && isValidWebhookMaxBodyBytes((v as WebhookConfigEntryV1).maxBodyBytes)
    && isValidWebhookRateLimitPerMinute((v as WebhookConfigEntryV1).rateLimitPerMinute)
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
  sourceSessionKey?: string
  targetSessionKey?: string
  sourceSessionKeyHash?: string
  targetSessionKeyHash?: string
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
    && isOptionalString((v as RelayRunEntryV1).sourceSessionKey)
    && isOptionalString((v as RelayRunEntryV1).targetSessionKey)
    && isOptionalString((v as RelayRunEntryV1).sourceSessionKeyHash)
    && isOptionalString((v as RelayRunEntryV1).targetSessionKeyHash)
    && (
      typeof (v as RelayRunEntryV1).sourceSessionKey === "string"
      || typeof (v as RelayRunEntryV1).sourceSessionKeyHash === "string"
    )
    && (
      typeof (v as RelayRunEntryV1).targetSessionKey === "string"
      || typeof (v as RelayRunEntryV1).targetSessionKeyHash === "string"
    )
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

type WorkflowResourceEntryTypeV1 = "file" | "directory"
type WorkflowResourceRefV1 =
  | { readonly kind: "local_path"; readonly entryType: WorkflowResourceEntryTypeV1; readonly path: string }
  | { readonly kind: "drive"; readonly entryType: WorkflowResourceEntryTypeV1; readonly id: string; readonly versionId?: string }
  | { readonly kind: "staged"; readonly entryType: WorkflowResourceEntryTypeV1; readonly id: string }
  | { readonly kind: "inline_file"; readonly entryType: "file"; readonly name: string; readonly mimeType?: string; readonly base64: string }

export interface WorkflowParamPresetEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  workflowId: string
  name: string
  values: Record<string, string>
  createdAt: number
  updatedAt: number
}

export type WorkflowParamPresetValueV2 = string | string[]

export interface WorkflowParamPresetEntryV2 extends Record<string, unknown> {
  id: string
  schemaVersion: 2
  workflowId: string
  name: string
  values: Record<string, WorkflowParamPresetValueV2>
  createdAt: number
  updatedAt: number
}

const workflowParamPresetMigrations: readonly Migration[] = [
  migration<WorkflowParamPresetEntryV1, WorkflowParamPresetEntryV2>(1, 2, migrateWorkflowParamPresetEntryV1ToV2),
]

export const workflowParamPresetsSchema: NamespaceSchema<WorkflowParamPresetEntryV2> = {
  name: "workflow.param-presets",
  backend: "json",
  currentVersion: 2,
  migrations: workflowParamPresetMigrations,
  validate: isWorkflowParamPresetEntryV2,
}

export function reviveWorkflowParamPresetsEnvelope(raw: unknown): JsonFileEnvelope<WorkflowParamPresetEntryV2> | null {
  if (!isWorkflowJsonEnvelope(raw)) return null
  if (raw.schemaVersion === 2) return raw as JsonFileEnvelope<WorkflowParamPresetEntryV2>
  if (raw.schemaVersion !== 1) return null

  const items: Record<string, WorkflowParamPresetEntryV2> = {}
  for (const [id, value] of Object.entries(raw.items)) {
    if (!isWorkflowParamPresetEntryV1(value)) return null
    const migrated = migrateWorkflowParamPresetEntryV1ToV2(value)
    items[id] = migrated
  }
  return { schemaVersion: 2, singleton: null, items }
}

function migrateWorkflowParamPresetEntryV1ToV2(entry: WorkflowParamPresetEntryV1): WorkflowParamPresetEntryV2 {
  return { ...entry, schemaVersion: 2, values: { ...entry.values } }
}

function isWorkflowParamPresetEntryV1(value: unknown): value is WorkflowParamPresetEntryV1 {
  return isWorkflowParamPresetEntryBase(value)
    && value.schemaVersion === 1
    && isStringRecord(value.values)
}

function isWorkflowParamPresetEntryV2(value: unknown): value is WorkflowParamPresetEntryV2 {
  return isWorkflowParamPresetEntryBase(value)
    && value.schemaVersion === 2
    && isWorkflowParamPresetValues(value.values)
}

function isWorkflowParamPresetEntryBase(value: unknown): value is Record<string, unknown> & {
  id: string
  workflowId: string
  name: string
  createdAt: number
  updatedAt: number
} {
  return isPlainRecord(value)
    && typeof value.id === "string"
    && value.id.length > 0
    && typeof value.workflowId === "string"
    && value.workflowId.length > 0
    && typeof value.name === "string"
    && value.name.length > 0
    && typeof value.createdAt === "number"
    && typeof value.updatedAt === "number"
}

function isWorkflowParamPresetValues(value: unknown): value is Record<string, WorkflowParamPresetValueV2> {
  return isPlainRecord(value) && Object.values(value).every((item) =>
    typeof item === "string"
    || (Array.isArray(item)
      && item.length > 0
      && item.length <= WORKFLOW_MULTI_RESOURCE_PARAM_MAX_ITEMS
      && item.every((pathValue) => typeof pathValue === "string" && pathValue.length > 0)),
  )
}

export interface WorkflowEntryV1 extends Record<string, unknown> {
  id: string
  /** Legacy per-document version; removed after SemVer migration. */
  schemaVersion?: 1
  meta?: { schemaVersion: string }
  name: string
  description?: string
  version: string
  createdAt: number
  updatedAt: number
  /** Optional only at the permissive storage envelope; document migration makes it required. */
  layoutDirection?: "horizontal" | "vertical"
  defaultProjectId?: string
  defaultProviderId?: string
  defaultModelTier?: "default" | "haiku" | "sonnet" | "opus"
  defaultNodeTimeoutMins?: number
  params: Array<{
    name: string
    type: "text" | "number" | "file" | "directory" | "option"
    default: string | number | WorkflowResourceRefV1 | WorkflowResourceRefV1[] | null
    description?: string
    options?: string[]
    allowCustomOption?: boolean
    allowMultiple?: boolean
  }>
  nodes: Array<{ id: string; name: string; type: string; position: { x: number; y: number }; config: Record<string, unknown> }>
  edges: Array<{ id: string; from: string; to: string; branch?: string }>
}

function isWorkflowJsonEnvelope(value: unknown): value is JsonFileEnvelope<unknown> {
  return isAnyRecord<Record<string, unknown>>(value)
    && typeof value.schemaVersion === "number"
    && "singleton" in value
    && isAnyRecord<Record<string, unknown>>(value.items)
}

export function reviveWorkflowsEnvelope(raw: unknown): JsonFileEnvelope<WorkflowEntryV1> | null {
  const sourceItems = isWorkflowJsonEnvelope(raw)
    ? raw.items
    : isAnyRecord<Record<string, unknown>>(raw)
      ? raw
      : null
  if (!sourceItems) return null

  const items: Record<string, WorkflowEntryV1> = {}
  for (const [id, value] of Object.entries(sourceItems)) {
    if (isPlainRecord(value) && value.id === id) {
      items[id] = value as WorkflowEntryV1
      continue
    }
    items[id] = wrapUnreadableWorkflowEntry(id, value)
  }
  return { schemaVersion: 1, singleton: null, items }
}

function wrapUnreadableWorkflowEntry(id: string, raw: unknown): WorkflowEntryV1 {
  const entry = {
    id,
    name: isPlainRecord(raw) && typeof raw.name === "string" && raw.name
      ? raw.name
      : "无法读取的工作流",
  } as WorkflowEntryV1
  Object.defineProperty(entry, "toJSON", {
    enumerable: false,
    value: () => raw,
  })
  return entry
}

export const workflowsSchema: NamespaceSchema<WorkflowEntryV1> = {
  name: "workflows",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  // Document-level validation and SemVer migration happen in WorkflowService.
  // Keeping the storage envelope permissive allows one bad/future document to
  // be isolated without making every other workflow unreadable.
  validate: (v): v is WorkflowEntryV1 =>
    isPlainRecord(v) && typeof v.id === "string" && v.id.length > 0,
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

function isOptionalNonNegativeFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0)
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0)
}

function isConversationHistoryEntry(value: unknown): value is ConversationHistoryEntryV1 {
  return isAnyRecord<ConversationHistoryEntryV1>(value)
    && ["user", "assistant", "system", "tool"].includes(value.role)
    && typeof value.content === "string"
    && typeof value.timestamp === "string"
    && isOptionalRecord(value.metadata)
}

function isConversationUsage(value: unknown): value is ConversationUsageV1 {
  return isPlainRecord<ConversationUsageV1>(value)
    && isOptionalNonNegativeInteger(value.inputTokens)
    && isOptionalNonNegativeInteger(value.outputTokens)
    && isOptionalNonNegativeInteger(value.cacheReadInputTokens)
    && isOptionalNonNegativeInteger(value.cacheCreationInputTokens)
    && isOptionalNonNegativeInteger(value.totalTokens)
}

function isConversationMainThreadPersonaSnapshot(
  value: unknown,
): value is ConversationMainThreadPersonaSnapshotV1 {
  if (!isAnyRecord<ConversationMainThreadPersonaSnapshotV1>(value)) return false
  return typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && (value.source === "builtin" || value.source === "user")
    && typeof value.definitionHash === "string"
    && value.definitionHash.trim().length > 0
}

function isConversationAgentConfig(value: unknown): value is NonNullable<ConversationEntryV1["agentConfig"]> {
  if (!isAnyRecord<NonNullable<ConversationEntryV1["agentConfig"]>>(value)) return false
  return isOptionalString(value.model)
    && isOptionalString(value.mode)
    && isOptionalString(value.modelTier)
    && (value.env === undefined || isStringRecord(value.env))
    && (value.experimentalSynapseToolRouterEnabled === undefined
      || typeof value.experimentalSynapseToolRouterEnabled === "boolean")
    && (value.activeMainThreadPersonaId === undefined
      || value.activeMainThreadPersonaId === null
      || typeof value.activeMainThreadPersonaId === "string")
    && (value.activeMainThreadPersonaSnapshot === undefined
      || isConversationMainThreadPersonaSnapshot(value.activeMainThreadPersonaSnapshot))
}

function isAgentUsageSummary(value: unknown): value is AgentUsageSummaryV1 {
  return isPlainRecord<AgentUsageSummaryV1>(value)
    && isRequiredNonNegativeInteger(value.inputTokens)
    && isRequiredNonNegativeInteger(value.outputTokens)
    && isRequiredNonNegativeInteger(value.cacheReadInputTokens)
    && isRequiredNonNegativeInteger(value.cacheCreationInputTokens)
    && isOptionalNonNegativeInteger(value.reasoningOutputTokens)
    && isRequiredNonNegativeInteger(value.totalTokens)
}

function isRequiredNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
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

function isAutomationScope(value: unknown): value is AutomationScopeV1 {
  return isAnyRecord<AutomationScopeV1>(value)
    && (
      value.type === "global"
      || (value.type === "project" && typeof value.projectId === "string")
    )
}

function isAutomationRef(value: unknown): value is AutomationRefV1 {
  return isAnyRecord<AutomationRefV1>(value)
    && typeof value.type === "string"
    && isAnyRecord(value.config)
}

function isAutomationRunStatus(value: unknown): value is AutomationRunStatusV1 {
  return ["success", "failed", "timeout", "cancelled", "skipped"].includes(String(value))
}

function isAutomationActiveRunStatus(value: unknown): value is AutomationActiveRunStatusV1 {
  return value === "running" || isAutomationRunStatus(value)
}

function isAutomationRunTrigger(value: unknown): value is AutomationRunTriggerV1 {
  return ["trigger", "manual", "missed_run"].includes(String(value))
}

function isAutomationPolicy(value: unknown): value is AutomationItemEntryV1["policy"] {
  return isAnyRecord<AutomationItemEntryV1["policy"]>(value)
    && value.overlapPolicy === "skip"
    && (value.missedRunPolicy === "skip" || value.missedRunPolicy === "run_once")
}
