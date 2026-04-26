/**
 * Phase 0.3 — Minimal preload bridge.
 *
 * Creates a type-safe bridge for renderer-to-main communication.
 */

import { contextBridge, ipcRenderer } from "electron"
import type { IpcChannelMap } from "./generated/ipc-channels.generated"
import type { SynapseBridge } from "../src/types/bridge"

const IPC_CHANNELS = {
  "content": {
    "list": "synapse:content:list",
    "getContent": "synapse:content:get-content",
    "getDetail": "synapse:content:get-detail",
    "getHistory": "synapse:content:get-history",
    "getHistoryVersion": "synapse:content:get-history-version",
    "getEditorAdapters": "synapse:content:get-editor-adapters",
    "create": "synapse:content:create",
    "update": "synapse:content:update",
    "deleteContent": "synapse:content:delete-content",
    "listDeleted": "synapse:content:list-deleted",
    "restore": "synapse:content:restore",
    "purge": "synapse:content:purge",
    "download": "synapse:content:download",
    "readIconImage": "synapse:content:read-icon-image",
    "openDetailWindow": "synapse:content:open-detail-window",
    "resolveEditorInstallTarget": "synapse:content:resolve-editor-install-target",
    "installToEditor": "synapse:content:install-to-editor",
    "readEditorInstallFormValues": "synapse:content:read-editor-install-form-values",
  },
  "cli": {
    "detect": "synapse:cli:detect",
  },
  "config": {
    "get": "synapse:config:get",
    "update": "synapse:config:update",
    "exportBackup": "synapse:config:export-backup",
    "importBackup": "synapse:config:import-backup",
    "previewLegacyCcConfigImport": "synapse:config:preview-legacy-cc-config-import",
    "resetApp": "synapse:config:reset-app",
  },
  "identity": {
    "getLocalState": "synapse:identity:get-local-state",
    "adoptExistingUserId": "synapse:identity:adopt-existing-user-id",
    "generateNewId": "synapse:identity:generate-new-id",
  },
  "user-profile": {
    "getRepoState": "synapse:user-profile:get-repo-state",
    "listRepoProfiles": "synapse:user-profile:list-repo-profiles",
    "updateDisplayName": "synapse:user-profile:update-display-name",
  },
  "log": {
    "write": "synapse:log:write",
    "export": "synapse:log:export",
    "clear": "synapse:log:clear",
    "readAll": "synapse:log:read-all",
    "listFiles": "synapse:log:list-files",
    "readFiles": "synapse:log:read-files",
  },
  "editor-scan": {
    "scanAll": "synapse:editor-scan:scan-all",
    "readItemContent": "synapse:editor-scan:read-item-content",
    "listSkillFiles": "synapse:editor-scan:list-skill-files",
  },
  "editor": {
    "getGlobalDirectories": "synapse:editor:get-global-directories",
    "createDirectory": "synapse:editor:create-directory",
  },
  "shell": {
    "showItemInFolder": "synapse:shell:show-item-in-folder",
  },
  "repository": {
    "getStates": "synapse:repository:get-states",
    "checkInitializationPreview": "synapse:repository:check-initialization-preview",
    "createLocalRepository": "synapse:repository:create-local-repository",
    "getPendingPushes": "synapse:repository:get-pending-pushes",
    "initializeStructure": "synapse:repository:initialize-structure",
    "chooseDirectory": "synapse:repository:choose-directory",
    "validateDirectory": "synapse:repository:validate-directory",
    "sync": "synapse:repository:sync",
    "runMaintenance": "synapse:repository:run-maintenance",
    "flushPendingPushes": "synapse:repository:flush-pending-pushes",
  },
  "update": {
    "getState": "synapse:update:get-state",
    "checkForUpdates": "synapse:update:check-for-updates",
    "cancelDownload": "synapse:update:cancel-download",
    "installUpdate": "synapse:update:install-update",
  },
  "connectors": {
    "listDescriptors": "synapse:connectors:list-descriptors",
    "createDraft": "synapse:connectors:create-draft",
    "normalizeInbound": "synapse:connectors:normalize-inbound",
  },
  "agent-sessions": {
    "list": "synapse:agent-sessions:list",
    "getDetail": "synapse:agent-sessions:get-detail",
    "create": "synapse:agent-sessions:create",
    "switchSession": "synapse:agent-sessions:switch",
    "listCommands": "synapse:agent-sessions:list-commands",
    "executeCommand": "synapse:agent-sessions:execute-command",
    "send": "synapse:agent-sessions:send",
    "respondPermission": "synapse:agent-sessions:respond-permission",
  },
  "automation": {
    "listCron": "synapse:automation:list-cron",
    "createCron": "synapse:automation:create-cron",
    "updateCron": "synapse:automation:update-cron",
    "toggleCron": "synapse:automation:toggle-cron",
    "deleteCron": "synapse:automation:delete-cron",
  },
} as const satisfies IpcChannelMap

