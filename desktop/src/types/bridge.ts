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
  DataStoreTableInfo,
  DataStoreTableSchema,
  DataStoreWhereClause,
} from "./data-store"
import type {
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "./backup"
import type { SynapseCliDetectResult } from "./cli"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseLegacyCcConfigImportPreview,
} from "./config"
import type {
  SynapseConnectorDescriptor,
  SynapseConnectorDraft,
  SynapseInboundNormalizationResult,
} from "./connector"
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
import type { EditorScanResult, EditorScanSkillFileEntry } from "./editor-scan"
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
  cli: {
    detect: () => Promise<SynapseCliDetectResult[]>
  }
  config: {
    exportBackup: () => Promise<SynapseConfigBackupExportResult | null>
    get: () => Promise<SynapseConfig>
    importBackup: () => Promise<SynapseConfigBackupImportResult | null>
    previewLegacyCcConfigImport: (
      payload: { toml: string },
    ) => Promise<SynapseLegacyCcConfigImportPreview>
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
  connectors: {
    listDescriptors: () => Promise<SynapseConnectorDescriptor[]>
    createDraft: (payload: {
      type: string
      name?: string
      enabled?: boolean
      options?: Record<string, unknown>
      secretRefs?: Record<string, string>
    }) => Promise<SynapseConnectorDraft>
    normalizeInbound: (payload: {
      raw: unknown
      connectorId?: string
      platform?: string
      allowFrom?: string
      shareSessionInChannel?: boolean
      threadIsolation?: boolean
    }) => Promise<SynapseInboundNormalizationResult>
  }
  dataStore: {
    listTables: () => Promise<DataStoreTableInfo[]>
    createTable: (params: { name: string; description?: string; columns: Column[] }) => Promise<void>
    dropTable: (name: string) => Promise<void>
    describeTable: (name: string) => Promise<DataStoreTableSchema>
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
}
