import { randomUUID } from "node:crypto"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import { BrowserWindow, dialog } from "electron"
import { z } from "zod"

import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import { projectRequestSchema } from "../../runtime/ipc/schemas"
import type {
  AgentEventEntryV1,
  AgentUsageEntryV1,
  ConversationEntryV1,
  DataRepository,
} from "../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createZipArchive } from "../../runtime/archive"
import { createControlledProcessRunner } from "../../runtime/process"
import type { AgentAttachment, AgentEvent, AgentMessage } from "../../services/agent-runtime"
import { AgentConversationExportService } from "../../services/agent-runtime/conversation-export-service"
import type { EventBus } from "../../runtime/event-bus"
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
  historyEntries,
  assertKnowledgeBaseStorageMigrationInactive,
} from "./ipc-shared"

const MAX_CLIENT_SKEW_MS = 60_000
const MAX_AGENT_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_AGENT_IMAGE_ATTACHMENTS = 8
const MAX_AGENT_IMAGE_ATTACHMENT_TOTAL_BYTES = 20 * 1024 * 1024
const logger = createMainLogger("agent.ipc")
const agentImageMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"])
const binaryAttachmentDataSchema = z.custom<ArrayBuffer | Uint8Array>(
  isNonEmptyBinaryAttachmentData,
  "data must be a non-empty ArrayBuffer or Uint8Array",
)
const attachmentPathSchema = z.string()
  .trim()
  .refine(isAbsoluteAttachmentPath, "path must be an absolute POSIX or Windows path")

function clampClientSubmittedAt(clientIso: string | undefined, recvIso: string): string {
  if (!clientIso) return recvIso
  const recv = Date.parse(recvIso)
  const client = Date.parse(clientIso)
  if (!Number.isFinite(client) || !Number.isFinite(recv)) return recvIso
  if (client > recv) return recvIso
  if (recv - client > MAX_CLIENT_SKEW_MS) return recvIso
  return clientIso
}

function isNonEmptyBinaryAttachmentData(value: unknown): value is ArrayBuffer | Uint8Array {
  if (isArrayBufferLike(value)) return value.byteLength > 0
  if (isUint8ArrayLike(value)) return value.byteLength > 0
  return false
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]"
}

function isUint8ArrayLike(value: unknown): value is Uint8Array {
  return Object.prototype.toString.call(value) === "[object Uint8Array]"
}

function isAbsoluteAttachmentPath(value: string): boolean {
  if (/^([\\/])\1[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value)) return true
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  return value.startsWith("/") && !value.startsWith("//")
}

function binaryAttachmentByteLength(data: ArrayBuffer | Uint8Array): number {
  return data.byteLength
}

function normalizeAbsoluteAttachmentPath(value: string): string {
  return attachmentPathOps(value).normalize(value)
}

function attachmentBasename(value: string): string {
  return attachmentPathOps(value).basename(value)
}

function attachmentPathOps(value: string): typeof path.posix | typeof path.win32 {
  return (/^[A-Za-z]:[\\/]/.test(value) || /^([\\/])\1[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/.test(value))
    ? path.win32
    : path.posix
}

async function normalizeSendAttachments(
  attachments: SendRequest["attachments"],
): Promise<AgentMessage["attachments"]> {
  if (!attachments || attachments.length === 0) return undefined
  const normalized: AgentAttachment[] = []
  let imageCount = 0
  let totalImageBytes = 0
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      imageCount += 1
      if (imageCount > MAX_AGENT_IMAGE_ATTACHMENTS) {
        throw new Error(`图片附件最多 ${MAX_AGENT_IMAGE_ATTACHMENTS} 张。`)
      }
      const byteLength = binaryAttachmentByteLength(attachment.data)
      if (byteLength > MAX_AGENT_IMAGE_ATTACHMENT_BYTES) {
        throw new Error("图片附件过大。")
      }
      totalImageBytes += byteLength
      if (totalImageBytes > MAX_AGENT_IMAGE_ATTACHMENT_TOTAL_BYTES) {
        throw new Error("图片附件总大小过大。")
      }
      normalized.push({
        ...attachment,
        size: attachment.size ?? byteLength,
      })
      continue
    }
    const normalizedPath = normalizeAbsoluteAttachmentPath(attachment.path)
    const stat = await lstatAttachmentPath(normalizedPath)
    if (stat.isSymbolicLink()) {
      throw new Error("附件路径不能是符号链接。")
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      throw new Error("附件路径必须是文件或文件夹。")
    }
    if (stat.isDirectory()) {
      await assertDirectoryAttachmentHasNoSymlinks(normalizedPath)
    }
    normalized.push({
      ...attachment,
      path: normalizedPath,
      entryType: stat.isDirectory() ? "directory" : "file",
      name: attachment.name ?? attachmentBasename(normalizedPath),
    })
  }
  return normalized
}

