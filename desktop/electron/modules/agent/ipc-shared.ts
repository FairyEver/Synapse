import { z } from "zod"
import { stat } from "node:fs/promises"
import { AGENT_ATTACHMENT_IMAGE_MIME_TYPES } from "../../../src/types/agent-attachment"

import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type { ConversationEntryV1 } from "../../runtime/data-repo"
import {
  AgentRuntimeService,
  AGENT_RUNTIME_SERVICE_ID,
} from "../../services/agent-runtime"
import {
  ProviderService,
  PROVIDER_SERVICE_ID,
} from "../../services/provider"
import { configStore } from "../../services/config-store"
import {
  isManagedKnowledgeBaseProject,
  resolveProjectWorkspacePath,
} from "../../services/knowledge-base/managed-path"
import type { KnowledgeBaseStorageMigrationService } from "../../services/knowledge-base/storage-migration-service"
import { createMainLogger } from "../../services/log-store"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import { historyRecordToTimelineItem } from "../../../src/lib/agent-timeline"
import { isDefaultAgentWorkspaceProjectId } from "../../../src/lib/default-agent-workspace"
import { resolveDefaultAgentWorkspaceProject } from "./default-agent-workspace"

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_LOCAL_SESSION_KEY = "local:renderer"
export const LOCAL_RENDERER_PLATFORM = "local-renderer"
export const KNOWLEDGE_BASE_MIGRATION_ACTIVE_ERROR = "知识库存储迁移正在进行，请稍后再试。"
const logger = createMainLogger("agent.ipc-shared")
const MANAGED_KNOWLEDGE_BASE_WORKSPACE_MISSING_ERROR = "知识库运行目录不存在。请重新创建知识库或从备份恢复。"
const MANAGED_KNOWLEDGE_BASE_WORKSPACE_UNAVAILABLE_ERROR = "无法访问知识库运行目录。请检查磁盘权限后重试。"
const RECOVERABLE_MANAGED_KNOWLEDGE_BASE_WORKSPACE_ERRORS = new Set([
  MANAGED_KNOWLEDGE_BASE_WORKSPACE_MISSING_ERROR,
  MANAGED_KNOWLEDGE_BASE_WORKSPACE_UNAVAILABLE_ERROR,
])

// ─── Shared request schemas ───────────────────────────────────────────────────

export { projectRequestSchema }

export function isRecoverableManagedKnowledgeBaseWorkspaceError(error: unknown): boolean {
  return error instanceof Error && RECOVERABLE_MANAGED_KNOWLEDGE_BASE_WORKSPACE_ERRORS.has(error.message)
}

export function assertKnowledgeBaseStorageMigrationInactive(
  resolve: <T>(serviceId: string) => T,
  project: Parameters<typeof isManagedKnowledgeBaseProject>[0],
): void {
  if (!isManagedKnowledgeBaseProject(project)) return
  const storageMigration = resolve<KnowledgeBaseStorageMigrationService>("knowledge-base.storage-migration-service")
  if (storageMigration.isActive()) {
    throw new Error(KNOWLEDGE_BASE_MIGRATION_ACTIVE_ERROR)
  }
}

export const timelineRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
  beforeIndex: z.number().int().nonnegative().optional(),
})

export const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
])

// ─── Shared response schemas ──────────────────────────────────────────────────

const timelineBaseSchema = {
  id: z.string(),
  timestamp: z.string(),
  agentType: z.string().optional(),
  sdkSessionId: z.string().optional(),
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
}

