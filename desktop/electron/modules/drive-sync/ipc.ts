import { dialog } from "electron"
import path from "node:path"
import { z } from "zod"
import {
  DRIVE_SYNC_BINDING_PREVIEW_STATUSES,
  DRIVE_SYNC_BINDING_STATUSES,
  DRIVE_SYNC_CONFLICT_RESOLUTIONS,
  DRIVE_SYNC_HEALTH_STATUSES,
  DRIVE_SYNC_INITIAL_DIRECTIONS,
  DRIVE_SYNC_OPERATION_KINDS,
  DRIVE_SYNC_OPERATION_STATUSES,
} from "@synapse/shared/drive-sync-constants"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import { ipcOperationIdToChannel } from "../../../synapse-capabilities/shared/naming"
import type { DriveSyncService } from "../../services/drive-sync-service"

const driveItemKindSchema = z.enum(["file", "folder"])
const driveSyncInitialDirectionSchema = z.enum(DRIVE_SYNC_INITIAL_DIRECTIONS)
const driveSyncBindingPreviewStatusSchema = z.enum(DRIVE_SYNC_BINDING_PREVIEW_STATUSES)
const driveSyncConflictResolutionSchema = z.enum(DRIVE_SYNC_CONFLICT_RESOLUTIONS)
const bindingStatusSchema = z.enum(DRIVE_SYNC_BINDING_STATUSES)
const operationStatusSchema = z.enum(DRIVE_SYNC_OPERATION_STATUSES)
const operationKindSchema = z.enum(DRIVE_SYNC_OPERATION_KINDS)
const driveSyncExcludeRulesSchema = z.object({
  forced: z.array(z.string()),
  defaults: z.array(z.string()),
  importedGitignore: z.array(z.string()),
  user: z.array(z.string()),
})

const driveSyncBindingSchema = z.object({
  id: z.string().min(1),
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  drivePathHint: z.string().nullable(),
  kind: driveItemKindSchema,
  localPath: z.string().min(1),
  status: bindingStatusSchema,
  remoteCursor: z.string().min(1).nullable(),
  excludeRules: driveSyncExcludeRulesSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastSyncedAt: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
})

const driveSyncConflictSchema = z.object({
  id: z.string().min(1),
  bindingId: z.string().min(1),
  relativePath: z.string(),
  type: z.string().min(1),
  localSummary: z.string().nullable(),
  remoteSummary: z.string().nullable(),
  availableActions: z.array(driveSyncConflictResolutionSchema),
  createdAt: z.string().min(1),
})

const driveSyncOperationSchema = z.object({
  id: z.string().min(1),
  bindingId: z.string().min(1),
  kind: operationKindSchema,
  relativePath: z.string(),
  status: operationStatusSchema,
  message: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().min(1).nullable(),
  completedBytes: z.number().nonnegative().nullable(),
  totalBytes: z.number().nonnegative().nullable(),
  updatedAt: z.string().min(1),
})

const driveSyncSnapshotSchema = z.object({
  bindings: z.array(driveSyncBindingSchema),
  conflicts: z.array(driveSyncConflictSchema),
  operations: z.array(driveSyncOperationSchema),
  health: z.object({
    status: z.enum(DRIVE_SYNC_HEALTH_STATUSES),
    readOnly: z.boolean(),
    lastError: z.string().nullable(),
    updatedAt: z.string().min(1),
  }),
  summary: z.object({
    activeBindingCount: z.number().int().nonnegative(),
    runningOperationCount: z.number().int().nonnegative(),
    retryWaitingOperationCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
  }),
})

const driveSyncBindingPreviewSchema = z.object({
  status: driveSyncBindingPreviewStatusSchema,
  direction: driveSyncInitialDirectionSchema.nullable(),
  reason: z.string().nullable(),
  localPath: z.string(),
  localKind: z.enum(["missing", "file", "folder", "other"]),
  localEmpty: z.boolean().nullable(),
  forcedExcludeRules: z.array(z.string()),
  defaultExcludeRules: z.array(z.string()),
  importedGitignoreRules: z.array(z.string()),
  detectedGitignoreRules: z.array(z.string()),
})

const driveSyncPreviewBindingInputSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  drivePathHint: z.string().nullable().optional(),
  localPath: z.string().min(1),
  remoteExists: z.boolean(),
  directionHint: driveSyncInitialDirectionSchema.nullable().optional(),
  excludeRules: z.array(z.string()).optional(),
  useDefaultExcludes: z.boolean().optional(),
  importGitignore: z.boolean().optional(),
})

const driveSyncCreateSafeBindingInputSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  drivePathHint: z.string().nullable().optional(),
  targetParentId: z.string().nullable().optional(),
  localPath: z.string().min(1),
  direction: driveSyncInitialDirectionSchema,
  excludeRules: z.array(z.string()).optional(),
  useDefaultExcludes: z.boolean().optional(),
  importGitignore: z.boolean().optional(),
})