async function lstatAttachmentPath(attachmentPath: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  let finalStat: Awaited<ReturnType<typeof lstat>> | undefined
  for (const currentPath of attachmentPathPrefixes(attachmentPath)) {
    try {
      finalStat = await lstat(currentPath)
    } catch (error) {
      throw new Error("附件路径不存在。", { cause: error })
    }
    if (finalStat.isSymbolicLink()) {
      throw new Error("附件路径不能是符号链接。")
    }
  }
  if (!finalStat) {
    throw new Error("附件路径不存在。")
  }
  return finalStat
}

async function assertDirectoryAttachmentHasNoSymlinks(directoryPath: string): Promise<void> {
  const pending = [directoryPath]
  while (pending.length > 0) {
    const currentDirectory = pending.pop()
    if (!currentDirectory) continue
    const entries = await readdir(currentDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name)
      const entryStat = await lstat(entryPath)
      if (entryStat.isSymbolicLink()) {
        throw new Error("文件夹附件不能包含符号链接。")
      }
      if (entryStat.isDirectory()) {
        pending.push(entryPath)
      }
    }
  }
}

function attachmentPathPrefixes(attachmentPath: string): readonly string[] {
  const ops = attachmentPathOps(attachmentPath)
  const parsed = ops.parse(attachmentPath)
  const relative = ops.relative(parsed.root, attachmentPath)
  if (!relative) return [attachmentPath]
  const prefixes: string[] = []
  let currentPath = parsed.root
  for (const segment of relative.split(/[\\/]+/).filter(Boolean)) {
    currentPath = currentPath ? ops.join(currentPath, segment) : segment
    prefixes.push(currentPath)
  }
  return prefixes
}

// ─── Request schemas ──────────────────────────────────────────────────────────

const sendRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1).optional(),
  content: z.string(),
  clientSubmittedAt: z.string().optional(),
  providerId: z.string().min(1).optional(),
  mainThreadPersonaId: z.string().min(1).nullable().optional(),
  mainThreadPersonaName: z.string().optional(),
  mainThreadPersonaSource: z.enum(["builtin", "user"]).optional(),
  attachments: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("image"),
      mimeType: agentImageMimeTypeSchema,
      data: binaryAttachmentDataSchema,
      name: z.string().optional(),
      size: z.number().int().nonnegative().optional(),
    }),
    z.object({
      kind: z.literal("path"),
      path: attachmentPathSchema,
      entryType: z.enum(["file", "directory"]),
      name: z.string().optional(),
    }),
  ])).optional(),
}).superRefine((request, ctx) => {
  if (request.content.trim().length > 0) return
  if ((request.attachments?.length ?? 0) > 0) return
  ctx.addIssue({
    code: "custom",
    path: ["content"],
    message: "content or attachments are required",
  })
})

const respondPermissionRequestSchema = projectRequestSchema.extend({
  requestId: z.string().min(1),
  behavior: z.enum(["allow", "deny"]),
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

const cancelTurnResultSchema = z.object({
  status: z.enum(["no-active-turn", "graceful-pending", "hard-killed"]),
})

const exportConversationBundleRequestSchema = projectRequestSchema.extend({
  sessionKey: z.string().optional(),
  conversationId: z.string().min(1),
})

// ─── Response schemas ─────────────────────────────────────────────────────────

const sendResultSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string(),
  resultText: z.string(),
  events: z.array(agentEventSchema),
  agentSessionId: z.string().optional(),
  threadId: z.string().optional(),
  error: z.string().optional(),
})