const jsonRecordSchema = z.record(z.string(), z.unknown())
const agentErrorKindSchema = z.enum([
  "execution_failed",
  "tool_use_interrupted",
  "webfetch_preflight_failed",
])
const agentTurnDiagnosticSchema = z.object({
  source: z.enum(["claude-sdk", "agent-runtime", "process-runner"]),
  kind: z.enum(["aborted", "closed", "error", "tool_use_interrupted"]),
  message: z.string().optional(),
})
const agentTurnOutcomeSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    message: z.string().optional(),
  }),
  z.object({
    status: z.literal("cancelled"),
    mode: z.enum(["graceful", "force"]),
    reason: z.enum(["user_cancelled", "system_cancelled", "force_cancelled"]),
    message: z.string(),
    diagnostics: z.array(agentTurnDiagnosticSchema).optional(),
  }),
  z.object({
    status: z.literal("failed"),
    reason: z.string(),
    message: z.string(),
    diagnostics: z.array(agentTurnDiagnosticSchema).optional(),
  }),
  z.object({
    status: z.literal("timed_out"),
    reason: z.string(),
    message: z.string(),
    diagnostics: z.array(agentTurnDiagnosticSchema).optional(),
  }),
  z.object({
    status: z.literal("interrupted"),
    reason: z.literal("tool_use_interrupted"),
    recoverable: z.literal(true),
    message: z.string(),
    diagnostics: z.array(agentTurnDiagnosticSchema).optional(),
  }),
])
const agentArtifactImageMimeTypeSchema = z.enum(AGENT_ATTACHMENT_IMAGE_MIME_TYPES)
export const agentImageArtifactSchema = z.object({
  id: z.string(),
  kind: z.literal("image"),
  mimeType: agentArtifactImageMimeTypeSchema,
  byteSize: z.number(),
  url: z.string(),
  sha256: z.string().optional(),
})
const agentMessageAttachmentSchema = z.discriminatedUnion("kind", [
  agentImageArtifactSchema.extend({
    name: z.string().optional(),
  }),
  z.object({
    kind: z.literal("path"),
    path: z.string(),
    entryType: z.enum(["file", "directory"]),
    name: z.string(),
    byteSize: z.number().int().nonnegative().optional(),
  }),
])
const agentToolResultImageDiagnosticSchema = z.object({
  mimeType: z.string().optional(),
  base64Length: z.number().int().nonnegative().optional(),
  originalSize: z.number().int().nonnegative().optional(),
  dimensions: z.record(z.string(), z.number()).optional(),
})
const agentToolResultContentDiagnosticsSchema = z.object({
  kind: z.enum(["string", "array", "other"]),
  itemCount: z.number().int().nonnegative().optional(),
  contentTypes: z.array(z.string()).optional(),
  textCharCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  images: z.array(agentToolResultImageDiagnosticSchema),
})
const agentModelContextReferenceSchema = z.object({
  providerScopeId: z.string().min(1),
  modelId: z.string().min(1),
  contextWindowTokens: z.number().int().positive(),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoningMaxInputTokens: z.number().int().positive().optional(),
  reasoningMaxOutputTokens: z.number().int().positive().optional(),
  maxReasoningTokens: z.number().int().positive().optional(),
  sourceLabel: z.string().min(1),
  sourceUrl: z.string().url(),
  verifiedAt: z.string().datetime(),
})
export const agentContextUsageSchema = z.object({
  usedTokens: z.number().int().nonnegative(),
  contextWindowTokens: z.number().int().positive().optional(),
  model: z.string().min(1).optional(),
  modelContext: agentModelContextReferenceSchema.optional(),
  contextWindowConfigurationSource: z.enum(["catalog", "provider-env"]).optional(),
})
export const agentUserQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
})
export const agentUserQuestionSchema = z.object({
  id: z.string().optional(),
  key: z.string().optional(),
  question: z.string(),
  header: z.string().optional(),
  options: z.array(agentUserQuestionOptionSchema).optional(),
  multiSelect: z.boolean().optional(),
})
export const agentUserQuestionResolutionSchema = z.object({
  status: z.enum(["answered", "skipped", "timed_out", "cancelled"]),
  resolvedAt: z.string(),
  answers: z.array(z.object({
    questionIndex: z.number().int().nonnegative(),
    values: z.array(z.string()),
  })).optional(),
})
const resultMetadataSchema = z.object({
  mainThreadPersona: z.object({
    id: z.string(),
    name: z.string(),
    source: z.enum(["builtin", "user"]),
    definitionHash: z.string().optional(),
  }).optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  contextRemainingPercent: z.number().optional(),
  contextUsage: agentContextUsageSchema.optional(),
  workDir: z.string().optional(),
  cancelled: z.boolean().optional(),
  turnOutcome: agentTurnOutcomeSchema.optional(),
  usage: jsonRecordSchema.optional(),
  turnUsage: jsonRecordSchema.optional(),
  modelUsage: jsonRecordSchema.optional(),
  sdkResultUuid: z.string().optional(),
  costUsd: z.number().optional(),
  costCny: z.number().optional(),
  costBreakdownCny: jsonRecordSchema.optional(),
  totalCostUsd: z.number().optional(),
  totalCostCny: z.number().optional(),
  totalCostBreakdownCny: jsonRecordSchema.optional(),
  costCurrency: z.literal("CNY").optional(),
  estimatedCost: z.boolean().optional(),
})

