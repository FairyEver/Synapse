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

export const updateIpcModule: IpcModule = {
  id: "update",
  methods: {
    getState: {
      kind: "invoke",
      channel: "synapse:update:get-state",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.getState()
      },
    },
    checkForUpdates: {
      kind: "invoke",
      channel: "synapse:update:check-for-updates",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.checkForUpdates()
      },
    },
    checkForUpdatesOnPageEnter: {
      kind: "invoke",
      channel: "synapse:update:check-for-updates-on-page-enter",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.checkForUpdatesOnPageEnter()
      },
    },
    downloadUpdate: {
      kind: "invoke",
      channel: "synapse:update:download-update",
      request: z.void(),
      response: updateStateResponseSchema,
      handler: async (_ctx) => {
        return updateService.downloadUpdate()
      },
    },
    cancelDownload: {
      kind: "invoke",
      channel: "synapse:update:cancel-download",
      request: z.void(),
      response: z.void(),
      handler: async (_ctx) => {
        await updateService.cancelDownload()
      },
    },
    installUpdate: {
      kind: "invoke",
      channel: "synapse:update:install-update",
      request: z.void(),
      response: z.void(),
      handler: async (_ctx) => {
        await updateService.installUpdate()
      },
    },
  },
  events: {},
}
