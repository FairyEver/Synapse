import type {
  DataStoreChangeEvent,
  DataStoreCliDebugInfo,
  DataStoreCliStatus,
  DataStoreMcpHttpStatus,
  DataStoreMcpServerInfo,
  DataStoreMcpStatus,
  DataStoreMcpTarget,
  Column,
  DataStoreQueryParams,
  DataStoreQueryResult,
  DataStoreStatus,
  DataStoreTableImportInspection,
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
} from "./data-store"
import type {
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
  SynapseFeishuHeartbeat,
  SynapseFeishuHeartbeatPayload,
  SynapseFeishuHeartbeatWithProject,
  SynapseFeishuManualCredentialsPayload,
  SynapseFeishuScheduledJob,
  SynapseFeishuScheduledJobPayload,
  SynapseFeishuScheduledJobWithProject,
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
import type {
  SynapseLogClearResult,
  SynapseLogExportResult,
  SynapseLogFileInfo,
  SynapseRendererLogPayload,
} from "./log"
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
  SynapseRepositoryUpdatedEvent,
  SynapseRepositoryValidationResult,
} from "./repository"
import type { SynapseAppUpdateState } from "./update"

export type SynapseOpsDiagnostics = {
  appVersion: string
  singleInstanceLocked: boolean
  logPath: string
  sideChannel?: {
    enabled: boolean
    bindAddress?: string
    port?: number
    sendPath: string
    cronAddPath: string
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
  agent?: SynapseAgentStatus
  feishu?: {
    projectId: string
    configured: boolean
    running: boolean
  }
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
    getStates: () => Promise<SynapseRepositoryLocalState[]>
    initializeStructure: (
      repositoryUuid: string,
    ) => Promise<SynapseRepositoryInitializationResult>
    onPendingPushesUpdated: (listener: (payload: SynapsePendingPushUpdatedEvent) => void) => () => void
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
  dataStore: {
    listTables: () => Promise<DataStoreTableInfo[]>
    createTable: (params: { name: string; description?: string; columns: Column[] }) => Promise<void>
    dropTable: (name: string) => Promise<void>
    describeTable: (name: string) => Promise<DataStoreTableSchema>
    updateTableDescription: (params: { table: string; description: string }) => Promise<void>
    addColumn: (params: { table: string; column: Column & { default?: unknown } }) => Promise<void>
    updateColumnDescription: (params: { table: string; column: string; description: string }) => Promise<void>
    updateColumnChoices: (params: { table: string; column: string; choices: string[] }) => Promise<void>
    getColumnChoicesUsage: (params: { table: string; column: string }) => Promise<Record<string, number>>
    insert: (params: { table: string; data: Record<string, unknown> }) => Promise<{ id: number }>
    batchInsert: (params: { table: string; rows: Record<string, unknown>[] }) => Promise<{ ids: number[] }>
    query: (params: DataStoreQueryParams) => Promise<DataStoreQueryResult>
    update: (params: { table: string; id: number; data: Record<string, unknown> }) => Promise<{ affected: number }>
    delete: (params: { table: string; id: number }) => Promise<{ affected: number }>
    updateWhere: (params: { table: string; where: DataStoreWhereClause; data: Record<string, unknown> }) => Promise<{ affected: number; ids: number[] }>
    deleteWhere: (params: { table: string; where: DataStoreWhereClause }) => Promise<{ affected: number; ids: number[] }>
    count: (params: { table: string; where?: DataStoreWhereClause }) => Promise<{ count: number }>
    renameTable: (params: { from: string; to: string }) => Promise<void>
    renameColumn: (params: { table: string; from: string; to: string }) => Promise<void>
    dropColumn: (params: { table: string; column: string }) => Promise<void>
    rawSQL: (params: { sql: string; params?: unknown[] }) => Promise<{ rows?: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number }>
    getStatus: () => Promise<DataStoreStatus>
    exportDB: () => Promise<{ success: boolean; path?: string }>
    importDB: () => Promise<{ success: boolean }>
    exportTable: (table: string) => Promise<{ success: boolean; path?: string }>
    inspectTableImport: () => Promise<
      { success: false }
      | ({ success: true } & DataStoreTableImportInspection)
    >
    importTable: (sourcePath: string) => Promise<{ success: boolean; tableName?: string }>
    installCLI: () => Promise<{ success: boolean; path?: string; error?: string }>
    getCliStatus: () => Promise<DataStoreCliStatus>
    getCliDebugInfo: () => Promise<DataStoreCliDebugInfo>
    getMcpHttpStatus: () => Promise<DataStoreMcpHttpStatus>
    getMcpStatus: () => Promise<DataStoreMcpStatus>
    getMCPServers: () => Promise<DataStoreMcpServerInfo[]>
    openMCPSettings: (target: DataStoreMcpTarget) => Promise<{ success: boolean; error?: string }>
    registerMCP: (target: DataStoreMcpTarget) => Promise<{ success: boolean; error?: string }>
    onChanged: (listener: (event: DataStoreChangeEvent) => void) => () => void
  }
  agent: {
    status: (projectId: string) => Promise<SynapseAgentStatus>
    listSessions: (projectId: string) => Promise<SynapseAgentSessionSummary[]>
    getTimeline: (
      args: { projectId: string; sessionKey?: string; conversationId?: string; limit?: number },
    ) => Promise<SynapseAgentTimelineResult>
    createSession: (
      args: { projectId: string; sessionKey?: string; name?: string },
    ) => Promise<SynapseAgentSessionSummary>
    switchSession: (
      args: { projectId: string; sessionKey?: string; conversationId: string },
    ) => Promise<SynapseAgentSessionSummary>
    deleteSession: (
      args: { projectId: string; conversationId: string },
    ) => Promise<{ ok: boolean }>
    send: (
      args: { projectId: string; sessionKey?: string; content: string },
    ) => Promise<SynapseAgentSendResult>
    listPendingPermissions: (projectId: string) => Promise<SynapseAgentPendingPermission[]>
    respondPermission: (
      args: { projectId: string; requestId: string; behavior: "allow" | "deny"; message?: string },
    ) => Promise<{ ok: true }>
    getProviders: (projectId: string) => Promise<SynapseAgentProviderState>
    getRuntimeStatus: (
      request: { projectId?: string },
    ) => Promise<SynapseAgentRuntimeStatus>
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
      listScheduledJobs: (projectId: string) => Promise<SynapseFeishuScheduledJob[]>
      listAllScheduledJobs: () => Promise<SynapseFeishuScheduledJobWithProject[]>
      createScheduledJob: (
        payload: SynapseFeishuScheduledJobPayload,
      ) => Promise<SynapseFeishuScheduledJob>
      deleteScheduledJob: (
        payload: { projectId: string; id: string },
      ) => Promise<{ ok: true }>
      setScheduledJobEnabled: (
        payload: { projectId: string; id: string; enabled: boolean },
      ) => Promise<SynapseFeishuScheduledJob>
      setScheduledJobMuted: (
        payload: { projectId: string; id: string; mute: boolean },
      ) => Promise<SynapseFeishuScheduledJob>
      runScheduledJob: (
        payload: { projectId: string; id: string },
      ) => Promise<SynapseFeishuScheduledJob | null>
      listHeartbeats: (projectId: string) => Promise<SynapseFeishuHeartbeat[]>
      listAllHeartbeats: () => Promise<SynapseFeishuHeartbeatWithProject[]>
      upsertHeartbeat: (
        payload: SynapseFeishuHeartbeatPayload,
      ) => Promise<SynapseFeishuHeartbeat>
      pauseHeartbeat: (
        payload: { projectId: string; id: string },
      ) => Promise<SynapseFeishuHeartbeat>
      deleteHeartbeat: (
        payload: { projectId: string; id: string },
      ) => Promise<{ ok: true }>
      resumeHeartbeat: (
        payload: { projectId: string; id: string },
      ) => Promise<SynapseFeishuHeartbeat>
      runHeartbeat: (
        payload: { projectId: string; id: string },
      ) => Promise<SynapseFeishuHeartbeat | null>
    }
  }
  ops: {
    diagnostics: (payload?: { projectId?: string }) => Promise<SynapseOpsDiagnostics>
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
}
