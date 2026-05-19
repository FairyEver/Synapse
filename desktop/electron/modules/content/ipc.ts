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
import { getContentTypeDefinition } from "../../../src/config/content-types"
import { getActiveRepositoryConfig } from "../../../src/lib/config"
import type { SynapseContentType } from "../../../src/types/content"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type {
  SynapseCreateContentRequest,
  SynapseUpdateContentRequest,
  SynapseDeleteContentPayload,
  SynapseRestoreContentPayload,
  SynapsePurgeContentPayload,
  SynapseOpenContentWindowPayload,
} from "../../../src/types/content"
import type {
  SynapseResolveEditorTargetPayload,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
} from "../../../src/types/editor"
import { configStore } from "../../services/config-store"
import { contentDownloadService } from "../../services/content-download-service"
import { contentInstallService } from "../../services/content-install-service"
import { installStatusCacheService } from "../../services/install-status-cache-service"
import { contentService } from "../../services/content-service"
import { contentSubmissionService } from "../../services/content-submission-service"
import { contentWindowService } from "../../services/content-window-service"
import { editorAdapterService } from "../../services/editor-adapter-service"
import { createMainLogger } from "../../services/log-store"
import type { RepositorySyncCoordinator } from "../../services/repository-sync-coordinator"

const logger = createMainLogger("ipc.content")

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
const unknownRequestSchema = z.unknown()

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
    getHistory: {
      kind: "invoke",
      channel: "synapse:content:get-history",
      request: z.object({ contentType: contentTypeSchema, id: z.string() }),
      response: contentRecordListSchema,
      handler: async (_ctx, request: { contentType: SynapseContentType; id: string }) => {
        return contentService.getHistory(request.contentType, request.id)
      },
    },
    getHistoryVersion: {
      kind: "invoke",
      channel: "synapse:content:get-history-version",
      request: z.object({ contentType: contentTypeSchema, id: z.string(), historyDirname: z.string() }),
      response: contentRecordSchema,
      handler: async (_ctx, request: { contentType: SynapseContentType; id: string; historyDirname: string }) => {
        return contentService.getHistoryVersion(request.contentType, request.id, request.historyDirname)
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
      request: unknownRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, request: SynapseCreateContentRequest) => {
        logger.info(`Handling content.create request. contentType: ${request.contentType}, title: ${request.payload?.title}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.createContent(request)
        const repository = await resolveActiveRepository()

        await notifyPendingPushesUpdated(eventBus, repository)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    update: {
      kind: "invoke",
      channel: "synapse:content:update",
      request: unknownRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, request: SynapseUpdateContentRequest) => {
        logger.info(`Handling content.update request. contentType: ${request.contentType}, contentId: ${request.payload?.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.updateContent(request)
        const repository = await resolveActiveRepository()

        await notifyPendingPushesUpdated(eventBus, repository)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    deleteContent: {
      kind: "invoke",
      channel: "synapse:content:delete-content",
      request: unknownRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, payload: SynapseDeleteContentPayload) => {
        logger.info(`Handling content.deleteContent request. contentType: ${payload.type}, contentId: ${payload.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.deleteContent(payload)
        const repository = await resolveActiveRepository()

        await notifyPendingPushesUpdated(eventBus, repository)

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
      request: unknownRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, payload: SynapseRestoreContentPayload) => {
        logger.info(`Handling content.restore request. contentType: ${payload.type}, contentId: ${payload.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.restoreContent(payload)
        const repository = await resolveActiveRepository()

        await notifyPendingPushesUpdated(eventBus, repository)

        if (result.status === "saved" && result.pendingPushCount > 0 && repository) {
          requestContentSavedPush(ctx, eventBus, repository)
        }

        return result
      },
    },
    purge: {
      kind: "invoke",
      channel: "synapse:content:purge",
      request: unknownRequestSchema,
      response: contentMutationResultSchema,
      handler: async (ctx, payload: SynapsePurgeContentPayload) => {
        logger.info(`Handling content.purge request. contentType: ${payload.type}, contentId: ${payload.id}`)

        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const result = await contentSubmissionService.purgeContent(payload)
        const repository = await resolveActiveRepository()

        await notifyPendingPushesUpdated(eventBus, repository)

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
        const sanitizedFileName = fileNameBase.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100)

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
        await contentDownloadService.download(args.contentType, args.id, result.filePath)

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
      request: unknownRequestSchema,
      response: z.void(),
      handler: async (_ctx, payload: SynapseOpenContentWindowPayload) => {
        await contentWindowService.openDetailWindow(payload)
      },
    },
    resolveEditorInstallTarget: {
      kind: "invoke",
      channel: "synapse:content:resolve-editor-install-target",
      request: unknownRequestSchema,
      response: contentRecordSchema,
      handler: async (_ctx, payload: SynapseResolveEditorTargetPayload) => {
        return editorAdapterService.resolveTarget(payload)
      },
    },
    installToEditor: {
      kind: "invoke",
      channel: "synapse:content:install-to-editor",
      request: unknownRequestSchema,
      response: contentRecordSchema,
      handler: async (ctx, payload: SynapseInstallToEditorPayload) => {
        logger.info(`Handling content.installToEditor request. contentType: ${payload.contentType}, contentId: ${payload.contentId}, editorId: ${payload.editorId}, scope: ${payload.scope}`)
        const result = await contentInstallService.installToEditor(payload, {
          actor: { kind: "user" },
          auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
          permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        })

        if (payload.scope === "global") {
          const editors = await installStatusCacheService.refresh(payload.contentId)
          const eventBus = ctx.resolve<EventBus>("core.event-bus")
          eventBus.emit({
            domain: "install-status",
            type: "install-status.changed",
            payload: { contentId: payload.contentId, editors },
            timestamp: new Date().toISOString(),
          })
        }

        return result
      },
    },
    readEditorInstallFormValues: {
      kind: "invoke",
      channel: "synapse:content:read-editor-install-form-values",
      request: unknownRequestSchema,
      response: contentRecordSchema,
      handler: async (_ctx, payload: SynapseReadEditorInstallFormValuesPayload) => {
        return contentInstallService.readEditorInstallFormValues(payload)
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