// Event channels (not in generated IPC_CHANNELS because they're events, not methods)
const EVENT_CHANNELS = {
  repository: {
    pendingPushesUpdated: "synapse:repository:pending-pushes-updated",
    progress: "synapse:repository:progress",
    updated: "synapse:repository:updated",
  },
  update: {
    stateChanged: "synapse:update:state-changed",
    openUpdatePage: "synapse:update:open-update-page",
  },
  dataStore: {
    changed: "synapse:data-store:changed",
  },
}

// Data store channels (not yet migrated to IpcModule)
const DATA_STORE_CHANNELS = {
  listTables: "synapse:data-store:list-tables",
  createTable: "synapse:data-store:create-table",
  dropTable: "synapse:data-store:drop-table",
  describeTable: "synapse:data-store:describe-table",
  addColumn: "synapse:data-store:add-column",
  updateColumnDescription: "synapse:data-store:update-column-description",
  updateColumnChoices: "synapse:data-store:update-column-choices",
  getColumnChoicesUsage: "synapse:data-store:get-column-choices-usage",
  insert: "synapse:data-store:insert",
  batchInsert: "synapse:data-store:batch-insert",
  query: "synapse:data-store:query",
  update: "synapse:data-store:update",
  delete: "synapse:data-store:delete",
  updateWhere: "synapse:data-store:update-where",
  deleteWhere: "synapse:data-store:delete-where",
  count: "synapse:data-store:count",
  renameTable: "synapse:data-store:rename-table",
  renameColumn: "synapse:data-store:rename-column",
  dropColumn: "synapse:data-store:drop-column",
  rawSQL: "synapse:data-store:raw-sql",
  getStatus: "synapse:data-store:get-status",
  exportDB: "synapse:data-store:export-db",
  importDB: "synapse:data-store:import-db",
  installCLI: "synapse:data-store:install-cli",
  getCliStatus: "synapse:data-store:get-cli-status",
  getCliDebugInfo: "synapse:data-store:get-cli-debug-info",
  getMcpHttpStatus: "synapse:data-store:get-mcp-http-status",
  getMcpStatus: "synapse:data-store:get-mcp-status",
  getMCPServers: "synapse:data-store:get-mcp-servers",
  openMCPSettings: "synapse:data-store:open-mcp-settings",
  registerMCP: "synapse:data-store:register-mcp",
} as const

// Helper to create invoke wrapper
const invoke = (channel: string) => (args?: unknown) => ipcRenderer.invoke(channel, args)

