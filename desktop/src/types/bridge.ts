import type {
  DatabaseChangeEvent,
  DatabaseCliDebugInfo,
  DatabaseCliStatus,
  DatabaseFolder,
  DatabaseMcpHttpStatus,
  DatabaseMcpServerInfo,
  DatabaseMcpStatus,
  DatabaseMcpTarget,
  Column,
  DatabaseQueryParams,
  DatabaseQueryResult,
  DatabaseStatus,
  DatabaseTableImportInspection,
  DatabaseTableInfo,
  DatabaseTableSchema,
  DatabaseWhereClause,
} from "./database"
import type {
  SynapseAgentCancelTurnResult,
  SynapseAgentDomainEvent,
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentRuntimeStatus,
  SynapseAgentSendResult,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineResult,
} from "./agent"
import type {
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "./backup"
import type { SynapseConfig, SynapseConfigPatch } from "./config"
import type {
  SynapseFeishuConnectorRuntimeStatus,
  SynapseFeishuConnectorSummary,
  SynapseFeishuManualCredentialsPayload,
  SynapseFeishuSetupBeginResult,
  SynapseFeishuSetupPollResult,
  SynapseFeishuWorkspaceBinding,
  SynapseFeishuWorkspaceBindingsSummary,
  SynapseFeishuWorkspaceConfig,
  SynapseFeishuWorkspaceConfigPayload,
  SynapseFeishuWorkspaceRoutePayload,
  SynapseFeishuWorkspaceUnbindPayload,
} from "./connectors"
import type {
  SynapseContentDownloadResult,
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseContentMeta,
  SynapseCreateContentRequest,
  SynapseDeleteContentPayload,
  SynapseContentMutationResult,
  SynapseOpenContentWindowPayload,
  SynapseContentType,
  SynapsePurgeContentPayload,
  SynapseRestoreContentPayload,
  SynapseTextContentFile,
  SynapseUpdateContentRequest,
} from "./content"
import type {
  SynapseLocalIdentityState,
  SynapseRepoProfileState,
  SynapseUserProfile,
} from "./identity"
import type {
  SynapseEditorAdapterSummary,
  SynapseContentInstallResult,
  SynapseEditorGlobalDirectory,
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseReadEditorInstallFormValuesPayload,
  SynapseReadEditorInstallFormValuesResult,
  SynapseResolveEditorTargetPayload,
} from "./editor"
import type {
  SynapseCopyToEditorPayload,
  SynapseEditorCopyResult,
  SynapseResolveEditorCopyTargetPayload,
} from "./editor-copy"
import type {
  SynapseEditorInstallStatusResult,
  SynapseResolveEditorInstallStatusPayload,
} from "./editor-install-status"
import type {
  EditorScanQuickPublishDraft,
  EditorScanQuickPublishRequest,
  EditorScanResult,
  EditorScanSkillFileEntry,
  EditorScanTrashRequest,
  EditorScanTrashResult,
} from "./editor-scan"
import type { InstallStatusChangedEvent, InstallStatusMap } from "./install-status"
import type {
  SynapseLogClearResult,
  SynapseLogExportResult,
  SynapseLogFileInfo,
  SynapseRendererLogPayload,
} from "./log"
import type {
  SynapseLicenseActivationRequest,
  SynapseLicenseStatus,
} from "./license"
import type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsReport,
} from "./diagnostics"
import type {
  SynapseCreateLocalRepositoryPayload,
  SynapseCreateLocalRepositoryResult,
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationResult,
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationResult,
  SynapsePendingPushState,
  SynapsePendingPushUpdatedEvent,
  SynapseRepositoryProgressEvent,
  SynapseRepositorySyncSnapshot,
  SynapseRepositorySyncSnapshotUpdatedEvent,
  SynapseRepositoryUpdatedEvent,
  SynapseRepositoryValidationResult,
} from "./repository"
import type { SynapseAppUpdateState } from "./update"
import type {
  ScheduledTask,
  ScheduledTaskCreateInput,
  ScheduledTaskRun,
  ScheduledTaskUpdateInput,
} from "./task-scheduler"
import type { WorkflowDefinition, WorkflowMeta, ValidationError, ValidationResult, WorkflowRunSnapshot, WorkflowEvent } from "./workflow"

