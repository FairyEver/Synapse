/**
 * Phase 0.3 — Repository IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/repository-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { BrowserWindow, dialog, type OpenDialogOptions } from "electron"
import type { IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type { SynapseCreateLocalRepositoryPayload, SynapseRepositoryValidationResult } from "../../../src/types/repository"
import { configStore } from "../../services/config-store"
import { contentIndexService } from "../../services/content-index-service"
import { repositoryMaintenanceService } from "../../services/repository-maintenance-service"
import { contentSubmissionService } from "../../services/content-submission-service"
import { repositoryGitService } from "../../services/repository-git-service"
import { createMainLogger } from "../../services/log-store"
import { repositoryStore } from "../../services/repository-store"
import { repositoryStructureService } from "../../services/repository-structure-service"

const logger = createMainLogger("ipc.repository")

// Helper to resolve repository config
async function resolveRepositoryConfig(repositoryUuid: string): Promise<SynapseRepositoryConfig> {
  const config = await configStore.load()
  const repository = config.repositories.find((item) => item.uuid === repositoryUuid)

  if (!repository) {
    logger.warn("Repository config lookup failed.", { repositoryUuid })
    throw new Error("找不到对应的仓库配置。请先到 Settings 里确认仓库是否仍然存在。")
  }

  return repository
}

// Schemas
const repositoryStateSchema = z.object({
  repositoryUuid: z.string(),
  localPath: z.string(),
  status: z.enum(["missing", "ready"]),
  isGitRepository: z.boolean(),
  gitRootPath: z.string().nullable(),
})

const initializationPreviewSchema = z.object({
  isEmpty: z.boolean(),
  nonGitEntries: z.array(z.string()),
})

const createLocalRepositoryPayloadSchema = z.object({
  name: z.string(),
  parentPath: z.string(),
})

const repositoryConfigSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  localPath: z.string(),
  contentDirs: z.record(z.string(), z.string()),
  rulesDir: z.string().optional(),
  skillsDir: z.string().optional(),
  variables: z.array(z.object({
    name: z.string(),
    value: z.string(),
    description: z.string().optional(),
  })).optional(),
})

const createLocalRepositoryResultSchema = z.object({
  createdAt: z.string(),
  message: z.string().optional(),
  repository: repositoryConfigSchema,
})

const pendingPushEntrySchema = z.object({
  id: z.number(),
  commitHash: z.string().nullable(),
  action: z.string(),
  targetId: z.string(),
  createdAt: z.string(),
  retryCount: z.number(),
  lastError: z.string().nullable(),
  title: z.string().nullable(),
})

const pendingPushesSchema = z.object({
  count: z.number(),
  items: z.array(pendingPushEntrySchema),
})

const initializeResultSchema = z.object({
  initializedAt: z.string(),
  message: z.string().optional(),
  pendingPushCount: z.number().optional(),
  repository: repositoryStateSchema,
})

const validationResultSchema = z.object({
  isValid: z.boolean(),
  missingDirectories: z.array(z.string()),
  message: z.string(),
})

const syncResultSchema = z.object({
  operation: z.enum(["pull", "push", "sync"]),
  repository: repositoryStateSchema,
  completedAt: z.string(),
  message: z.string().optional(),
  pendingPushCount: z.number().optional(),
})

const maintenanceResultSchema = z.object({
  operation: z.literal("maintenance"),
  repository: repositoryStateSchema,
  completedAt: z.string(),
  message: z.string(),
  pendingPushCount: z.number(),
})

const flushResultSchema = z.object({
  operation: z.literal("push"),
  repository: repositoryStateSchema,
  completedAt: z.string(),
})

export const repositoryIpcModule: IpcModule = {
  id: "repository",
  methods: {
    getStates: {
      kind: "invoke",
      channel: "synapse:repository:get-states",
      request: z.void(),
      response: z.array(repositoryStateSchema),
      handler: async (_ctx) => {
        logger.debug("Handling repository.getStates request.")
        const config = await configStore.load()
        const states = await Promise.all(
          config.repositories.map((repository) => repositoryStore.getRepositoryState(repository)),
        )

        logger.debug(`Repository states resolved for renderer. repositoryCount: ${config.repositories.length}`)

        return states
      },
    },
    checkInitializationPreview: {
      kind: "invoke",
      channel: "synapse:repository:check-initialization-preview",
      request: z.object({ repositoryUuid: z.string() }),
      response: initializationPreviewSchema,
      handler: async (_ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        return repositoryStructureService.checkInitializationPreview(repository)
      },
    },
    createLocalRepository: {
      kind: "invoke",
      channel: "synapse:repository:create-local-repository",
      request: createLocalRepositoryPayloadSchema,
      response: createLocalRepositoryResultSchema,
      handler: async (_ctx, payload: SynapseCreateLocalRepositoryPayload) => {
        logger.info(`Handling repository.createLocalRepository request. name: ${payload.name}, parentPath: ${payload.parentPath}`)
        return repositoryStructureService.createLocalRepository(payload)
      },
    },
    getPendingPushes: {
      kind: "invoke",
      channel: "synapse:repository:get-pending-pushes",
      request: z.object({ repositoryUuid: z.string() }),
      response: pendingPushesSchema,
      handler: async (_ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        return contentSubmissionService.readPendingPushState(repository)
      },
    },
    initializeStructure: {
      kind: "invoke",
      channel: "synapse:repository:initialize-structure",
      request: z.object({ repositoryUuid: z.string() }),
      response: initializeResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")

        eventBus.emit({
          domain: "repository",
          type: "repository.progress",
          payload: {
            repositoryUuid: request.repositoryUuid,
            operation: "initialize",
            statusText: "正在初始化仓库...",
            percent: 0,
          },
          timestamp: new Date().toISOString(),
        })

        const result = await repositoryStructureService.initializeStructure(repository)
        const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

        eventBus.emit({
          domain: "repository",
          type: "repository.updated",
          payload: {
            repositoryUuid: request.repositoryUuid,
            operation: "initialize",
            completedAt: result.initializedAt,
            message: result.message,
          },
          timestamp: new Date().toISOString(),
        })
        eventBus.emit({
          domain: "repository",
          type: "repository.pendingPushesUpdated",
          payload: {
            repositoryUuid: request.repositoryUuid,
            pendingPushes,
          },
          timestamp: new Date().toISOString(),
        })

        return result
      },
    },
    chooseDirectory: {
      kind: "invoke",
      channel: "synapse:repository:choose-directory",
      request: z.void(),
      response: z.string().nullable(),
      handler: async (_ctx) => {
        logger.info("Opening native directory picker.")

        const options: OpenDialogOptions = {
          properties: ["openDirectory"],
        }

        // Get parent window for modal dialog - try focused first, then any visible window
        const parentWindow = BrowserWindow.getFocusedWindow()
          ?? BrowserWindow.getAllWindows().find(w => w.isVisible() && !w.isDestroyed())
          ?? undefined

        const result = await dialog.showOpenDialog(parentWindow as unknown as Electron.BaseWindow, options)

        const selectedPath = result.canceled ? null : result.filePaths[0] ?? null

        logger.info(`Native directory picker closed. canceled: ${result.canceled}, selectedPath: ${selectedPath}`)

        return selectedPath
      },
    },
    validateDirectory: {
      kind: "invoke",
      channel: "synapse:repository:validate-directory",
      request: z.object({ targetPath: z.string() }),
      response: validationResultSchema,
      handler: async (_ctx, request: { targetPath: string }): Promise<SynapseRepositoryValidationResult> => {
        logger.info(`Validating directory structure. targetPath: ${request.targetPath}`)
        await repositoryStructureService.ensureContentDirectories(request.targetPath)
        return repositoryStructureService.validateDirectoryStructure(request.targetPath)
      },
    },
    sync: {
      kind: "invoke",
      channel: "synapse:repository:sync",
      request: z.object({ repositoryUuid: z.string() }),
      response: syncResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        logger.info(`Handling repository.sync request. repositoryUuid: ${request.repositoryUuid}`)
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")

        try {
          const result = await repositoryGitService.syncRepository(repository, (progressEvent) => {
            eventBus.emit({
              domain: "repository",
              type: "repository.progress",
              payload: progressEvent,
              timestamp: new Date().toISOString(),
            })
          })
          await contentIndexService.syncIndex(repository)
          const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

          eventBus.emit({
            domain: "repository",
            type: "repository.updated",
            payload: {
              repositoryUuid: request.repositoryUuid,
              operation: result.operation,
              completedAt: result.completedAt,
            },
            timestamp: new Date().toISOString(),
          })
          eventBus.emit({
            domain: "repository",
            type: "repository.pendingPushesUpdated",
            payload: {
              repositoryUuid: request.repositoryUuid,
              pendingPushes,
            },
            timestamp: new Date().toISOString(),
          })

          logger.info(`repository.sync request completed. repositoryUuid: ${request.repositoryUuid}, completedAt: ${result.completedAt}`)

          return result
        } catch (error) {
          logger.error(`repository.sync request failed. repositoryUuid: ${request.repositoryUuid}, error: ${error}`)
          throw error
        }
      },
    },
    runMaintenance: {
      kind: "invoke",
      channel: "synapse:repository:run-maintenance",
      request: z.object({ repositoryUuid: z.string() }),
      response: maintenanceResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")

        try {
          eventBus.emit({
            domain: "repository",
            type: "repository.progress",
            payload: {
              repositoryUuid: request.repositoryUuid,
              operation: "maintenance",
              statusText: "正在准备整理...",
              percent: 0,
            },
            timestamp: new Date().toISOString(),
          })

          const maintenanceResult = await repositoryMaintenanceService.runManualMaintenance(
            repository,
            (statusText) => {
              eventBus.emit({
                domain: "repository",
                type: "repository.progress",
                payload: {
                  repositoryUuid: request.repositoryUuid,
                  operation: "maintenance",
                  statusText,
                  percent: null,
                },
                timestamp: new Date().toISOString(),
              })
            },
          )

          const repositoryState = await repositoryStore.getRepositoryState(repository)
          const completedAt = new Date().toISOString()
          const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

          eventBus.emit({
            domain: "repository",
            type: "repository.updated",
            payload: {
              repositoryUuid: request.repositoryUuid,
              operation: "maintenance",
              completedAt,
            },
            timestamp: new Date().toISOString(),
          })
          eventBus.emit({
            domain: "repository",
            type: "repository.pendingPushesUpdated",
            payload: {
              repositoryUuid: request.repositoryUuid,
              pendingPushes,
            },
            timestamp: new Date().toISOString(),
          })

          return {
            operation: "maintenance" as const,
            repository: repositoryState,
            completedAt,
            message: maintenanceResult.message,
            pendingPushCount: maintenanceResult.pendingPushCount,
          }
        } catch (error) {
          logger.error(`repository.runMaintenance request failed. repositoryUuid: ${request.repositoryUuid}, error: ${error}`)
          throw error
        }
      },
    },
    flushPendingPushes: {
      kind: "invoke",
      channel: "synapse:repository:flush-pending-pushes",
      request: z.object({ repositoryUuid: z.string() }),
      response: flushResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")

        try {
          eventBus.emit({
            domain: "repository",
            type: "repository.progress",
            payload: {
              repositoryUuid: request.repositoryUuid,
              operation: "push",
              statusText: "正在准备推送...",
              percent: 0,
            },
            timestamp: new Date().toISOString(),
          })

          await contentSubmissionService.flushPendingPushes(repository, (statusText) => {
            eventBus.emit({
              domain: "repository",
              type: "repository.progress",
              payload: {
                repositoryUuid: request.repositoryUuid,
                operation: "push",
                statusText,
                percent: null,
              },
              timestamp: new Date().toISOString(),
            })
          })

          const repositoryState = await repositoryStore.getRepositoryState(repository)
          const completedAt = new Date().toISOString()
          const pendingPushes = await contentSubmissionService.readPendingPushState(repository)

          eventBus.emit({
            domain: "repository",
            type: "repository.updated",
            payload: {
              repositoryUuid: request.repositoryUuid,
              operation: "push",
              completedAt,
            },
            timestamp: new Date().toISOString(),
          })
          eventBus.emit({
            domain: "repository",
            type: "repository.pendingPushesUpdated",
            payload: {
              repositoryUuid: request.repositoryUuid,
              pendingPushes,
            },
            timestamp: new Date().toISOString(),
          })

          return {
            operation: "push" as const,
            repository: repositoryState,
            completedAt,
          }
        } catch (error) {
          logger.error(`repository.flushPendingPushes request failed. repositoryUuid: ${request.repositoryUuid}, error: ${error}`)
          throw error
        }
      },
    },
  },
  events: {},
}
