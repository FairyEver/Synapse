/**
 * Phase 0.3 — Log IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/log-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { app, dialog } from "electron"
import path from "node:path"
import type { IpcHandlerContext, IpcModule } from "../../runtime/ipc/types"
import type { WindowManager } from "../../runtime/window"
import { logStore } from "../../services/log-store"
import type { SynapseRendererLogPayload } from "../../../src/types/log"
import type { AuditSink, PermissionAction, PermissionGuard } from "../../runtime/security"
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

async function runGuardedLogOperation<T>(
  ctx: IpcHandlerContext,
  options: {
    readonly action: PermissionAction
    readonly metadata?: Record<string, unknown>
    readonly run: () => Promise<T>
    readonly source: string
  },
): Promise<T> {
  const actor = { kind: "user" } as const
  const resource = logStore.getLogDirectory()
  const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
  const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
  const metadata = { source: options.source, ...options.metadata }
  const permission = await permissionGuard.check({
    action: options.action,
    actor,
    resource,
    context: metadata,
  })

  if (!permission.allowed) {
    auditSink.record({
      action: options.action,
      actor,
      resource,
      outcome: "denied",
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
    })
    throw new Error(permission.reason)
  }

  try {
    const result = await options.run()
    auditSink.record({
      action: options.action,
      actor,
      resource,
      outcome: "allowed",
      metadata,
    })
    return result
  } catch (error) {
    auditSink.record({
      action: options.action,
      actor,
      resource,
      outcome: "failed",
      metadata: {
        ...metadata,
        errorName: error instanceof Error ? error.name : typeof error,
        errorLength: String(error).length,
      },
    })
    throw error
  }
}

export const logIpcModule: IpcModule = {
  id: "log",
  methods: {
    write: {
      kind: "invoke",
      operationId: "app.log.entry.write",
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
      operationId: "app.log.bundle.export",
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
      operationId: "app.log.entry.clear",
      request: z.void(),
      response: z.object({ fileCount: z.number() }),
      handler: async (ctx) => {
        return runGuardedLogOperation(ctx, {
          action: "fs.write",
          source: "log.clear",
          run: () => logStore.clearAllLogs(),
        })
      },
    },
    readAll: {
      kind: "invoke",
      operationId: "app.log.operation.read_all",
      request: z.void(),
      response: z.string(),
      handler: async (ctx) => {
        return runGuardedLogOperation(ctx, {
          action: "fs.read.outside-userdata",
          source: "log.readAll",
          run: () => logStore.readAllLogs(),
        })
      },
    },
    listFiles: {
      kind: "invoke",
      operationId: "app.log.operation.list_files",
      request: z.void(),
      response: z.array(logFileInfoSchema),
      handler: async (_ctx) => {
        return logStore.listLogFilesInfo()
      },
    },
    readFiles: {
      kind: "invoke",
      operationId: "app.log.operation.read_files",
      request: z.array(z.string()),
      response: z.string(),
      handler: async (ctx, fileNames: string[]) => {
        return runGuardedLogOperation(ctx, {
          action: "fs.read.outside-userdata",
          source: "log.readFiles",
          metadata: { fileCount: fileNames.length },
          run: () => logStore.readLogsByNames(fileNames),
        })
      },
    },
  },
  events: {},
}
