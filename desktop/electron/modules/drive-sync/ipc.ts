import { BrowserWindow, dialog, type OpenDialogOptions } from "electron"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import type { DriveSyncService } from "../../services/drive-sync-service"

const driveItemKindSchema = z.enum(["file", "folder"])
const driveSyncBindingStatuses = ["active", "paused", "conflict", "error", "removed"] as const
const driveSyncOperationStatuses = ["pending", "running", "succeeded", "retry_wait", "conflict", "error"] as const
const bindingStatusSchema = z.enum(driveSyncBindingStatuses)
const operationStatusSchema = z.enum(driveSyncOperationStatuses)

const driveSyncBindingSchema = z.object({
  id: z.string().min(1),
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  localPath: z.string().min(1),
  status: bindingStatusSchema,
  remoteCursor: z.string().min(1).nullable(),
  excludeRules: z.array(z.string()),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastSyncedAt: z.string().min(1).nullable(),
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

const driveSyncCreateBindingInputSchema = z.object({
  driveItemId: z.string().min(1),
  driveItemName: z.string().min(1),
  kind: driveItemKindSchema,
  drivePathHint: z.string().nullable().optional(),
  localPath: z.string().min(1),
  remoteCursor: z.string().min(1).nullable().optional(),
  excludeRules: z.array(z.string()).optional(),
  initialDirection: z.enum(["download_remote", "none"]).optional(),
})

const driveSyncChooseLocalPathInputSchema = z.object({
  kind: driveItemKindSchema,
  defaultName: z.string().min(1),
})

const driveSyncBindingIdInputSchema = z.object({
  id: z.string().min(1),
})

const driveSyncExcludeRulesInputSchema = z.object({
  id: z.string().min(1),
  excludeRules: z.array(z.string()),
})

const driveSyncConflictResolveInputSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["use_local", "use_remote", "keep_both", "skip", "confirm_delete"]),
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
    chooseLocalPath: {
      channel: "synapse:drive-sync:local-path:choose",
      kind: "invoke",
      request: driveSyncChooseLocalPathInputSchema,
      response: z.string().nullable(),
      handler: async (_ctx, request: z.infer<typeof driveSyncChooseLocalPathInputSchema>) => {
        const parentWindow = BrowserWindow.getFocusedWindow()
          ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
          ?? undefined
        if (request.kind === "file") {
          const result = parentWindow
            ? await dialog.showSaveDialog(parentWindow, { defaultPath: request.defaultName })
            : await dialog.showSaveDialog({ defaultPath: request.defaultName })
          return result.canceled ? null : result.filePath ?? null
        }

        const options: OpenDialogOptions = {
          properties: ["openDirectory", "createDirectory"],
        }
        const result = parentWindow
          ? await dialog.showOpenDialog(parentWindow, options)
          : await dialog.showOpenDialog(options)
        return result.canceled ? null : result.filePaths[0] ?? null
      },
    },
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
        resolveDriveSyncService(ctx).pauseBinding(request),
    },
    resumeBinding: {
      channel: "synapse:drive-sync:bindings:resume",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).resumeBinding(request),
    },
    updateExcludeRules: {
      channel: "synapse:drive-sync:bindings:exclude-rules:update",
      kind: "invoke",
      request: driveSyncExcludeRulesInputSchema,
      response: driveSyncBindingSchema,
      handler: (ctx, request: z.infer<typeof driveSyncExcludeRulesInputSchema>) =>
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
      channel: "synapse:drive-sync:bindings:poll-remote",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).pollRemoteChanges(request.id),
    },
    retryOperation: {
      channel: "synapse:drive-sync:operations:retry",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).retryOperation(request),
    },
    resolveConflict: {
      channel: "synapse:drive-sync:conflicts:resolve",
      kind: "invoke",
      request: driveSyncConflictResolveInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncConflictResolveInputSchema>) =>
        resolveDriveSyncService(ctx).resolveConflict(request),
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
