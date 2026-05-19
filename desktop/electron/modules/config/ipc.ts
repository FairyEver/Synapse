/**
 * Phase 0.3 — Config IpcModule.
 * SPEC §6 Step 3.
 *
 * Replaces electron/ipc/config-handlers.ts with IpcModule.
 */

import { z } from "zod"
import { app } from "electron"
import { readdir, rm, unlink } from "node:fs/promises"
import path from "node:path"
import type { IpcModule } from "../../runtime/ipc/types"
import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type { SynapseConfigPatch } from "../../../src/types/config"
import { configBackupService } from "../../services/config-backup-service"
import { configStore } from "../../services/config-store"
import { createMainLogger, logStore } from "../../services/log-store"
import { repositoryStore } from "../../services/repository-store"
import { shutdownDatabase } from "../../database"
import type { LicenseService } from "../../services/license"

const logger = createMainLogger("ipc.config")

// 重置应用时需要保留的文件前缀
const PRESERVED_FILE_PREFIXES = ["synapse-database.db", "synapse-data.db"]

function shouldPreserveOnReset(entryName: string): boolean {
  return PRESERVED_FILE_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

// Schemas
const permissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
])

const providerModelSchema = z.object({
  providerId: z.string(),
  modelTier: z.string(),
}).nullable()

const configSchema = z.object({
  activeRepoUuid: z.union([z.string(), z.null()]),
  repositories: z.array(z.any()),
  global: z.any(),
  agent: z.object({
    defaultPermissionMode: permissionModeSchema,
    defaultProviderModel: providerModelSchema,
  }),
})

const configPatchSchema = z.any()

const exportResultSchema = z.object({
  success: z.boolean(),
  filePath: z.optional(z.string()),
  message: z.optional(z.string()),
}).nullable()

const importResultSchema = z.object({
  success: z.boolean(),
  message: z.optional(z.string()),
}).nullable()

