import { app, BrowserWindow } from "electron"
import { readdir, rm, unlink } from "node:fs/promises"
import path from "node:path"
import type { SynapseConfigBackupExportResult, SynapseConfigBackupImportResult } from "../../src/types/backup"
import type { SynapseConfigPatch } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { configBackupService } from "../services/config-backup-service"
import { configStore } from "../services/config-store"
import { createMainLogger, logStore } from "../services/log-store"
import { repositoryStore } from "../services/repository-store"
import { shutdownDataStore } from "../data-store"

// 重置应用时需要保留的文件前缀。数据服务（对外提供的数据库）独立于应用配置，
// 不随重置一起清空。匹配主库 .db、WAL/SHM sidecar 以及历史损坏备份。
const PRESERVED_FILE_PREFIXES = ["synapse-data.db"]

function shouldPreserveOnReset(entryName: string): boolean {
  return PRESERVED_FILE_PREFIXES.some((prefix) => entryName.startsWith(prefix))
}

let handlersRegistered = false
const logger = createMainLogger("ipc.config")

function registerConfigHandlers() {
  if (handlersRegistered) {
    return
  }

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.config.exportBackup,
    async (event): Promise<SynapseConfigBackupExportResult | null> => {
      logger.info("Handling config.exportBackup request.")
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      return configBackupService.exportBackup(ownerWindow)
    },
  )

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.config.get, async () => {
    logger.debug("Handling config.get request.")
    const config = await configStore.load()

    logger.debug("Config loaded for renderer.", {
      activeRepoUuid: config.activeRepoUuid,
      repositoryCount: config.repositories.length,
    })

    return config
  })
  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.config.importBackup,
    async (event): Promise<SynapseConfigBackupImportResult | null> => {
      logger.info("Handling config.importBackup request.")
      const ownerWindow = BrowserWindow.fromWebContents(event.sender)
      return configBackupService.importBackup(ownerWindow)
    },
  )

  handleValidatedIpc(
    SYNAPSE_IPC_CHANNELS.config.update,
    async (_event, patch: SynapseConfigPatch) => {
      logger.info("Handling config.update request.", patch)
      const config = await configStore.update(patch)

      logger.info("Config updated.", {
        activeRepoUuid: config.activeRepoUuid,
        repositoryCount: config.repositories.length,
      })

      return config
    },
  )

  handleValidatedIpc(SYNAPSE_IPC_CHANNELS.config.resetApp, async () => {
    logger.info("Handling config.resetApp request. Wiping all user data except data-store files.")

    repositoryStore.unwatchAll()
    // 先关闭数据服务，确保 SQLite WAL 正确 checkpoint 到主库文件，
    // 这样保留下来的 synapse-data.db 是自洽的。
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
  })

  handlersRegistered = true
}

export { registerConfigHandlers }
