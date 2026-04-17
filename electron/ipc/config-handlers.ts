import { ipcMain } from "electron"
import type { SynapseConfigPatch } from "../../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./channels"
import { configStore } from "../services/config-store"

let handlersRegistered = false

function registerConfigHandlers() {
  if (handlersRegistered) {
    return
  }

  ipcMain.handle(SYNAPSE_IPC_CHANNELS.config.get, async () => configStore.load())
  ipcMain.handle(
    SYNAPSE_IPC_CHANNELS.config.update,
    async (_event, patch: SynapseConfigPatch) => configStore.update(patch),
  )

  handlersRegistered = true
}

export { registerConfigHandlers }
