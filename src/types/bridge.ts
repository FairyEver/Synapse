import type { SynapseConfig, SynapseConfigPatch } from "./config"
import type {
  SynapseContentDownloadResult,
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentHistoryVersion,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseDeleteContentPayload,
  SynapseContentMutationResult,
  SynapseRuleMeta,
  SynapseSkillMeta,
  SynapseTextContentFile,
  SynapseUpdateRulePayload,
  SynapseUpdateSkillPayload,
} from "./content"
import type { SynapseIdentityState } from "./identity"
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
    createRule: (payload: SynapseCreateRulePayload) => Promise<SynapseContentMutationResult>
    createSkill: (payload: SynapseCreateSkillPayload) => Promise<SynapseContentMutationResult>
    updateRule: (payload: SynapseUpdateRulePayload) => Promise<SynapseContentMutationResult>
    updateSkill: (payload: SynapseUpdateSkillPayload) => Promise<SynapseContentMutationResult>
    deleteContent: (payload: SynapseDeleteContentPayload) => Promise<SynapseContentMutationResult>
    downloadRule: (ruleId: string) => Promise<SynapseContentDownloadResult>
    downloadSkill: (skillId: string) => Promise<SynapseContentDownloadResult>
    getEditorAdapters: () => Promise<SynapseEditorAdapterSummary[]>
    getRuleContent: (ruleId: string) => Promise<SynapseTextContentFile>
    getRuleDetail: (ruleId: string) => Promise<SynapseContentDetail>
    getRuleHistory: (ruleId: string) => Promise<SynapseContentHistoryEntry[]>
    getRuleHistoryVersion: (ruleId: string, historyDirname: string) => Promise<SynapseContentHistoryVersion>
    getRules: () => Promise<SynapseRuleMeta[]>
    getSkillContent: (skillId: string) => Promise<SynapseTextContentFile>
    getSkillDetail: (skillId: string) => Promise<SynapseContentDetail>
    getSkillHistory: (skillId: string) => Promise<SynapseContentHistoryEntry[]>
    getSkillHistoryVersion: (skillId: string, historyDirname: string) => Promise<SynapseContentHistoryVersion>
    getSkills: () => Promise<SynapseSkillMeta[]>
    installToEditor: (
      payload: SynapseInstallToEditorPayload,
    ) => Promise<SynapseContentInstallResult>
    resolveEditorInstallTarget: (
      payload: SynapseResolveEditorTargetPayload,
    ) => Promise<SynapseEditorResolvedTarget>
  }
  config: {
    get: () => Promise<SynapseConfig>
    update: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  }
  identity: {
    generateNewId: () => Promise<SynapseIdentityState>
    getState: () => Promise<SynapseIdentityState>
    replaceUserId: (userId: string) => Promise<SynapseIdentityState>
    updateDisplayName: (displayName: string) => Promise<SynapseIdentityState>
  }
  log: {
    export: () => Promise<SynapseLogExportResult>
    list: (query: SynapseLogListQuery) => Promise<SynapseLogListResult>
    onAppended: (listener: (payload: SynapseLogAppendedEvent) => void) => () => void
    summary: () => Promise<SynapseLogSummary>
    write: (payload: SynapseRendererLogPayload) => void
  }
  repository: {
    chooseDirectory: () => Promise<string | null>
    flushPendingPushes: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
    getPendingPushes: (repositoryUuid: string) => Promise<SynapsePendingPushState>
    getStates: () => Promise<SynapseRepositoryLocalState[]>
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
