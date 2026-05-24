/**
 * Phase 0.3 — Minimal preload bridge.
 *
 * Creates a type-safe bridge for renderer-to-main communication.
 */

import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { SynapseBridge } from "../src/types/bridge"
import type { SynapseAgentDomainEvent } from "../src/types/agent"
import type { SynapseContentChangedEvent } from "../src/types/content"
import type { DatabaseChangeEvent } from "../src/types/database"
import type { InstallStatusChangedEvent } from "../src/types/install-status"
import type {
  SynapsePendingPushUpdatedEvent,
  SynapseRepositoryProgressEvent,
  SynapseRepositorySyncSnapshotUpdatedEvent,
  SynapseRepositoryUpdatedEvent,
} from "../src/types/repository"
import type { SynapseAppUpdateState } from "../src/types/update"
import type { WorkflowEvent } from "../src/types/workflow"
import type { IpcChannelMap } from "./generated/ipc-channels.generated"
import type { DomainEvent, EventDomain, Unsubscribe } from "./runtime/event-bus"

const IPC_CHANNELS = {
  "content": {
    "list": "synapse:content:list",
    "getContent": "synapse:content:get-content",
    "getDetail": "synapse:content:get-detail",
    "getAttachmentFile": "synapse:content:get-attachment-file",
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
    "openCreateWindow": "synapse:content:open-create-window",
    "openEditWindow": "synapse:content:open-edit-window",
    "readEditorInitPayload": "synapse:content:read-editor-init-payload",
    "resolveEditorInstallTarget": "synapse:content:resolve-editor-install-target",
    "installToEditor": "synapse:content:install-to-editor",
    "readEditorInstallFormValues": "synapse:content:read-editor-install-form-values",
    "getIconPromptTemplate": "synapse:content:get-icon-prompt-template",
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
  "install-status": {
    "getAll": "synapse:install-status:get-all",
    "uninstall": "synapse:install-status:uninstall",
  },
  "knowledge-base": {
    "inspect": "synapse:knowledge-base:inspect",
    "initialize": "synapse:knowledge-base:initialize",
    "createManaged": "synapse:knowledge-base:create-managed",
    "listSources": "synapse:knowledge-base:list-sources",
    "uploadSources": "synapse:knowledge-base:upload-sources",
    "addUrlSource": "synapse:knowledge-base:add-url-source",
    "selectAndUploadSources": "synapse:knowledge-base:select-and-upload-sources",
    "openSourceManager": "synapse:knowledge-base:open-source-manager",
    "openRawDirectory": "synapse:knowledge-base:open-raw-directory",
  },
  "editor": {
    "getGlobalDirectories": "synapse:editor:get-global-directories",
    "createDirectory": "synapse:editor:create-directory",
  },
  "shell": {
    "openExternal": "synapse:shell:open-external",
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
    "listAllSessions": "synapse:agent:list-all-sessions",
    "getTimeline": "synapse:agent:get-timeline",
    "createSession": "synapse:agent:create-session",
    "switchSession": "synapse:agent:switch-session",
    "deleteSession": "synapse:agent:delete-session",
    "renameSession": "synapse:agent:rename-session",
    "send": "synapse:agent:send",
    "listPendingPermissions": "synapse:agent:list-pending-permissions",
    "respondPermission": "synapse:agent:respond-permission",
    "setPermissionMode": "synapse:agent:set-permission-mode",
    "cancelTurn": "synapse:agent:cancel-turn",
    "forceKillTurn": "synapse:agent:force-kill-turn",
    "getProviders": "synapse:agent:get-providers",
    "listProviders": "synapse:agent:list-providers",
    "listProviderPresets": "synapse:agent:list-provider-presets",
    "createProvider": "synapse:agent:create-provider",
    "createProviderFromPreset": "synapse:agent:create-provider-from-preset",
    "previewCcSwitchClaudeProviders": "synapse:agent:preview-cc-switch-claude-providers",
    "importCcSwitchClaudeProviders": "synapse:agent:import-cc-switch-claude-providers",
    "chooseCcSwitchClaudeImportSource": "synapse:agent:choose-cc-switch-claude-import-source",
    "updateProvider": "synapse:agent:update-provider",
    "archiveProvider": "synapse:agent:archive-provider",
    "deleteProvider": "synapse:agent:delete-provider",
    "listAllProviders": "synapse:agent:list-all-providers",
    "scanProviderReferences": "synapse:agent:scan-provider-references",
    "migrateProviderReferences": "synapse:agent:migrate-provider-references",
    "setActiveProvider": "synapse:agent:set-active-provider",
    "getRuntimeStatus": "synapse:agent:get-runtime-status",
    "listCommands": "synapse:agent:list-commands",
    "openReference": "synapse:agent:open-reference",
    "getAvailableAgents": "synapse:agent:get-available-agents",
    "event": "synapse:events:agent",
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
    "exportTasksToFile": "synapse:task-scheduler:tasks:export-to-file",
    "importTasksFromFile": "synapse:task-scheduler:tasks:import-from-file",
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
  "workflow": {
    "exportPackageData": "synapse:workflow:export-package-data",
    "inspectImportPackageData": "synapse:workflow:inspect-import-package-data",
    "importPackageData": "synapse:workflow:import-package-data",
    "list": "synapse:workflow:list",
    "get": "synapse:workflow:get",
    "create": "synapse:workflow:create",
    "save": "synapse:workflow:save",
    "delete": "synapse:workflow:delete",
    "validate": "synapse:workflow:validate",
    "run": "synapse:workflow:run",
    "runDefinition": "synapse:workflow:run-definition",
    "rerun": "synapse:workflow:rerun",
    "openRunner": "synapse:workflow:open-runner",
    "cancel": "synapse:workflow:cancel",
    "runHistory": "synapse:workflow:run-history",
    "runStatus": "synapse:workflow:run-status",
    "openEditor": "synapse:workflow:open-editor",
    "editorState": "synapse:workflow:editor-state",
    "checkCanSync": "synapse:workflow:check-can-sync",
    "exportPackage": "synapse:workflow:export-package",
    "inspectImportPackage": "synapse:workflow:inspect-import-package",
    "importPackage": "synapse:workflow:import-package",
    "event": "synapse:workflow:event",
  },
  "usage-analysis": {
    "ccRefresh": "synapse:usage-analysis:cc:refresh",
    "ccOverview": "synapse:usage-analysis:cc:overview",
    "ccTime": "synapse:usage-analysis:cc:time",
    "ccModels": "synapse:usage-analysis:cc:models",
    "ccProjects": "synapse:usage-analysis:cc:projects",
    "ccTools": "synapse:usage-analysis:cc:tools",
    "ccDetails": "synapse:usage-analysis:cc:details",
    "codexRefresh": "synapse:usage-analysis:codex:refresh",
    "codexOverview": "synapse:usage-analysis:codex:overview",
    "codexTime": "synapse:usage-analysis:codex:time",
    "codexModels": "synapse:usage-analysis:codex:models",
    "codexProjects": "synapse:usage-analysis:codex:projects",
    "codexTools": "synapse:usage-analysis:codex:tools",
    "codexDetails": "synapse:usage-analysis:codex:details",
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
  workflow: {
    event: "synapse:workflow:event",
  },
  installStatus: {
    changed: "synapse:events:install-status",
  },
  diagnostics: {
    ping: "synapse:diagnostics:ping",
    pong: "synapse:diagnostics:pong",
  },
}

// HTTP test channels (not yet migrated to IpcModule)
const HTTP_CHANNELS = {
  testRequest: "synapse:http:test-request",
} as const

// Database channels (not yet migrated to IpcModule)
const DATABASE_CHANNELS = {
  databaseTableList: "synapse:database:table:list",
  databaseTableCreate: "synapse:database:table:create",
  databaseTableDelete: "synapse:database:table:delete",
  databaseTableDescribe: "synapse:database:table:describe",
  databaseOverviewGet: "synapse:database:overview:get",
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
  databaseFolderList: "synapse:database:folder:list",
  databaseFolderCreate: "synapse:database:folder:create",
  databaseFolderRename: "synapse:database:folder:rename",
  databaseFolderDelete: "synapse:database:folder:delete",
  databaseFolderMoveTable: "synapse:database:folder:move-table",
  databaseFolderReorder: "synapse:database:folder:reorder",
  databaseFolderReorderFolders: "synapse:database:folder:reorder-folders",
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

const SENSITIVE_IPC_FIELD_PATTERN =
  /(password|token|secret|credential|api[-_]?key|app[-_]?secret|private[-_ ]?key|cookie|authorization)/i
const SENSITIVE_ERROR_VALUE_PATTERN =
  /\b(secret|token|api[-_]?key|authorization|cookie|password|credential)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const SECRET_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\\\s"')]+\\)+[^\\\s"'),;]+/g
const POSIX_PATH_PATTERN = /(^|[\s("'])\/(?:[^/\s"')]+\/)+[^/\s"'),;]+/g

function sanitizeIpcPayload(fieldName: string, value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (SENSITIVE_IPC_FIELD_PATTERN.test(fieldName)) return "[redacted]"
    return value.length > 300 ? `${value.slice(0, 120)}...[truncated ${value.length} chars]` : value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeIpcPayload(fieldName, item, depth + 1))
  }
  if (typeof value === "object") {
    if (depth >= 3) return "[object]"
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeIpcPayload(key, item, depth + 1),
      ]),
    )
  }
  return String(value)
}

