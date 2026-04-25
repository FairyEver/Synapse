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
  installSource: z.object({
    source: z.enum(["development", "packaged-app", "npm-wrapper", "unknown"]),
    packageName: z.string().nullable(),
    packageVersion: z.string().nullable(),
    binaryPath: z.string().nullable(),
    wrapperScriptPath: z.string().nullable(),
    expectedBinaryName: z.string().nullable(),
    versionStatus: z.enum(["matching", "newer-or-equal", "outdated", "missing", "unknown"]),
    message: z.string(),
  }),
  legacyUpdateCompatibility: z.object({
    status: z.enum(["skipped", "unknown", "current", "available"]),
    currentVersion: z.string(),
    latestVersion: z.string().nullable(),
    commandHint: z.string().nullable(),
    message: z.string(),
  }),
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
  downloadedFilePath: z.string().nullable(),
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
