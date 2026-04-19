import type {
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "./backup"
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
  SynapseEditorResolvedTarget,
  SynapseInstallToEditorPayload,
  SynapseResolveEditorTargetPayload,
} from "./editor"
import type {
  SynapseLogAppendedEvent,
  SynapseLogExportResult,
  SynapseLogListQuery,
  SynapseLogListResult,
  SynapseLogSummary,
  SynapseRendererLogPayload,
} from "./log"
import type {
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationResult,
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationResult,
  SynapsePendingPushState,
  SynapsePendingPushUpdatedEvent,
  SynapseRepositoryProgressEvent,
  SynapseRepositoryUpdatedEvent,
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
    download: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<SynapseContentDownloadResult>
    openDetailWindow: (payload: SynapseOpenContentWindowPayload) => Promise<void>
    getEditorAdapters: () => Promise<SynapseEditorAdapterSummary[]>
    installToEditor: (
      payload: SynapseInstallToEditorPayload,
    ) => Promise<SynapseContentInstallResult>
    resolveEditorInstallTarget: (
      payload: SynapseResolveEditorTargetPayload,
    ) => Promise<SynapseEditorResolvedTarget>
  }
  config: {
    exportBackup: () => Promise<SynapseConfigBackupExportResult | null>
    get: () => Promise<SynapseConfig>
    importBackup: () => Promise<SynapseConfigBackupImportResult | null>
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
    export: () => Promise<SynapseLogExportResult>
    list: (query: SynapseLogListQuery) => Promise<SynapseLogListResult>
    onAppended: (listener: (payload: SynapseLogAppendedEvent) => void) => () => void
    summary: () => Promise<SynapseLogSummary>
    write: (payload: SynapseRendererLogPayload) => void
  }
  repository: {
    checkInitializationPreview: (
      repositoryUuid: string,
    ) => Promise<SynapseRepositoryInitializationPreview>
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
  }
  updater: {
    checkForUpdates: () => Promise<SynapseAppUpdateState>
    getState: () => Promise<SynapseAppUpdateState>
    onStateChanged: (listener: (payload: SynapseAppUpdateState) => void) => () => void
  }
}
