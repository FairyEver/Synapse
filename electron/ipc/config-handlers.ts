import { BrowserWindow } from "electron"
import type { SynapseConfigBackupExportResult, SynapseConfigBackupImportResult } from "../../src/types/backup"
import type { SynapseConfigPatch } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { handleValidatedIpc } from "./validated-ipc"
import { configBackupService } from "../services/config-backup-service"
import { configStore } from "../services/config-store"
import { createMainLogger } from "../services/log-store"

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

  handlersRegistered = true
}

export { registerConfigHandlers }
