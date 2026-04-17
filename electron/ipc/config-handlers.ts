import { ipcMain } from "electron"
import type { SynapseConfigPatch } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { configStore } from "../services/config-store"
import { repositoryStore } from "../services/repository-store"

let handlersRegistered = false

function registerConfigHandlers() {
  if (handlersRegistered) {
    return
  }

  ipcMain.handle(SYNAPSE_IPC_CHANNELS.config.get, async () => configStore.load())
  ipcMain.handle(
    SYNAPSE_IPC_CHANNELS.config.update,
    async (_event, patch: SynapseConfigPatch) => {
      const previousConfig = await configStore.load()
      const nextConfig = await configStore.update(patch)
      const nextRepositoryUuidSet = new Set(nextConfig.repositories.map((repository) => repository.uuid))

      await Promise.all(
        previousConfig.repositories
          .filter((repository) => !nextRepositoryUuidSet.has(repository.uuid))
          .map(async (repository) => {
            try {
              await repositoryStore.removeLocalRepository(repository.uuid)
            } catch (error) {
              console.error(`[config] Failed to remove local repository cache for ${repository.uuid}.`, error)
            }
          }),
      )

      return nextConfig
    },
  )

  handlersRegistered = true
}

export { registerConfigHandlers }
