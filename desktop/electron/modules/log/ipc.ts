/**
 * Phase 0.3 — Log IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/log-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { app, dialog } from "electron"
import path from "node:path"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import { logStore } from "../../services/log-store"
import type { SynapseRendererLogPayload } from "../../../src/types/log"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import { createControlledProcessRunner } from "../../runtime/process"

// Schemas
const rendererLogPayloadSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  category: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
})

const exportResultSchema = z.object({
  fileCount: z.number(),
  filePath: z.string(),
})

const logFileInfoSchema = z.object({
  name: z.string(),
  sizeBytes: z.number(),
})

export const logIpcModule: IpcModule = {
  id: "log",
  methods: {
    write: {
      kind: "invoke",
      channel: "synapse:log:write",
      request: rendererLogPayloadSchema,
      response: z.void(),
      handler: async (_ctx, request: SynapseRendererLogPayload) => {
        logStore.write({
          source: "renderer",
          level: request.level,
          category: request.category,
          message: request.message,
          details: request.details,
        })
      },
    },
    export: {
      kind: "invoke",
      channel: "synapse:log:export",
      request: z.void(),
      response: exportResultSchema,
      handler: async (ctx) => {
        const windowManager = ctx.resolve<WindowManager>("core.window-manager")
        const windows = windowManager.list()
        const mainWindow = windows.find((w) => w.role === "main")

        const defaultName = `synapse-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`
        const dialogResult = mainWindow
          ? await dialog.showSaveDialog({
              defaultPath: path.join(app.getPath("downloads"), defaultName),
              filters: [{ name: "ZIP", extensions: ["zip"] }],
            })
          : await dialog.showSaveDialog({
              defaultPath: path.join(app.getPath("downloads"), defaultName),
              filters: [{ name: "ZIP", extensions: ["zip"] }],
            })

        if (dialogResult.canceled || !dialogResult.filePath) {
          return { fileCount: 0, filePath: "" }
        }

        const actor = { kind: "user" } as const
        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")

        const permission = await permissionGuard.check({
          action: "fs.write",
          actor,
          resource: dialogResult.filePath,
          context: { source: "log.export" },
        })
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.write",
            actor,
            resource: dialogResult.filePath,
            outcome: "denied",
            metadata: {
              source: "log.export",
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }

        try {
          const result = await logStore.exportAllLogs(dialogResult.filePath, {
            actor,
            processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
          })
          auditSink.record({
            action: "fs.write",
            actor,
            resource: dialogResult.filePath,
            outcome: "allowed",
            metadata: { source: "log.export" },
          })
          return result
        } catch (error) {
          auditSink.record({
            action: "fs.write",
            actor,
            resource: dialogResult.filePath,
            outcome: "failed",
            metadata: {
              source: "log.export",
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
          throw error
        }
      },
    },
    clear: {
      kind: "invoke",
      channel: "synapse:log:clear",
      request: z.void(),
      response: z.object({ fileCount: z.number() }),
      handler: async (_ctx) => {
        return logStore.clearAllLogs()
      },
    },
    readAll: {
      kind: "invoke",
      channel: "synapse:log:read-all",
      request: z.void(),
      response: z.string(),
      handler: async (_ctx) => {
        return logStore.readAllLogs()
      },
    },
    listFiles: {
      kind: "invoke",
      channel: "synapse:log:list-files",
      request: z.void(),
      response: z.array(logFileInfoSchema),
      handler: async (_ctx) => {
        return logStore.listLogFilesInfo()
      },
    },
    readFiles: {
      kind: "invoke",
      channel: "synapse:log:read-files",
      request: z.array(z.string()),
      response: z.string(),
      handler: async (_ctx, fileNames: string[]) => {
        return logStore.readLogsByNames(fileNames)
      },
    },
  },
  events: {},
}