export type SynapseOpsDiagnostics = {
  appVersion: string
  singleInstanceLocked: boolean
  logPath: string
  windowsCompatibility?: {
    platform: string
    arch: string
    release: string
    runningOnWindows: boolean
    env: {
      pathKey?: string
      hasPath: boolean
      pathEntryCount: number
      hasPathext: boolean
      hasComSpec: boolean
      hasSystemRoot: boolean
      hasWindir: boolean
      hasUserProfile: boolean
      hasAppData: boolean
      hasLocalAppData: boolean
      missingRequiredKeys: string[]
    }
    paths: {
      appPath?: string
      userDataPath?: string
      tempPath?: string
      downloadsPath?: string
      logPath?: string
      userDataInsideAppPath: boolean
      logInsideAppPath: boolean
      userDataHasSpace: boolean
      userDataHasNonAscii: boolean
      logPathHasSpace: boolean
      logPathHasNonAscii: boolean
    }
  }
  sideChannel?: {
    enabled: boolean
    bindAddress?: string
    port?: number
    sendPath: string
    relaySendPath: string
  }
  webhook?: {
    enabled: boolean
    bindAddress: string
    path: string
    preferredPort?: number
    assignedPort?: number
    maxBodyBytes: number
    rateLimitPerMinute: number
    serviceRestartRequired?: boolean
    lastError?: string
  }
  relay?: {
    bindingCount: number
    recentRunCount: number
  }
  agent?: {
    projectId: string
    agentType: string
    liveSessions: number
    busySessions: number
    queuedTurns: number
    pendingPermissions: number
  }
  feishu?: {
    projectId: string
    configured: boolean
    running: boolean
  }
}

export type SynapseOpsPingResult = {
  ok: true
  receivedAt: string
}

export type SynapseRunAsConfig = Record<string, unknown>
export type SynapseRunAsCheckResult = Record<string, unknown>
export type SynapseWebhookStatus = NonNullable<SynapseOpsDiagnostics["webhook"]>
export type SynapseOpsRecord = Record<string, unknown>

