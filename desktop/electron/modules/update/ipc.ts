/**
 * Phase 0.3 — Update IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/update-handlers.ts with IpcModule.
 */

import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { updateService } from "../../services/update-service"

// Schemas
const updateStateSchema = z.enum([
  "unsupported",
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "not-available",
  "error",
])

const updateStateResponseSchema = z.object({
  currentVersion: z.string(),
  releaseVersion: z.string().nullable(),
  status: updateStateSchema,
  message: z.string(),
  error: z.string().nullable(),
  downloadPercent: z.number().nullable(),
  bytesPerSecond: z.number().nullable(),
  transferredBytes: z.number().nullable(),
  totalBytes: z.number().nullable(),
  lastCheckedAt: z.string().nullable(),
  canCheck: z.boolean(),
})

const updateOpenRequestSchema = z.object({
  id: z.number().int().positive(),
  automatic: z.boolean(),
}).strict()

export const updateIpcModule: IpcModule = {
  id: "update",
  methods: {
    getState: {
      kind: "invoke",
      operationId: "app.update.operation.get_state",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.getState()
      },
    },
    checkForUpdates: {
      kind: "invoke",
      operationId: "app.update.operation.check_for_updates",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.checkForUpdates()
      },
    },
    checkForUpdatesOnPageEnter: {
      kind: "invoke",
      operationId: "app.update.operation.check_for_updates_on_page_enter",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.checkForUpdatesOnPageEnter()
      },
    },
    downloadUpdate: {
      kind: "invoke",
      operationId: "app.update.operation.download_update",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.downloadUpdate()
      },
    },
    cancelDownload: {
      kind: "invoke",
      operationId: "app.update.operation.cancel_download",
      request: z.void(),
      response: z.void(),
      handler: async (_ctx) => {
        await updateService.cancelDownload()
      },
    },
    installUpdate: {
      kind: "invoke",
      operationId: "app.update.operation.install_update",
      request: z.void(),
      response: z.void(),
      handler: async (_ctx) => {
        await updateService.installUpdate()
      },
    },
    getPendingOpenRequest: {
      kind: "invoke",
      operationId: "app.update.operation.get_pending_open_request",
      request: z.void(),
      response: updateOpenRequestSchema.nullable(),
      handler: async (_ctx) => {
        return updateService.getPendingOpenRequest()
      },
    },
    acknowledgeOpenRequest: {
      kind: "invoke",
      operationId: "app.update.operation.acknowledge_open_request",
      request: z.object({ id: z.number().int().positive() }).strict(),
      response: z.void(),
      handler: async (_ctx, request: { id: number }) => {
        updateService.acknowledgeOpenRequest(request.id)
      },
    },
  },
  events: {
    openRequest: {
      kind: "event",
      operationId: "app.update.operation.open_request",
      payload: updateOpenRequestSchema,
    },
  },
}
