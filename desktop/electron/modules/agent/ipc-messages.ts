import { randomUUID } from "node:crypto"
import { BrowserWindow, clipboard, dialog, type OpenDialogOptions } from "electron"
import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type {
  AgentArtifactEntry,
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataRepository,
} from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createZipArchive } from "../../runtime/archive"
import { createControlledProcessRunner } from "../../runtime/process"
import type { AgentEvent, AgentMessage, AgentRuntimeService } from "../../services/agent-runtime"
import { AgentConversationExportService } from "../../services/agent-runtime/conversation-export-service"
import { AgentAttachmentQuotaError } from "../../services/agent-runtime/attachment-staging-service"
import { REDACTED } from "../../services/agent-runtime/redaction"
import { agentConversationDeliveryOptions } from "../../services/agent-runtime/event-delivery"
import type { EventBus } from "../../runtime/event-bus"
import type { ProjectContainerRegistry } from "../../runtime/project-container"
import { AGENT_RUNTIME_SERVICE_ID } from "../../services/agent-runtime"
import { AGENT_ATTACHMENT_IMAGE_MIME_TYPES } from "../../../src/types/agent-attachment"
import { createMainLogger } from "../../services/log-store"
import { configStore } from "../../services/config-store"
import {
  DEFAULT_LOCAL_SESSION_KEY,
  LOCAL_RENDERER_PLATFORM,
  timelineRequestSchema,
  timelineItemSchema,
  agentEventSchema,
  permissionModeSchema,
  agentUserQuestionSchema,
  sessionSummary,
  sessionSummarySchema,
  resolveProjectAgent,
  resolveTimelineSession,
  historyPage,
  InvalidConversationHistoryBoundaryError,
  assertKnowledgeBaseStorageMigrationInactive,
} from "./ipc-shared"
import { AgentClipboardAttachmentService } from "./clipboard-attachment-service"

const MAX_CLIENT_SKEW_MS = 60_000
const MAX_AGENT_ATTACHMENT_RESOLUTION_PATHS = 256
const logger = createMainLogger("agent.ipc")
const rendererDestroyCleanupRegistered = new Set<number>()
const clipboardAttachmentService = new AgentClipboardAttachmentService(() => clipboard.readImage())
const agentImageMimeTypeSchema = z.enum(AGENT_ATTACHMENT_IMAGE_MIME_TYPES)
const attachmentPathSchema = z.string()
  .trim()
  .refine(isAbsoluteAttachmentPath, "path must be an absolute POSIX or Windows path")
const attachmentSelectionKindSchema = z.enum(["file", "directory"])

function clampClientSubmittedAt(clientIso: string | undefined, recvIso: string): string {
  if (!clientIso) return recvIso
  const recv = Date.parse(recvIso)
  const client = Date.parse(clientIso)
  if (!Number.isFinite(client) || !Number.isFinite(recv)) return recvIso
  if (client > recv) return recvIso
  if (recv - client > MAX_CLIENT_SKEW_MS) return recvIso
  return clientIso
}

function isAbsoluteAttachmentPath(value: string): boolean {
  if (/^([\\/])\1[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)) return true
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  return value.startsWith("/") && !value.startsWith("//")
}

const attachmentRefSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(2), attachmentId: z.string().min(1), kind: z.literal("image"), name: z.string(),
    byteSize: z.number().int().nonnegative(), mimeType: agentImageMimeTypeSchema,
    previewUrl: z.string(), thumbnailUrl: z.string(), previewByteSize: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(), sha256: z.string().length(64),
  }),
  z.object({
    version: z.literal(2), attachmentId: z.string().min(1), kind: z.literal("file"), name: z.string(),
    byteSize: z.number().int().nonnegative(), mimeType: z.string().optional(), sha256: z.string().length(64),
  }),
  z.object({
    version: z.literal(2), attachmentId: z.string().min(1), kind: z.literal("directory"), name: z.string(),
    byteSize: z.number().int().nonnegative(),
  }),
])

const attachmentCandidateSchema = z.object({
  sourceIndex: z.number().int().nonnegative(),
  ref: attachmentRefSchema,
})

const attachmentSelectionResultSchema = z.object({
  attachments: z.array(attachmentCandidateSchema),
  rejectedCount: z.number().int().nonnegative(),
})

const attachmentContextRequestSchema = projectRequestSchema.extend({
  draftScopeId: z.string().min(1),
})

