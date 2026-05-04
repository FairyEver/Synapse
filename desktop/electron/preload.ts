/**
 * Phase 0.3 — Minimal preload bridge.
 *
 * Creates a type-safe bridge for renderer-to-main communication.
 */

import { contextBridge, ipcRenderer } from "electron"
import type { SynapseBridge } from "../src/types/bridge"
import type { SynapseAgentDomainEvent } from "../src/types/agent"
import type { DatabaseChangeEvent } from "../src/types/database"
import type {
  SynapsePendingPushUpdatedEvent,
  SynapseRepositoryProgressEvent,
  SynapseRepositorySyncSnapshotUpdatedEvent,
  SynapseRepositoryUpdatedEvent,
} from "../src/types/repository"
import type { SynapseAppUpdateState } from "../src/types/update"
import type { IpcChannelMap } from "./generated/ipc-channels.generated"
import type { DomainEvent, EventDomain, Unsubscribe } from "./runtime/event-bus"

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
  "config": {
    "get": "synapse:config:get",
    "update": "synapse:config:update",
    "exportBackup": "synapse:config:export-backup",
    "importBackup": "synapse:config:import-backup",
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
    "prepareQuickPublishDraft": "synapse:editor-scan:prepare-quick-publish-draft",
    "trashItem": "synapse:editor-scan:trash-item",
  },
  "editor-copy": {
    "resolveTarget": "synapse:editor-copy:resolve-target",
    "copy": "synapse:editor-copy:copy",
  },
  "editor-install-status": {
    "resolveForContent": "synapse:editor-install-status:resolve-for-content",
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
    "getSyncSnapshots": "synapse:repository:get-sync-snapshots",
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
  "agent": {
    "status": "synapse:agent:status",
    "listSessions": "synapse:agent:list-sessions",
    "getTimeline": "synapse:agent:get-timeline",
    "createSession": "synapse:agent:create-session",
    "switchSession": "synapse:agent:switch-session",
    "deleteSession": "synapse:agent:delete-session",
    "send": "synapse:agent:send",
    "listPendingPermissions": "synapse:agent:list-pending-permissions",
    "respondPermission": "synapse:agent:respond-permission",
    "getProviders": "synapse:agent:get-providers",
    "getRuntimeStatus": "synapse:agent:get-runtime-status",
    "listCommands": "synapse:agent:list-commands",
    "openReference": "synapse:agent:open-reference",
    "event": "synapse:events:agent",
  },
  "connectors": {
    "feishuBeginSetup": "synapse:connectors:feishu:begin-setup",
    "feishuPollSetup": "synapse:connectors:feishu:poll-setup",
    "feishuSaveSetup": "synapse:connectors:feishu:save-setup",
    "feishuSaveManualCredentials": "synapse:connectors:feishu:save-manual-credentials",
    "feishuGetStatus": "synapse:connectors:feishu:get-status",
    "feishuStart": "synapse:connectors:feishu:start",
    "feishuStop": "synapse:connectors:feishu:stop",
    "feishuList": "synapse:connectors:feishu:list",
    "feishuGetWorkspaceConfig": "synapse:connectors:feishu:workspace-config:get",
    "feishuUpdateWorkspaceConfig": "synapse:connectors:feishu:workspace-config:update",
    "feishuListWorkspaceBindings": "synapse:connectors:feishu:workspace-bindings:list",
    "feishuRouteWorkspaceBinding": "synapse:connectors:feishu:workspace-bindings:route",
    "feishuUnbindWorkspaceBinding": "synapse:connectors:feishu:workspace-bindings:unbind",
  },
  "task-scheduler": {
    "listTasks": "synapse:task-scheduler:tasks:list",
    "getTask": "synapse:task-scheduler:tasks:get",
    "createTask": "synapse:task-scheduler:tasks:create",
    "updateTask": "synapse:task-scheduler:tasks:update",
    "deleteTask": "synapse:task-scheduler:tasks:delete",
    "setTaskEnabled": "synapse:task-scheduler:tasks:set-enabled",
    "runTask": "synapse:task-scheduler:tasks:run",
    "stopRun": "synapse:task-scheduler:runs:stop",
    "listRuns": "synapse:task-scheduler:runs:list",
  },
  "ops": {
    "diagnostics": "synapse:ops:diagnostics",
    "runDiagnostics": "synapse:ops:diagnostics:run",
    "exportDiagnosticsBundle": "synapse:ops:diagnostics:export-bundle",
    "ping": "synapse:ops:ping",
    "openLogDirectory": "synapse:ops:open-log-directory",
    "runAsGet": "synapse:ops:run-as:get",
    "runAsUpdate": "synapse:ops:run-as:update",
    "runAsPreflight": "synapse:ops:run-as:preflight",
    "runAsAuditProbe": "synapse:ops:run-as:audit-probe",
    "webhookStatus": "synapse:ops:webhook:status",
    "webhookUpdate": "synapse:ops:webhook:update",
    "webhookRuns": "synapse:ops:webhook:runs",
    "relayBindings": "synapse:ops:relay:bindings",
    "relayRuns": "synapse:ops:relay:runs",
    "relayUnbind": "synapse:ops:relay:unbind",
    "compressGet": "synapse:ops:compress:get",
    "compressUpdate": "synapse:ops:compress:update",
  },
  "license": {
    "getStatus": "synapse:license:get-status",
    "activate": "synapse:license:activate",
    "renew": "synapse:license:renew",
  },
  "token-usage": {
    "scan": "synapse:token-usage:scan",
    "getGraphResult": "synapse:token-usage:graph-result",
    "getModelReport": "synapse:token-usage:model-report",
    "getDailyReport": "synapse:token-usage:daily-report",
    "getDetectedAgents": "synapse:token-usage:detected-agents",
    "clearData": "synapse:token-usage:clear-data",
  },
} as const satisfies IpcChannelMap