// Helper to create subscription
const subscribe = (channel: string) => (listener: (payload: unknown) => void) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return (): void => {
    ipcRenderer.removeListener(channel, wrapped)
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
    list: invoke(IPC_CHANNELS.content.list),
    getContent: invoke(IPC_CHANNELS.content.getContent),
    getDetail: invoke(IPC_CHANNELS.content.getDetail),
    getHistory: invoke(IPC_CHANNELS.content.getHistory),
    getHistoryVersion: invoke(IPC_CHANNELS.content.getHistoryVersion),
    create: invoke(IPC_CHANNELS.content.create),
    update: invoke(IPC_CHANNELS.content.update),
    deleteContent: invoke(IPC_CHANNELS.content.deleteContent),
    listDeleted: invoke(IPC_CHANNELS.content.listDeleted),
    restore: invoke(IPC_CHANNELS.content.restore),
    purge: invoke(IPC_CHANNELS.content.purge),
    download: invoke(IPC_CHANNELS.content.download),
    openDetailWindow: invoke(IPC_CHANNELS.content.openDetailWindow),
    getEditorAdapters: invoke(IPC_CHANNELS.content.getEditorAdapters),
    installToEditor: invoke(IPC_CHANNELS.content.installToEditor),
    readEditorInstallFormValues: invoke(IPC_CHANNELS.content.readEditorInstallFormValues),
    readIconImage: invoke(IPC_CHANNELS.content.readIconImage),
    resolveEditorInstallTarget: invoke(IPC_CHANNELS.content.resolveEditorInstallTarget),
  },
  cli: {
    detect: invoke(IPC_CHANNELS.cli.detect),
  },
  config: {
    exportBackup: invoke(IPC_CHANNELS.config.exportBackup),
    get: invoke(IPC_CHANNELS.config.get),
    importBackup: invoke(IPC_CHANNELS.config.importBackup),
    previewLegacyCcConfigImport: invoke(IPC_CHANNELS.config.previewLegacyCcConfigImport),
    resetApp: invoke(IPC_CHANNELS.config.resetApp),
    update: invoke(IPC_CHANNELS.config.update),
  },
  identity: {
    adoptExistingUserId: (userId, repoId) =>
      invoke(IPC_CHANNELS.identity.adoptExistingUserId)({ repoId, userId }),
    generateNewId: invoke(IPC_CHANNELS.identity.generateNewId),
    getLocalState: invoke(IPC_CHANNELS.identity.getLocalState),
  },
  userProfile: {
    getRepoState: (repoId) => invoke(IPC_CHANNELS["user-profile"].getRepoState)({ repoId }),
    listRepoProfiles: (repoId) => invoke(IPC_CHANNELS["user-profile"].listRepoProfiles)({ repoId }),
    updateDisplayName: (repoId, displayName) =>
      invoke(IPC_CHANNELS["user-profile"].updateDisplayName)({ displayName, repoId }),
  },
  log: {
    clear: invoke(IPC_CHANNELS.log.clear),
    export: invoke(IPC_CHANNELS.log.export),
    listFiles: invoke(IPC_CHANNELS.log.listFiles),
    readAll: invoke(IPC_CHANNELS.log.readAll),
    readFiles: (fileNames: string[]) => invoke(IPC_CHANNELS.log.readFiles)(fileNames),
    write: (payload) => {
      void invoke(IPC_CHANNELS.log.write)(payload)
    },
  },
  editor: {
    getGlobalDirectories: invoke(IPC_CHANNELS.editor.getGlobalDirectories),
    createDirectory: (dirPath: string) => invoke(IPC_CHANNELS.editor.createDirectory)({ dirPath }),
  },
  editorScan: {
    scanAll: invoke(IPC_CHANNELS["editor-scan"].scanAll),
    readItemContent: (filePath: string) =>
      invoke(IPC_CHANNELS["editor-scan"].readItemContent)({ filePath }),
    listSkillFiles: (dirPath: string) =>
      invoke(IPC_CHANNELS["editor-scan"].listSkillFiles)({ dirPath }),
  },
  shell: {
    showItemInFolder: (filePath: string) => {
      void invoke(IPC_CHANNELS.shell.showItemInFolder)({ fullPath: filePath })
    },
  },
  repository: {
    checkInitializationPreview: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.checkInitializationPreview)({ repositoryUuid }),
    createLocalRepository: (payload) =>
      invoke(IPC_CHANNELS.repository.createLocalRepository)(payload),
    chooseDirectory: invoke(IPC_CHANNELS.repository.chooseDirectory),
    flushPendingPushes: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.flushPendingPushes)({ repositoryUuid }),
    getPendingPushes: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.getPendingPushes)({ repositoryUuid }),
    getStates: invoke(IPC_CHANNELS.repository.getStates),
    initializeStructure: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.initializeStructure)({ repositoryUuid }),
    onPendingPushesUpdated: subscribe(EVENT_CHANNELS.repository.pendingPushesUpdated) as unknown as SynapseBridge["repository"]["onPendingPushesUpdated"],
    runMaintenance: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.runMaintenance)({ repositoryUuid }),
    sync: (repositoryUuid) => invoke(IPC_CHANNELS.repository.sync)({ repositoryUuid }),
    onProgress: subscribe(EVENT_CHANNELS.repository.progress) as unknown as SynapseBridge["repository"]["onProgress"],
    onUpdated: subscribe(EVENT_CHANNELS.repository.updated) as unknown as SynapseBridge["repository"]["onUpdated"],
    validateDirectory: (targetPath) =>
      invoke(IPC_CHANNELS.repository.validateDirectory)({ targetPath }),
  },
  updater: {
    cancelDownload: invoke(IPC_CHANNELS.update.cancelDownload),
    checkForUpdates: invoke(IPC_CHANNELS.update.checkForUpdates),
    getState: invoke(IPC_CHANNELS.update.getState),
    installUpdate: invoke(IPC_CHANNELS.update.installUpdate),
    onStateChanged: subscribe(EVENT_CHANNELS.update.stateChanged) as unknown as SynapseBridge["updater"]["onStateChanged"],
    onOpenUpdatePage: subscribe(EVENT_CHANNELS.update.openUpdatePage) as unknown as SynapseBridge["updater"]["onOpenUpdatePage"],
  },
  connectors: {
    listDescriptors: invoke(IPC_CHANNELS.connectors.listDescriptors),
    createDraft: (payload) => invoke(IPC_CHANNELS.connectors.createDraft)(payload),
    normalizeInbound: (payload) => invoke(IPC_CHANNELS.connectors.normalizeInbound)(payload),
  },
  agentSessions: {
    list: invoke(IPC_CHANNELS["agent-sessions"].list),
    getDetail: (payload) => invoke(IPC_CHANNELS["agent-sessions"].getDetail)(payload),
    create: (payload) => invoke(IPC_CHANNELS["agent-sessions"].create)(payload),
    switchSession: (payload) => invoke(IPC_CHANNELS["agent-sessions"].switchSession)(payload),
    listCommands: (payload) => invoke(IPC_CHANNELS["agent-sessions"].listCommands)(payload),
    executeCommand: (payload) => invoke(IPC_CHANNELS["agent-sessions"].executeCommand)(payload),
    send: (payload) => invoke(IPC_CHANNELS["agent-sessions"].send)(payload),
    respondPermission: (payload) => invoke(IPC_CHANNELS["agent-sessions"].respondPermission)(payload),
  },
  automation: {
    listCron: (payload) => invoke(IPC_CHANNELS.automation.listCron)(payload),
    createCron: (payload) => invoke(IPC_CHANNELS.automation.createCron)(payload),
    updateCron: (payload) => invoke(IPC_CHANNELS.automation.updateCron)(payload),
    toggleCron: (payload) => invoke(IPC_CHANNELS.automation.toggleCron)(payload),
    deleteCron: (payload) => invoke(IPC_CHANNELS.automation.deleteCron)(payload),
  },
  dataStore: {
    listTables: invoke(DATA_STORE_CHANNELS.listTables),
    createTable: (params) => invoke(DATA_STORE_CHANNELS.createTable)(params),
    dropTable: (name) => invoke(DATA_STORE_CHANNELS.dropTable)(name),
    describeTable: (name) => invoke(DATA_STORE_CHANNELS.describeTable)(name),
    addColumn: (params) => invoke(DATA_STORE_CHANNELS.addColumn)(params),
    updateColumnDescription: (params) =>
      invoke(DATA_STORE_CHANNELS.updateColumnDescription)(params),
    updateColumnChoices: (params) =>
      invoke(DATA_STORE_CHANNELS.updateColumnChoices)(params),
    getColumnChoicesUsage: (params) =>
      invoke(DATA_STORE_CHANNELS.getColumnChoicesUsage)(params),
    insert: (params) => invoke(DATA_STORE_CHANNELS.insert)(params),
    batchInsert: (params) => invoke(DATA_STORE_CHANNELS.batchInsert)(params),
    query: (params) => invoke(DATA_STORE_CHANNELS.query)(params),
    update: (params) => invoke(DATA_STORE_CHANNELS.update)(params),
    delete: (params) => invoke(DATA_STORE_CHANNELS.delete)(params),
    updateWhere: (params) => invoke(DATA_STORE_CHANNELS.updateWhere)(params),
    deleteWhere: (params) => invoke(DATA_STORE_CHANNELS.deleteWhere)(params),
    count: (params) => invoke(DATA_STORE_CHANNELS.count)(params),
    renameTable: (params) => invoke(DATA_STORE_CHANNELS.renameTable)(params),
    renameColumn: (params) => invoke(DATA_STORE_CHANNELS.renameColumn)(params),
    dropColumn: (params) => invoke(DATA_STORE_CHANNELS.dropColumn)(params),
    rawSQL: (params) => invoke(DATA_STORE_CHANNELS.rawSQL)(params),
    getStatus: invoke(DATA_STORE_CHANNELS.getStatus),
    exportDB: invoke(DATA_STORE_CHANNELS.exportDB),
    importDB: invoke(DATA_STORE_CHANNELS.importDB),
    installCLI: invoke(DATA_STORE_CHANNELS.installCLI),
    getCliStatus: invoke(DATA_STORE_CHANNELS.getCliStatus),
    getCliDebugInfo: invoke(DATA_STORE_CHANNELS.getCliDebugInfo),
    getMcpHttpStatus: invoke(DATA_STORE_CHANNELS.getMcpHttpStatus),
    getMcpStatus: invoke(DATA_STORE_CHANNELS.getMcpStatus),
    getMCPServers: invoke(DATA_STORE_CHANNELS.getMCPServers),
    openMCPSettings: (target) =>
      invoke(DATA_STORE_CHANNELS.openMCPSettings)(target),
    registerMCP: (target) => invoke(DATA_STORE_CHANNELS.registerMCP)(target),
    onChanged: subscribe(EVENT_CHANNELS.dataStore.changed) as unknown as SynapseBridge["dataStore"]["onChanged"],
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
