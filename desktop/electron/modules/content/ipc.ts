/**
 * Phase 0.3 — Content IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/content-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { app, dialog } from "electron"
import path from "node:path"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createControlledProcessRunner } from "../../runtime/process"
import { getContentTypeDefinition } from "../../../src/config/content-types"
import { normalizeContentFileNameSegment } from "../../../src/lib/content-attachments"
import { getActiveRepositoryConfig } from "../../../src/lib/config"
import type { SynapseContentType } from "../../../src/types/content"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type {
  SynapseContentMutationOperation,
  SynapseContentMutationResult,
  SynapseCreateContentRequest,
  SynapseUpdateContentRequest,
  SynapseDeleteContentPayload,
  SynapseRestoreContentPayload,
  SynapsePurgeContentPayload,
  SynapseOpenContentCreateWindowPayload,
  SynapseOpenContentEditWindowPayload,
  SynapseOpenContentWindowPayload,
} from "../../../src/types/content"
import type {
  SynapseResolveEditorTargetPayload,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
} from "../../../src/types/editor"
import { configStore } from "../../services/config-store"
import { contentDownloadService } from "../../services/content-download-service"
import { editorInstallService } from "../../services/editor-install-service"
import { contentService } from "../../services/content-service"
import { contentSubmissionService } from "../../services/content-submission-service"
import { contentWindowService } from "../../services/content-window-service"
import { editorAdapterService } from "../../services/editor-adapter-service"
import { createMainLogger } from "../../services/log-store"
import type { RepositorySyncCoordinator } from "../../services/repository-sync-coordinator"
import { notifyInstallStatusChanged } from "../install-status-events"

const logger = createMainLogger("ipc.content")

type ContentPostMutationOperation = SynapseContentMutationOperation | "restore" | "purge"

type LegacyContentSavedPushEventEntry = {
  legacyEventRequest: Promise<void>
  pushRequest: Promise<void>
}

const legacyContentSavedPushEvents = new Map<string, LegacyContentSavedPushEventEntry>()

// Helper to resolve active repository
async function resolveActiveRepository(): Promise<SynapseRepositoryConfig | null> {
  const config = await configStore.load()
  return getActiveRepositoryConfig(config)
}

const contentTypeSchema = z.enum(["rule", "skill", "prompt"])
const contentRecordSchema = z.object({}).passthrough()
const contentRecordListSchema = z.array(contentRecordSchema)
const contentMutationResultSchema = z.object({
  pendingPushCount: z.number().optional(),
  status: z.string(),
}).passthrough()
const nullableContentRecordSchema = contentRecordSchema.nullable()
const contentIconTypeSchema = z.enum(["icon", "image"])
const contentViewModeSchema = z.enum(["rendered", "source"])
const skillFilePayloadSchema = z.object({
  bytes: z.instanceof(Uint8Array).optional(),
  originalName: z.string(),
  sha256: z.string().optional(),
  size: z.number(),
}).passthrough()
const createContentPayloadBaseSchema = z.object({
  category: z.string(),
  content: z.string(),
  description: z.string(),
  icon: z.string(),
  iconBg: z.string(),
  iconImage: z.string(),
  iconImageBytes: z.instanceof(Uint8Array).optional(),
  iconType: contentIconTypeSchema,
  title: z.string(),
  usage: z.string().optional(),
}).passthrough()
const createContentPayloadSchema = createContentPayloadBaseSchema.extend({
  files: z.array(skillFilePayloadSchema).optional(),
  name: z.string().optional(),
})
const updateContentPayloadSchema = createContentPayloadSchema.extend({
  baseHistoryDirname: z.string(),
  force: z.boolean().optional(),
  id: z.string(),
})
const createContentRequestSchema = z.object({
  contentType: contentTypeSchema,
  payload: createContentPayloadSchema,
})
const updateContentRequestSchema = z.object({
  contentType: contentTypeSchema,
  payload: updateContentPayloadSchema,
})
const deleteContentPayloadSchema = z.object({
  baseHistoryDirname: z.string(),
  force: z.boolean().optional(),
  id: z.string(),
  type: contentTypeSchema,
})
const restoreContentPayloadSchema = z.object({
  baseHistoryDirname: z.string(),
  id: z.string(),
  type: contentTypeSchema,
})
const purgeContentPayloadSchema = z.object({
  baseHistoryDirname: z.string(),
  id: z.string(),
  type: contentTypeSchema,
})
const contentWindowNoticeSchema = z.object({
  id: z.string(),
  message: z.string(),
})
const openContentDetailWindowPayloadSchema = z.object({
  contentType: contentTypeSchema,
  id: z.string(),
  title: z.string(),
  viewMode: contentViewModeSchema,
})
const openContentCreateWindowPayloadSchema = z.object({
  contentType: contentTypeSchema,
  initialValue: createContentPayloadSchema.nullable().optional(),
  notices: z.array(contentWindowNoticeSchema).optional(),
  quickPublishSessionId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  sourceLabel: z.string().nullable().optional(),
  title: z.string(),
})
const contentEditPrefillSchema = z.discriminatedUnion("contentType", [
  z.object({ content: z.string(), contentType: z.literal("rule") }),
  z.object({ content: z.string(), contentType: z.literal("skill"), files: z.array(skillFilePayloadSchema) }),
])
const openContentEditWindowPayloadSchema = z.object({
  contentType: contentTypeSchema,
  id: z.string(),
  origin: z.enum(["detail", "external"]),
  prefill: contentEditPrefillSchema.nullable().optional(),
  quickPublishSessionId: z.string().uuid().optional(),
  requestId: z.string().optional(),
  sourceLabel: z.string().nullable().optional(),
  title: z.string(),
})
const editorInstallScopeSchema = z.enum(["global", "project"])
const resolveEditorTargetPayloadSchema = z.object({
  contentId: z.string(),
  contentType: contentTypeSchema,
  editorId: z.string(),
  preparedSourceId: z.string().optional(),
  projectPath: z.string().optional(),
  ruleName: z.string().optional(),
  scope: editorInstallScopeSchema,
  skillName: z.string().optional(),
  skillTitle: z.string().optional(),
})
const installToEditorPayloadSchema = resolveEditorTargetPayloadSchema.extend({
  installFormValues: z.record(z.string(), z.unknown()).optional(),
  overwriteConfirmed: z.boolean().optional(),
  replaceConfirmed: z.boolean().optional(),
  replacedContentId: z.string().optional(),
  skillEnvValues: z.record(z.string(), z.string()).optional(),
  variableSubstitutions: z.record(z.string(), z.string()).optional(),
})
const readEditorInstallFormValuesPayloadSchema = z.object({
  editorId: z.string(),
  targetPath: z.string(),
})

// Helper to notify pending pushes updated
async function notifyPendingPushesUpdated(
  eventBus: EventBus,
  repository: SynapseRepositoryConfig | null = null,
): Promise<void> {
  const resolvedRepository = repository ?? await resolveActiveRepository()

  if (!resolvedRepository) {
    return
  }

  const pendingPushes = await contentSubmissionService.readPendingPushState(resolvedRepository)

  eventBus.emit({
    domain: "repository",
    type: "repository.pendingPushesUpdated",
    payload: {
      repositoryUuid: resolvedRepository.uuid,
      pendingPushes,
    },
    timestamp: new Date().toISOString(),
  })
}

function emitContentChanged(
  eventBus: EventBus,
  operation: SynapseContentMutationOperation,
  result: SynapseContentMutationResult,
): void {
  if (result.status !== "saved") {
    return
  }

  eventBus.emit({
    domain: "content",
    type: "content.changed",
    payload: {
      contentType: result.type,
      contentId: result.id,
      operation,
      latestHistoryDirname: result.latestHistoryDirname,
      modifiedAt: result.modifiedAt,
    },
    timestamp: new Date().toISOString(),
  })
}

async function notifyPendingPushesUpdatedIfPossible(
  eventBus: EventBus,
  repository: SynapseRepositoryConfig,
): Promise<void> {
  try {
    await notifyPendingPushesUpdated(eventBus, repository)
  } catch (error) {
    logger.warn("Failed to refresh pending pushes after content-saved repository push.", {
      error,
      repositoryUuid: repository.uuid,
    })
  }
}

async function resolveActiveRepositoryIfPossible(
  operation: ContentPostMutationOperation,
): Promise<SynapseRepositoryConfig | null> {
  try {
    return await resolveActiveRepository()
  } catch (error) {
    logger.warn("Failed to resolve active repository after content mutation.", {
      error,
      operation,
    })
    return null
  }
}

async function notifyPendingPushesUpdatedAfterContentMutation(
  eventBus: EventBus,
  repository: SynapseRepositoryConfig | null,
  operation: ContentPostMutationOperation,
): Promise<void> {
  if (!repository) {
    return
  }

  try {
    await notifyPendingPushesUpdated(eventBus, repository)
  } catch (error) {
    logger.warn("Failed to refresh pending pushes after content mutation.", {
      error,
      operation,
      repositoryUuid: repository.uuid,
    })
  }
}

function emitLegacyPushUpdated(
  eventBus: EventBus,
  repository: SynapseRepositoryConfig,
  result: { error?: string; message: string },
): void {
  eventBus.emit({
    domain: "repository",
    type: "repository.updated",
    payload: {
      repositoryUuid: repository.uuid,
      operation: "push",
      completedAt: new Date().toISOString(),
      ...result,
    },
    timestamp: new Date().toISOString(),
  })
}

async function emitLegacyPushSucceeded(
  eventBus: EventBus,
  repository: SynapseRepositoryConfig,
): Promise<void> {
  await notifyPendingPushesUpdatedIfPossible(eventBus, repository)
  emitLegacyPushUpdated(eventBus, repository, { message: "同步完成。" })
}

async function emitLegacyPushFailed(
  eventBus: EventBus,
  repository: SynapseRepositoryConfig,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : "推送到仓库失败。"

  logger.warn("Failed to request content-saved repository push.", {
    error,
    repositoryUuid: repository.uuid,
  })

  await notifyPendingPushesUpdatedIfPossible(eventBus, repository)
  emitLegacyPushUpdated(eventBus, repository, { error: message, message })
}

function logLegacyPushEventFailure(repository: SynapseRepositoryConfig, error: unknown): void {
  logger.warn("Failed to emit legacy content-saved repository push event.", {
    error,
    repositoryUuid: repository.uuid,
  })
}

function requestContentSavedPush(
  ctx: IpcHandlerContext,
  eventBus: EventBus,
  repository: SynapseRepositoryConfig,
): void {
  let coordinator: RepositorySyncCoordinator

  try {
    coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
  } catch (error) {
    logger.warn("Failed to schedule content-saved repository push.", {
      error,
      repositoryUuid: repository.uuid,
    })
    void emitLegacyPushFailed(eventBus, repository, error).catch((eventError) => {
      logLegacyPushEventFailure(repository, eventError)
    })
    return
  }

  try {
    const pushRequest = coordinator.requestPush(repository, "content-saved")
    const currentEntry = legacyContentSavedPushEvents.get(repository.uuid)

    if (currentEntry?.pushRequest === pushRequest) {
      void pushRequest.catch((error) => {
        logger.warn("Coalesced content-saved repository push request failed.", {
          error,
          repositoryUuid: repository.uuid,
        })
      })
      return
    }

    const legacyEventRequest = pushRequest
      .then(
        () => emitLegacyPushSucceeded(eventBus, repository),
        (error) => emitLegacyPushFailed(eventBus, repository, error),
      )
      .catch((error) => {
        logLegacyPushEventFailure(repository, error)
      })
      .finally(() => {
        const currentEntry = legacyContentSavedPushEvents.get(repository.uuid)

        if (
          currentEntry?.legacyEventRequest === legacyEventRequest
          || currentEntry?.pushRequest === pushRequest
        ) {
          legacyContentSavedPushEvents.delete(repository.uuid)
        }
      })

    legacyContentSavedPushEvents.set(repository.uuid, {
      legacyEventRequest,
      pushRequest,
    })
  } catch (error) {
    logger.warn("Failed to schedule content-saved repository push.", {
      error,
      repositoryUuid: repository.uuid,
    })
  }
}

export const contentIpcModule: IpcModule = {
  id: "content",
  methods: {
    list: {
      kind: "invoke",
      channel: "synapse:content:list",
      request: z.object({ contentType: contentTypeSchema }),
      response: contentRecordListSchema,
      handler: async (_ctx, request: { contentType: SynapseContentType }) => {
        return contentService.listContent(request.contentType)
      },
    },
    getContent: {
      kind: "invoke",
      channel: "synapse:content:get-content",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: nullableContentRecordSchema,
      handler: async (_ctx, request: { contentType: SynapseContentType; id: string }) => {
        return contentService.getContent(request.contentType, request.id)
      },
    },
    getDetail: {
      kind: "invoke",
      channel: "synapse:content:get-detail",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: contentRecordSchema,
      handler: async (_ctx, request: { contentType: SynapseContentType; id: string }) => {
        return contentService.getDetail(request.contentType, request.id)
      },
    },
    getAttachmentFile: {
      kind: "invoke",
      channel: "synapse:content:get-attachment-file",
      request: z.object({
        contentType: contentTypeSchema,
        id: z.string(),
        historyDirname: z.string(),
        originalName: z.string(),
      }),
      response: nullableContentRecordSchema,
      handler: async (_ctx, request: {
        contentType: SynapseContentType
        historyDirname: string
        id: string
        originalName: string
      }) => {
        return contentService.getAttachmentFile(
          request.contentType,
          request.id,
          request.historyDirname,
          request.originalName,
        )
      },
    },
    getEditorAdapters: {
      kind: "invoke",
      channel: "synapse:content:get-editor-adapters",
      request: z.void(),
      response: contentRecordListSchema,
      handler: async (_ctx) => {
        return editorAdapterService.listAdapters()
      },
    },
    create: {
      kind: "invoke",
      channel: "synapse:content:create",
      request: createContentRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, request: SynapseCreateContentRequest) => {
        logger.info("Handling content.create request.", { contentType: request.contentType })

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.createContent(request)
        const repository = await resolveActiveRepositoryIfPossible("create")

        await notifyPendingPushesUpdatedAfterContentMutation(eventBus, repository, "create")
        emitContentChanged(eventBus, "create", result)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    update: {
      kind: "invoke",
      channel: "synapse:content:update",
      request: updateContentRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, request: SynapseUpdateContentRequest) => {
        logger.info(`Handling content.update request. contentType: ${request.contentType}, contentId: ${request.payload?.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.updateContent(request)
        const repository = await resolveActiveRepositoryIfPossible("update")

        await notifyPendingPushesUpdatedAfterContentMutation(eventBus, repository, "update")
        emitContentChanged(eventBus, "update", result)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        if (result.status === "saved" && request.contentType === "skill") {
          await notifyInstallStatusChanged(eventBus, request.payload.id, {
            logger,
            warningMessage: "Failed to refresh install status after content change.",
          })
        }

        return result
      },
    },
    deleteContent: {
      kind: "invoke",
      channel: "synapse:content:delete-content",
      request: deleteContentPayloadSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, payload: SynapseDeleteContentPayload) => {
        logger.info(`Handling content.deleteContent request. contentType: ${payload.type}, contentId: ${payload.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.deleteContent(payload)
        const repository = await resolveActiveRepositoryIfPossible("delete")

        await notifyPendingPushesUpdatedAfterContentMutation(eventBus, repository, "delete")
        emitContentChanged(eventBus, "delete", result)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    listDeleted: {
      kind: "invoke",
      channel: "synapse:content:list-deleted",
      request: z.object({ contentType: contentTypeSchema }),
      response: contentRecordListSchema,
      handler: async (_ctx, request: { contentType: SynapseContentType }) => {
        return contentService.listDeletedContent(request.contentType)
      },
    },
    restore: {
      kind: "invoke",
      channel: "synapse:content:restore",
      request: restoreContentPayloadSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, payload: SynapseRestoreContentPayload) => {
        logger.info(`Handling content.restore request. contentType: ${payload.type}, contentId: ${payload.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.restoreContent(payload)
        const repository = await resolveActiveRepositoryIfPossible("restore")

        await notifyPendingPushesUpdatedAfterContentMutation(eventBus, repository, "restore")
        emitContentChanged(eventBus, "restore", result)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    purge: {
      kind: "invoke",
      channel: "synapse:content:purge",
      request: purgeContentPayloadSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, payload: SynapsePurgeContentPayload) => {
        logger.info(`Handling content.purge request. contentType: ${payload.type}, contentId: ${payload.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.purgeContent(payload)
        const repository = await resolveActiveRepositoryIfPossible("purge")

        await notifyPendingPushesUpdatedAfterContentMutation(eventBus, repository, "purge")
        emitContentChanged(eventBus, "purge", result)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    download: {
      kind: "invoke",
      channel: "synapse:content:download",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: z.object({ canceled: z.boolean(), filePath: z.string().nullable() }),
      handler: async (ctx, args: { contentType: SynapseContentType; id: string }) => {
        const definition = getContentTypeDefinition(args.contentType)

        const detail = await contentService.getDetail(args.contentType, args.id)
        const fileNameBase = detail.title?.trim() || args.id
        const sanitizedFileName = normalizeContentFileNameSegment(fileNameBase)

        const result = await dialog.showSaveDialog({
          buttonLabel: "下载",
          defaultPath: path.join(app.getPath("downloads"), `${sanitizedFileName}${definition.download.extension}`),
          filters: [
            {
              extensions: [definition.download.extension.replace(/^\./, "")],
              name: definition.download.dialogFilterName,
            },
          ],
        })

        if (result.canceled || !result.filePath) {
          logger.info(`Content download canceled by user. contentType: ${args.contentType}, contentId: ${args.id}`)
          return {
            canceled: true,
            filePath: null,
          }
        }

        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const downloadMetadata = { contentType: args.contentType, contentId: args.id }

        const permission = await permissionGuard.check({
          action: "fs.write",
          actor: { kind: "user" },
          resource: result.filePath,
          context: downloadMetadata,
        })

        if (!permission.allowed) {
          auditSink.record({
            action: "fs.write",
            actor: { kind: "user" },
            resource: result.filePath,
            outcome: "denied",
            metadata: downloadMetadata,
          })
          logger.warn("Content download permission denied.", { targetPath: path.basename(result.filePath), ...downloadMetadata })
          throw new Error("没有写入该位置的权限。")
        }

        auditSink.record({
          action: "fs.write",
          actor: { kind: "user" },
          resource: result.filePath,
          outcome: "allowed",
          metadata: { ...downloadMetadata, fileName: sanitizedFileName },
        })

        logger.info(`Content download started. contentType: ${args.contentType}, contentId: ${args.id}, targetPath: ${path.basename(result.filePath)}`)
        try {
          await contentDownloadService.download(args.contentType, args.id, result.filePath, {
            actor: { kind: "user" },
            processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
          })
        } catch (error) {
          auditSink.record({
            action: "fs.write",
            actor: { kind: "user" },
            resource: result.filePath,
            outcome: "failed",
            metadata: {
              ...downloadMetadata,
              errorLength: String(error).length,
              errorName: error instanceof Error ? error.name : typeof error,
              fileName: sanitizedFileName,
            },
          })
          throw error
        }

        return {
          canceled: false,
          filePath: result.filePath,
        }
      },
    },
    readIconImage: {
      kind: "invoke",
      channel: "synapse:content:read-icon-image",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: z.string().nullable(),
      handler: async (_ctx, args: { contentType: SynapseContentType; id: string }) => {
        return contentService.readIconImage(args.contentType, args.id)
      },
    },
    openDetailWindow: {
      kind: "invoke",
      channel: "synapse:content:open-detail-window",
      request: openContentDetailWindowPayloadSchema,
      response: z.void(),
      handler: async (_ctx, payload: SynapseOpenContentWindowPayload) => {
        await contentWindowService.openDetailWindow(payload)
      },
    },
    openCreateWindow: {
      kind: "invoke",
      channel: "synapse:content:open-create-window",
      request: openContentCreateWindowPayloadSchema,
      response: z.void(),
      handler: async (_ctx, payload: SynapseOpenContentCreateWindowPayload) => {
        await contentWindowService.openCreateWindow(payload)
      },
    },
    openEditWindow: {
      kind: "invoke",
      channel: "synapse:content:open-edit-window",
      request: openContentEditWindowPayloadSchema,
      response: z.void(),
      handler: async (_ctx, payload: SynapseOpenContentEditWindowPayload) => {
        await contentWindowService.openEditWindow(payload)
      },
    },
    readEditorInitPayload: {
      kind: "invoke",
      channel: "synapse:content:read-editor-init-payload",
      request: z.object({ requestId: z.string() }),
      response: z.unknown(),
      handler: async (_ctx, payload: { requestId: string }) => {
        return contentWindowService.readPendingEditorPayload(payload.requestId)
      },
    },
    resolveEditorInstallTarget: {
      kind: "invoke",
      channel: "synapse:content:resolve-editor-install-target",
      request: resolveEditorTargetPayloadSchema,
      response: contentRecordSchema,
      handler: async (_ctx, payload: SynapseResolveEditorTargetPayload) => {
        return editorInstallService.resolveEditorInstallTarget(payload)
      },
    },
    installToEditor: {
      kind: "invoke",
      channel: "synapse:content:install-to-editor",
      request: installToEditorPayloadSchema,
      response: contentRecordSchema,
      handler: async (ctx, payload: SynapseInstallToEditorPayload) => {
        logger.info(`Handling content.installToEditor request. contentType: ${payload.contentType}, contentId: ${payload.contentId}, editorId: ${payload.editorId}, scope: ${payload.scope}`)
        const result = await editorInstallService.installToEditor(payload, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        await notifyInstallStatusChanged(eventBus, payload.contentId, {
          logger,
          warningMessage: "Failed to refresh install status after content change.",
        })
        if (payload.replacedContentId && payload.replacedContentId !== payload.contentId) {
          await notifyInstallStatusChanged(eventBus, payload.replacedContentId, {
            logger,
            warningMessage: "Failed to refresh install status after content change.",
          })
        }

        return result
      },
    },
    readEditorInstallFormValues: {
      kind: "invoke",
      channel: "synapse:content:read-editor-install-form-values",
      request: readEditorInstallFormValuesPayloadSchema,
      response: contentRecordSchema,
      handler: async (ctx, payload: SynapseReadEditorInstallFormValuesPayload) => {
        return editorInstallService.readEditorInstallFormValues(payload, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })
      },
    },
    getIconPromptTemplate: {
      kind: "invoke",
      channel: "synapse:content:get-icon-prompt-template",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: z.string(),
      handler: async (_ctx, args: { contentType: SynapseContentType; id: string }) => {
        return contentService.getIconPromptTemplate(args.contentType, args.id)
      },
    },
  },
  events: {},
}