export const timelineItemSchema = z.discriminatedUnion("kind", [
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("message"),
    role: z.enum(["user", "assistant", "system", "tool"]),
    content: z.string(),
    attachments: z.array(agentMessageAttachmentSchema).optional(),
    legacy: z.boolean().optional(),
    metadata: resultMetadataSchema.optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("thinking"),
    content: z.string(),
    startedAt: z.string().optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("toolCall"),
    toolUseId: z.string().optional(),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: jsonRecordSchema.optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("toolResult"),
    toolUseId: z.string().optional(),
    toolName: z.string(),
    content: z.string().optional(),
    contentDiagnostics: agentToolResultContentDiagnosticsSchema.optional(),
    imageArtifacts: z.array(agentImageArtifactSchema).optional(),
    status: z.string().optional(),
    exitCode: z.number().optional(),
    success: z.boolean().optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("permissionRequest"),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: jsonRecordSchema.optional(),
    questions: z.array(agentUserQuestionSchema).optional(),
    blockedPath: z.string().optional(),
    sessionDirectoryGrantAvailable: z.boolean().optional(),
    resolution: agentUserQuestionResolutionSchema.optional(),
    resolutionAttempt: agentUserQuestionResolutionSchema.optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("toolProgress"),
    toolUseId: z.string().optional(),
    toolName: z.string(),
    blockIndex: z.number().optional(),
    inputCharCount: z.number(),
    status: z.enum(["preparing", "stopped"]),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("error"),
    message: z.string(),
    errorKind: agentErrorKindSchema.optional(),
    recoverable: z.boolean().optional(),
    turnOutcome: agentTurnOutcomeSchema.optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("result"),
    content: z.string(),
    metadata: resultMetadataSchema.optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("phase"),
    runId: z.string(),
    phase: z.enum([
      "submitted",
      "received",
      "runtime_starting",
      "runtime_ready",
      "request_submitted",
      "awaiting_first_token",
      "streaming",
      "completed",
      "failed",
      "cancel_pending",
      "cancelled",
    ]),
    status: z.enum(["in-progress", "done", "failed"]),
    startedAt: z.string(),
    completedAt: z.string().optional(),
    errorMessage: z.string().optional(),
    errorKind: agentErrorKindSchema.optional(),
    recoverable: z.boolean().optional(),
  }),
  z.object({
    ...timelineBaseSchema,
    kind: z.literal("sdkEvent"),
    sdkType: z.string(),
    sdkSubtype: z.string().optional(),
    label: z.string(),
    summary: z.string().optional(),
  }),
])

export const sessionSummarySchema = z.object({
  projectId: z.string(),
  id: z.string(),
  sessionKey: z.string(),
  mode: permissionModeSchema.optional(),
  name: z.string().optional(),
  platform: z.string().optional(),
  sourceLabel: z.string().optional(),
  agentType: z.string().optional(),
  agentSessionId: z.string().optional(),
  providerId: z.string().optional(),
  modelTier: z.string().optional(),
  activeMainThreadPersonaId: z.string().nullable().optional(),
  activeMainThreadPersonaName: z.string().optional(),
  activeMainThreadPersonaSource: z.enum(["builtin", "user"]).optional(),
  active: z.boolean(),
  historyCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessage: timelineItemSchema.optional(),
})

// ─── Shared helper functions ──────────────────────────────────────────────────

