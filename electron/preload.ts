import { contextBridge, ipcRenderer } from "electron"
import type { SynapseBridge } from "../src/types/bridge"

// Sandbox preload cannot require arbitrary local modules, so the IPC channel
// names used here must stay inline instead of importing ./ipc/channels.
const SYNAPSE_PRELOAD_CHANNELS = {
  content: {
    createRule: "synapse:content:create-rule",
    createSkill: "synapse:content:create-skill",
    downloadRule: "synapse:content:download-rule",
    downloadSkill: "synapse:content:download-skill",
    getRuleContent: "synapse:content:get-rule-content",
    getRules: "synapse:content:get-rules",
    getSkillContent: "synapse:content:get-skill-content",
    getSkillFiles: "synapse:content:get-skill-files",
    getSkills: "synapse:content:get-skills",
  },
  config: {
    get: "synapse:config:get",
    update: "synapse:config:update",
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
    getStates: "synapse:repository:get-states",
    sync: "synapse:repository:sync",
    progress: "synapse:repository:progress",
    updated: "synapse:repository:updated",
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
    downloadRule: (ruleId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.downloadRule, ruleId),
    downloadSkill: (skillId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.downloadSkill, skillId),
    getRuleContent: (ruleId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRuleContent, ruleId),
    getRules: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getRules),
    getSkillContent: (skillId) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkillContent, skillId),
    getSkillFiles: (skillId) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkillFiles, skillId),
    getSkills: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getSkills),
  },
  config: {
    get: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.get),
    update: (patch) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.update, patch),
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
    getStates: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.getStates),
    sync: (repositoryUuid) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.sync, repositoryUuid),
    onProgress: (listener) =>
      subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.repository.progress, listener),
    onUpdated: (listener) => subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.repository.updated, listener),
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
