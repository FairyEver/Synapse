import { contextBridge, ipcRenderer } from "electron"
import type { SynapseConfig, SynapseConfigPatch } from "../src/types/config"
import { SYNAPSE_IPC_CHANNELS } from "./ipc/channels"

contextBridge.exposeInMainWorld("synapse", {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  config: {
    get: () => ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.config.get) as Promise<SynapseConfig>,
    update: (patch: SynapseConfigPatch) =>
      ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.config.update, patch) as Promise<SynapseConfig>,
  },
})