export const configIpcModule: IpcModule = {
  id: "config",
  methods: {
    get: {
      kind: "invoke",
      channel: "synapse:config:get",
      request: z.void(),
      response: configSchema,
      handler: async (_ctx) => {
        logger.debug("Handling config.get request.")
        const config = await configStore.load()

        logger.debug(
          `Config loaded for renderer. activeRepoUuid: ${config.activeRepoUuid}, repositoryCount: ${config.repositories.length}`
        )

        return config
      },
    },
    update: {
      kind: "invoke",
      channel: "synapse:config:update",
      request: configPatchSchema,
      response: configSchema,
      handler: async (_ctx, patch: SynapseConfigPatch) => {
        logger.info(`Handling config.update request. patch: ${JSON.stringify(sanitizePatchForLog(patch))}`)
        const config = await configStore.update(patch)

        logger.info(
          `Config updated. activeRepoUuid: ${config.activeRepoUuid}, repositoryCount: ${config.repositories.length}`
        )

        return config
      },
    },
    exportBackup: {
      kind: "invoke",
      channel: "synapse:config:export-backup",
      request: z.void(),
      response: exportResultSchema,
      handler: async (ctx) => {
        logger.info("Handling config.exportBackup request.")

        const filePath = await configBackupService.selectExportTarget({
          getParentWindow: ctx.getParentWindow,
        })
        if (!filePath) {
          return null
        }

        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const actor = { kind: "user" } as const
        const permission = await permissionGuard.check({
          action: "fs.write",
          actor,
          resource: filePath,
          context: { source: "config.exportBackup" },
        })
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.write",
            actor,
            resource: filePath,
            outcome: "denied",
            metadata: {
              source: "config.exportBackup",
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }

        try {
          await configBackupService.writeExport(filePath)
          auditSink.record({
            action: "fs.write",
            actor,
            resource: filePath,
            outcome: "allowed",
            metadata: { source: "config.exportBackup" },
          })
          return { success: true, filePath }
        } catch (error) {
          auditSink.record({
            action: "fs.write",
            actor,
            resource: filePath,
            outcome: "failed",
            metadata: {
              source: "config.exportBackup",
              errorName: error instanceof Error ? error.name : typeof error,
              errorLength: String(error).length,
            },
          })
          throw error
        }
      },
    },
    importBackup: {
      kind: "invoke",
      channel: "synapse:config:import-backup",
      request: z.void(),
      response: importResultSchema,
      handler: async (ctx) => {
        logger.info("Handling config.importBackup request.")

        const filePath = await configBackupService.selectImportSource({
          getParentWindow: ctx.getParentWindow,
        })
        if (!filePath) {
          return null
        }

        const permissionGuard = ctx.resolve<PermissionGuard>("core.permission-guard")
        const auditSink = ctx.resolve<AuditSink>("core.audit-sink")
        const actor = { kind: "user" } as const
        const permission = await permissionGuard.check({
          action: "fs.read.outside-userdata",
          actor,
          resource: filePath,
          context: { source: "config.importBackup" },
        })
        if (!permission.allowed) {
          auditSink.record({
            action: "fs.read.outside-userdata",
            actor,
            resource: filePath,
            outcome: "denied",
            metadata: {
              source: "config.importBackup",
              reason: permission.reason,
              policyId: permission.policyId,
            },
          })
          throw new Error(permission.reason)
        }

        auditSink.record({
          action: "fs.read.outside-userdata",
          actor,
          resource: filePath,
          outcome: "allowed",
          metadata: { source: "config.importBackup" },
        })

        try {
          await configBackupService.readImport(filePath)
          auditSink.record({
            action: "config.import",
            actor,
            resource: "config+identity",
            outcome: "allowed",
            metadata: { source: "config.importBackup" },
          })
          return { success: true, message: "配置已成功导入。" }
        } catch (error) {
          auditSink.record({
            action: "config.import",
            actor,
            resource: "config+identity",
            outcome: "failed",
            metadata: {
              source: "config.importBackup",
              errorName: error instanceof Error ? error.name : typeof error,
            },
          })
          throw error
        }
      },
    },
    resetApp: {
      kind: "invoke",
      channel: "synapse:config:reset-app",
      request: z.void(),
      response: z.union([z.object({ success: z.literal(true) }), z.object({ success: z.literal(false), failedCount: z.number(), failedEntries: z.array(z.string()) })]),
      handler: async (_ctx) => {
        logger.info("Handling config.resetApp request. Wiping all user data except database files.")

        repositoryStore.unwatchAll()
        const licenseService = _ctx.resolve<LicenseService>("core.license")
        licenseService.stop()
        try {
          await licenseService.resetActivation()
        } catch (error) {
          logger.warn("Failed to reset license activation before app reset.", { error })
        }
        await shutdownDatabase()
        await logStore.dispose()

        const userDataPath = app.getPath("userData")
        const entries = await readdir(userDataPath, { withFileTypes: true })

        const failedEntries: string[] = []

        for (const entry of entries) {
          if (shouldPreserveOnReset(entry.name)) {
            continue
          }

          const entryPath = path.join(userDataPath, entry.name)

          try {
            if (entry.isDirectory()) {
              await rm(entryPath, { recursive: true, force: true })
            } else {
              await unlink(entryPath)
            }
          } catch {
            failedEntries.push(entry.name)
            logger.warn("Failed to delete entry during app reset.", { entryName: entry.name })
          }
        }

        if (failedEntries.length > 0) {
          logger.warn("App reset completed with some entries not deleted.", {
            failedCount: failedEntries.length,
            failedEntries,
          })
          app.relaunch()
          app.exit(0)
          return { success: false as const, failedCount: failedEntries.length, failedEntries }
        }

        app.relaunch()
        app.exit(0)
        return { success: true as const }
      },
    },
  },
  events: {},
}

function sanitizePatchForLog(patch: SynapseConfigPatch): SynapseConfigPatch {
  if (!patch.repositories || !Array.isArray(patch.repositories)) return patch
  return {
    ...patch,
    repositories: patch.repositories.map((repo) => {
      if (!repo.variables) return repo
      return { ...repo, variables: repo.variables.map((v) => ({ ...v, value: v.value ? "[redacted]" : v.value })) }
    }),
  }
}
