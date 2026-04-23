import { contextBridge, ipcRenderer } from "electron"
import type { SynapseBridge } from "../src/types/bridge"
import type { SynapseAllChannels } from "./ipc/channels"

// Sandbox preload cannot require local modules at runtime, so channel strings
// stay inline. The `satisfies SynapseAllChannels` assertion ensures they stay
// in sync with the canonical definitions in ./ipc/channels.ts at compile time.
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
    listDeleted: "synapse:content:list-deleted",
    restore: "synapse:content:restore",
    purge: "synapse:content:purge",
    download: "synapse:content:download",
    openDetailWindow: "synapse:content:open-detail-window",
    getEditorAdapters: "synapse:content:get-editor-adapters",
    installToEditor: "synapse:content:install-to-editor",
    peekCursorFrontmatter: "synapse:content:peek-cursor-frontmatter",
    peekClaudeCodeFrontmatter: "synapse:content:peek-claude-code-frontmatter",
    readIconImage: "synapse:content:read-icon-image",
    resolveEditorInstallTarget: "synapse:content:resolve-editor-install-target",
  },
  cli: {
    detect: "synapse:cli:detect",
  },
  config: {
    exportBackup: "synapse:config:export-backup",
    get: "synapse:config:get",
    importBackup: "synapse:config:import-backup",
    resetApp: "synapse:config:reset-app",
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
    clear: "synapse:log:clear",
    export: "synapse:log:export",
    listFiles: "synapse:log:list-files",
    readAll: "synapse:log:read-all",
    readFiles: "synapse:log:read-files",
    write: "synapse:log:write",
  },
  repository: {
    checkInitializationPreview: "synapse:repository:check-initialization-preview",
    createLocalRepository: "synapse:repository:create-local-repository",
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
    validateDirectory: "synapse:repository:validate-directory",
  },
  editor: {
    getGlobalDirectories: "synapse:editor:get-global-directories",
    createDirectory: "synapse:editor:create-directory",
  },
  editorScan: {
    scanAll: "synapse:editor-scan:scan-all",
    readItemContent: "synapse:editor-scan:read-item-content",
    listSkillFiles: "synapse:editor-scan:list-skill-files",
  },
  shell: {
    showItemInFolder: "synapse:shell:show-item-in-folder",
  },
  update: {
    cancelDownload: "synapse:update:cancel-download",
    checkForUpdates: "synapse:update:check-for-updates",
    getState: "synapse:update:get-state",
    installUpdate: "synapse:update:install-update",
    openUpdatePage: "synapse:update:open-update-page",
    stateChanged: "synapse:update:state-changed",
  },
  dataStore: {
    listTables: "synapse:data-store:list-tables",
    createTable: "synapse:data-store:create-table",
    dropTable: "synapse:data-store:drop-table",
    describeTable: "synapse:data-store:describe-table",
    addColumn: "synapse:data-store:add-column",
    updateColumnDescription: "synapse:data-store:update-column-description",
    updateColumnEnumValues: "synapse:data-store:update-column-enum-values",
    insert: "synapse:data-store:insert",
    batchInsert: "synapse:data-store:batch-insert",
    query: "synapse:data-store:query",
    update: "synapse:data-store:update",
    delete: "synapse:data-store:delete",
    rawSQL: "synapse:data-store:raw-sql",
    getStatus: "synapse:data-store:get-status",
    exportDB: "synapse:data-store:export-db",
    importDB: "synapse:data-store:import-db",
    installCLI: "synapse:data-store:install-cli",
    getCliStatus: "synapse:data-store:get-cli-status",
    getCliDebugInfo: "synapse:data-store:get-cli-debug-info",
    getMcpStatus: "synapse:data-store:get-mcp-status",
    getMCPServers: "synapse:data-store:get-mcp-servers",
    openMCPSettings: "synapse:data-store:open-mcp-settings",
    registerMCP: "synapse:data-store:register-mcp",
  },
} as const satisfies SynapseAllChannels

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
    listDeleted: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.listDeleted, args),
    restore: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.restore, payload),
    purge: (payload) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.purge, payload),
    download: (args) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.download, args),
    openDetailWindow: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.openDetailWindow, payload),
    getEditorAdapters: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.getEditorAdapters),
    installToEditor: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.installToEditor, payload),
    peekCursorFrontmatter: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.peekCursorFrontmatter, payload),
    peekClaudeCodeFrontmatter: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.peekClaudeCodeFrontmatter, payload),
    readIconImage: (args) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.readIconImage, args),
    resolveEditorInstallTarget: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.content.resolveEditorInstallTarget, payload),
  },
  cli: {
    detect: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.cli.detect),
  },
  config: {
    exportBackup: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.exportBackup),
    get: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.get),
    importBackup: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.importBackup),
    resetApp: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.config.resetApp),
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
    clear: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.clear),
    export: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.export),
    listFiles: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.listFiles),
    readAll: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.readAll),
    readFiles: (fileNames: string[]) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.log.readFiles, fileNames),
    write: (payload) => ipcRenderer.send(SYNAPSE_PRELOAD_CHANNELS.log.write, payload),
  },
  editor: {
    getGlobalDirectories: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.editor.getGlobalDirectories),
    createDirectory: (dirPath: string) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.editor.createDirectory, dirPath),
  },
  editorScan: {
    scanAll: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.editorScan.scanAll),
    readItemContent: (filePath: string) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.editorScan.readItemContent, filePath),
    listSkillFiles: (dirPath: string) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.editorScan.listSkillFiles, dirPath),
  },
  shell: {
    showItemInFolder: (filePath: string) => ipcRenderer.send(SYNAPSE_PRELOAD_CHANNELS.shell.showItemInFolder, filePath),
  },
  repository: {
    checkInitializationPreview: (repositoryUuid) =>
      ipcRenderer.invoke(
        SYNAPSE_PRELOAD_CHANNELS.repository.checkInitializationPreview,
        repositoryUuid,
      ),
    createLocalRepository: (payload) =>
      ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.createLocalRepository, payload),
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
    validateDirectory: (targetPath) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.repository.validateDirectory, targetPath),
  },
  updater: {
    cancelDownload: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.update.cancelDownload),
    checkForUpdates: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.update.checkForUpdates),
    getState: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.update.getState),
    installUpdate: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.update.installUpdate),
    onStateChanged: (listener) =>
      subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.update.stateChanged, listener),
    onOpenUpdatePage: (listener) =>
      subscribeToChannel(SYNAPSE_PRELOAD_CHANNELS.update.openUpdatePage, listener),
  },
  dataStore: {
    listTables: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.listTables),
    createTable: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.createTable, params),
    dropTable: (name) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.dropTable, name),
    describeTable: (name) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.describeTable, name),
    addColumn: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.addColumn, params),
    updateColumnDescription: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.updateColumnDescription, params),
    updateColumnEnumValues: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.updateColumnEnumValues, params),
    insert: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.insert, params),
    batchInsert: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.batchInsert, params),
    query: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.query, params),
    update: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.update, params),
    delete: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.delete, params),
    rawSQL: (params) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.rawSQL, params),
    getStatus: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.getStatus),
    exportDB: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.exportDB),
    importDB: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.importDB),
    installCLI: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.installCLI),
    getCliStatus: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.getCliStatus),
    getCliDebugInfo: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.getCliDebugInfo),
    getMcpStatus: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.getMcpStatus),
    getMCPServers: () => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.getMCPServers),
    openMCPSettings: (target) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.openMCPSettings, target),
    registerMCP: (target) => ipcRenderer.invoke(SYNAPSE_PRELOAD_CHANNELS.dataStore.registerMCP, target),
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
