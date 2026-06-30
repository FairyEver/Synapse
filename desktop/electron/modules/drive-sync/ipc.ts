import { dialog } from "electron"
import path from "node:path"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import type { DriveSyncService } from "../../services/drive-sync-service"

const driveItemKindSchema = z.enum(["file", "folder"])
const driveSyncInitialDirectionSchema = z.enum(["remote_to_local", "local_to_remote", "bind_existing"])
const driveSyncBindingPreviewStatusSchema = z.enum(["ready", "blocked", "warning"])
const driveSyncConflictResolutionSchema = z.enum(["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"])
const driveSyncBindingStatuses = ["active", "paused", "conflict", "error", "removed"] as const
const driveSyncOperationStatuses = ["pending", "running", "succeeded", "retry_wait", "conflict", "error"] as const
const bindingStatusSchema = z.enum(driveSyncBindingStatuses)
const operationStatusSchema = z.enum(driveSyncOperationStatuses)
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
  createdAt: z.string().min(1),
})

const driveSyncOperationSchema = z.object({
  id: z.string().min(1),
  bindingId: z.string().min(1),
  relativePath: z.string(),
  status: operationStatusSchema,
  message: z.string().nullable(),
  updatedAt: z.string().min(1),
})

const driveSyncSnapshotSchema = z.object({
  bindings: z.array(driveSyncBindingSchema),
  conflicts: z.array(driveSyncConflictSchema),
  operations: z.array(driveSyncOperationSchema),
  summary: z.object({
    activeBindingCount: z.number().int().nonnegative(),
    runningOperationCount: z.number().int().nonnegative(),
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
})

const driveSyncCreateBindingInputSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  drivePathHint: z.string().nullable().optional(),
  localPath: z.string().min(1),
  remoteCursor: z.string().min(1).nullable().optional(),
  excludeRules: z.array(z.string()).optional(),
})

const driveSyncPreviewBindingInputSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  drivePathHint: z.string().nullable().optional(),
  localPath: z.string().min(1),
  remoteExists: z.boolean(),
  directionHint: driveSyncInitialDirectionSchema.nullable().optional(),
  importGitignore: z.boolean().optional(),
})

const driveSyncCreateSafeBindingInputSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  drivePathHint: z.string().nullable().optional(),
  localPath: z.string().min(1),
  direction: driveSyncInitialDirectionSchema,
  excludeRules: z.array(z.string()).optional(),
  importGitignore: z.boolean().optional(),
})

const driveSyncBindingIdInputSchema = z.object({
  id: z.string().min(1),
})
const driveSyncOptionalBindingIdInputSchema = driveSyncBindingIdInputSchema.partial().optional()

const driveSyncUpdateExcludeRulesInputSchema = z.object({
  id: z.string().min(1),
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
    windowManager.broadcast(driveSyncIpcModule.events.changed.channel, payload)
  })
  driveSyncEventWiredServices.add(service)
}

export const driveSyncIpcModule: IpcModule = {
  id: "driveSync",
  methods: {
    getSnapshot: {
      channel: "synapse:drive-sync:snapshot:get",
      kind: "invoke",
      request: z.void(),
      response: driveSyncSnapshotSchema,
      handler: (ctx) => resolveDriveSyncService(ctx).getSnapshot(),
    },
    createBinding: {
      channel: "synapse:drive-sync:bindings:create",
      kind: "invoke",
      request: driveSyncCreateBindingInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncCreateBindingInputSchema>) =>
        resolveDriveSyncService(ctx).createBinding(request),
    },
    previewBinding: {
      channel: "synapse:drive-sync:bindings:preview",
      kind: "invoke",
      request: driveSyncPreviewBindingInputSchema,
      response: driveSyncBindingPreviewSchema,
      handler: (ctx, request: z.infer<typeof driveSyncPreviewBindingInputSchema>) =>
        resolveDriveSyncService(ctx).previewBinding(request),
    },
    createSafeBinding: {
      channel: "synapse:drive-sync:bindings:safe-create",
      kind: "invoke",
      request: driveSyncCreateSafeBindingInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncCreateSafeBindingInputSchema>) =>
        resolveDriveSyncService(ctx).createSafeBinding(request),
    },
    removeBinding: {
      channel: "synapse:drive-sync:bindings:remove",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).removeBinding(request.id),
    },
    pauseBinding: {
      channel: "synapse:drive-sync:bindings:pause",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).pauseBinding(request.id),
    },
    resumeBinding: {
      channel: "synapse:drive-sync:bindings:resume",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).resumeBinding(request.id),
    },
    updateExcludeRules: {
      channel: "synapse:drive-sync:bindings:exclude-rules:update",
      kind: "invoke",
      request: driveSyncUpdateExcludeRulesInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncUpdateExcludeRulesInputSchema>) =>
        resolveDriveSyncService(ctx).updateExcludeRules(request),
    },
    rescanBinding: {
      channel: "synapse:drive-sync:bindings:rescan",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).rescanBinding(request.id),
    },
    pollRemoteChanges: {
      channel: "synapse:drive-sync:remote:poll",
      kind: "invoke",
      request: driveSyncOptionalBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncOptionalBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).pollRemoteChanges(request?.id),
    },
    resolveConflict: {
      channel: "synapse:drive-sync:conflicts:resolve",
      kind: "invoke",
      request: driveSyncResolveConflictInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncResolveConflictInputSchema>) =>
        resolveDriveSyncService(ctx).resolveConflict(request),
    },
    chooseLocalPath: {
      channel: "synapse:drive-sync:local-path:choose",
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
      channel: "synapse:drive-sync:changed",
      kind: "event",
      payload: driveSyncSnapshotSchema,
    },
  },
}
