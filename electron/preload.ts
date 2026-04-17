import { contextBridge, ipcRenderer } from "electron"
import type { SynapseConfig, SynapseConfigPatch } from "../src/types/config"
import type {
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationResult,
  SynapseRepositoryProgressEvent,
  SynapseRepositoryUpdatedEvent,
} from "../src/types/repository"
import { SYNAPSE_IPC_CHANNELS } from "./ipc/channels"

function subscribeToChannel<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrappedListener = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload)
  }

  ipcRenderer.on(channel, wrappedListener)

  return () => {
    ipcRenderer.removeListener(channel, wrappedListener)
  }
}

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
  repository: {
    getStates: () =>
      ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.repository.getStates) as Promise<SynapseRepositoryLocalState[]>,
    clone: (repositoryUuid: string) =>
      ipcRenderer.invoke(
        SYNAPSE_IPC_CHANNELS.repository.clone,
        repositoryUuid,
      ) as Promise<SynapseRepositoryOperationResult>,
    sync: (repositoryUuid: string) =>
      ipcRenderer.invoke(
        SYNAPSE_IPC_CHANNELS.repository.sync,
        repositoryUuid,
      ) as Promise<SynapseRepositoryOperationResult>,
    onProgress: (listener: (payload: SynapseRepositoryProgressEvent) => void) =>
      subscribeToChannel(SYNAPSE_IPC_CHANNELS.repository.progress, listener),
    onUpdated: (listener: (payload: SynapseRepositoryUpdatedEvent) => void) =>
      subscribeToChannel(SYNAPSE_IPC_CHANNELS.repository.updated, listener),
  },
})