function describeIpcError(error: unknown): string {
  return sanitizeIpcErrorMessage(error instanceof Error ? error.message : String(error))
}

function sanitizeIpcErrorMessage(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted]")
    .replace(SENSITIVE_ERROR_VALUE_PATTERN, "$1=[redacted]")
    .replace(SECRET_KEY_PATTERN, "[key]")
    .replace(WINDOWS_PATH_PATTERN, "[path]")
    .replace(POSIX_PATH_PATTERN, "$1[path]")
    .trim()
}

function writeRendererIpcFailureLog(channel: string, args: unknown, error: unknown, durationMs: number): void {
  void ipcRenderer.invoke(IPC_CHANNELS.log.write, {
    level: "error",
    category: "renderer.ipc",
    message: "IPC invoke failed.",
    details: {
      channel,
      durationMs,
      error: describeIpcError(error),
      request: sanitizeIpcPayload("request", args),
    },
  }).catch(() => undefined)
}

// Helper to create invoke wrapper
const invoke = (channel: string) => async (args?: unknown) => {
  const startedAt = performance.now()
  try {
    return await ipcRenderer.invoke(channel, args)
  } catch (error) {
    if (channel !== IPC_CHANNELS.log.write) {
      writeRendererIpcFailureLog(channel, args, error, Math.round(performance.now() - startedAt))
    }
    throw error
  }
}

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
  isPackaged: !process.env.VITE_DEV_SERVER_URL,
  content: {
    list: invoke(IPC_CHANNELS.content.list),
    getContent: invoke(IPC_CHANNELS.content.getContent),
    getDetail: invoke(IPC_CHANNELS.content.getDetail),
    getAttachmentFile: invoke(IPC_CHANNELS.content.getAttachmentFile),
    create: invoke(IPC_CHANNELS.content.create),
    update: invoke(IPC_CHANNELS.content.update),
    deleteContent: invoke(IPC_CHANNELS.content.deleteContent),
    onChanged: createDomainEventPayloadSubscription<SynapseContentChangedEvent>(
      subscribe,
      "content",
      "content.changed",
    ),
    listDeleted: invoke(IPC_CHANNELS.content.listDeleted),
    restore: invoke(IPC_CHANNELS.content.restore),
    purge: invoke(IPC_CHANNELS.content.purge),
    download: invoke(IPC_CHANNELS.content.download),
    openDetailWindow: invoke(IPC_CHANNELS.content.openDetailWindow),
    openCreateWindow: invoke(IPC_CHANNELS.content.openCreateWindow),
    openEditWindow: invoke(IPC_CHANNELS.content.openEditWindow),
    readEditorInitPayload: invoke(IPC_CHANNELS.content.readEditorInitPayload),
    getEditorAdapters: invoke(IPC_CHANNELS.content.getEditorAdapters),
    installToEditor: invoke(IPC_CHANNELS.content.installToEditor),
    readEditorInstallFormValues: invoke(IPC_CHANNELS.content.readEditorInstallFormValues),
    getIconPromptTemplate: invoke(IPC_CHANNELS.content.getIconPromptTemplate),
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
    write: (payload) => invoke(IPC_CHANNELS.log.write)(payload),
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
  installStatus: {
    getAll: invoke(IPC_CHANNELS["install-status"].getAll),
    uninstall: (payload: { contentId: string; editorId: string }) =>
      invoke(IPC_CHANNELS["install-status"].uninstall)(payload),
    onChanged: createDomainEventPayloadSubscription<InstallStatusChangedEvent>(
      subscribe,
      "install-status",
      "install-status.changed",
    ),
  },
  knowledgeBase: {
    inspect: (projectPath: string) =>
      invoke(IPC_CHANNELS["knowledge-base"].inspect)({ projectPath }),
    initialize: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].initialize)(payload),
    createManaged: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].createManaged)(payload),
    listSources: (projectId: string) =>
      invoke(IPC_CHANNELS["knowledge-base"].listSources)({ projectId }),
    uploadSources: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].uploadSources)(payload),
    addUrlSource: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].addUrlSource)(payload),
    selectAndUploadSources: (projectId: string) =>
      invoke(IPC_CHANNELS["knowledge-base"].selectAndUploadSources)({ projectId }),
    openSourceManager: (payload) =>
      invoke(IPC_CHANNELS["knowledge-base"].openSourceManager)(payload),
    filePathForDroppedFile: (file: File) => webUtils.getPathForFile(file) || null,
    openRawDirectory: (projectPath: string) =>
      invoke(IPC_CHANNELS["knowledge-base"].openRawDirectory)({ projectPath }),
  },
  shell: {
    openExternal: (url: string) => {
      return invoke(IPC_CHANNELS.shell.openExternal)({ url })
    },
    showItemInFolder: (filePath: string) => {
      return invoke(IPC_CHANNELS.shell.showItemInFolder)({ fullPath: filePath })
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
    initializeStructure: (repositoryUuid, options) =>
      invoke(IPC_CHANNELS.repository.initializeStructure)({ options, repositoryUuid }),
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
    databaseOverviewGet: invoke(DATABASE_CHANNELS.databaseOverviewGet),
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
    databaseFolderList: invoke(DATABASE_CHANNELS.databaseFolderList),
    databaseFolderCreate: (params) => invoke(DATABASE_CHANNELS.databaseFolderCreate)(params),
    databaseFolderRename: (params) => invoke(DATABASE_CHANNELS.databaseFolderRename)(params),
    databaseFolderDelete: (params) => invoke(DATABASE_CHANNELS.databaseFolderDelete)(params),
    databaseFolderMoveTable: (params) => invoke(DATABASE_CHANNELS.databaseFolderMoveTable)(params),
    databaseFolderReorder: (params) => invoke(DATABASE_CHANNELS.databaseFolderReorder)(params),
    databaseFolderReorderFolders: (params) => invoke(DATABASE_CHANNELS.databaseFolderReorderFolders)(params),
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
    exportTasksToFile: (json) => invoke(IPC_CHANNELS["task-scheduler"].exportTasksToFile)({ json }),
    importTasksFromFile: () => invoke(IPC_CHANNELS["task-scheduler"].importTasksFromFile)(),
  },
  agent: {
    status: (projectId) => invoke(IPC_CHANNELS.agent.status)({ projectId }),
    listSessions: (projectId) => invoke(IPC_CHANNELS.agent.listSessions)({ projectId }),
    listAllSessions: () => invoke(IPC_CHANNELS.agent.listAllSessions)({}),
    getTimeline: (args) => invoke(IPC_CHANNELS.agent.getTimeline)(args),
    createSession: (args) => invoke(IPC_CHANNELS.agent.createSession)(args),
    switchSession: (args) => invoke(IPC_CHANNELS.agent.switchSession)(args),
    deleteSession: (args) => invoke(IPC_CHANNELS.agent.deleteSession)(args),
    renameSession: (args) => invoke(IPC_CHANNELS.agent.renameSession)(args),
    send: (args) => invoke(IPC_CHANNELS.agent.send)(args),
    listPendingPermissions: (projectId) =>
      invoke(IPC_CHANNELS.agent.listPendingPermissions)({ projectId }),
    respondPermission: (args) => invoke(IPC_CHANNELS.agent.respondPermission)(args),
    setPermissionMode: (args) => invoke(IPC_CHANNELS.agent.setPermissionMode)(args),
    cancelTurn: (args) => invoke(IPC_CHANNELS.agent.cancelTurn)(args),
    forceKillTurn: (args) => invoke(IPC_CHANNELS.agent.forceKillTurn)(args),
    getProviders: () => invoke(IPC_CHANNELS.agent.getProviders)({}),
    listProviders: () => invoke(IPC_CHANNELS.agent.listProviders)({}),
    listProviderPresets: () => invoke(IPC_CHANNELS.agent.listProviderPresets)({}),
    createProvider: (args) => invoke(IPC_CHANNELS.agent.createProvider)(args),
    createProviderFromPreset: (args) => invoke(IPC_CHANNELS.agent.createProviderFromPreset)(args),
    previewCcSwitchClaudeProviders: (args) =>
      invoke(IPC_CHANNELS.agent.previewCcSwitchClaudeProviders)(args ?? {}),
    importCcSwitchClaudeProviders: (args) =>
      invoke(IPC_CHANNELS.agent.importCcSwitchClaudeProviders)(args),
    chooseCcSwitchClaudeImportSource: () =>
      invoke(IPC_CHANNELS.agent.chooseCcSwitchClaudeImportSource)({}),
    updateProvider: (args) => invoke(IPC_CHANNELS.agent.updateProvider)(args),
    archiveProvider: (args) => invoke(IPC_CHANNELS.agent.archiveProvider)(args),
    deleteProvider: (args) => invoke(IPC_CHANNELS.agent.deleteProvider)(args),
    listAllProviders: () => invoke(IPC_CHANNELS.agent.listAllProviders)({}),
    scanProviderReferences: (args) => invoke(IPC_CHANNELS.agent.scanProviderReferences)(args),
    migrateProviderReferences: (args) => invoke(IPC_CHANNELS.agent.migrateProviderReferences)(args),
    setActiveProvider: (args) => invoke(IPC_CHANNELS.agent.setActiveProvider)(args),
    getRuntimeStatus: invoke(IPC_CHANNELS.agent.getRuntimeStatus),
    listCommands: (projectId) => invoke(IPC_CHANNELS.agent.listCommands)({ projectId }),
    openReference: (args) => invoke(IPC_CHANNELS.agent.openReference)(args),
    getAvailableAgents: () => invoke(IPC_CHANNELS.agent.getAvailableAgents)({}),
    onEvent: createRawPayloadSubscription<SynapseAgentDomainEvent>(
      subscribe,
      EVENT_CHANNELS.agent.event,
    ),
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
  workflow: {
    list: invoke(IPC_CHANNELS.workflow.list),
    get: (id: string) => invoke(IPC_CHANNELS.workflow.get)({ id }),
    create: () => invoke(IPC_CHANNELS.workflow.create)(),
    save: (def) => invoke(IPC_CHANNELS.workflow.save)(def),
    delete: (id: string) => invoke(IPC_CHANNELS.workflow.delete)({ id }),
    validate: (def) => invoke(IPC_CHANNELS.workflow.validate)(def),
    run: (id: string, params: Record<string, unknown>) => invoke(IPC_CHANNELS.workflow.run)({ id, params }),
    runDefinition: (def: unknown, params: Record<string, unknown>, force?: boolean) =>
      invoke(IPC_CHANNELS.workflow.runDefinition)({ definition: def, params, force }),
    rerun: (previousRunId: string, params: Record<string, unknown>, force?: boolean) =>
      invoke(IPC_CHANNELS.workflow.rerun)({ previousRunId, params, force }),
    openRunner: (workflowId: string, runId: string) =>
      invoke(IPC_CHANNELS.workflow.openRunner)({ workflowId, runId }),
    cancel: (runId: string) => invoke(IPC_CHANNELS.workflow.cancel)({ runId }),
    runHistory: (workflowId: string) => invoke(IPC_CHANNELS.workflow.runHistory)({ workflowId }),
    runStatus: (runId: string) => invoke(IPC_CHANNELS.workflow.runStatus)({ runId }),
    openEditor: (id: string, runId?: string) => invoke(IPC_CHANNELS.workflow.openEditor)({ id, runId }),
    editorState: invoke(IPC_CHANNELS.workflow.editorState),
    checkCanSync: invoke(IPC_CHANNELS.workflow.checkCanSync),
    exportPackage: (workflowId: string, workflowName?: string) =>
      invoke(IPC_CHANNELS.workflow.exportPackage)({ workflowId, workflowName }),
    inspectImportPackage: () => invoke(IPC_CHANNELS.workflow.inspectImportPackage)(),
    importPackage: (packagePath: string, mappings) =>
      invoke(IPC_CHANNELS.workflow.importPackage)({ packagePath, mappings }),
    onEvent: (listener) =>
      subscribe("synapse:events:workflow")((domainEvent) => {
        listener((domainEvent as DomainEvent).payload as WorkflowEvent)
      }),
    onDefinitionUpdated: createDomainEventPayloadSubscription<{ workflowId: string; source: string; versionHash: string }>(
      subscribe,
      "workflow",
      "workflow:definition-updated",
    ),
    onRunnerSwitchRun: createRawPayloadSubscription<{ runId: string }>(
      subscribe,
      "synapse:workflow:runner-switch-run",
    ),
    onEditorRefocus: createRawPayloadSubscription<{ runId?: string }>(
      subscribe,
      "synapse:workflow:editor-refocus",
    ),
  },
  usageAnalysis: {
    cc: {
      refresh: invoke(IPC_CHANNELS["usage-analysis"].ccRefresh),
      getOverview: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccOverview)(range),
      getTime: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccTime)(range),
      getModels: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccModels)(range),
      getProjects: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccProjects)(range),
      getTools: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccTools)(range),
      getDetails: (range) => invoke(IPC_CHANNELS["usage-analysis"].ccDetails)(range),
    },
    codex: {
      refresh: invoke(IPC_CHANNELS["usage-analysis"].codexRefresh),
      getOverview: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexOverview)(range),
      getTime: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexTime)(range),
      getModels: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexModels)(range),
      getProjects: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexProjects)(range),
      getTools: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexTools)(range),
      getDetails: (range) => invoke(IPC_CHANNELS["usage-analysis"].codexDetails)(range),
    },
  },
  http: {
    testRequest: invoke(HTTP_CHANNELS.testRequest),
  },
  diagnostics: {
    onPing: (listener: () => void) => {
      const wrapped = () => listener()
      ipcRenderer.on(EVENT_CHANNELS.diagnostics.ping, wrapped)
      return () => { ipcRenderer.removeListener(EVENT_CHANNELS.diagnostics.ping, wrapped) }
    },
    pong: () => {
      ipcRenderer.send(EVENT_CHANNELS.diagnostics.pong)
    },
  },
}

contextBridge.exposeInMainWorld("synapse", synapseBridge)