export async function resolveProjectAgent(
  resolve: <T>(serviceId: string) => T,
  projectId: string,
): Promise<{
  readonly agent: AgentRuntimeService
  readonly providerService: ProviderService
  readonly project: { readonly uuid: string; readonly name: string; readonly localPath: string }
  readonly managedKnowledgeBase?: boolean
}> {
  const config = await configStore.load()
  const project = await resolveAgentProjectConfig(config, projectId)
  if (!project) {
    throw new Error("找不到当前项目。")
  }
  await assertManagedKnowledgeBaseWorkspace(project)

  const containers = resolve<ProjectContainerRegistry>("core.project-containers")
  const container = await containers.open(project.uuid, {
    name: project.name,
    workspacePath: project.localPath,
    managedKnowledgeBase: project.managedKnowledgeBase,
  })
  return {
    agent: container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID),
    providerService: container.get<ProviderService>(PROVIDER_SERVICE_ID),
    project,
  }
}

async function resolveAgentProjectConfig(
  config: Awaited<ReturnType<typeof configStore.load>>,
  projectId: string,
): Promise<{
  readonly uuid: string
  readonly name: string
  readonly localPath: string
  readonly managedKnowledgeBase?: boolean
} | null> {
  if (isDefaultAgentWorkspaceProjectId(projectId)) {
    return resolveDefaultAgentWorkspaceProject()
  }
  const repository = config.repositories.find((item) => item.uuid === projectId)
  if (repository) {
    return repository
  }
  const project = config.global.projects.find((item) => item.id === projectId)
  if (!project) {
    return null
  }
  return {
    uuid: project.id,
    name: project.name,
    localPath: resolveProjectWorkspacePath(project, { storage: config.global.knowledgeBaseStorage }),
    ...(isManagedKnowledgeBaseProject(project) ? { managedKnowledgeBase: true } : undefined),
  }
}