export type SynapseBridge = {
  platform: string
  versions: {
    chrome: string
    electron: string
    node: string
  }
  isPackaged: boolean
  content: {
    list: <T extends SynapseContentType>(
      args: { contentType: T },
    ) => Promise<SynapseContentMeta<T>[]>
    getContent: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<SynapseTextContentFile>
    getDetail: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<SynapseContentDetail>
    getHistory: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<SynapseContentHistoryEntry[]>
    getHistoryVersion: (
      args: { contentType: SynapseContentType; id: string; historyDirname: string },
    ) => Promise<SynapseContentHistoryVersion>
    create: (request: SynapseCreateContentRequest) => Promise<SynapseContentMutationResult>
    update: (request: SynapseUpdateContentRequest) => Promise<SynapseContentMutationResult>
    deleteContent: (payload: SynapseDeleteContentPayload) => Promise<SynapseContentMutationResult>
    listDeleted: <T extends SynapseContentType>(
      args: { contentType: T },
    ) => Promise<SynapseContentMeta<T>[]>
    restore: (payload: SynapseRestoreContentPayload) => Promise<SynapseContentMutationResult>
    purge: (payload: SynapsePurgeContentPayload) => Promise<SynapseContentMutationResult>
    download: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<SynapseContentDownloadResult>
    openDetailWindow: (payload: SynapseOpenContentWindowPayload) => Promise<void>
    getEditorAdapters: () => Promise<SynapseEditorAdapterSummary[]>
    installToEditor: (
      payload: SynapseInstallToEditorPayload,
    ) => Promise<SynapseContentInstallResult>
    readEditorInstallFormValues: (
      payload: SynapseReadEditorInstallFormValuesPayload,
    ) => Promise<SynapseReadEditorInstallFormValuesResult>
    getIconPromptTemplate: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<string | null>
    readIconImage: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<string | null>
    resolveEditorInstallTarget: (
      payload: SynapseResolveEditorTargetPayload,
    ) => Promise<SynapseEditorResolvedTarget>
  }
  config: {
    exportBackup: () => Promise<SynapseConfigBackupExportResult | null>
    get: () => Promise<SynapseConfig>
    importBackup: () => Promise<SynapseConfigBackupImportResult | null>
    resetApp: () => Promise<void>
    update: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  }
  identity: {
    adoptExistingUserId: (userId: string, repoId: string) => Promise<SynapseLocalIdentityState>
    generateNewId: () => Promise<SynapseLocalIdentityState>
    getLocalState: () => Promise<SynapseLocalIdentityState>
  }
  userProfile: {
    getRepoState: (repoId: string) => Promise<SynapseRepoProfileState>
    listRepoProfiles: (repoId: string) => Promise<ReadonlyMap<string, SynapseUserProfile>>
    updateDisplayName: (repoId: string, displayName: string) => Promise<SynapseUserProfile>
  }
  log: {
    clear: () => Promise<SynapseLogClearResult>
    export: () => Promise<SynapseLogExportResult>
    listFiles: () => Promise<SynapseLogFileInfo[]>
    readAll: () => Promise<string>
    readFiles: (fileNames: string[]) => Promise<string>
    write: (payload: SynapseRendererLogPayload) => void
  }
  license: {
    activate: (payload: SynapseLicenseActivationRequest) => Promise<SynapseLicenseStatus>
    getStatus: () => Promise<SynapseLicenseStatus>
    renew: () => Promise<SynapseLicenseStatus>
  }
  editor: {
    getGlobalDirectories: () => Promise<SynapseEditorGlobalDirectory[]>
    createDirectory: (dirPath: string) => Promise<void>
  }
  editorScan: {
    scanAll: () => Promise<EditorScanResult>
    readItemContent: (filePath: string) => Promise<string>
    listSkillFiles: (dirPath: string) => Promise<EditorScanSkillFileEntry[]>
    prepareQuickPublishDraft: (
      request: EditorScanQuickPublishRequest,
    ) => Promise<EditorScanQuickPublishDraft>
    trashItem: (request: EditorScanTrashRequest) => Promise<EditorScanTrashResult>
  }
  editorCopy: {
    copy: (payload: SynapseCopyToEditorPayload) => Promise<SynapseEditorCopyResult>
    resolveTarget: (
      payload: SynapseResolveEditorCopyTargetPayload,
    ) => Promise<SynapseEditorResolvedTarget>
  }
  editorInstallStatus: {
    resolveForContent: (
      payload: SynapseResolveEditorInstallStatusPayload,
    ) => Promise<SynapseEditorInstallStatusResult>
  }
  installStatus: {
    getAll: () => Promise<InstallStatusMap>
    uninstall: (payload: { contentId: string; editorId: string }) => Promise<void>
    onChanged: (listener: (payload: InstallStatusChangedEvent) => void) => () => void
  }
  shell: {
    showItemInFolder: (filePath: string) => void
  }
  repository: {
    checkInitializationPreview: (
      repositoryUuid: string,
    ) => Promise<SynapseRepositoryInitializationPreview>
    createLocalRepository: (
      payload: SynapseCreateLocalRepositoryPayload,
    ) => Promise<SynapseCreateLocalRepositoryResult>
    chooseDirectory: () => Promise<string | null>
    flushPendingPushes: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
    getPendingPushes: (repositoryUuid: string) => Promise<SynapsePendingPushState>
    getSyncSnapshots: () => Promise<SynapseRepositorySyncSnapshot[]>
    getStates: () => Promise<SynapseRepositoryLocalState[]>
    initializeStructure: (
      repositoryUuid: string,
    ) => Promise<SynapseRepositoryInitializationResult>
    onPendingPushesUpdated: (listener: (payload: SynapsePendingPushUpdatedEvent) => void) => () => void
    onSyncSnapshotUpdated: (
      listener: (payload: SynapseRepositorySyncSnapshotUpdatedEvent) => void,
    ) => () => void
    runMaintenance: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
    sync: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
    onProgress: (listener: (payload: SynapseRepositoryProgressEvent) => void) => () => void
    onUpdated: (listener: (payload: SynapseRepositoryUpdatedEvent) => void) => () => void
    validateDirectory: (targetPath: string) => Promise<SynapseRepositoryValidationResult>
  }
  updater: {
    cancelDownload: () => Promise<void>
    checkForUpdates: () => Promise<SynapseAppUpdateState>
    getState: () => Promise<SynapseAppUpdateState>
    installUpdate: () => Promise<void>
    onStateChanged: (listener: (payload: SynapseAppUpdateState) => void) => () => void
    onOpenUpdatePage: (listener: () => void) => () => void
  }
  database: {
    databaseTableList: () => Promise<DatabaseTableInfo[]>
    databaseTableCreate: (params: { name: string; description?: string; columns: Column[] }) => Promise<void>
    databaseTableDelete: (name: string) => Promise<void>
    databaseTableDescribe: (name: string) => Promise<DatabaseTableSchema>
    databaseTableUpdate: (params: { table: string; description: string }) => Promise<void>
    databaseColumnCreate: (params: { table: string; column: Column & { default?: unknown } }) => Promise<void>
    databaseColumnUpdate: (params: { table: string; column: string; description: string }) => Promise<void>
    databaseChoiceUpdate: (params: { table: string; column: string; choices: string[] }) => Promise<void>
    databaseChoiceUsageGet: (params: { table: string; column: string }) => Promise<Record<string, number>>
    databaseRowCreate: (params: { table: string; data: Record<string, unknown> }) => Promise<{ id: number }>
    databaseRowsCreate: (params: { table: string; rows: Record<string, unknown>[] }) => Promise<{ ids: number[] }>
    databaseRowList: (params: DatabaseQueryParams) => Promise<DatabaseQueryResult>
    databaseRowUpdate: (params: { table: string; id: number; data: Record<string, unknown> }) => Promise<{ affected: number }>
    databaseRowDelete: (params: { table: string; id: number }) => Promise<{ affected: number }>
    databaseRowsUpdate: (params: { table: string; where: DatabaseWhereClause; data: Record<string, unknown> }) => Promise<{ affected: number; ids: number[] }>
    databaseRowsDelete: (params: { table: string; where: DatabaseWhereClause }) => Promise<{ affected: number; ids: number[] }>
    databaseRowCount: (params: { table: string; where?: DatabaseWhereClause }) => Promise<{ count: number }>
    databaseTableRename: (params: { from: string; to: string }) => Promise<void>
    databaseColumnRename: (params: { table: string; from: string; to: string }) => Promise<void>
    databaseColumnDelete: (params: { table: string; column: string }) => Promise<void>
    databaseSqlExecute: (params: { sql: string; params?: unknown[] }) => Promise<{ rows?: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number }>
    databaseStatusGet: () => Promise<DatabaseStatus>
    databaseExport: () => Promise<{ success: boolean; path?: string }>
    databaseImport: () => Promise<{ success: boolean }>
    databaseTableExport: (table: string) => Promise<{ success: boolean; path?: string }>
    databaseTableImportInspect: () => Promise<
      { success: false }
      | ({ success: true } & DatabaseTableImportInspection)
    >
    databaseTableImport: (sourcePath: string) => Promise<{ success: boolean; tableName?: string }>
    databaseCliInstall: () => Promise<{ success: boolean; path?: string; error?: string }>
    databaseCliStatusGet: () => Promise<DatabaseCliStatus>
    databaseCliDebugInfoGet: () => Promise<DatabaseCliDebugInfo>
    databaseMcpHttpStatusGet: () => Promise<DatabaseMcpHttpStatus>
    databaseMcpStatusGet: () => Promise<DatabaseMcpStatus>
    databaseMcpServersGet: () => Promise<DatabaseMcpServerInfo[]>
    databaseMcpSettingsOpen: (target: DatabaseMcpTarget) => Promise<{ success: boolean; error?: string }>
    databaseMcpRegister: (target: DatabaseMcpTarget) => Promise<{ success: boolean; error?: string }>
    onChanged: (listener: (event: DatabaseChangeEvent) => void) => () => void
    databaseFolderList: () => Promise<DatabaseFolder[]>
    databaseFolderCreate: (params: { name: string }) => Promise<{ id: number }>
    databaseFolderRename: (params: { id: number; name: string }) => Promise<void>
    databaseFolderDelete: (params: { id: number }) => Promise<void>
    databaseFolderMoveTable: (params: { tableName: string; folderId: number | null }) => Promise<void>
    databaseFolderReorder: (params: { folderId: number; tableNames: string[] }) => Promise<void>
    databaseFolderReorderFolders: (params: { folderIds: number[] }) => Promise<void>
  }
  taskScheduler: {
    listTasks: () => Promise<ScheduledTask[]>
    getTask: (id: string) => Promise<ScheduledTask | null>
    createTask: (input: ScheduledTaskCreateInput) => Promise<ScheduledTask>
    updateTask: (payload: { id: string; patch: ScheduledTaskUpdateInput }) => Promise<ScheduledTask>
    deleteTask: (id: string) => Promise<{ deleted: boolean }>
    setTaskEnabled: (payload: { id: string; enabled: boolean }) => Promise<ScheduledTask>
    runTask: (id: string) => Promise<ScheduledTaskRun | null>
    stopRun: (runId: string) => Promise<{ stopped: boolean }>
    listRuns: (taskId: string, options?: { limit?: number }) => Promise<ScheduledTaskRun[]>
    exportTasksToFile: (json: string) => Promise<{ success: boolean; path?: string }>
    importTasksFromFile: () => Promise<{ success: boolean; content?: string }>
  }
  agent: {
    status: (projectId: string) => Promise<SynapseAgentStatus>
    listSessions: (projectId: string) => Promise<SynapseAgentSessionSummary[]>
    listAllSessions: () => Promise<SynapseAgentSessionSummary[]>
    getTimeline: (
      args: { projectId: string; sessionKey?: string; conversationId?: string; limit?: number },
    ) => Promise<SynapseAgentTimelineResult>
    createSession: (
      args: { projectId: string; sessionKey?: string; name?: string; agentType?: string },
    ) => Promise<SynapseAgentSessionSummary>
    switchSession: (
      args: { projectId: string; sessionKey?: string; conversationId: string },
    ) => Promise<SynapseAgentSessionSummary>
    deleteSession: (
      args: { projectId: string; conversationId: string },
    ) => Promise<{ ok: boolean }>
    renameSession: (
      args: { projectId: string; conversationId: string; name: string },
    ) => Promise<{ ok: boolean }>
    send: (
      args: { projectId: string; sessionKey?: string; content: string; clientSubmittedAt?: string },
    ) => Promise<SynapseAgentSendResult>
    listPendingPermissions: (projectId: string) => Promise<SynapseAgentPendingPermission[]>
    respondPermission: (
      args: { projectId: string; requestId: string; behavior: "allow" | "deny"; message?: string },
    ) => Promise<{ ok: true }>
    cancelTurn: (
      args: { projectId: string; conversationId: string },
    ) => Promise<SynapseAgentCancelTurnResult>
    forceKillTurn: (
      args: { projectId: string; conversationId: string },
    ) => Promise<SynapseAgentCancelTurnResult>
    getProviders: (projectId: string) => Promise<SynapseAgentProviderState>
    getRuntimeStatus: (
      request: { projectId?: string },
    ) => Promise<SynapseAgentRuntimeStatus>
    getAvailableAgents: () => Promise<Array<{
      agentType: string
      label: string
      available: boolean
      binaryPath?: string
    }>>
    listCommands: (projectId: string) => Promise<SynapseAgentPublishedCommand[]>
    openReference: (args: { projectId: string; reference: string }) => Promise<{ ok: true; path: string }>
    onEvent: (listener: (event: SynapseAgentDomainEvent) => void) => () => void
  }
  connectors: {
    feishu: {
      beginSetup: (projectId: string) => Promise<SynapseFeishuSetupBeginResult>
      pollSetup: (setupId: string) => Promise<SynapseFeishuSetupPollResult>
      saveSetup: (setupId: string) => Promise<SynapseFeishuConnectorSummary>
      saveManualCredentials: (
        payload: SynapseFeishuManualCredentialsPayload,
      ) => Promise<SynapseFeishuConnectorSummary>
      getStatus: (projectId: string) => Promise<SynapseFeishuConnectorRuntimeStatus>
      start: (projectId: string) => Promise<SynapseFeishuConnectorRuntimeStatus>
      stop: (projectId: string) => Promise<SynapseFeishuConnectorRuntimeStatus>
      list: (projectId: string) => Promise<SynapseFeishuConnectorSummary[]>
      getWorkspaceConfig: (projectId: string) => Promise<SynapseFeishuWorkspaceConfig>
      updateWorkspaceConfig: (
        payload: SynapseFeishuWorkspaceConfigPayload,
      ) => Promise<SynapseFeishuWorkspaceConfig>
      listWorkspaceBindings: (
        projectId: string,
      ) => Promise<SynapseFeishuWorkspaceBindingsSummary>
      routeWorkspaceBinding: (
        payload: SynapseFeishuWorkspaceRoutePayload,
      ) => Promise<SynapseFeishuWorkspaceBinding>
      unbindWorkspaceBinding: (
        payload: SynapseFeishuWorkspaceUnbindPayload,
      ) => Promise<{ ok: true }>
    }
  }
  ops: {
    diagnostics: (payload?: { projectId?: string }) => Promise<SynapseOpsDiagnostics>
    runDiagnostics: (payload?: { projectId?: string }) => Promise<SynapseDiagnosticsReport>
    exportDiagnosticsBundle: (
      payload: { report: SynapseDiagnosticsReport },
    ) => Promise<SynapseDiagnosticsBundleExportResult>
    ping: () => Promise<SynapseOpsPingResult>
    openLogDirectory: () => Promise<{ ok: true }>
    runAsGet: (projectId: string) => Promise<SynapseRunAsConfig>
    runAsUpdate: (payload: {
      projectId: string
      enabled?: boolean
      user?: string
      envAllowlist?: string[]
      requirePreflight?: boolean
    }) => Promise<SynapseRunAsConfig>
    runAsPreflight: (projectId: string) => Promise<SynapseRunAsCheckResult>
    runAsAuditProbe: (projectId: string) => Promise<SynapseRunAsCheckResult>
    webhookStatus: () => Promise<SynapseWebhookStatus>
    webhookUpdate: (payload: {
      enabled?: boolean
      bindAddress?: string
      preferredPort?: number
      path?: string
      maxBodyBytes?: number
      rateLimitPerMinute?: number
      resetToken?: boolean
    }) => Promise<SynapseOpsRecord>
    webhookRuns: (payload?: { projectId?: string }) => Promise<SynapseOpsRecord[]>
    relayBindings: (payload?: { projectId?: string }) => Promise<SynapseOpsRecord[]>
    relayRuns: (payload?: { projectId?: string }) => Promise<SynapseOpsRecord[]>
    relayUnbind: (id: string) => Promise<{ ok: boolean }>
    compressGet: (projectId: string) => Promise<SynapseOpsRecord>
    compressUpdate: (payload: {
      projectId: string
      agentType?: string
      enabled?: boolean
      maxTokens?: number
      minGapMins?: number
    }) => Promise<SynapseOpsRecord>
  }
  workflow: {
    list: () => Promise<WorkflowMeta[]>
    get: (id: string) => Promise<WorkflowDefinition | null>
    save: (def: WorkflowDefinition) => Promise<{ versionHash: string } | { errors: ValidationError[] }>
    delete: (id: string) => Promise<void>
    validate: (def: WorkflowDefinition) => Promise<ValidationResult>
    run: (id: string, params: Record<string, unknown>) => Promise<{ runId: string }>
    cancel: (runId: string) => Promise<void>
    runHistory: (workflowId: string) => Promise<WorkflowRunSnapshot[]>
    runSnapshot: (runId: string, workflowId: string) => Promise<WorkflowRunSnapshot | null>
    openEditor: (id: string) => Promise<void>
    editorState: () => Promise<{ openEditors: string[] }>
    checkCanSync: () => Promise<{ canSync: boolean; blockers: string[] }>
    onEvent: (listener: (event: WorkflowEvent) => void) => () => void
  }
  tokenUsage: {
    scan: () => Promise<{
      totalClients: number
      scannedClients: number
      totalFiles: number
      parsedFiles: number
      newMessages: number
      elapsedMs: number
    }>
    getGraphResult: (options?: { since?: string; until?: string }) => Promise<{
      meta: { generatedAt: string; processingTimeMs: number }
      summary: {
        totalTokens: number; totalCost: number
        totalDays: number; activeDays: number
        averagePerDay: number; maxCostInSingleDay: number
        clients: string[]; models: string[]
      }
      years: { year: string; totalTokens: number; totalCost: number }[]
      contributions: {
        date: string
        totals: { tokens: number; cost: number; messages: number }
        intensity: 0 | 1 | 2 | 3 | 4
        tokenBreakdown: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }
        clients: {
          client: string; modelId: string; providerId: string
          tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number }
          cost: number; messages: number
        }[]
      }[]
    }>
    getModelReport: (options?: { since?: string; until?: string; groupBy?: string }) => Promise<{
      client: string; model: string; provider: string
      input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number
      messageCount: number; cost: number
    }[]>
    getDailyReport: (options?: { since?: string; until?: string }) => Promise<Record<string, unknown>[]>
    getHourlyReport: (options?: { since?: string; until?: string }) => Promise<{
      hour: string; client: string; model: string; provider: string
      input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number
      cost: number; messages: number; turns: number
    }[]>
    getHourlyProfile: (options?: { since?: string; until?: string }) => Promise<{
      periods: { name: string; startHour: number; endHour: number; tokens: number; cost: number; messages: number }[]
      weekdays: { day: string; tokens: number; cost: number }[]
      peakHour: number
      peakHourTokens: number
    }>
    getAgentReport: (options?: { since?: string; until?: string }) => Promise<{
      client: string; models: string[]; providers: string[]
      input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number
      messageCount: number; cost: number; activeDays: number
      firstSeen: string; lastSeen: string
    }[]>
    getDetectedAgents: () => Promise<{ id: string; name: string; fileCount: number }[]>
    clearData: () => Promise<void>
    cursorAddAccount: (params: { sessionToken: string; label?: string }) => Promise<{ accountId: string; error?: string }>
    cursorRemoveAccount: (params: { accountId: string }) => Promise<void>
    cursorListAccounts: () => Promise<{ id: string; label?: string; userId?: string; active: boolean; createdAt: string; lastSyncAt?: string }[]>
    cursorSetActive: (params: { accountId: string }) => Promise<void>
    cursorSync: () => Promise<{ synced: boolean; rows: number; error?: string }>
    cursorValidate: (params: { sessionToken: string }) => Promise<{ valid: boolean; membershipType?: string; error?: string }>
  }
}
