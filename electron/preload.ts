import { contextBridge, ipcRenderer } from "electron"
import type { SynapseBridge } from "../src/types/bridge"

// Sandbox preload cannot require arbitrary local modules, so the IPC channel
// names used here must stay inline instead of importing ./ipc/channels.
const SYNAPSE_PRELOAD_CHANNELS = {
  content: {
    list: "synapse:content:list",
    getContent: "synapse:content:get-content",
    getDetail: "synapse:content:get-detail",
    getHistory: "synapse:content:get-history",
    getHistoryVersion: "synapse:content:get-history-version",
    create: "synapse:content:create",
    update: "synapse:content:update",
    deleteContent: "synapse:content:delete-content",
    download: "synapse:content:download",
    openDetailWindow: "synapse:content:open-detail-window",
    getEditorAdapters: "synapse:content:get-editor-adapters",
    installToEditor: "synapse:content:install-to-editor",
    resolveEditorInstallTarget: "synapse:content:resolve-editor-install-target",
  },
  config: {
    exportBackup: "synapse:config:export-backup",
    get: "synapse:config:get",
    importBackup: "synapse:config:import-backup",
    update: "synapse:config:update",
  },
  identity: {
    adoptExistingUserId: "synapse:identity:adopt-existing-user-id",
    generateNewId: "synapse:identity:generate-new-id",
    getLocalState: "synapse:identity:get-local-state",
  },
  userProfile: {
    getRepoState: "synapse:user-profile:get-repo-state",
    listRepoProfiles: "synapse:user-profile:list-repo-profiles",
    updateDisplayName: "synapse:user-profile:update-display-name",
  },
  log: {
    appended: "synapse:log:appended",
    export: "synapse:log:export",
    list: "synapse:log:list",
    summary: "synapse:log:summary",
    write: "synapse:log:write",
  },
  repository: {
    checkInitializationPreview: "synapse:repository:check-initialization-preview",
    chooseDirectory: "synapse:repository:choose-directory",
    flushPendingPushes: "synapse:repository:flush-pending-pushes",
    getPendingPushes: "synapse:repository:get-pending-pushes",
    getStates: "synapse:repository:get-states",
    initializeStructure: "synapse:repository:initialize-structure",
    pendingPushesUpdated: "synapse:repository:pending-pushes-updated",
    runMaintenance: "synapse:repository:run-maintenance",
    sync: "synapse:repository:sync",
    progress: "synapse:repository:progress",
    updated: "synapse:repository:updated",
  },
  update: {
    checkForUpdates: "synapse:update:check-for-updates",
    getState: "synapse:update:get-state",
    stateChanged: "synapse:update:state-changed",
  },
} as const

function subscribeToChannel<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrappedListener = (_event: Electron.IpcRendererEvent, payload: T) => {
    listener(payload)
  }

  ipcRenderer.on(channel, wrappedListener)

  return () => {
    ipcRenderer.removeListener(channel, wrappedListener)
  }
}

const synapseBridge: SynapseBridge = {
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  },
  content: {
    list: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.list, args),
    getContent: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getContent, args),
    getDetail: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getDetail, args),
    getHistory: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getHistory, args),
    getHistoryVersion: (args) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getHistoryVersion, args),
    create: (request) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.create, request),
    update: (request) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.update, request),
    deleteContent: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.deleteContent, payload),
    download: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.download, args),
    openDetailWindow: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.openDetailWindow, payload),
    getEditorAdapters: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getEditorAdapters),
    installToEditor: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.installToEditor, payload),
    resolveEditorInstallTarget: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.resolveEditorInstallTarget, payload),
  },
  config: {
    exportBackup: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.exportBackup),
    get: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.get),
    importBackup: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.importBackup),
    update: (patch) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.update, patch),
  },
  identity: {
    adoptExistingUserId: (userId, repoId) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.adoptExistingUserId, { repoId, userId }),
    generateNewId: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.generateNewId),
    getLocalState: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.getLocalState),
  },
  userProfile: {
    getRepoState: (repoId) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.userProfile.getRepoState, { repoId }),
    listRepoProfiles: (repoId) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.userProfile.listRepoProfiles, { repoId }),
    updateDisplayName: (repoId, displayName) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.userProfile.updateDisplayName, {
        displayName,
        repoId,
      }),
  },
  log: {
    export: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.export),
    list: (query) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.list, query),
    onAppended: (listener) => subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.log.appended, listener),
    summary: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.summary),
    write: (payload) => ipcRenderer.send(SYNAPSE_PRELOAD_CHANNELS.log.write, payload),
  },
  repository: {
    checkInitializationPreview: (repositoryUuid) =>
      ipcRenderer.invoke(
        SYNAPSE_PRELOAD_CHANNELS.repository.checkInitializationPreview,
        repositoryUuid,
      ),
    chooseDirectory: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.chooseDirectory),
    flushPendingPushes: (repositoryUuid) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.flushPendingPushes, repositoryUuid),
    getPendingPushes: (repositoryUuid) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.getPendingPushes, repositoryUuid),
    getStates: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.getStates),
    initializeStructure: (repositoryUuid) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.initializeStructure, repositoryUuid),
    onPendingPushesUpdated: (listener) =>
      subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.repository.pendingPushesUpdated, listener),
    runMaintenance: (repositoryUuid) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.runMaintenance, repositoryUuid),
    sync: (repositoryUuid) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.sync, repositoryUuid),
    onProgress: (listener) =>
      subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.repository.progress, listener),
    onUpdated: (listener) => subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.repository.updated, listener),
  },
  updater: {
    checkForUpdates: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.update.checkForUpdates),
    getState: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.update.getState),
    onStateChanged: (listener) =>
      subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.update.stateChanged, listener),
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
