import type {
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "./backup"
import type { SynapseCliDetectResult } from "./cli"
import type { SynapseConfig, SynapseConfigPatch } from "./config"
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
  SynapsePeekClaudeCodeFrontmatterPayload,
  SynapsePeekClaudeCodeFrontmatterResult,
  SynapsePeekCursorFrontmatterPayload,
  SynapsePeekCursorFrontmatterResult,
  SynapseResolveEditorTargetPayload,
} from "./editor"
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
    peekCursorFrontmatter: (
      payload: SynapsePeekCursorFrontmatterPayload,
    ) => Promise<SynapsePeekCursorFrontmatterResult>
    peekClaudeCodeFrontmatter: (
      payload: SynapsePeekClaudeCodeFrontmatterPayload,
    ) => Promise<SynapsePeekClaudeCodeFrontmatterResult>
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
    onStateChanged: (listener: (payload: SynapseAppUpdateState) => void) => () => void
  }
}
