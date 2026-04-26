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
import type { SynapseConfigPatch } from "../../../src/types/config"
import { configBackupService } from "../../services/config-backup-service"
import { configStore } from "../../services/config-store"
import { createMainLogger, logStore } from "../../services/log-store"
import { repositoryStore } from "../../services/repository-store"
import { shutdownDataStore } from "../../data-store"

const logger = createMainLogger("ipc.config")

// 重置应用时需要保留的文件前缀
const PRESERVED_FILE_PREFIXES = ["synapse-data.db"]

function shouldPreserveOnReset(entryName: string): boolean {
  return PRESERVED_FILE_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

// Schemas
const configSchema = z.object({
  activeRepoUuid: z.union([z.string(), z.null()]),
  repositories: z.array(z.any()),
  global: z.any(),
})

const configPatchSchema = z.any()

const exportResultSchema = z.object({
  success: z.boolean(),
  filePath: z.optional(z.string()),
  message: z.optional(z.string()),
})

const importResultSchema = z.object({
  success: z.boolean(),
  message: z.optional(z.string()),
})

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
        logger.info(`Handling config.update request. patch: ${JSON.stringify(patch)}`)
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
      handler: async (_ctx) => {
        logger.info("Handling config.exportBackup request.")
        const result = await configBackupService.exportBackup()
        if (result === null) {
          return { success: false, message: "用户取消了导出操作。" }
        }
        return { success: true, filePath: result.filePath }
      },
    },
    importBackup: {
      kind: "invoke",
      channel: "synapse:config:import-backup",
      request: z.void(),
      response: importResultSchema,
      handler: async (_ctx) => {
        logger.info("Handling config.importBackup request.")
        const result = await configBackupService.importBackup()
        if (result === null) {
          return { success: false, message: "用户取消了导入操作。" }
        }
        return { success: true, message: "配置已成功导入。" }
      },
    },
    resetApp: {
      kind: "invoke",
      channel: "synapse:config:reset-app",
      request: z.void(),
      response: z.void(),
      handler: async (_ctx) => {
        logger.info("Handling config.resetApp request. Wiping all user data except data-store files.")

        repositoryStore.unwatchAll()
        await shutdownDataStore()
        await logStore.dispose()

        const userDataPath = app.getPath("userData")
        const entries = await readdir(userDataPath, { withFileTypes: true })

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
            // Best effort — some files may be locked by Chromium.
          }
        }

        app.relaunch()
        app.exit(0)
      },
    },
  },
  events: {},
}