const stageClipboardImageRequestSchema = attachmentContextRequestSchema.extend({
  name: z.string().trim().min(1).max(255).optional(),
})

const chooseAttachmentsRequestSchema = attachmentContextRequestSchema.extend({
  kind: attachmentSelectionKindSchema,
})

const resolveAttachmentPathsRequestSchema = attachmentContextRequestSchema.extend({
  paths: z.array(attachmentPathSchema).max(MAX_AGENT_ATTACHMENT_RESOLUTION_PATHS),
})

const releaseAttachmentsRequestSchema = attachmentContextRequestSchema.extend({
  attachmentIds: z.array(z.string().min(1)).max(50),
})

const releaseAttachmentsResultSchema = z.object({
  releasedCount: z.number().int().nonnegative(),
})

async function stagePathsForRenderer(
  agent: AgentRuntimeService,
  input: { readonly draftScopeId: string; readonly paths: readonly string[] },
): Promise<z.infer<typeof attachmentSelectionResultSchema>> {
  const attachments: z.infer<typeof attachmentCandidateSchema>[] = []
  let rejectedCount = 0
  for (const [sourceIndex, attachmentPath] of input.paths.entries()) {
    try {
      const staged = await agent.stageAttachmentPaths({
        actor: { kind: "user", id: "renderer" },
        draftScopeId: input.draftScopeId,
        paths: [attachmentPath],
      })
      const attachment = staged[0]
      if (!attachment) {
        rejectedCount += 1
        continue
      }
      attachments.push({ sourceIndex, ref: attachment.ref })
    } catch (error) {
      if (error instanceof AgentAttachmentQuotaError) {
        await agent.releaseAttachments({
          actor: { kind: "user", id: "renderer" },
          draftScopeId: input.draftScopeId,
          attachmentIds: attachments.map((attachment) => attachment.ref.attachmentId),
        })
        return { attachments: [], rejectedCount: input.paths.length }
      }
      rejectedCount += 1
    }
  }
  return { attachments, rejectedCount }
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const sendRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1).optional(),
  content: z.string(),
  displayContent: z.string().optional(),
  clientSubmittedAt: z.string().optional(),
  providerId: z.string().min(1).optional(),
  attachments: z.array(z.object({
    attachmentId: z.string().min(1),
    order: z.number().int().nonnegative(),
  })).max(50).optional(),
}).superRefine((request, ctx) => {
  if (request.content.trim().length > 0) return
  if ((request.attachments?.length ?? 0) > 0) return
  ctx.addIssue({
    code: "custom",
    path: ["content"],
    message: "content or attachments are required",
  })
})

const steerRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  expectedTurnId: z.string().min(1),
  clientMessageId: z.string().min(1),
  content: z.string(),
  clientSubmittedAt: z.string().optional(),
}).superRefine((request, ctx) => {
  const content = request.content.trim()
  if (!content) {
    ctx.addIssue({ code: "custom", path: ["content"], message: "content is required" })
  } else if (content.startsWith("/")) {
    ctx.addIssue({ code: "custom", path: ["content"], message: "commands cannot steer an active turn" })
  }
})

const respondPermissionRequestSchema = projectRequestSchema.extend({
  requestId: z.string().min(1),
  behavior: z.enum(["allow", "deny"]),
  scope: z.enum(["once", "session"]).optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
  message: z.string().optional(),
})

const setPermissionModeRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  mode: permissionModeSchema,
})

const cancelTurnRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
})

const contextRecoveryRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  failedTurnId: z.string().min(1),
})

const cancelTurnResultSchema = z.object({
  status: z.enum(["no-active-turn", "graceful-pending", "hard-killed"]),
})

const exportConversationBundleRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1),
})
const timelineContentChunkRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  historyIndex: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive().max(64 * 1024).optional(),
})
const agentEventSubscriptionRequestSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(256),
  projectId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
})
const ackAgentEventBatchRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  batchId: z.string().min(1),
})

const fileCheckpointRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  checkpointId: z.string().min(1),
})
const fileCheckpointDiffRequestSchema = fileCheckpointRequestSchema.extend({
  fileId: z.string().min(1),
})
const confirmFileCheckpointRewindRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
  operationId: z.string().min(1),
})

// ─── Response schemas ─────────────────────────────────────────────────────────

const sendResultSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string(),
  outcome: z.object({
    status: z.enum(["completed", "failed", "cancelled", "interrupted"]),
    errorKind: z.enum([
      "execution_failed",
      "connection_interrupted",
      "tool_use_interrupted",
      "webfetch_preflight_failed",
      "request_body_too_large",
      "context_refill_thrashing",
      "renderer_unavailable",
    ]).optional(),
    recoverable: z.boolean().optional(),
  }),
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
})

const steerResultSchema = z.object({
  status: z.enum([
    "accepted",
    "no-active-turn",
    "turn-changed",
    "permission-pending",
    "cancel-pending",
    "session-ended",
    "unsupported",
  ]),
  conversationId: z.string(),
  turnId: z.string().optional(),
  clientMessageId: z.string(),
})

const timelineResultSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string().optional(),
  entries: z.array(timelineItemSchema),
  total: z.number().int().nonnegative(),
  startIndex: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
const timelineContentChunkResultSchema = z.object({
  conversationId: z.string(),
  historyIndex: z.number().int().nonnegative(),
  content: z.string(),
  nextOffset: z.number().int().nonnegative(),
  done: z.boolean(),
})

const pendingPermissionSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string(),
  toolName: z.string(),
  toolInput: z.string().optional(),
  toolInputRaw: z.record(z.string(), z.unknown()).optional(),
  questions: z.array(agentUserQuestionSchema).optional(),
  blockedPath: z.string().optional(),
  sessionDirectoryGrantAvailable: z.boolean().optional(),
  createdAt: z.string(),
})

const respondPermissionResultSchema = z.object({
  ok: z.literal(true),
})

const exportConversationBundleResultSchema = z.object({
  success: z.boolean(),
  filePath: z.string().optional(),
  fileCount: z.number().optional(),
})

const fileCheckpointStatusSchema = z.enum(["available", "superseded", "rewound", "partial", "unavailable"])
const fileCheckpointFileSchema = z.object({
  id: z.string(),
  path: z.string(),
  kind: z.enum(["added", "modified", "deleted"]),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  truncated: z.boolean(),
})
const fileCheckpointDetailSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: fileCheckpointStatusSchema,
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(fileCheckpointFileSchema),
})
const fileCheckpointDiffSchema = z.object({
  checkpointId: z.string(),
  fileId: z.string(),
  path: z.string(),
  kind: z.enum(["added", "modified", "deleted"]),
  patch: z.string().optional(),
  binary: z.boolean(),
  truncated: z.boolean(),
  diffCleared: z.boolean().optional(),
})
const fileCheckpointPrepareSchema = z.object({
  operationId: z.string(),
  expiresAt: z.string(),
  filesChanged: z.array(z.string()),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  coverageWarning: z.boolean(),
})
const fileCheckpointRewindSchema = z.object({
  checkpointId: z.string(),
  status: z.enum(["rewound", "partial"]),
  skippedLinks: z.number().int().nonnegative(),
})

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SendRequest = z.infer<typeof sendRequestSchema>
type SteerRequest = z.infer<typeof steerRequestSchema>
type RespondPermissionRequest = z.infer<typeof respondPermissionRequestSchema>
type SetPermissionModeRequest = z.infer<typeof setPermissionModeRequestSchema>
type ExportConversationBundleRequest = z.infer<typeof exportConversationBundleRequestSchema>

// ─── Message method descriptors ───────────────────────────────────────────────

