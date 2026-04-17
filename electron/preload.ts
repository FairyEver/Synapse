import { contextBridge, ipcRenderer } from "electron"
import type { SynapseConfig, SynapseConfigPatch } from "../src/types/config"
import type {
  SynapseLogAppendedEvent,
  SynapseLogExportResult,
  SynapseLogListQuery,
  SynapseLogListResult,
  SynapseLogSummary,
  SynapseRendererLogPayload,
} from "../src/types/log"
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
  log: {
    export: () => ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.log.export) as Promise<SynapseLogExportResult>,
    list: (query: SynapseLogListQuery) =>
      ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.log.list, query) as Promise<SynapseLogListResult>,
    onAppended: (listener: (payload: SynapseLogAppendedEvent) => void) =>
      subscribeToChannel(SYNAPSE_IPC_CHANNELS.log.appended, listener),
    summary: () => ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.log.summary) as Promise<SynapseLogSummary>,
    write: (payload: SynapseRendererLogPayload) =>
      ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.log.write, payload) as Promise<void>,
  },
  repository: {
    chooseDirectory: () =>
      ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.repository.chooseDirectory) as Promise<string | null>,
    getStates: () =>
      ipcRenderer.invoke(SYNAPSE_IPC_CHANNELS.repository.getStates) as Promise<SynapseRepositoryLocalState[]>,
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
