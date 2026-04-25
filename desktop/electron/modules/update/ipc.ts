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
  "idle",
  "checking",
  "update-available",
  "update-not-available",
  "downloading",
  "ready-to-install",
  "error",
])

const updateInfoSchema = z.object({
  version: z.string().optional(),
  releaseDate: z.string().optional(),
  releaseNotes: z.string().optional(),
})

const updateStateResponseSchema = z.object({
  state: updateStateSchema,
  info: updateInfoSchema.optional(),
  progress: z.object({
    percent: z.number(),
    bytesPerSecond: z.number(),
    total: z.number(),
    transferred: z.number(),
  }).optional(),
  error: z.string().optional(),
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
      response: z.object({
        updateAvailable: z.boolean(),
        version: z.string().optional(),
      }),
      handler: async (_ctx) => {
        return updateService.checkForUpdates()
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