// Event channels (not in generated IPC_CHANNELS because they're events, not methods)
const EVENT_CHANNELS = {
  update: {
    stateChanged: "synapse:update:state-changed",
    openUpdatePage: "synapse:update:open-update-page",
  },
  agent: {
    event: "synapse:events:agent",
  },
}

// Database channels (not yet migrated to IpcModule)
const DATABASE_CHANNELS = {
  databaseTableList: "synapse:database:table:list",
  databaseTableCreate: "synapse:database:table:create",
  databaseTableDelete: "synapse:database:table:delete",
  databaseTableDescribe: "synapse:database:table:describe",
  databaseTableUpdate: "synapse:database:table:update",
  databaseColumnCreate: "synapse:database:column:create",
  databaseColumnUpdate: "synapse:database:column:update",
  databaseChoiceUpdate: "synapse:database:choice:update",
  databaseChoiceUsageGet: "synapse:database:choice-usage:get",
  databaseRowCreate: "synapse:database:row:create",
  databaseRowsCreate: "synapse:database:rows:create",
  databaseRowList: "synapse:database:row:list",
  databaseRowUpdate: "synapse:database:row:update",
  databaseRowDelete: "synapse:database:row:delete",
  databaseRowsUpdate: "synapse:database:rows:update",
  databaseRowsDelete: "synapse:database:rows:delete",
  databaseRowCount: "synapse:database:row:count",
  databaseTableRename: "synapse:database:table:rename",
  databaseColumnRename: "synapse:database:column:rename",
  databaseColumnDelete: "synapse:database:column:delete",
  databaseSqlExecute: "synapse:database:sql:execute",
  databaseStatusGet: "synapse:database:status:get",
  databaseExport: "synapse:database:export",
  databaseImport: "synapse:database:import",
  databaseTableExport: "synapse:database:table:export",
  databaseTableImportInspect: "synapse:database:table-import:inspect",
  databaseTableImport: "synapse:database:table:import",
  databaseCliInstall: "synapse:database:cli:install",
  databaseCliStatusGet: "synapse:database:cli-status:get",
  databaseCliDebugInfoGet: "synapse:database:cli-debug-info:get",
  databaseMcpHttpStatusGet: "synapse:database:mcp-http-status:get",
  databaseMcpStatusGet: "synapse:database:mcp-status:get",
  databaseMcpServersGet: "synapse:database:mcp-servers:get",
  databaseMcpSettingsOpen: "synapse:database:mcp-settings:open",
  databaseMcpRegister: "synapse:database:mcp:register",
} as const

type RawSubscribe = (channel: string) => (listener: (payload: unknown) => void) => Unsubscribe

const channelForDomain = (domain: EventDomain): string => `synapse:events:${domain}`

function isDomainEvent(
  payload: unknown,
  domain: EventDomain,
  type: string,
): payload is DomainEvent {
  if (typeof payload !== "object" || payload === null) {
    return false
  }

  const event = payload as Partial<DomainEvent>

  return event.domain === domain && event.type === type && "payload" in event
}

function createDomainEventPayloadSubscription<TPayload>(
  subscribeToChannel: RawSubscribe,
  domain: EventDomain,
  type: string,
): (listener: (payload: TPayload) => void) => Unsubscribe {
  return (listener) =>
    subscribeToChannel(channelForDomain(domain))((event) => {
      if (isDomainEvent(event, domain, type)) {
        listener(event.payload as TPayload)
      }
    })
}