const driveSyncBindingIdInputSchema = z.object({
  id: z.string().min(1),
})
const driveSyncOptionalBindingIdInputSchema = driveSyncBindingIdInputSchema.partial().optional()

const driveSyncUpdateExcludeRulesInputSchema = z.object({
  id: z.string().min(1),
  defaults: z.array(z.string()),
  importedGitignore: z.array(z.string()),
  user: z.array(z.string()),
})

const driveSyncResolveConflictInputSchema = z.object({
  conflictId: z.string().min(1),
  action: driveSyncConflictResolutionSchema,
})

const driveSyncChooseLocalPathInputSchema = z.object({
  kind: driveItemKindSchema,
  mode: driveSyncInitialDirectionSchema.optional(),
  defaultName: z.string().optional(),
})

const driveSyncEventWiredServices = new WeakSet<DriveSyncService>()

function resolveDriveSyncService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): DriveSyncService {
  const service = ctx.resolve<DriveSyncService>("core.drive-sync")
  wireDriveSyncEvents(ctx, service)
  return service
}

function wireDriveSyncEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: DriveSyncService,
): void {
  if (driveSyncEventWiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("changed", (payload) => {
    windowManager.broadcast(ipcOperationIdToChannel(driveSyncIpcModule.events.changed.operationId), payload)
  })
  driveSyncEventWiredServices.add(service)
}

export const driveSyncIpcModule: IpcModule = {
  id: "driveSync",
  methods: {
    getSnapshot: {
      operationId: "app.drive_sync.snapshot.get",
      kind: "invoke",
      request: z.void(),
      response: driveSyncSnapshotSchema,
      handler: (ctx) => resolveDriveSyncService(ctx).getSnapshot(),
    },
    previewBinding: {
      operationId: "app.drive_sync.bindings.preview",
      kind: "invoke",
      request: driveSyncPreviewBindingInputSchema,
      response: driveSyncBindingPreviewSchema,
      handler: (ctx, request: z.infer<typeof driveSyncPreviewBindingInputSchema>) =>
        resolveDriveSyncService(ctx).previewBinding(request),
    },
    createSafeBinding: {
      operationId: "app.drive_sync.bindings.safe_create",
      kind: "invoke",
      request: driveSyncCreateSafeBindingInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncCreateSafeBindingInputSchema>) =>
        resolveDriveSyncService(ctx).createSafeBinding(request),
    },
    removeBinding: {
      operationId: "app.drive_sync.bindings.remove",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).removeBinding(request.id),
    },
    pauseBinding: {
      operationId: "app.drive_sync.bindings.pause",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).pauseBinding(request.id),
    },
    resumeBinding: {
      operationId: "app.drive_sync.bindings.resume",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).resumeBinding(request.id),
    },
    updateExcludeRules: {
      operationId: "app.drive_sync.bindings.exclude_rules.update",
      kind: "invoke",
      request: driveSyncUpdateExcludeRulesInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncUpdateExcludeRulesInputSchema>) =>
        resolveDriveSyncService(ctx).updateExcludeRules(request),
    },
    rescanBinding: {
      operationId: "app.drive_sync.bindings.rescan",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).rescanBinding(request.id),
    },
    pollRemoteChanges: {
      operationId: "app.drive_sync.remote.poll",
      kind: "invoke",
      request: driveSyncOptionalBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncOptionalBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).pollRemoteChanges(request?.id),
    },
    resolveConflict: {
      operationId: "app.drive_sync.conflicts.resolve",
      kind: "invoke",
      request: driveSyncResolveConflictInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncResolveConflictInputSchema>) =>
        resolveDriveSyncService(ctx).resolveConflict(request),
    },
    chooseLocalPath: {
      operationId: "app.drive_sync.local_path.choose",
      kind: "invoke",
      request: driveSyncChooseLocalPathInputSchema,
      response: z.string().nullable(),
      handler: async (_ctx, request: z.infer<typeof driveSyncChooseLocalPathInputSchema>) => {
        const mode = request.mode ?? "bind_existing"
        if (mode === "remote_to_local" && request.kind === "file") {
          const result = await dialog.showSaveDialog({
            defaultPath: request.defaultName,
          })
          return result.canceled ? null : result.filePath ?? null
        }
        const result = await dialog.showOpenDialog({
          properties: [request.kind === "folder" || mode === "remote_to_local" ? "openDirectory" : "openFile"],
        })
        const selectedPath = result.canceled ? null : result.filePaths[0] ?? null
        if (!selectedPath) return null
        if (mode === "remote_to_local" && request.kind === "folder") {
          return path.join(selectedPath, request.defaultName || "同步文件夹")
        }
        return selectedPath
      },
    },
  },
  events: {
    changed: {
      operationId: "app.drive_sync.operation.changed",
      kind: "event",
      payload: driveSyncSnapshotSchema,
    },
  },
}
