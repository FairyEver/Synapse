/**
 * Phase 0.3 — Repository IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/repository-handlers.ts with IpcModule.
 */

import { z } from "zod"
import path from "node:path"
import { BrowserWindow, dialog, type OpenDialogOptions } from "electron"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { EventBus } from "../../runtime/event-bus"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { SynapseRepositoryConfig } from "../../../src/types/config"
import type { SynapseCreateLocalRepositoryPayload, SynapseRepositoryValidationResult } from "../../../src/types/repository"
import { configStore } from "../../services/config-store"
import { contentIndexService } from "../../services/content-index-service"
import { contentSubmissionService } from "../../services/content-submission-service"
import { installStatusCacheService } from "../../services/install-status-cache-service"
import { createMainLogger } from "../../services/log-store"
import { repositoryStore } from "../../services/repository-store"
import { repositoryStructureService } from "../../services/repository-structure-service"
import { RepositorySyncCoordinator } from "../../services/repository-sync-coordinator"
import { sanitizeError } from "../../services/error-sanitize"
import type { InstallStatusEntry, InstallStatusMap } from "../../../src/types/install-status"

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

function getInstallStatusEntryKey(entry: InstallStatusEntry): string {
  return [
    entry.editorId,
    entry.scope,
    entry.projectPath ?? "",
    entry.projectName ?? "",
    entry.status,
  ].join("\u0000")
}

function normalizeInstallStatusEntries(entries: InstallStatusEntry[] | undefined): string[] {
  return (entries ?? []).map(getInstallStatusEntryKey).sort()
}

function sanitizeErrorForRepositoryLog(error: unknown): string {
  return sanitizeError(String(error)) || "unknown error"
}