function createRawPayloadSubscription<TPayload>(
  subscribeToChannel: RawSubscribe,
  channel: string,
): (listener: (payload: TPayload) => void) => Unsubscribe {
  return (listener) =>
    subscribeToChannel(channel)((payload) => {
      listener(payload as TPayload)
    })
}

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
  config: {
    exportBackup: invoke(IPC_CHANNELS.config.exportBackup),
    get: invoke(IPC_CHANNELS.config.get),
    importBackup: invoke(IPC_CHANNELS.config.importBackup),
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
  license: {
    activate: (payload) => invoke(IPC_CHANNELS.license.activate)(payload),
    getStatus: invoke(IPC_CHANNELS.license.getStatus),
    renew: invoke(IPC_CHANNELS.license.renew),
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
    prepareQuickPublishDraft: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].prepareQuickPublishDraft)(request),
    trashItem: (request) =>
      invoke(IPC_CHANNELS["editor-scan"].trashItem)(request),
  },
  editorCopy: {
    resolveTarget: invoke(IPC_CHANNELS["editor-copy"].resolveTarget),
    copy: invoke(IPC_CHANNELS["editor-copy"].copy),
  },
  editorInstallStatus: {
    resolveForContent: invoke(IPC_CHANNELS["editor-install-status"].resolveForContent),
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
    getSyncSnapshots: invoke(IPC_CHANNELS.repository.getSyncSnapshots),
    getStates: invoke(IPC_CHANNELS.repository.getStates),
    initializeStructure: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.initializeStructure)({ repositoryUuid }),
    onPendingPushesUpdated: createDomainEventPayloadSubscription<SynapsePendingPushUpdatedEvent>(
      subscribe,
      "repository",
      "repository.pendingPushesUpdated",
    ),
    onSyncSnapshotUpdated: createDomainEventPayloadSubscription<SynapseRepositorySyncSnapshotUpdatedEvent>(
      subscribe,
      "repository",
      "repository.syncSnapshotUpdated",
    ),
    runMaintenance: (repositoryUuid) =>
      invoke(IPC_CHANNELS.repository.runMaintenance)({ repositoryUuid }),
    sync: (repositoryUuid) => invoke(IPC_CHANNELS.repository.sync)({ repositoryUuid }),
    onProgress: createDomainEventPayloadSubscription<SynapseRepositoryProgressEvent>(
      subscribe,
      "repository",
      "repository.progress",
    ),
    onUpdated: createDomainEventPayloadSubscription<SynapseRepositoryUpdatedEvent>(
      subscribe,
      "repository",
      "repository.updated",
    ),
    validateDirectory: (targetPath) =>
      invoke(IPC_CHANNELS.repository.validateDirectory)({ targetPath }),
  },
  updater: {
    cancelDownload: invoke(IPC_CHANNELS.update.cancelDownload),
    checkForUpdates: invoke(IPC_CHANNELS.update.checkForUpdates),
    getState: invoke(IPC_CHANNELS.update.getState),
    installUpdate: invoke(IPC_CHANNELS.update.installUpdate),
    onStateChanged: createRawPayloadSubscription<SynapseAppUpdateState>(
      subscribe,
      EVENT_CHANNELS.update.stateChanged,
    ),
    onOpenUpdatePage: createRawPayloadSubscription<void>(
      subscribe,
      EVENT_CHANNELS.update.openUpdatePage,
    ),
  },
  database: {
    databaseTableList: invoke(DATABASE_CHANNELS.databaseTableList),
    databaseTableCreate: (params) => invoke(DATABASE_CHANNELS.databaseTableCreate)(params),
    databaseTableDelete: (name) => invoke(DATABASE_CHANNELS.databaseTableDelete)(name),
    databaseTableDescribe: (name) => invoke(DATABASE_CHANNELS.databaseTableDescribe)(name),
    databaseTableUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseTableUpdate)(params),
    databaseColumnCreate: (params) => invoke(DATABASE_CHANNELS.databaseColumnCreate)(params),
    databaseColumnUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseColumnUpdate)(params),
    databaseChoiceUpdate: (params) =>
      invoke(DATABASE_CHANNELS.databaseChoiceUpdate)(params),
    databaseChoiceUsageGet: (params) =>
      invoke(DATABASE_CHANNELS.databaseChoiceUsageGet)(params),
    databaseRowCreate: (params) => invoke(DATABASE_CHANNELS.databaseRowCreate)(params),
    databaseRowsCreate: (params) => invoke(DATABASE_CHANNELS.databaseRowsCreate)(params),
    databaseRowList: (params) => invoke(DATABASE_CHANNELS.databaseRowList)(params),
    databaseRowUpdate: (params) => invoke(DATABASE_CHANNELS.databaseRowUpdate)(params),
    databaseRowDelete: (params) => invoke(DATABASE_CHANNELS.databaseRowDelete)(params),
    databaseRowsUpdate: (params) => invoke(DATABASE_CHANNELS.databaseRowsUpdate)(params),
    databaseRowsDelete: (params) => invoke(DATABASE_CHANNELS.databaseRowsDelete)(params),
    databaseRowCount: (params) => invoke(DATABASE_CHANNELS.databaseRowCount)(params),
    databaseTableRename: (params) => invoke(DATABASE_CHANNELS.databaseTableRename)(params),
    databaseColumnRename: (params) => invoke(DATABASE_CHANNELS.databaseColumnRename)(params),
    databaseColumnDelete: (params) => invoke(DATABASE_CHANNELS.databaseColumnDelete)(params),
    databaseSqlExecute: (params) => invoke(DATABASE_CHANNELS.databaseSqlExecute)(params),
    databaseStatusGet: invoke(DATABASE_CHANNELS.databaseStatusGet),
    databaseExport: invoke(DATABASE_CHANNELS.databaseExport),
    databaseImport: invoke(DATABASE_CHANNELS.databaseImport),
    databaseTableExport: (table) => invoke(DATABASE_CHANNELS.databaseTableExport)(table),
    databaseTableImportInspect: invoke(DATABASE_CHANNELS.databaseTableImportInspect),
    databaseTableImport: (sourcePath) => invoke(DATABASE_CHANNELS.databaseTableImport)(sourcePath),
    databaseCliInstall: invoke(DATABASE_CHANNELS.databaseCliInstall),
    databaseCliStatusGet: invoke(DATABASE_CHANNELS.databaseCliStatusGet),
    databaseCliDebugInfoGet: invoke(DATABASE_CHANNELS.databaseCliDebugInfoGet),
    databaseMcpHttpStatusGet: invoke(DATABASE_CHANNELS.databaseMcpHttpStatusGet),
    databaseMcpStatusGet: invoke(DATABASE_CHANNELS.databaseMcpStatusGet),
    databaseMcpServersGet: invoke(DATABASE_CHANNELS.databaseMcpServersGet),
    databaseMcpSettingsOpen: (target) =>
      invoke(DATABASE_CHANNELS.databaseMcpSettingsOpen)(target),
    databaseMcpRegister: (target) => invoke(DATABASE_CHANNELS.databaseMcpRegister)(target),
    onChanged: createDomainEventPayloadSubscription<DatabaseChangeEvent>(
      subscribe,
      "database",
      "database.changed",
    ),
  },
  taskScheduler: {
    listTasks: invoke(IPC_CHANNELS["task-scheduler"].listTasks),
    getTask: (id) => invoke(IPC_CHANNELS["task-scheduler"].getTask)({ taskId: id }),
    createTask: (input) => invoke(IPC_CHANNELS["task-scheduler"].createTask)(input),
    updateTask: (payload) => invoke(IPC_CHANNELS["task-scheduler"].updateTask)(payload),
    deleteTask: (id) => invoke(IPC_CHANNELS["task-scheduler"].deleteTask)({ taskId: id }),
    setTaskEnabled: (payload) =>
      invoke(IPC_CHANNELS["task-scheduler"].setTaskEnabled)({
        taskId: payload.id,
        enabled: payload.enabled,
      }),
    runTask: (id) => invoke(IPC_CHANNELS["task-scheduler"].runTask)({ taskId: id }),
    stopRun: (runId) => invoke(IPC_CHANNELS["task-scheduler"].stopRun)({ runId }),
    listRuns: (taskId, options) =>
      invoke(IPC_CHANNELS["task-scheduler"].listRuns)({ taskId, limit: options?.limit }),
  },
  agent: {
    status: (projectId) => invoke(IPC_CHANNELS.agent.status)({ projectId }),
    listSessions: (projectId) => invoke(IPC_CHANNELS.agent.listSessions)({ projectId }),
    getTimeline: (args) => invoke(IPC_CHANNELS.agent.getTimeline)(args),
    createSession: (args) => invoke(IPC_CHANNELS.agent.createSession)(args),
    switchSession: (args) => invoke(IPC_CHANNELS.agent.switchSession)(args),
    deleteSession: (args) => invoke(IPC_CHANNELS.agent.deleteSession)(args),
    send: (args) => invoke(IPC_CHANNELS.agent.send)(args),
    listPendingPermissions: (projectId) =>
      invoke(IPC_CHANNELS.agent.listPendingPermissions)({ projectId }),
    respondPermission: (args) => invoke(IPC_CHANNELS.agent.respondPermission)(args),
    getProviders: (projectId) => invoke(IPC_CHANNELS.agent.getProviders)({ projectId }),
    getRuntimeStatus: invoke(IPC_CHANNELS.agent.getRuntimeStatus),
    listCommands: (projectId) => invoke(IPC_CHANNELS.agent.listCommands)({ projectId }),
    openReference: (args) => invoke(IPC_CHANNELS.agent.openReference)(args),
    onEvent: createRawPayloadSubscription<SynapseAgentDomainEvent>(
      subscribe,
      EVENT_CHANNELS.agent.event,
    ),
  },
  connectors: {
    feishu: {
      beginSetup: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuBeginSetup)({ projectId }),
      pollSetup: (setupId) =>
        invoke(IPC_CHANNELS.connectors.feishuPollSetup)({ setupId }),
      saveSetup: (setupId) =>
        invoke(IPC_CHANNELS.connectors.feishuSaveSetup)({ setupId }),
      saveManualCredentials: (payload) =>
        invoke(IPC_CHANNELS.connectors.feishuSaveManualCredentials)(payload),
      getStatus: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuGetStatus)({ projectId }),
      start: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuStart)({ projectId }),
      stop: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuStop)({ projectId }),
      list: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuList)({ projectId }),
      getWorkspaceConfig: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuGetWorkspaceConfig)({ projectId }),
      updateWorkspaceConfig: (payload) =>
        invoke(IPC_CHANNELS.connectors.feishuUpdateWorkspaceConfig)(payload),
      listWorkspaceBindings: (projectId) =>
        invoke(IPC_CHANNELS.connectors.feishuListWorkspaceBindings)({ projectId }),
      routeWorkspaceBinding: (payload) =>
        invoke(IPC_CHANNELS.connectors.feishuRouteWorkspaceBinding)(payload),
      unbindWorkspaceBinding: (payload) =>
        invoke(IPC_CHANNELS.connectors.feishuUnbindWorkspaceBinding)(payload),
    },
  },
  ops: {
    diagnostics: (payload) => invoke(IPC_CHANNELS.ops.diagnostics)(payload ?? {}),
    runDiagnostics: (payload) => invoke(IPC_CHANNELS.ops.runDiagnostics)(payload ?? {}),
    exportDiagnosticsBundle: (payload) => invoke(IPC_CHANNELS.ops.exportDiagnosticsBundle)(payload),
    ping: invoke(IPC_CHANNELS.ops.ping),
    openLogDirectory: invoke(IPC_CHANNELS.ops.openLogDirectory),
    runAsGet: (projectId) => invoke(IPC_CHANNELS.ops.runAsGet)({ projectId }),
    runAsUpdate: (payload) => invoke(IPC_CHANNELS.ops.runAsUpdate)(payload),
    runAsPreflight: (projectId) => invoke(IPC_CHANNELS.ops.runAsPreflight)({ projectId }),
    runAsAuditProbe: (projectId) => invoke(IPC_CHANNELS.ops.runAsAuditProbe)({ projectId }),
    webhookStatus: invoke(IPC_CHANNELS.ops.webhookStatus),
    webhookUpdate: (payload) => invoke(IPC_CHANNELS.ops.webhookUpdate)(payload),
    webhookRuns: (payload) => invoke(IPC_CHANNELS.ops.webhookRuns)(payload),
    relayBindings: (payload) => invoke(IPC_CHANNELS.ops.relayBindings)(payload),
    relayRuns: (payload) => invoke(IPC_CHANNELS.ops.relayRuns)(payload),
    relayUnbind: (id) => invoke(IPC_CHANNELS.ops.relayUnbind)({ id }),
    compressGet: (projectId) => invoke(IPC_CHANNELS.ops.compressGet)({ projectId }),
    compressUpdate: (payload) => invoke(IPC_CHANNELS.ops.compressUpdate)(payload),
  },
  tokenUsage: {
    scan: invoke(IPC_CHANNELS["token-usage"].scan),
    getGraphResult: (options?: { since?: string; until?: string }) =>
      invoke(IPC_CHANNELS["token-usage"].getGraphResult)(options),
    getModelReport: invoke(IPC_CHANNELS["token-usage"].getModelReport),
    getDailyReport: invoke(IPC_CHANNELS["token-usage"].getDailyReport),
    getDetectedAgents: invoke(IPC_CHANNELS["token-usage"].getDetectedAgents),
    clearData: invoke(IPC_CHANNELS["token-usage"].clearData),
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