async function assertManagedKnowledgeBaseWorkspace(project: {
  readonly uuid: string
  readonly name: string
  readonly localPath: string
  readonly managedKnowledgeBase?: boolean
}): Promise<void> {
  if (!project.managedKnowledgeBase) return
  try {
    const stats = await stat(project.localPath)
    if (!stats.isDirectory()) {
      throw Object.assign(
        new Error("Managed knowledge base workspace is not a directory."),
        { code: "ENOTDIR" },
      )
    }
  } catch (error) {
    const errorCode = nodeErrorCode(error)
    logger.warn("Managed knowledge base workspace unavailable.", {
      boundary: "agent.managed-knowledge-base.workspace",
      projectId: project.uuid,
      projectName: project.name,
      errorCode,
    })
    if (errorCode === "ENOENT" || errorCode === "ENOTDIR") {
      throw new Error(MANAGED_KNOWLEDGE_BASE_WORKSPACE_MISSING_ERROR, { cause: error })
    }
    throw new Error(MANAGED_KNOWLEDGE_BASE_WORKSPACE_UNAVAILABLE_ERROR, { cause: error })
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  const code = (error as Error & { readonly code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

export function sessionSummary(session: ConversationEntryV1, historyCount = session.history.length) {
  const last = session.history.at(-1)
  const personaSnapshot = session.agentConfig?.activeMainThreadPersonaSnapshot
  return {
    projectId: session.projectId,
    id: session.id,
    sessionKey: session.sessionKey,
    mode: permissionModeFromConversation(session),
    name: session.name,
    platform: session.platform,
    sourceLabel: sessionSourceLabel(session),
    agentType: session.agentType,
    agentSessionId: session.agentSessionId,
    providerId: session.providerId,
    modelTier: session.agentConfig?.modelTier,
    activeMainThreadPersonaId: session.agentConfig?.activeMainThreadPersonaId,
    activeMainThreadPersonaName: personaSnapshot?.name,
    activeMainThreadPersonaSource: personaSnapshot?.source,
    active: session.active,
    historyCount,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessage: last ? historyEntry(session.id, last, historyCount - 1, session.agentType) : undefined,
  }
}

function permissionModeFromConversation(
  session: ConversationEntryV1,
): z.infer<typeof permissionModeSchema> | undefined {
  const mode = session.agentConfig?.mode
  return permissionModeSchema.safeParse(mode).success
    ? mode as z.infer<typeof permissionModeSchema>
    : undefined
}

function sessionSourceLabel(session: ConversationEntryV1): string | undefined {
  const chatName = stringFromRecord(session.userMeta, "chatName")
  const userName = stringFromRecord(session.userMeta, "userName")
  if (chatName && userName) return `${chatName} / ${userName}`
  return chatName ?? userName ?? session.channelKey
}

function stringFromRecord(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const item = value?.[key]
  return typeof item === "string" && item.trim() ? item.trim() : undefined
}

export async function resolveTimelineSession(
  agent: AgentRuntimeService,
  request: z.infer<typeof timelineRequestSchema>,
): Promise<ConversationEntryV1 | null> {
  if (request.conversationId) {
    return agent.getSession(request.conversationId)
  }
  const sessions = await agent.listSessions()
  if (request.sessionKey) {
    return sessions.find((session) => session.sessionKey === request.sessionKey && session.active)
      ?? sessions.find((session) => session.sessionKey === request.sessionKey)
      ?? null
  }
  return sessions.find((session) => session.sessionKey === DEFAULT_LOCAL_SESSION_KEY && session.active)
    ?? sessions[0]
    ?? null
}

export interface ConversationHistoryPage {
  readonly entries: ReturnType<typeof historyEntry>[]
  readonly total: number
  readonly startIndex: number
  readonly hasMore: boolean
}

export class InvalidConversationHistoryBoundaryError extends Error {
  constructor(beforeIndex: number) {
    super(`Invalid conversation history boundary: ${String(beforeIndex)}`)
    this.name = "InvalidConversationHistoryBoundaryError"
  }
}

export function historyPage(
  session: ConversationEntryV1,
  request: Pick<z.infer<typeof timelineRequestSchema>, "limit" | "beforeIndex"> = {},
): ConversationHistoryPage {
  const total = session.history.length
  if (total === 0) {
    return { entries: [], total: 0, startIndex: 0, hasMore: false }
  }

  const paged = request.limit !== undefined || request.beforeIndex !== undefined
  const endIndex = request.beforeIndex ?? total
  assertHistoryPageBoundary(session, endIndex)

  if (!paged) {
    return {
      entries: session.history.map((entry, index) =>
        historyEntry(session.id, entry, index, session.agentType)),
      total,
      startIndex: 0,
      hasMore: false,
    }
  }

  if (endIndex === 0) {
    return { entries: [], total, startIndex: 0, hasMore: false }
  }

  const nominalStart = Math.max(0, endIndex - (request.limit ?? 100))
  let startIndex = nominalStart
  while (startIndex > 0 && session.history[startIndex]?.role !== "user") {
    startIndex -= 1
  }
  if (session.history[startIndex]?.role !== "user") startIndex = 0

  return {
    entries: session.history.slice(startIndex, endIndex).map((entry, index) =>
      historyEntry(session.id, entry, startIndex + index, session.agentType)),
    total,
    startIndex,
    hasMore: startIndex > 0,
  }
}

function assertHistoryPageBoundary(session: ConversationEntryV1, beforeIndex: number): void {
  const total = session.history.length
  if (beforeIndex === 0 || beforeIndex === total) return
  if (beforeIndex > total || session.history[beforeIndex]?.role !== "user") {
    throw new InvalidConversationHistoryBoundaryError(beforeIndex)
  }
}

export function historyEntry(
  sessionId: string,
  entry: ConversationEntryV1["history"][number],
  index: number,
  agentType?: string,
) {
  return historyRecordToTimelineItem(sessionId, entry, index, agentType)
}

// ─── Shared event schemas (used in main ipc.ts) ───────────────────────────────

const agentEventBaseSchema = {
  sdkSessionId: z.string().optional(),
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
  timestamp: z.string().optional(),
  payload: jsonRecordSchema.optional(),
}

export const agentEventTypeSchema = z.enum([
  "text",
  "thinking",
  "toolUse",
  "toolResult",
  "permissionRequest",
  "result",
  "error",
  "sessionInit",
  "assistant",
  "stream",
  "status",
  "compactBoundary",
  "sdkEvent",
])

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...agentEventBaseSchema, type: z.literal("text"), content: z.string() }),
  z.object({ ...agentEventBaseSchema, type: z.literal("thinking"), content: z.string() }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("toolUse"),
    toolUseId: z.string().optional(),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: jsonRecordSchema.optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("toolResult"),
    toolUseId: z.string().optional(),
    toolName: z.string(),
    content: z.string().optional(),
    contentDiagnostics: agentToolResultContentDiagnosticsSchema.optional(),
    imageArtifacts: z.array(agentImageArtifactSchema).optional(),
    status: z.string().optional(),
    exitCode: z.number().optional(),
    success: z.boolean().optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("permissionRequest"),
    requestId: z.string(),
    toolName: z.string(),
    toolInput: z.string().optional(),
    toolInputRaw: jsonRecordSchema.optional(),
    questions: z.array(agentUserQuestionSchema).optional(),
    blockedPath: z.string().optional(),
    sessionDirectoryGrantAvailable: z.boolean().optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("result"),
    content: z.string(),
    done: z.literal(true),
    metadata: resultMetadataSchema.optional(),
    usage: jsonRecordSchema.optional(),
    modelUsage: jsonRecordSchema.optional(),
    sdkResultUuid: z.string().optional(),
    costUsd: z.number().optional(),
    costCny: z.number().optional(),
    costCurrency: z.literal("CNY").optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("error"),
    message: z.string(),
    errorKind: agentErrorKindSchema.optional(),
    recoverable: z.boolean().optional(),
    turnOutcome: agentTurnOutcomeSchema.optional(),
    usage: jsonRecordSchema.optional(),
    modelUsage: jsonRecordSchema.optional(),
    sdkResultUuid: z.string().optional(),
    costUsd: z.number().optional(),
    costCny: z.number().optional(),
    costCurrency: z.literal("CNY").optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("sessionInit"),
    tools: z.array(z.string()).optional(),
    mcpServers: z.array(jsonRecordSchema).optional(),
    model: z.string().optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("assistant"),
    contentBlocks: z.array(z.unknown()).optional(),
    content: z.string().optional(),
    message: jsonRecordSchema.optional(),
    contextUsage: agentContextUsageSchema.optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("stream"),
    blockIndex: z.number().optional(),
    deltaType: z.string().optional(),
    text: z.string().optional(),
    thinking: z.string().optional(),
    partialJson: z.string().optional(),
    inputJsonDeltaLength: z.number().optional(),
    toolUseId: z.string().optional(),
    toolName: z.string().optional(),
    event: jsonRecordSchema.optional(),
    contextUsage: agentContextUsageSchema.optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("status"),
    status: z.string().nullable().optional(),
    message: z.string().optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("compactBoundary"),
    contextUsage: agentContextUsageSchema.optional(),
  }),
  z.object({
    ...agentEventBaseSchema,
    type: z.literal("sdkEvent"),
    sdkType: z.string(),
    sdkSubtype: z.string().optional(),
    payload: jsonRecordSchema,
  }),
])

export const agentEventScopeSchema = z.object({
  projectId: z.string().optional(),
  sessionId: z.string().optional(),
  repositoryId: z.string().optional(),
}).optional()

// ─── Phase update domain event (T1/T2 in Plan A; T3..T9 in Plan B) ────────────

export const agentPhaseValueSchema = z.enum([
  "submitted",
  "received",
  "runtime_starting",
  "runtime_ready",
  "request_submitted",
  "awaiting_first_token",
  "streaming",
  "completed",
  "failed",
  "cancel_pending",
  "cancelled",
])

export const agentPhaseStatusSchema = z.enum(["in-progress", "done", "failed"])

export const agentPhaseUpdatePayloadSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string().optional(),
  phase: agentPhaseValueSchema,
  status: agentPhaseStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  errorMessage: z.string().optional(),
  errorKind: agentErrorKindSchema.optional(),
  recoverable: z.boolean().optional(),
})

export type AgentPhaseUpdatePayload = z.infer<typeof agentPhaseUpdatePayloadSchema>
