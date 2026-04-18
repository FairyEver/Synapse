import type { SynapseConfig, SynapseConfigPatch } from "./config"
import type {
  SynapseContentDownloadResult,
  SynapseContentWriteResult,
  SynapseCreateRulePayload,
  SynapseCreateSkillPayload,
  SynapseContentFile,
  SynapseRuleMeta,
  SynapseSkillMeta,
  SynapseTextContentFile,
} from "./content"
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
    createRule: (payload: SynapseCreateRulePayload) => Promise<SynapseContentWriteResult>
    createSkill: (payload: SynapseCreateSkillPayload) => Promise<SynapseContentWriteResult>
    downloadRule: (ruleId: string) => Promise<SynapseContentDownloadResult>
    downloadSkill: (skillId: string) => Promise<SynapseContentDownloadResult>
    getEditorAdapters: () => Promise<SynapseEditorAdapterSummary[]>
    getRuleContent: (ruleId: string) => Promise<SynapseTextContentFile>
    getRules: () => Promise<SynapseRuleMeta[]>
    getSkillContent: (skillId: string) => Promise<SynapseTextContentFile>
    getSkillFiles: (skillId: string) => Promise<SynapseContentFile[]>
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
  log: {
    export: () => Promise<SynapseLogExportResult>
    list: (query: SynapseLogListQuery) => Promise<SynapseLogListResult>
    onAppended: (listener: (payload: SynapseLogAppendedEvent) => void) => () => void
    summary: () => Promise<SynapseLogSummary>
    write: (payload: SynapseRendererLogPayload) => void
  }
  repository: {
    chooseDirectory: () => Promise<string | null>
    getStates: () => Promise<SynapseRepositoryLocalState[]>
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
