import { contextBridge, ipcRenderer } from "electron"
import type { SynapseBridge } from "../src/types/bridge"

// Sandbox preload cannot require arbitrary local modules, so the IPC channel
// names used here must stay inline instead of importing ./ipc/channels.
const SYNAPSE_PRELOAD_CHANNELS = {
  content: {
    createRule: "synapse:content:create-rule",
    createSkill: "synapse:content:create-skill",
    deleteContent: "synapse:content:delete-content",
    downloadRule: "synapse:content:download-rule",
    downloadSkill: "synapse:content:download-skill",
    getEditorAdapters: "synapse:content:get-editor-adapters",
    getRuleContent: "synapse:content:get-rule-content",
    getRuleDetail: "synapse:content:get-rule-detail",
    getRuleHistory: "synapse:content:get-rule-history",
    getRuleHistoryVersion: "synapse:content:get-rule-history-version",
    getRules: "synapse:content:get-rules",
    getSkillContent: "synapse:content:get-skill-content",
    getSkillDetail: "synapse:content:get-skill-detail",
    getSkillHistory: "synapse:content:get-skill-history",
    getSkillHistoryVersion: "synapse:content:get-skill-history-version",
    getSkills: "synapse:content:get-skills",
    installToEditor: "synapse:content:install-to-editor",
    resolveEditorInstallTarget: "synapse:content:resolve-editor-install-target",
    updateRule: "synapse:content:update-rule",
    updateSkill: "synapse:content:update-skill",
  },
  config: {
    exportBackup: "synapse:config:export-backup",
    get: "synapse:config:get",
    importBackup: "synapse:config:import-backup",
    update: "synapse:config:update",
  },
  identity: {
    generateNewId: "synapse:identity:generate-new-id",
    getState: "synapse:identity:get-state",
    replaceUserId: "synapse:identity:replace-user-id",
    updateDisplayName: "synapse:identity:update-display-name",
  },
  log: {
    appended: "synapse:log:appended",
    export: "synapse:log:export",
    list: "synapse:log:list",
    summary: "synapse:log:summary",
    write: "synapse:log:write",
  },
  repository: {
    chooseDirectory: "synapse:repository:choose-directory",
    flushPendingPushes: "synapse:repository:flush-pending-pushes",
    getPendingPushes: "synapse:repository:get-pending-pushes",
    getStates: "synapse:repository:get-states",
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
    createRule: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.createRule, payload),
    createSkill: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.createSkill, payload),
    deleteContent: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.deleteContent, payload),
    downloadRule: (ruleId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.downloadRule, ruleId),
    downloadSkill: (skillId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.downloadSkill, skillId),
    getEditorAdapters: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getEditorAdapters),
    getRuleContent: (ruleId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRuleContent, ruleId),
    getRuleDetail: (ruleId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRuleDetail, ruleId),
    getRuleHistory: (ruleId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRuleHistory, ruleId),
    getRuleHistoryVersion: (ruleId, historyDirname) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRuleHistoryVersion, ruleId, historyDirname),
    getRules: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRules),
    getSkillContent: (skillId) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkillContent, skillId),
    getSkillDetail: (skillId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkillDetail, skillId),
    getSkillHistory: (skillId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkillHistory, skillId),
    getSkillHistoryVersion: (skillId, historyDirname) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkillHistoryVersion, skillId, historyDirname),
    getSkills: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkills),
    installToEditor: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.installToEditor, payload),
    resolveEditorInstallTarget: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.resolveEditorInstallTarget, payload),
    updateRule: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.updateRule, payload),
    updateSkill: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.updateSkill, payload),
  },
  config: {
    exportBackup: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.exportBackup),
    get: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.get),
    importBackup: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.importBackup),
    update: (patch) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.update, patch),
  },
  identity: {
    generateNewId: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.generateNewId),
    getState: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.getState),
    replaceUserId: (userId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.replaceUserId, userId),
    updateDisplayName: (displayName) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.identity.updateDisplayName, displayName),
  },
  log: {
    export: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.export),
    list: (query) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.list, query),
    onAppended: (listener) => subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.log.appended, listener),
    summary: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.summary),
    write: (payload) => ipcRenderer.send(SYNAPSE_PRELOAD_CHANNELS.log.write, payload),
  },
  repository: {
    chooseDirectory: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.chooseDirectory),
    flushPendingPushes: (repositoryUuid) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.flushPendingPushes, repositoryUuid),
    getPendingPushes: (repositoryUuid) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.getPendingPushes, repositoryUuid),
    getStates: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.getStates),
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
