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
})

const driveSyncBindingIdInputSchema = z.object({
  id: z.string().min(1),
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
    removeBinding: {
      channel: "synapse:drive-sync:bindings:remove",
      kind: "invoke",
      request: driveSyncBindingIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof driveSyncBindingIdInputSchema>) =>
        resolveDriveSyncService(ctx).removeBinding(request.id),
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