const timelineResultSchema = z.object({
  projectId: z.string(),
  sessionKey: z.string(),
  conversationId: z.string().optional(),
  entries: z.array(timelineItemSchema),
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectRequest = z.infer<typeof projectRequestSchema>
type SendRequest = z.infer<typeof sendRequestSchema>
type RespondPermissionRequest = z.infer<typeof respondPermissionRequestSchema>
type SetPermissionModeRequest = z.infer<typeof setPermissionModeRequestSchema>
type ExportConversationBundleRequest = z.infer<typeof exportConversationBundleRequestSchema>

// ─── Message method descriptors ───────────────────────────────────────────────

export const messageMethods: Record<string, IpcMethodDescriptor> = {
  getTimeline: {
    kind: "invoke",
    channel: "synapse:agent:get-timeline",
    request: timelineRequestSchema,
    response: timelineResultSchema,
    handler: async (ctx, request: z.infer<typeof timelineRequestSchema>) => {
      try {
        const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
        const session = await resolveTimelineSession(agent, request)
        return {
          projectId: request.projectId,
          sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
          conversationId: session?.id,
          entries: session ? historyEntries(session, request.limit) : [],
        }
      } catch (rawError) {
        logger.warn("Agent timeline runtime lookup failed; trying repository fallback.", {
          projectId: request.projectId,
          sessionKey: request.sessionKey,
          hasConversationId: Boolean(request.conversationId),
          limit: request.limit,
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
          }
        }
        return {
          projectId: request.projectId,
          sessionKey: session.sessionKey,
          conversationId: session.id,
          entries: historyEntries(session, request.limit),
        }
      }
    },
  },
  exportConversationBundle: {
    kind: "invoke",
    channel: "synapse:agent:export-conversation-bundle",
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
          return {
            projectId: request.projectId,
            sessionKey: request.sessionKey ?? session?.sessionKey ?? DEFAULT_LOCAL_SESSION_KEY,
            conversationId: session?.id,
            entries: session ? historyEntries(session) : [],
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
  send: {
    kind: "invoke",
    channel: "synapse:agent:send",
    request: sendRequestSchema,
    response: sendResultSchema,
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
          scope: { projectId: request.projectId },
          timestamp: t_recv,
        }, { backpressure: "block" })

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
          scope: { projectId: request.projectId },
          timestamp: t_recv,
        }, { backpressure: "block" })

        const attachments = await normalizeSendAttachments(request.attachments)
        const message: AgentMessage = {
          projectId: request.projectId,
          sessionKey,
          platform: LOCAL_RENDERER_PLATFORM,
          userId: "renderer",
          userName: "Renderer",
          content: request.content,
          providerId: request.providerId,
          mainThreadPersonaId: request.mainThreadPersonaId,
          mainThreadPersonaName: request.mainThreadPersonaName,
          mainThreadPersonaSource: request.mainThreadPersonaSource,
          attachments,
          replyCtx: {
            kind: LOCAL_RENDERER_PLATFORM,
            projectId: request.projectId,
            sessionKey,
          },
        }
        const result = request.conversationId
          ? await agent.sendToConversation(message, request.conversationId)
          : await agent.send(message)
        const t_done = new Date().toISOString()
        const errorEvent = latestAgentErrorEvent(result.events as AgentEvent[])
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
          scope: { projectId: request.projectId },
          timestamp: t_done,
        }, { backpressure: "block" })
        eventBus.emit({
          domain: "agent",
          type: "phase.update",
          payload: {
            runId,
            projectId: request.projectId,
            sessionKey,
            conversationId: result.conversationId,
            phase: result.error ? "failed" : "completed",
            status: result.error ? "failed" : "done",
            startedAt: t_recv,
            completedAt: t_done,
            errorMessage: result.error,
            errorKind: errorEvent?.errorKind,
            recoverable: errorEvent?.recoverable,
          },
          scope: { projectId: request.projectId },
          timestamp: t_done,
        }, { backpressure: "block" })
        return {
          projectId: request.projectId,
          sessionKey,
          conversationId: result.conversationId,
          resultText: result.resultText,
          events: result.events as AgentEvent[],
          agentSessionId: result.agentSessionId,
          threadId: result.threadId,
          error: result.error,
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
          scope: { projectId: request.projectId },
          timestamp: t_fail,
        }, { backpressure: "block" })
        throw rawError
      }
    },
  },
  listPendingPermissions: {
    kind: "invoke",
    channel: "synapse:agent:list-pending-permissions",
    request: projectRequestSchema,
    response: z.array(pendingPermissionSchema),
    handler: async (ctx, request: ProjectRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.listPendingPermissions()
    },
  },
  respondPermission: {
    kind: "invoke",
    channel: "synapse:agent:respond-permission",
    request: respondPermissionRequestSchema,
    response: respondPermissionResultSchema,
    handler: async (ctx, request: RespondPermissionRequest) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      await agent.respondPermission({
        requestId: request.requestId,
        behavior: request.behavior,
        updatedInput: request.updatedInput,
        message: request.message,
        actor: { kind: "user" },
      })
      return { ok: true }
    },
  },
  setPermissionMode: {
    kind: "invoke",
    channel: "synapse:agent:set-permission-mode",
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
    channel: "synapse:agent:cancel-turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.cancelTurn(request.conversationId)
    },
  },
  forceKillTurn: {
    kind: "invoke",
    channel: "synapse:agent:force-kill-turn",
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