export const messageMethods: Record<string, IpcMethodDescriptor> = {
  setAgentEventSubscription: {
    kind: "invoke",
    operationId: "app.agent.operation.set_event_subscription",
    request: agentEventSubscriptionRequestSchema,
    response: z.object({ ok: z.literal(true) }),
    handler: (ctx, request: z.infer<typeof agentEventSubscriptionRequestSchema>) => {
      const rendererId = ctx.sender?.id
      if (rendererId === undefined) throw new Error("Renderer 订阅来源无效。")
      const containers = ctx.resolve<ProjectContainerRegistry>("core.project-containers")
      const subscribed = new Set(request.projectIds)
      for (const { projectId } of containers.list()) {
        containers.peek(projectId)?.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
          .setRendererSubscription(
            rendererId,
            subscribed.has(projectId),
            request.projectId === projectId ? request.conversationId : null,
          )
      }
      if (!rendererDestroyCleanupRegistered.has(rendererId)) {
        rendererDestroyCleanupRegistered.add(rendererId)
        ctx.sender?.onDestroyed(() => {
          rendererDestroyCleanupRegistered.delete(rendererId)
          for (const { projectId } of containers.list()) {
            containers.peek(projectId)?.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
              .setRendererSubscription(rendererId, false)
          }
        })
      }
      return { ok: true }
    },
  },
  ackAgentEventBatch: {
    kind: "invoke",
    operationId: "app.agent.operation.ack_event_batch",
    request: ackAgentEventBatchRequestSchema,
    response: z.object({ acknowledged: z.boolean() }),
    handler: (ctx, request: z.infer<typeof ackAgentEventBatchRequestSchema>) => {
      const rendererId = ctx.sender?.id
      if (rendererId === undefined) return { acknowledged: false }
      const containers = ctx.resolve<ProjectContainerRegistry>("core.project-containers")
      const runtime = containers.peek(request.projectId)?.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
      return {
        acknowledged: runtime?.ackRendererEventBatch(
          rendererId,
          request.conversationId,
          request.batchId,
        ) ?? false,
      }
    },
  },
  getFileCheckpoint: {
    kind: "invoke",
    operationId: "app.agent.operation.get_file_checkpoint",
    request: fileCheckpointRequestSchema,
    response: fileCheckpointDetailSchema,
    handler: async (ctx, request: z.infer<typeof fileCheckpointRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.getFileCheckpointDetail(request.conversationId, request.checkpointId)
    },
  },
  getFileCheckpointDiff: {
    kind: "invoke",
    operationId: "app.agent.operation.get_file_checkpoint_diff",
    request: fileCheckpointDiffRequestSchema,
    response: fileCheckpointDiffSchema,
    handler: async (ctx, request: z.infer<typeof fileCheckpointDiffRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.getFileCheckpointDiff(request.conversationId, request.checkpointId, request.fileId)
    },
  },
  prepareFileCheckpointRewind: {
    kind: "invoke",
    operationId: "app.agent.operation.prepare_file_checkpoint_rewind",
    request: fileCheckpointRequestSchema,
    response: fileCheckpointPrepareSchema,
    handler: async (ctx, request: z.infer<typeof fileCheckpointRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.prepareFileCheckpointRewind({
        conversationId: request.conversationId,
        checkpointId: request.checkpointId,
        actor: { kind: "user", id: "renderer" },
      })
    },
  },
  confirmFileCheckpointRewind: {
    kind: "invoke",
    operationId: "app.agent.operation.confirm_file_checkpoint_rewind",
    request: confirmFileCheckpointRewindRequestSchema,
    response: fileCheckpointRewindSchema,
    handler: async (ctx, request: z.infer<typeof confirmFileCheckpointRewindRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const result = await agent.confirmFileCheckpointRewind({
        conversationId: request.conversationId,
        operationId: request.operationId,
      })
      return {
        checkpointId: result.checkpointId,
        status: result.status,
        skippedLinks: result.skippedLinks,
      }
    },
  },
  getTimeline: {
    kind: "invoke",
    operationId: "app.agent.operation.get_timeline",
    request: timelineRequestSchema,
    response: timelineResultSchema,
    maxResponseBytes: 1024 * 1024,
    handler: async (ctx, request: z.infer<typeof timelineRequestSchema>) => {
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        if (ctx.sender) agent.setRendererSubscription(ctx.sender.id, true, request.conversationId)
        const session = await resolveTimelineSession(agent, request)
        const page = session
          ? historyPage(session, request)
          : { entries: [], total: 0, startIndex: 0, hasMore: false }
        return {
          projectId: request.projectId,
          sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
          conversationId: session?.id,
          ...page,
        }
      } catch (rawError) {
        if (rawError instanceof InvalidConversationHistoryBoundaryError) throw rawError
        logger.warn("Agent timeline runtime lookup failed; trying repository fallback.", {
          projectId: request.projectId,
          sessionKey: request.sessionKey ? REDACTED : undefined,
          hasConversationId: Boolean(request.conversationId),
          limit: request.limit,
          beforeIndex: request.beforeIndex,
          boundary: "agent.timeline.runtime",
          ...timelineLookupErrorMeta(rawError),
        })
        if (!request.conversationId) throw new Error("找不到当前项目。", { cause: rawError })
        const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
        const conversations = dataRepo.namespace<ConversationEntryV1>("conversations")
        const session = await conversations.get(request.conversationId)
        if (!session || session.projectId !== request.projectId) {
          return {
            projectId: request.projectId,
            sessionKey: request.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
            conversationId: request.conversationId,
            entries: [],
            total: 0,
            startIndex: 0,
            hasMore: false,
          }
        }
        const page = historyPage(session, request)
        return {
          projectId: request.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          ...page,
        }
      }
    },
  },
  getTimelineContentChunk: {
    kind: "invoke",
    operationId: "app.agent.operation.get_timeline_content_chunk",
    request: timelineContentChunkRequestSchema,
    response: timelineContentChunkResultSchema,
    maxResponseBytes: 68 * 1024,
    handler: async (ctx, request: z.infer<typeof timelineContentChunkRequestSchema>) => {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const conversation = await dataRepo.namespace<ConversationEntryV1>("conversations")
        .get(request.conversationId)
      if (!conversation || conversation.projectId !== request.projectId) {
        throw new Error("找不到当前对话。")
      }
      const history = conversation.history[request.historyIndex]
      if (!history) throw new Error("对话内容索引无效。")
      if (request.offset > history.content.length) throw new Error("对话内容偏移无效。")
      const content = truncateUtf8Chunk(history.content.slice(request.offset), request.maxBytes ?? 64 * 1024)
      const nextOffset = request.offset + content.length
      return {
        conversationId: conversation.id,
        historyIndex: request.historyIndex,
        content,
        nextOffset,
        done: nextOffset >= history.content.length,
      }
    },
  },
  exportConversationBundle: {
    kind: "invoke",
    operationId: "app.agent.operation.export_conversation_bundle",
    request: exportConversationBundleRequestSchema,
    response: exportConversationBundleResultSchema,
    handler: async (ctx, request: ExportConversationBundleRequest) => {
      const dataRepo = ctx.resolve<DataRepository>("core.data-repository")
      const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
      const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
      const processRunner = createControlledProcessRunner({ permissionGuard, auditSink })
      const service = new AgentConversationExportService({
        conversations: dataRepo.namespace<ConversationEntryV1>("conversations"),
        agentEvents: dataRepo.namespace<AgentEventEntryV1>("agent.events"),
        agentUsage: dataRepo.namespace<AgentUsageEntryV1>("agent.usage"),
        agentArtifacts: dataRepo.namespace<AgentArtifactEntry>("agent.artifacts"),
        permissionGuard,
        auditSink,
        logger,
        chooseSavePath: chooseConversationBundleSavePath,
        createZipArchive: (sourceDirectoryPath, outputFilePath) =>
          createZipArchive(sourceDirectoryPath, outputFilePath, {
            actor: { kind: "user", id: "renderer" },
            processRunner,
            messages: {
              failed: "导出对话调试包失败。",
            },
          }),
        getTimeline: async () => {
          const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
          const session = await resolveTimelineSession(agent, request)
          const page = session
            ? historyPage(session)
            : { entries: [], total: 0, startIndex: 0, hasMore: false }
          return {
            projectId: request.projectId,
            sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
            conversationId: session?.id,
            ...page,
          }
        },
        getLiveState: async () => {
          const { agent, project } = await resolveProjectAgent(ctx.resolve, request.projectId)
          return {
            status: {
              ...agent.getStatus(),
              projectName: project.name,
            },
            pendingPermissions: agent.listPendingPermissions().filter((item) =>
              item.conversationId === request.conversationId),
          }
        },
      })
      return service.exportBundle(request)
    },
  },
  chooseAttachments: {
    kind: "invoke",
    operationId: "app.agent.operation.choose_attachments",
    request: chooseAttachmentsRequestSchema,
    response: attachmentSelectionResultSchema,
    handler: async (ctx, request: z.infer<typeof chooseAttachmentsRequestSchema>) => {
      const options: OpenDialogOptions = {
        title: request.kind === "file" ? "添加文件" : "添加文件夹",
        properties: request.kind === "file"
          ? ["openFile", "multiSelections"]
          : ["openDirectory", "multiSelections"],
      }
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const result = focusedWindow
        ? await dialog.showOpenDialog(focusedWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) {
        return { attachments: [], rejectedCount: 0 }
      }
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return stagePathsForRenderer(agent, {
        draftScopeId: request.draftScopeId,
        paths: result.filePaths,
      })
    },
  },
  resolveAttachmentPaths: {
    kind: "invoke",
    operationId: "app.agent.operation.resolve_attachment_paths",
    request: resolveAttachmentPathsRequestSchema,
    response: attachmentSelectionResultSchema,
    handler: async (ctx, request: z.infer<typeof resolveAttachmentPathsRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return stagePathsForRenderer(agent, request)
    },
  },
  stageClipboardImage: {
    kind: "invoke",
    operationId: "app.agent.operation.stage_clipboard_image",
    request: stageClipboardImageRequestSchema,
    response: attachmentSelectionResultSchema,
    handler: async (ctx, request: z.infer<typeof stageClipboardImageRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return clipboardAttachmentService.stage(agent, {
        draftScopeId: request.draftScopeId,
        name: request.name,
      })
    },
  },
  releaseAttachments: {
    kind: "invoke",
    operationId: "app.agent.operation.release_attachments",
    request: releaseAttachmentsRequestSchema,
    response: releaseAttachmentsResultSchema,
    handler: async (ctx, request: z.infer<typeof releaseAttachmentsRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      await agent.releaseAttachments({
        actor: { kind: "user", id: "renderer" },
        draftScopeId: request.draftScopeId,
        attachmentIds: request.attachmentIds,
      })
      return { releasedCount: request.attachmentIds.length }
    },
  },
  send: {
    kind: "invoke",
    operationId: "app.agent.operation.send",
    request: sendRequestSchema,
    response: sendResultSchema,
    maxResponseBytes: 32 * 1024,
    handler: async (ctx, request: SendRequest) => {
      const sessionKey = request.sessionKey?.trim() || DEFAULT_LOCAL_SESSION_KEY
      const eventBus = ctx.resolve<EventBus>("core.event-bus")
      const runId = randomUUID()
      const t_recv = new Date().toISOString()
      const submittedAt = clampClientSubmittedAt(request.clientSubmittedAt, t_recv)

      try {
        const config = await configStore.load()
        const project = config.global.projects.find((item) => item.id === request.projectId)
        assertKnowledgeBaseStorageMigrationInactive(ctx.resolve, project)
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        if (ctx.sender) agent.setRendererSubscription(ctx.sender.id, true, request.conversationId)
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: request.conversationId,
            phase: "submitted",
            status: "done",
            startedAt: submittedAt,
            completedAt: t_recv,
          },
          scope: rendererEventScope(request.projectId, ctx.sender?.id),
          timestamp: t_recv,
        }, agentConversationDeliveryOptions(request.projectId, request.conversationId))

        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: request.conversationId,
            phase: "received",
            status: "in-progress",
            startedAt: t_recv,
          },
          scope: rendererEventScope(request.projectId, ctx.sender?.id),
          timestamp: t_recv,
        }, agentConversationDeliveryOptions(request.projectId, request.conversationId))

        const attachmentIds = [...(request.attachments ?? [])]
          .sort((left, right) => left.order - right.order)
          .map((attachment) => attachment.attachmentId)
        const stagedAttachments = attachmentIds.length > 0
          ? await agent.resolveStagedAttachments(attachmentIds)
          : undefined
        const message: AgentMessage = {
          projectId: request.projectId,
          sessionKey,
          platform: LOCAL_RENDERER_PLATFORM,
          userId: "renderer",
          userName: "Renderer",
          content: request.content,
          displayContent: request.displayContent,
          providerId: request.providerId,
          originRendererId: ctx.sender?.id,
          attachmentRefs: stagedAttachments?.refs,
          attachmentDraftScopeId: stagedAttachments?.draftScopeId,
          replyCtx: {
            kind: LOCAL_RENDERER_PLATFORM,
            projectId: request.projectId,
            sessionKey,
          },
        }
        const result = request.conversationId
          ? await agent.sendToConversation(message, request.conversationId, { turnId: runId })
          : await agent.send(message, { turnId: runId })
        const t_done = new Date().toISOString()
        const errorEvent = latestAgentErrorEvent(result.events as AgentEvent[])
        const cancelled = isCancelledAgentResult(result.events as AgentEvent[])
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: result.conversationId,
            phase: "received",
            status: "done",
            startedAt: t_recv,
            completedAt: t_done,
          },
          scope: rendererEventScope(request.projectId, ctx.sender?.id),
          timestamp: t_done,
        }, agentConversationDeliveryOptions(request.projectId, result.conversationId))
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: result.conversationId,
            phase: cancelled ? "cancelled" : result.error ? "failed" : "completed",
            status: cancelled ? "done" : result.error ? "failed" : "done",
            startedAt: t_recv,
            completedAt: t_done,
            errorMessage: cancelled ? undefined : result.error,
            errorKind: errorEvent?.errorKind,
            recoverable: errorEvent?.recoverable,
          },
          scope: rendererEventScope(request.projectId, ctx.sender?.id),
          timestamp: t_done,
        }, agentConversationDeliveryOptions(request.projectId, result.conversationId))
        return {
          projectId: request.projectId,
          sessionKey,
          conversationId: result.conversationId,
          outcome: rendererTurnOutcome(result.events as AgentEvent[], result.error),
          agentSessionId: result.agentSessionId,
          threadId: result.threadId,
        }
      } catch (rawError) {
        const t_fail = new Date().toISOString()
        logger.warn("Agent send IPC failed.", {
          projectId: request.projectId,
          sessionKey,
          conversationId: request.conversationId,
          providerId: request.providerId,
          boundary: "agent.send.ipc",
          ...sendFailureDiagnostic(rawError),
        })
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: request.conversationId,
            phase: "failed",
            status: "failed",
            startedAt: t_recv,
            completedAt: t_fail,
            errorMessage: "发送失败",
          },
          scope: rendererEventScope(request.projectId, ctx.sender?.id),
          timestamp: t_fail,
        }, agentConversationDeliveryOptions(request.projectId, request.conversationId))
        throw rawError
      }
    },
  },
  steer: {
    kind: "invoke",
    operationId: "app.agent.operation.steer",
    request: steerRequestSchema,
    response: steerResultSchema,
    handler: async (ctx, request: SteerRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const receivedAt = new Date().toISOString()
      return agent.steer({
        conversationId: request.conversationId,
        expectedTurnId: request.expectedTurnId,
        clientMessageId: request.clientMessageId,
        content: request.content.trim(),
        submittedAt: clampClientSubmittedAt(request.clientSubmittedAt, receivedAt),
      })
    },
  },
  prepareContextRecovery: {
    kind: "invoke",
    operationId: "app.agent.operation.prepare_context_recovery",
    request: contextRecoveryRequestSchema,
    response: sessionSummarySchema,
    handler: async (ctx, request: z.infer<typeof contextRecoveryRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const updated = await agent.prepareContextRecovery(request)
      return sessionSummary(updated)
    },
  },
  continueContextRecovery: {
    kind: "invoke",
    operationId: "app.agent.operation.continue_context_recovery",
    request: contextRecoveryRequestSchema,
    response: sendResultSchema,
    maxResponseBytes: 32 * 1024,
    handler: async (ctx, request: z.infer<typeof contextRecoveryRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      if (ctx.sender) agent.setRendererSubscription(ctx.sender.id, true, request.conversationId)
      const conversation = await agent.getSession(request.conversationId)
      if (!conversation) throw new Error("找不到当前对话。")
      const eventBus = ctx.resolve<EventBus>("core.event-bus")
      const runId = randomUUID()
      const startedAt = new Date().toISOString()
      eventBus.emit({
        domain: "agent",
        type: "phase.update",
        payload: {
          runId,
          projectId: request.projectId,
          conversationId: request.conversationId,
          phase: "received",
          status: "in-progress",
          startedAt,
        },
        scope: rendererEventScope(request.projectId, ctx.sender?.id),
        timestamp: startedAt,
      }, agentConversationDeliveryOptions(request.projectId, request.conversationId))
      let result
      try {
        result = await agent.continueContextRecovery({
          ...request,
          turnId: runId,
          originRendererId: ctx.sender?.id,
        })
      } catch (error) {
        const failedAt = new Date().toISOString()
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            conversationId: request.conversationId,
            phase: "failed",
            status: "failed",
            startedAt,
            completedAt: failedAt,
            errorMessage: "整理失败，请新建对话。",
          },
          scope: rendererEventScope(request.projectId, ctx.sender?.id),
          timestamp: failedAt,
        }, agentConversationDeliveryOptions(request.projectId, request.conversationId))
        throw error
      }
      const completedAt = new Date().toISOString()
      const errorEvent = latestAgentErrorEvent(result.events as AgentEvent[])
      eventBus.emit({
        domain: "agent",
        type: "phase.update",
        payload: {
          runId,
          projectId: request.projectId,
          conversationId: request.conversationId,
          phase: result.error ? "failed" : "completed",
          status: result.error ? "failed" : "done",
          startedAt,
          completedAt,
          errorMessage: result.error,
          errorKind: errorEvent?.errorKind,
          recoverable: errorEvent?.recoverable,
        },
        scope: rendererEventScope(request.projectId, ctx.sender?.id),
        timestamp: completedAt,
      }, agentConversationDeliveryOptions(request.projectId, request.conversationId))
      return {
        projectId: request.projectId,
        sessionKey: conversation.sessionKey,
        conversationId: result.conversationId,
        outcome: rendererTurnOutcome(result.events as AgentEvent[], result.error),
        agentSessionId: result.agentSessionId,
        threadId: result.threadId,
      }
    },
  },
  listPendingPermissions: {
    kind: "invoke",
    operationId: "app.agent.operation.list_pending_permissions",
    request: projectRequestSchema,
    response: z.array(pendingPermissionSchema),
    handler: async (ctx, request: ProjectRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.listPendingPermissions()
    },
  },
  respondPermission: {
    kind: "invoke",
    operationId: "app.agent.operation.respond_permission",
    request: respondPermissionRequestSchema,
    response: respondPermissionResultSchema,
    handler: async (ctx, request: RespondPermissionRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      await agent.respondPermission({
        requestId: request.requestId,
        behavior: request.behavior,
        scope: request.scope,
        updatedInput: request.updatedInput,
        message: request.message,
        actor: { kind: "user" },
      })
      return { ok: true }
    },
  },
  setPermissionMode: {
    kind: "invoke",
    operationId: "app.agent.operation.set_permission_mode",
    request: setPermissionModeRequestSchema,
    response: sessionSummarySchema,
    handler: async (ctx, request: SetPermissionModeRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      const updated = await agent.setPermissionMode({
        conversationId: request.conversationId,
        mode: request.mode,
        actor: { kind: "user" },
      })
      return sessionSummary(updated)
    },
  },
  cancelTurn: {
    kind: "invoke",
    operationId: "app.agent.operation.cancel_turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.cancelTurn(request.conversationId)
    },
  },
  forceKillTurn: {
    kind: "invoke",
    operationId: "app.agent.operation.force_kill_turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.forceKillTurn(request.conversationId)
    },
  },
}

