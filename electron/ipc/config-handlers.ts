import { ipcMain } from "electron"
import type { SynapseConfigPatch } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { configStore } from "../services/config-store"
import { createMainLogger } from "../services/log-store"

let handlersRegistered = false
const logger = createMainLogger("ipc.config")

function registerConfigHandlers() {
  if (handlersRegistered) {
    return
  }

  ipcMain.handle(SYNAPSE_IPC_CHANNELS.config.get, async () => {
    logger.debug("Handling config.get request.")
    const config = await configStore.load()

    logger.debug("Config loaded for renderer.", {
      activeRepoUuid: config.activeRepoUuid,
      repositoryCount: config.repositories.length,
    })

    return config
  })
  ipcMain.handle(
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