async function guardCreateLocalRepository(
  ctx: IpcHandlerContext,
  payload: SynapseCreateLocalRepositoryPayload,
): Promise<string> {
  const actor = { kind: "user" } as const
  const resource = path.resolve(payload.parentPath, payload.name.trim())
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const permission = await permissionGuard.check({
    action: "fs.write.outside-userdata",
    actor,
    resource,
    context: {
      source: "repository.createLocalRepository",
      parentPath: path.resolve(payload.parentPath),
    },
  })

  if (!permission.allowed) {
    auditSink.record({
      action: "fs.write.outside-userdata",
      actor,
      resource,
      outcome: "denied",
      metadata: {
        source: "repository.createLocalRepository",
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  return resource
}

function recordCreateLocalRepositoryAudit(
  ctx: IpcHandlerContext,
  resource: string,
  outcome: "allowed" | "failed",
  error?: unknown,
): void {
  ctx.resolve<AuditSink>("core.audit-sink").record({
    action: "fs.write.outside-userdata",
    actor: { kind: "user" },
    resource,
    outcome,
    metadata: {
      source: "repository.createLocalRepository",
      ...(error
        ? {
            errorName: error instanceof Error ? error.name : typeof error,
            errorLength: String(error).length,
          }
        : {}),
    },
  })
}

function installStatusEntriesEqual(
  before: InstallStatusEntry[] | undefined,
  after: InstallStatusEntry[] | undefined,
): boolean {
  const left = normalizeInstallStatusEntries(before)
  const right = normalizeInstallStatusEntries(after)

  if (left.length !== right.length) {
    return false
  }

  return left.every((entry, index) => entry === right[index])
}

function getChangedInstallStatusContentIds(
  before: InstallStatusMap,
  after: InstallStatusMap,
): string[] {
  const contentIds = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...contentIds].filter((contentId) => (
    !installStatusEntriesEqual(before[contentId], after[contentId])
  ))
}

async function notifyInstallStatusChanges(eventBus: EventBus): Promise<void> {
  const before = installStatusCacheService.getAll()
  await installStatusCacheService.buildCache()
  const after = installStatusCacheService.getAll()

  for (const contentId of getChangedInstallStatusContentIds(before, after)) {
    eventBus.emit({
      domain: "install-status",
      type: "install-status.changed",
      payload: { contentId, entries: after[contentId] ?? [] },
      timestamp: new Date().toISOString(),
    }, { backpressure: "block" })
  }
}

// Schemas
const repositoryStateSchema = z.object({
  repositoryUuid: z.string(),
  localPath: z.string(),
  status: z.enum(["missing", "ready", "inaccessible"]),
  isGitRepository: z.boolean(),
  gitRootPath: z.string().nullable(),
})

const initializationPreviewSchema = z.object({
  isEmpty: z.boolean(),
  nonGitEntries: z.array(z.string()),
  operationToken: z.string(),
  dangerFlags: z.array(z.enum([
    "home",
    "desktop",
    "documents",
    "downloads",
    "filesystem-root",
    "synapse-source-checkout",
    "source-repository",
  ])),
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

const syncFailureCategorySchema = z.enum([
  "network",
  "timeout",
  "auth",
  "upstream-missing",
  "diverged",
  "missing-path",
  "not-git",
  "ignored-paths",
  "git-missing",
  "no-changes",
  "unknown",
])

const pendingPushEntrySchema = z.object({
  id: z.number(),
  commitHash: z.string().nullable(),
  action: z.string(),
  targetId: z.string(),
  createdAt: z.string(),
  retryCount: z.number(),
  lastError: z.string().nullable(),
  lastErrorCategory: syncFailureCategorySchema.nullable().optional(),
  lastAttemptAt: z.string().nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  title: z.string().nullable(),
})

const pendingPushesSchema = z.object({
  count: z.number(),
  items: z.array(pendingPushEntrySchema),
})

const syncSnapshotSchema = z.object({
  repositoryUuid: z.string(),
  status: z.enum(["synced", "syncing", "pending", "offline", "attention"]),
  operation: z.enum(["sync", "push", "maintenance", "initialize"]).nullable(),
  phase: z.enum(["preparing", "running", "retry-wait", "blocked", "completed"]),
  pendingCount: z.number(),
  pendingItems: z.array(pendingPushEntrySchema),
  message: z.string(),
  detail: z.string().optional(),
  failureCategory: syncFailureCategorySchema.nullable().optional(),
  lastAttemptAt: z.string().nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  retryCount: z.number(),
  canRetryNow: z.boolean(),
  primaryAction: z.enum(["retry", "open-settings", "resolve-git"]).nullable(),
})

const initializeResultSchema = z.object({
  initializedAt: z.string(),
  message: z.string().optional(),
  pendingPushCount: z.number().optional(),
  repository: repositoryStateSchema,
})

const initializationOptionsSchema = z.object({
  confirmedOperationToken: z.string().optional(),
}).optional()

const validationResultSchema = z.object({
  isValid: z.boolean(),
  initializationPreview: initializationPreviewSchema,
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
      operationId: "app.settings.repository.get_states",
      request: z.void(),
      response: z.array(repositoryStateSchema),
      handler: async (_ctx) => {
        logger.debug("Handling repository.getStates request.")
        const config = await configStore.load()
        const results = await Promise.allSettled(
          config.repositories.map((repository) => repositoryStore.getRepositoryState(repository)),
        )
        const states = results.map((result, index) => {
          if (result.status === "fulfilled") return result.value
          const repository = config.repositories[index]
          logger.warn("Repository state resolution failed; returning inaccessible state.", {
            repositoryUuid: repository?.uuid,
            error: result.reason,
          })
          return {
            repositoryUuid: repository?.uuid ?? "unknown",
            localPath: repository?.localPath ?? "",
            status: "inaccessible" as const,
            isGitRepository: false,
            gitRootPath: null,
          }
        })

        logger.debug(`Repository states resolved for renderer. repositoryCount: ${config.repositories.length}`)

        return states
      },
    },
    checkInitializationPreview: {
      kind: "invoke",
      operationId: "app.settings.repository.check_initialization_preview",
      request: z.object({ repositoryUuid: z.string() }),
      response: initializationPreviewSchema,
      handler: async (_ctx, request: { repositoryUuid: string }) => {
        logger.info(`Handling repository.checkInitializationPreview request. repositoryUuid: ${request.repositoryUuid}`)

        try {
          const repository = await resolveRepositoryConfig(request.repositoryUuid)
          const preview = await repositoryStructureService.checkInitializationPreview(repository)

          logger.info(`repository.checkInitializationPreview request completed. repositoryUuid: ${request.repositoryUuid}, isEmpty: ${preview.isEmpty}, nonGitEntryCount: ${preview.nonGitEntries.length}, dangerFlagCount: ${preview.dangerFlags.length}`)

          return preview
        } catch (error) {
          logger.error(`repository.checkInitializationPreview request failed. repositoryUuid: ${request.repositoryUuid}, error: ${error}`)
          throw error
        }
      },
    },
    createLocalRepository: {
      kind: "invoke",
      operationId: "app.settings.repository.create_local_repository",
      request: createLocalRepositoryPayloadSchema,
      response: createLocalRepositoryResultSchema,
      handler: async (ctx, payload: SynapseCreateLocalRepositoryPayload) => {
        logger.info(`Handling repository.createLocalRepository request. name: ${payload.name}, parentPath: ${payload.parentPath}`)
        const resource = await guardCreateLocalRepository(ctx, payload)
        try {
          const result = await repositoryStructureService.createLocalRepository(payload)
          recordCreateLocalRepositoryAudit(ctx, resource, "allowed")
          return result
        } catch (error) {
          recordCreateLocalRepositoryAudit(ctx, resource, "failed", error)
          throw error
        }
      },
    },
    getPendingPushes: {
      kind: "invoke",
      operationId: "app.settings.repository.get_pending_pushes",
      request: z.object({ repositoryUuid: z.string() }),
      response: pendingPushesSchema,
      handler: async (_ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        return contentSubmissionService.readPendingPushState(repository)
      },
    },
    getSyncSnapshots: {
      kind: "invoke",
      operationId: "app.settings.repository.get_sync_snapshots",
      request: z.void(),
      response: z.array(syncSnapshotSchema),
      handler: async (ctx) => {
        const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")
        const config = await configStore.load()
        return coordinator.getSnapshotsForRepositories(config.repositories)
      },
    },
    initializeStructure: {
      kind: "invoke",
      operationId: "app.settings.repository.initialize_structure",
      request: z.object({
        repositoryUuid: z.string(),
        options: initializationOptionsSchema,
      }),
      response: initializeResultSchema,
      handler: async (ctx, request: { repositoryUuid: string; options?: z.infer<typeof initializationOptionsSchema> }) => {
        const hasConfirmedOperationToken = Boolean(request.options?.confirmedOperationToken)
        logger.info(`Handling repository.initializeStructure request. repositoryUuid: ${request.repositoryUuid}, hasConfirmedOperationToken: ${hasConfirmedOperationToken}`)

        try {
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

          const result = await repositoryStructureService.initializeStructure(repository, request.options)
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

          logger.info(`repository.initializeStructure request completed. repositoryUuid: ${request.repositoryUuid}, initializedAt: ${result.initializedAt}, pendingPushCount: ${result.pendingPushCount ?? pendingPushes.count}`)

          return result
        } catch (error) {
          logger.error(`repository.initializeStructure request failed. repositoryUuid: ${request.repositoryUuid}, error: ${error}`)
          throw error
        }
      },
    },
    chooseDirectory: {
      kind: "invoke",
      operationId: "app.settings.repository.choose_directory",
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
      operationId: "app.settings.repository.validate_directory",
      request: z.object({ targetPath: z.string() }),
      response: validationResultSchema,
      handler: async (_ctx, request: { targetPath: string }): Promise<SynapseRepositoryValidationResult> => {
        logger.info(`Validating directory structure. targetPath: ${request.targetPath}`)
        return repositoryStructureService.validateDirectoryStructure(request.targetPath)
      },
    },
    sync: {
      kind: "invoke",
      operationId: "app.settings.repository.sync",
      request: z.object({ repositoryUuid: z.string() }),
      response: syncResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        logger.info(`Handling repository.sync request. repositoryUuid: ${request.repositoryUuid}`)
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")

        try {
          const result = await coordinator.requestSync(repository, "manual")
          if (result.operation === "sync") {
            await contentIndexService.syncIndex(repository)
            try {
              await notifyInstallStatusChanges(eventBus)
            } catch (error) {
              logger.warn("Failed to refresh install status after repository sync.", {
                error,
                repositoryUuid: request.repositoryUuid,
              })
            }
          }
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
          logger.error(`repository.sync request failed. repositoryUuid: ${request.repositoryUuid}, error: ${sanitizeErrorForRepositoryLog(error)}`)
          throw error
        }
      },
    },
    runMaintenance: {
      kind: "invoke",
      operationId: "app.settings.repository.run_maintenance",
      request: z.object({ repositoryUuid: z.string() }),
      response: maintenanceResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")

        try {
          const result = await coordinator.requestMaintenance(repository)
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

          return result
        } catch (error) {
          logger.error(`repository.runMaintenance request failed. repositoryUuid: ${request.repositoryUuid}, error: ${sanitizeErrorForRepositoryLog(error)}`)
          throw error
        }
      },
    },
    flushPendingPushes: {
      kind: "invoke",
      operationId: "app.settings.repository.flush_pending_pushes",
      request: z.object({ repositoryUuid: z.string() }),
      response: flushResultSchema,
      handler: async (ctx, request: { repositoryUuid: string }) => {
        const repository = await resolveRepositoryConfig(request.repositoryUuid)
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const coordinator = ctx.resolve<RepositorySyncCoordinator>("repo.sync-coordinator")

        try {
          await coordinator.requestPush(repository, "manual")
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
          logger.error(`repository.flushPendingPushes request failed. repositoryUuid: ${request.repositoryUuid}, error: ${sanitizeErrorForRepositoryLog(error)}`)
          throw error
        }
      },
    },
  },
  events: {},
}