function latestAgentErrorEvent(events: readonly AgentEvent[]): Extract<AgentEvent, { type: "error" }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === "error") return event
  }
  return undefined
}

function isCancelledAgentResult(events: readonly AgentEvent[]): boolean {
  return events.some((event) => event.type === "result" && (
    event.metadata?.cancelled === true
    || event.metadata?.turnOutcome?.status === "cancelled"
  ))
}

function rendererTurnOutcome(
  events: readonly AgentEvent[],
  error: string | undefined,
): {
  readonly status: "completed" | "failed" | "cancelled" | "interrupted"
  readonly errorKind?: Extract<AgentEvent, { type: "error" }>["errorKind"]
  readonly recoverable?: boolean
} {
  if (isCancelledAgentResult(events)) return { status: "cancelled" }
  const errorEvent = latestAgentErrorEvent(events)
  if (errorEvent?.turnOutcome?.status === "interrupted" || errorEvent?.recoverable === true) {
    return {
      status: "interrupted",
      errorKind: errorEvent.errorKind,
      recoverable: true,
    }
  }
  if (error || errorEvent) {
    return {
      status: "failed",
      errorKind: errorEvent?.errorKind,
      recoverable: errorEvent?.recoverable,
    }
  }
  return { status: "completed" }
}

function timelineLookupErrorMeta(rawError: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const code = (rawError as { readonly code?: unknown } | null)?.code
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
    errorCode: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
  }
}

async function chooseConversationBundleSavePath(defaultFileName: string): Promise<string | null> {
  const options = {
    title: "导出对话",
    defaultPath: defaultFileName,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  }
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const result = focusedWindow
    ? await dialog.showSaveDialog(focusedWindow, options)
    : await dialog.showSaveDialog(options)
  return result.canceled ? null : result.filePath ?? null
}

function sendFailureDiagnostic(rawError: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const message = rawError instanceof Error ? rawError.message : String(rawError)
  const code = (rawError as { readonly code?: unknown } | null)?.code
  return {
    errorName: rawError instanceof Error ? rawError.name : typeof rawError,
    errorLength: message.length,
    errorCode: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
  }
}

function truncateUtf8Chunk(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

function rendererEventScope(projectId: string, rendererId: number | undefined): {
  readonly projectId: string
  readonly rendererIds?: readonly number[]
} {
  return {
    projectId,
    ...(rendererId !== undefined ? { rendererIds: [rendererId] } : {}),
  }
}
