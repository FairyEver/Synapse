import type {
  DatabaseChangeEvent,
  DatabaseFolder,
  DatabaseOverview,
  Column,
  DatabaseQueryParams,
  DatabaseQueryResult,
  DatabaseStatus,
  DatabaseTableImportInspection,
  DatabaseTableInfo,
  DatabaseTableSchema,
  DatabaseWhereClause,
} from "./database"
import type { McpRegistrationInfo, McpServerStatus, McpTarget } from "./mcp"
import type {
  AgentReferenceActionInput,
  AgentReferenceActionResult,
} from "./agent-reference-action"
import type {
  SynapseAccountState,
  SynapseAccountStateChangedEvent,
} from "./account"
import type { SynapseAppUpdateOpenRequest, SynapseAppUpdateState } from "./update"
import type { AgentAttachmentRef } from "./agent-attachment"
import type {
  GenerateDocxInput,
  GenerateDocxResult,
} from "../../app-capabilities/document-template/shared/schema"
import type {
  TextExtractionRequest,
  TextExtractionResponse,
  TextExtractionStatusEvent,
  TextOutputChooseRequest,
  TextSaveInput,
  TextSaveResponse,
} from "../../app-capabilities/text-extractor/shared/schema"
import type { FileOpenInput, FileOpenResult } from "../../app-capabilities/file-opener/shared/schema"
import type {
  TextFileOutputChooseRequest,
  TextFileWriteInput,
  TextFileWriteResponse,
} from "../../app-capabilities/text-file-writer/shared/schema"
import type {
  HtmlGenerationFileInput,
  HtmlGenerationFileResponse,
  HtmlGenerationInput,
  HtmlGenerationResponse,
  HtmlGeneratorOutputChooseRequest,
} from "../../app-capabilities/html-generator/shared/schema"
import type {
  JsonRepairInput,
  JsonRepairResponse,
} from "../../app-capabilities/json-repair/shared/schema"
import type {
  SkillUninstallBatchResult,
  SkillUninstallCancelRequest,
  SkillUninstallExecutionCancelRequest,
  SkillUninstallNameScanRequest,
  SkillUninstallNameScanResult,
  SkillUninstallRequest,
  SkillUninstallScanRequest,
  SkillUninstallScanResult,
} from "../../app-capabilities/skill-uninstaller/shared/schema"
import type {
  SynapseQuickInputChangedEvent,
  SynapseQuickInputItem,
} from "./quick-input"
import type {
  SecretCreateInput,
  SecretDeleteInput,
  SecretGetInput,
  SecretListResult,
  SecretSkillEnvQueueInput,
  SecretSkillEnvQueueResult,
  SecretSkillEnvBatchScanInput,
  SecretSkillEnvBatchScanResult,
  SecretSkillEnvScanInput,
  SecretSkillEnvScanResult,
  SecretSafeView,
  SecretUpdateInput,
  SecretUpsertInput,
  SecretUpsertResult,
  SecretValueView,
  SecretsChangedEvent,
} from "../../app-capabilities/secrets/shared/schema"
import type { ConnectorItem, ConnectorListResult } from "../../app-capabilities/connectors/shared/schema"
import type {
  SynapseAgentPersona,
  SynapseAgentPersonaBuiltinModelUpdateInput,
  SynapseAgentPersonaChangedEvent,
  SynapseAgentPersonaCreateInput,
  SynapseAgentPersonaIdInput,
  SynapseAgentPersonaListResult,
  SynapseAgentPersonaUpdateInput,
} from "./agent-persona"
import type {
  SynapseSoundNotifierChangedEvent,
  SynapseSoundNotifierPlayInput,
  SynapseSoundNotifierPlayRequestedEvent,
  SynapseSoundNotifierPlayResult,
  SynapseSoundNotifierSettings,
  SynapseSoundNotifierSettingsPatch,
} from "./sound-notifier"
import type {
  SynapseSystemNotificationResult,
  SynapseSystemNotifierSettings,
  SynapseSystemNotifierSettingsPatch,
} from "./system-notifier"
import type {
  SynapseTerminalAttachSessionInput,
  SynapseTerminalAttachSessionResult,
  SynapseTerminalClosePaneInput,
  SynapseTerminalCloseWorkspaceInput,
  SynapseTerminalCloseWorkspaceResult,
  SynapseTerminalCreateGroupCommandInput,
  SynapseTerminalCreateGroupInput,
  SynapseTerminalCreateSessionInput,
  SynapseTerminalDataEvent,
  SynapseTerminalDomainChangedEvent,
  SynapseTerminalDeleteGroupCommandInput,
  SynapseTerminalDeleteGroupInput,
  SynapseTerminalDeleteSessionInput,
  SynapseTerminalEnvironmentValueInput,
  SynapseTerminalGroup,
  SynapseTerminalGroupCommand,
  SynapseTerminalGroupSummary,
  SynapseTerminalGlobalLaunchSettings,
  SynapseTerminalLaunchGroupCommandInput,
  SynapseTerminalReadSessionInput,
  SynapseTerminalReadSessionResult,
  SynapseTerminalRenameGroupInput,
  SynapseTerminalRenameSessionInput,
  SynapseTerminalRenameWorkspaceInput,
  SynapseTerminalResizeSessionInput,
  SynapseTerminalResizedEvent,
  SynapseTerminalRunStartupCommandInput,
  SynapseTerminalSetSplitRatioInput,
  SynapseTerminalSession,
  SynapseTerminalSessionDeletedEvent,
  SynapseTerminalStopSessionInput,
  SynapseTerminalSplitPaneInput,
  SynapseTerminalSplitPaneResult,
  SynapseTerminalUpdateGroupCommandInput,
  SynapseTerminalUpdateGroupSettingsInput,
  SynapseTerminalUpdateGlobalLaunchSettingsInput,
  SynapseTerminalWriteSessionInput,
  SynapseTerminalWorkspace,
} from "./terminal"
import type {
  SynapseSkillRepositoryInstallPrepareResult,
  SynapseSkillRepositoryInstallResolveResult,
} from "./skill-repository-install"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapseInstallSourceToEditorTargetsPayload,
  SynapseInstallSourceToEditorTargetsResult,
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
  SynapseSkillEnvInspectionResult,
  SynapseSkillInstallerSource,
} from "./installers"
import type {
  DashboardWebhookDto,
  DriveDocumentImageImportRequest,
  DriveDocumentImageImportResult,
  DriveDocumentImageSourcesDto,
  DriveAccessSettingsUpdateInput,
  DriveFileVersionDto,
  DriveFileVersionListInput,
  DriveFileVersionListPageDto,
  DriveFolderUploadPrepareResult,
  DriveItemDto,
  DriveItemListInput,
  DriveItemListPageDto,
  DriveLinkDownloadFileDto,
  DriveLinkDownloadFileInput,
  DriveLinkListDto,
  DriveLinkListInput,
  DriveLinkMaterializeDto,
  DriveLinkMaterializeInput,
  DriveLinkReadTextDto,
  DriveLinkReadTextInput,
  DriveLinkResolveDto,
  DriveLinkResolveInput,
  DrivePublicAssetDto,
  DrivePublicAssetListPageDto,
  DrivePublicLinksPageInput,
  DriveSiteAccessUpdateInput,
  DriveSiteCreateInput,
  DriveSiteDto,
  DriveSiteListInput,
  DriveSiteListPageDto,
  DriveSitePreflightDto,
  DriveShareDto,
  DriveShareListPageDto,
  DriveShareListItemDto,
  DriveTrashItemDto,
  DriveTrashListPageDto,
  DriveUploadPrepareResult,
  DriveSyncBindingPreviewDto,
  DriveSyncBindingDto,
  DriveSyncConflictResolutionInput,
  DriveSyncCreateSafeBindingInput,
  DriveSyncUpdateExcludeRulesInput,
  DriveSyncSnapshotDto,
  DriveUsageDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

export type DriveLocalUploadFileItem = {
  readonly kind: "file"
  readonly path: string
  readonly name: string
  readonly mimeType?: string | null
  readonly expectedItemId?: string | null
}

export type DriveLocalUploadFolderItem = {
  readonly kind: "folder"
  readonly folderName: string
  readonly directories?: Array<{
    readonly relativePath: string
  }>
  readonly files: Array<{
    readonly path: string
    readonly relativePath: string
    readonly mimeType?: string | null
  }>
}

export type DriveLocalUploadItem = DriveLocalUploadFileItem | DriveLocalUploadFolderItem

export type DriveLocalUploadRequest = {
  readonly taskId?: string
  readonly parentId?: string | null
  readonly items: DriveLocalUploadItem[]
}

export type DriveLocalUploadResult = {
  readonly completed: number
  readonly completedDirectories?: number
  readonly failed: number
  readonly failedDirectories?: number
  readonly skipped: number
  readonly message?: string
}

export type DriveLocalUploadProgressEvent =
  | { readonly type: "item-started"; readonly taskId: string; readonly itemKey: string }
  | { readonly type: "item-progress"; readonly taskId: string; readonly itemKey: string; readonly uploadedBytes: number; readonly totalBytes: number }
  | { readonly type: "item-completed"; readonly taskId: string; readonly itemKey: string }
  | { readonly type: "item-skipped"; readonly taskId: string; readonly itemKey: string; readonly message?: string }
  | { readonly type: "item-failed"; readonly taskId: string; readonly itemKey: string; readonly message?: string }
  | { readonly type: "task-finished"; readonly taskId: string; readonly result: DriveLocalUploadResult }

export type DriveFileVersionDeleteResult = {
  readonly ok: true
  readonly deletePending?: boolean
}

export type DrivePublicAssetLocalFile = {
  readonly path: string
  readonly name: string
  readonly mimeType?: string | null
}

export type DrivePublicAssetUploadRequest = {
  readonly files: readonly DrivePublicAssetLocalFile[]
}

export type DrivePublicAssetBinaryUploadRequest = {
  readonly name: string
  readonly mimeType: string
  readonly data: ArrayBuffer
}

export type DrivePublicAssetUploadResultItem =
  | {
    readonly status: "fulfilled"
    readonly fileName: string
    readonly asset: DrivePublicAssetDto
  }
  | {
    readonly status: "rejected"
    readonly fileName: string
    readonly message: string
  }

export type DrivePublicAssetUploadResult = {
  readonly results: readonly DrivePublicAssetUploadResultItem[]
}

export type DriveDocumentImageSourceContext =
  | { readonly kind: "owner"; readonly itemId: string }
  | { readonly kind: "share"; readonly shareId: string; readonly itemId?: string | null }

export type DriveDocumentImageImportBridgeRequest =
  DriveDocumentImageSourceContext & DriveDocumentImageImportRequest

import type {
  SynapseLiveState,
  SynapseLiveStateChangedEvent,
} from "./live"
import type {
  SynapseAgentCancelTurnResult,
  SynapseAgentConversationExportResult,
  SynapseAgentFileCheckpointDetail,
  SynapseAgentFileCheckpointDiff,
  SynapseAgentFileCheckpointPrepareResult,
  SynapseAgentFileCheckpointRewindResult,
  SynapseAgentDomainEvent,
  SynapseAgentPendingPermission,
  SynapseAgentPublishedCommand,
  SynapseAgentProviderState,
  SynapseAgentRuntimeStatus,
  SynapseAgentSendResult,
  SynapseAgentSessionSummary,
  SynapseAgentStatus,
  SynapseAgentTimelineResult,
  SynapseAgentPermissionMode,
  SynapseAgentPermissionScope,
} from "./agent"
import type {
  AgentConversationTarget,
  AgentConversationWindowFocusResult,
  AgentConversationWindowOpenResult,
  AgentConversationWindowReplaceRequest,
  AgentConversationWindowReplaceResult,
  AgentConversationWindowRequest,
  AgentDetachedConversation,
} from "./agent-conversation-window"
import type {
  OpenAgentSessionPayload,
  SynapseAgentConversationReference,
  SynapseOpenAgentConversationResult,
} from "./agent-navigation"
import type {
  SynapseConfigBackupExportResult,
  SynapseConfigBackupImportResult,
} from "./backup"
import type { SynapseConfig, SynapseConfigPatch } from "./config"
import type {
  WorkflowImportOptions,
  WorkflowImportPreview,
  WorkflowModelMapping,
  WorkflowShareImportPreview,
  WorkflowShareImportSelections,
  WorkflowShareExportPreflight,
  WorkflowShareDeletePlan,
} from "./workflow-package"
import type {
  CcConversationChunk,
  CcConversationChunkInput,
  CcConversationDetail,
  CcConversationFocus,
  CcConversationListInput,
  CcConversationListResult,
  CcConversationWindowRequest,
  CcRecordDetailsInput,
  CcRecordDetailsResult,
  CcRecordListInput,
  CcRecordListResult,
} from "./usage-analysis-conversations"
import type {
  SynapseContentDownloadResult,
  SynapseContentChangedEvent,
  SynapseContentDetail,
  SynapseContentFile,
  SynapseContentMeta,
  SynapseCreateContentRequest,
  SynapseDeleteContentPayload,
  SynapseContentMutationResult,
  SynapseOpenContentCreateWindowPayload,
  SynapseOpenContentEditWindowPayload,
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
  SynapseCheatCodeStateChangedEvent,
  SynapseCheatCodeStateMap,
  SynapseCheatCodeStateResult,
} from "./cheat-code"
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
  EditorScanCancelResult,
  EditorScanQuickPublishDraft,
  EditorScanQuickPublishRequest,
  EditorScanFinalizeQuickPublishRequest,
  EditorScanFinalizeQuickPublishResult,
  EditorScanSkillRepositoryIdentityRetryRequest,
  EditorScanSkillRepositoryIdentityRetryResult,
  EditorScanSkillRepositoryUploadRequest,
  EditorScanSkillRepositoryUploadResult,
  EditorScanResult,
  EditorScanRequest,
  EditorScanSkillFileEntry,
  EditorScanTrashRequest,
  EditorScanTrashResult,
} from "./editor-scan"
import type { InstallStatusChangedEvent, InstallStatusMap, InstallStatusUninstallResult } from "./install-status"
import type {
  SynapseLogClearResult,
  SynapseLogExportResult,
  SynapseLogFileInfo,
  SynapseRendererLogPayload,
} from "./log"
import type {
  SynapseDiagnosticsBundleExportResult,
  SynapseDiagnosticsReport,
} from "./diagnostics"
import type {
  SynapseKnowledgeBaseCreateManagedPayload,
  SynapseKnowledgeBaseCreateManagedResult,
  SynapseKnowledgeBaseCreateRawFolderPayload,
  SynapseKnowledgeBaseDeleteManagedPayload,
  SynapseKnowledgeBaseDeleteManagedResult,
  SynapseKnowledgeBaseExportRawEntriesPayload,
  SynapseKnowledgeBaseExportManagedPayload,
  SynapseKnowledgeBaseExportManagedResult,
  SynapseKnowledgeBaseImportManagedPayload,
  SynapseKnowledgeBaseImportManagedResult,
  SynapseKnowledgeBaseImportPreview,
  SynapseKnowledgeBaseListRawDirectoryPayload,
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseMoveRawEntriesPayload,
  SynapseKnowledgeBaseOpenSourceManagerPayload,
  SynapseKnowledgeBaseAddUrlSourcePayload,
  SynapseKnowledgeBaseRawMutationResult,
  SynapseKnowledgeBaseRenameRawEntryPayload,
  SynapseKnowledgeBaseSelectAndUploadRawDirectoryPayload,
  SynapseKnowledgeBaseStorageMigrationPayload,
  SynapseKnowledgeBaseStorageMigrationProgress,
  SynapseKnowledgeBaseStorageMigrationResult,
  SynapseKnowledgeBaseStorageStatus,
  SynapseKnowledgeBaseTrashRawEntriesPayload,
  SynapseKnowledgeBaseTransferProgress,
  SynapseKnowledgeBaseUploadRawFilesPayload,
  SynapseKnowledgeBaseUploadRawItemsPayload,
  SynapseKnowledgeBaseUploadSourcesResult,
} from "./knowledge-base"
import type {
  SynapseCreateLocalRepositoryPayload,
  SynapseCreateLocalRepositoryResult,
  SynapseRepositoryInitializationOptions,
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
import type {
  SynapseGitAccessState,
  SynapseGitBranch,
  SynapseGitCheckoutRemoteBranchInput,
  SynapseGitCheckoutRemoteBranchResult,
  SynapseGitChangeSelection,
  SynapseGitCloneResult,
  SynapseGitClearHttpsCredentialInput,
  SynapseGitCommitDetail,
  SynapseGitCommitSummary,
  SynapseGitDiffResult,
  SynapseGitDiscardChangesResult,
  SynapseGitEnvironmentState,
  SynapseGitGenerateSshKeyInput,
  SynapseGitOperationResult,
  SynapseGitOperationState,
  SynapseGitProvider,
  SynapseGitProtocol,
  SynapseGitPushTarget,
  SynapseGitInitializationPlan,
  SynapseGitRemoteBranchGroup,
  SynapseGitRepository,
  SynapseGitRepositorySummary,
  SynapseGitRepositorySnapshot,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitSshPublicKey,
  SynapseGitSshHostKeyCandidate,
  SynapseGitSshTestResult,
  SynapseGitTestSshConnectionInput,
} from "./git"
import type {
  AutomationChangedEvent,
  AutomationCreateInput,
  AutomationItem,
  AutomationRun,
  AutomationStopRunResult,
  AutomationUpdateInput,
} from "./automation"
import type {
  WorkflowDefinition,
  WorkflowListResult,
  SaveWorkflowParamPresetInput,
  ValidationError,
  ValidationResult,
  WorkflowEvent,
  WorkflowParamPreset,
  WorkflowParamPresetResourceEntryType,
  WorkflowRunListItem,
  WorkflowRunStatus,
} from "./workflow"
import type {
  SynapseSystemAppContentOpenRequest,
  SynapseSystemAppGitOpenRequest,
  SynapseSystemAppId,
  SynapseSystemAppOpenOptions,
  SynapseSystemAppTerminalOpenRequest,
} from "../modules/apps/types"

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
}

export type SynapseOpsPingResult = {
  ok: true
  receivedAt: string
}

export type SynapseRunAsConfig = Record<string, unknown>
export type SynapseRunAsCheckResult = Record<string, unknown>
export type SynapseWebhookStatus = NonNullable<SynapseOpsDiagnostics["webhook"]>
export type SynapseOpsRecord = Record<string, unknown>

export type SynapseAgentProviderCategory =
  | "official"
  | "cn_official"
  | "cloud_provider"
  | "aggregator"
  | "third_party"
  | "custom"

export type SynapseAgentProviderApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY"

export type SynapseAgentProvider = {
  readonly id: string
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly source?: "local" | "user"
  readonly readonly?: boolean
  readonly configured?: boolean
  readonly configPath?: string
  readonly note?: string
  readonly websiteUrl?: string
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly env?: Record<string, string>
  readonly settingsConfig?: Record<string, unknown>
  readonly archived?: boolean
  readonly sortIndex?: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type SynapseCreateAgentProviderInput = {
  readonly id: string
  readonly name: string
  readonly note?: string
  readonly websiteUrl?: string
  readonly category: SynapseAgentProviderCategory
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly apiKey?: string
  readonly active?: boolean
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly env?: Record<string, string>
  readonly settingsConfig?: Record<string, unknown>
  readonly secretEnv?: Record<string, string>
  readonly sortIndex?: number
}

export type SynapseUpdateAgentProviderInput = Partial<Omit<SynapseCreateAgentProviderInput, "id">> & {
  readonly archived?: boolean
  readonly clearSecretEnv?: readonly string[]
}

export type SynapseAgentProviderPresetTemplateValue = {
  readonly key: string
  readonly label: string
  readonly placeholder: string
  readonly defaultValue?: string
  readonly sensitive: boolean
}

export type SynapseAgentProviderPreset = {
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly websiteUrl?: string
  readonly apiKeyUrl?: string
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly templateValues: readonly SynapseAgentProviderPresetTemplateValue[]
}

export type SynapseCreateProviderFromPresetInput = {
  readonly presetName: string
  readonly providerId?: string
  readonly name?: string
  readonly apiKey?: string
  readonly templateValues?: Record<string, string>
  readonly active?: boolean
  readonly sortIndex?: number
}

export type SynapseCcSwitchImportSource = {
  readonly kind: "sqlite" | "json"
  readonly path: string
}

export type SynapseCcSwitchImportPreviewStatus = "ready" | "duplicate" | "missing_api_key"

export type SynapseCcSwitchClaudeProviderPreviewItem = {
  readonly id: string
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly websiteUrl?: string
  readonly note?: string
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
  readonly status: SynapseCcSwitchImportPreviewStatus
  readonly selectedByDefault: boolean
}

export type SynapseCcSwitchClaudeImportPreviewResult = {
  readonly source?: SynapseCcSwitchImportSource
  readonly items: readonly SynapseCcSwitchClaudeProviderPreviewItem[]
  readonly error?: string
}

export type SynapseImportCcSwitchClaudeProvidersResult = {
  readonly imported: readonly SynapseAgentProvider[]
  readonly skipped: readonly SynapseCcSwitchClaudeProviderPreviewItem[]
}

export type SynapseProviderPackageImportPreview = {
  readonly sourcePath: string
  readonly contentSha256: string
  readonly packageVersion: 1
  readonly sourceProviderId: string
  readonly targetProviderId: string
  readonly name: string
  readonly category: SynapseAgentProviderCategory
  readonly baseUrl?: string
  readonly apiKeyField: SynapseAgentProviderApiKeyField
  readonly model?: string
  readonly haikuModel?: string
  readonly sonnetModel?: string
  readonly opusModel?: string
}

export type SynapseProviderPackageImportResult = {
  readonly provider: SynapseAgentProvider
}

export type SynapseProviderPackageExportResult = {
  readonly filePath: string
}

export type SynapseAgentBridgeAttachment = {
  readonly attachmentId: string
  readonly order: number
}

export type SynapseAgentAttachmentCandidate = {
  readonly sourceIndex: number
  readonly ref: AgentAttachmentRef
}

export type SynapseAgentAttachmentSelectionResult = {
  readonly attachments: readonly SynapseAgentAttachmentCandidate[]
  readonly rejectedCount: number
}

export type UsageAnalysisRangePreset = "today" | "7d" | "30d" | "90d" | "all"
export type UsageAnalysisTimeBucketGranularity = "day" | "hour"

export type UsageAnalysisRangeInput = {
  readonly preset: UsageAnalysisRangePreset
  readonly bucket?: UsageAnalysisTimeBucketGranularity
}

export type UsageAnalysisDetailInput = UsageAnalysisRangeInput & {
  readonly limit?: number
  readonly offset?: number
}

export type UsageAnalysisTokenBreakdown = {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export type UsageAnalysisCostBreakdown = UsageAnalysisTokenBreakdown

export type UsageAnalysisModelPriceRule = {
  readonly id: string
  readonly modelPattern: string
  readonly inputPer1M: number
  readonly outputPer1M: number
  readonly cacheReadPer1M: number
  readonly cacheWritePer1M: number
  readonly reasoningPer1M: number
  readonly currency: "CNY"
  readonly enabled: boolean
  readonly source: "builtin" | "user"
  readonly sortIndex: number
  readonly updatedAt: string
}

export type UsageAnalysisModelPriceRuleInput = {
  readonly id?: string
  readonly modelPattern: string
  readonly inputPer1M?: number
  readonly outputPer1M?: number
  readonly cacheReadPer1M?: number
  readonly cacheWritePer1M?: number
  readonly reasoningPer1M?: number
  readonly currency?: "CNY"
  readonly enabled?: boolean
}

export type ModelPriceRule = UsageAnalysisModelPriceRule
export type ModelPriceRuleInput = UsageAnalysisModelPriceRuleInput
export type ModelPricePresetId = "openai" | "anthropic" | "deepseek-official" | "aliyun-bailian" | "other"
export type ModelPricePresetSummary = {
  readonly id: ModelPricePresetId
  readonly label: string
  readonly ruleCount: number
}
export type ModelPriceCoverageSource = "all" | "cc" | "codex"
export type ModelPriceCoverageRange = UsageAnalysisRangePreset
export type ModelPriceUsageSourceName = "cc" | "codex"

export type ModelPriceCoverageInput = {
  readonly source?: ModelPriceCoverageSource
  readonly range?: ModelPriceCoverageRange
  readonly limit?: number
}

export type ModelPriceCoverageRow = {
  readonly model: string
  readonly sources: ModelPriceUsageSourceName[]
  readonly tokens: number
  readonly requests: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly priceKnown: boolean
  readonly matchedRuleId?: string
  readonly matchedRulePattern?: string
}

export type UsageAnalysisRefreshResult = {
  readonly scannedFiles: number
  readonly parsedFiles: number
  readonly skippedFiles: number
  readonly failedFiles: number
  readonly usageEvents: number
  readonly toolEvents: number
  readonly elapsedMs: number
}

export type UsageAnalysisTimeBucket = {
  readonly bucket: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly requests: number
  readonly conversations: number
  readonly toolCalls: number
  readonly dominantModel: string
  readonly modelBreakdown: UsageAnalysisTimeModelBucket[]
}

export type UsageAnalysisTimeModelBucket = UsageAnalysisTokenBreakdown & {
  readonly model: string
  readonly tokens: number
}

export type UsageAnalysisModelRow = {
  readonly model: string
  readonly provider?: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly requests: number
  readonly averageTokensPerRequest: number
}

export type UsageAnalysisProjectRow = {
  readonly workspaceKey: string
  readonly workspaceLabel: string
  readonly sessions: number
  readonly requests: number
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly toolCalls: number
  readonly lastUsedAt: string
}

export type UsageAnalysisToolRow = {
  readonly toolName: string
  readonly category: string
  readonly calls: number
  readonly failures: number
  readonly failureRate: number
  readonly averageDurationMs: number
}

export type UsageAnalysisDetailRow = {
  readonly id: string
  readonly usageEventId?: string
  readonly timestamp: string
  readonly timestampMs?: number
  readonly sessionId: string
  readonly workspaceLabel: string
  readonly model: string
  readonly tokens: number
  readonly pricedTokens: number
  readonly unpricedTokens: number
  readonly estimatedCost: number
  readonly tokenBreakdown: UsageAnalysisTokenBreakdown
  readonly toolCalls: number
  readonly durationMs?: number
}

export type UsageAnalysisOverviewReport = {
  readonly generatedAt: string
  readonly totals: {
    readonly tokens: number
    readonly pricedTokens: number
    readonly unpricedTokens: number
    readonly estimatedCost: number
    readonly requests: number
    readonly conversations: number
    readonly toolCalls: number
    readonly activeDays: number
  }
  readonly tokenBreakdown: UsageAnalysisTokenBreakdown
  readonly costBreakdown: UsageAnalysisCostBreakdown
  readonly topModels: UsageAnalysisModelRow[]
  readonly topProjects: UsageAnalysisProjectRow[]
  readonly topTools: UsageAnalysisToolRow[]
  readonly trend: UsageAnalysisTimeBucket[]
}

export type UsageAnalysisBridgeDomain = {
  refresh: (input?: UsageAnalysisRefreshInput) => Promise<UsageAnalysisRefreshResult>
  getOverview: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisOverviewReport>
  getTime: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisTimeBucket[]>
  getModels: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisModelRow[]>
  getProjects: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisProjectRow[]>
  getTools: (range: UsageAnalysisRangeInput) => Promise<UsageAnalysisToolRow[]>
  getDetails: (range: UsageAnalysisDetailInput) => Promise<UsageAnalysisDetailRow[]>
}

export type UsageAnalysisRefreshInput = {
  readonly preset: "today"
}

export type ClaudeCodeUsageAnalysisBridgeDomain = UsageAnalysisBridgeDomain & {
  listRecords: (input: CcRecordListInput) => Promise<CcRecordListResult>
  listRecordDetails: (input: CcRecordDetailsInput) => Promise<CcRecordDetailsResult>
  listConversations: (input: CcConversationListInput) => Promise<CcConversationListResult>
  getConversation: (sessionId: string, focus?: CcConversationFocus) => Promise<CcConversationDetail>
  getConversationChunk: (input: CcConversationChunkInput) => Promise<CcConversationChunk>
  searchRecordsText: (input: CcRecordListInput) => Promise<CcRecordListResult>
  searchConversationText: (input: CcConversationListInput) => Promise<CcConversationListResult>
  openConversationWindow: (request: CcConversationWindowRequest) => Promise<void>
}

export type SynapseBridge = {
  platform: string
  versions: {
    chrome: string
    electron: string
    node: string
  }
  isPackaged: boolean
  apps: {
    openSystemApp: (
      appId: SynapseSystemAppId,
      options?: SynapseSystemAppOpenOptions,
    ) => Promise<void>
    onContentOpenRequest: (
      listener: (request: SynapseSystemAppContentOpenRequest) => void,
    ) => () => void
    onGitOpenRequest: (
      listener: (request: SynapseSystemAppGitOpenRequest) => void,
    ) => () => void
    onTerminalOpenRequest: (
      listener: (request: SynapseSystemAppTerminalOpenRequest) => void,
    ) => () => void
  }
  documentTemplate: {
    template: { choose: () => Promise<string | null> }
    json: { choose: () => Promise<string | null> }
    output: { choose: (input?: { defaultPath?: string }) => Promise<string | null> }
    docx: { generate: (input: GenerateDocxInput) => Promise<GenerateDocxResult> }
  }
  textExtractor: {
    document: {
      choose: () => Promise<string | null>
      extract: (input: TextExtractionRequest) => Promise<TextExtractionResponse>
      cancel: (input: { operationId: string }) => Promise<{ cancelled: boolean }>
    }
    output: {
      choose: (input: TextOutputChooseRequest) => Promise<string | null>
    }
    text: {
      save: (input: TextSaveInput) => Promise<TextSaveResponse>
    }
    operation: {
      onStatus: (listener: (event: TextExtractionStatusEvent) => void) => () => void
    }
  }
  fileOpener: {
    file: {
      open: (input: FileOpenInput) => Promise<FileOpenResult>
    }
  }
  textFileWriter: {
    output: {
      choose: (input?: TextFileOutputChooseRequest) => Promise<string | null>
    }
    file: {
      write: (input: TextFileWriteInput) => Promise<TextFileWriteResponse>
    }
  }
  htmlGenerator: {
    output: {
      choose: (input?: HtmlGeneratorOutputChooseRequest) => Promise<string | null>
    }
    ejs: {
      generate: (input: HtmlGenerationInput) => Promise<HtmlGenerationResponse>
    }
    ejsFile: {
      generate: (input: HtmlGenerationFileInput) => Promise<HtmlGenerationFileResponse>
    }
  }
  skillUninstaller: {
    scan: (request: SkillUninstallScanRequest) => Promise<SkillUninstallScanResult>
    scanNames: (request: SkillUninstallNameScanRequest) => Promise<SkillUninstallNameScanResult>
    cancelScan: (request: SkillUninstallCancelRequest) => Promise<{ cancelled: boolean }>
    cancelUninstall: (request: SkillUninstallExecutionCancelRequest) => Promise<{ cancelled: boolean }>
    uninstall: (request: SkillUninstallRequest) => Promise<SkillUninstallBatchResult>
  }
  quickInput: {
    item: {
      list: () => Promise<SynapseQuickInputItem[]>
      create: (input: { content: string }) => Promise<SynapseQuickInputItem>
      update: (input: { id: string; content: string }) => Promise<SynapseQuickInputItem>
      delete: (input: { id: string }) => Promise<void>
      onChanged: (listener: (event: SynapseQuickInputChangedEvent) => void) => () => void
    }
  }
  secrets: {
    item: {
      list: () => Promise<SecretListResult>
      get: (input: SecretGetInput) => Promise<SecretSafeView | SecretValueView>
      create: (input: SecretCreateInput) => Promise<SecretSafeView>
      update: (input: SecretUpdateInput) => Promise<SecretSafeView>
      upsert: (input: SecretUpsertInput) => Promise<SecretUpsertResult>
      delete: (input: SecretDeleteInput) => Promise<SecretSafeView>
      onChanged: (listener: (event: SecretsChangedEvent) => void) => () => void
    }
    operation: {
      scanSkillEnvBindings: (input: SecretSkillEnvScanInput) => Promise<SecretSkillEnvScanResult>
      scanSkillEnvBindingsBatch: (input: SecretSkillEnvBatchScanInput) => Promise<SecretSkillEnvBatchScanResult>
      queueSkillEnvBindings: (input: SecretSkillEnvQueueInput) => Promise<SecretSkillEnvQueueResult>
    }
  }
  connectors: {
    item: {
      list: () => Promise<ConnectorListResult>
      connect: (input: { id: string }) => Promise<ConnectorItem>
      disconnect: (input: { id: string }) => Promise<void>
      onChanged: (listener: (event: { items: ConnectorItem[] }) => void) => () => void
    }
  }
  agentPersonas: {
    list: () => Promise<SynapseAgentPersonaListResult>
    create: (input: SynapseAgentPersonaCreateInput) => Promise<SynapseAgentPersona>
    update: (input: SynapseAgentPersonaUpdateInput) => Promise<SynapseAgentPersona>
    updateBuiltinModel: (input: SynapseAgentPersonaBuiltinModelUpdateInput) => Promise<SynapseAgentPersona>
    delete: (input: SynapseAgentPersonaIdInput) => Promise<void>
    onChanged: (listener: (event: SynapseAgentPersonaChangedEvent) => void) => () => void
  }
  driveSync: {
    getSnapshot: () => Promise<DriveSyncSnapshotDto>
    previewBinding: (input: {
      driveItemId: string
      driveItemName: string
      kind: "file" | "folder"
      drivePathHint?: string | null
      localPath: string
      remoteExists: boolean
      directionHint?: "remote_to_local" | "local_to_remote" | "bind_existing" | null
      excludeRules?: readonly string[]
      useDefaultExcludes?: boolean
      importGitignore?: boolean
    }) => Promise<DriveSyncBindingPreviewDto>
    createSafeBinding: (input: DriveSyncCreateSafeBindingInput) => Promise<DriveSyncBindingDto>
    removeBinding: (input: { id: string }) => Promise<void>
    pauseBinding: (input: { id: string }) => Promise<DriveSyncBindingDto>
    resumeBinding: (input: { id: string }) => Promise<DriveSyncBindingDto>
    updateExcludeRules: (input: DriveSyncUpdateExcludeRulesInput) => Promise<DriveSyncBindingDto>
    rescanBinding: (input: { id: string }) => Promise<void>
    pollRemoteChanges: (input?: { id?: string }) => Promise<void>
    resolveConflict: (input: DriveSyncConflictResolutionInput) => Promise<void>
    chooseLocalPath: (input: { kind: "file" | "folder"; mode?: "bind_existing" | "remote_to_local" | "local_to_remote"; defaultName?: string }) => Promise<string | null>
    onChanged: (listener: (snapshot: DriveSyncSnapshotDto) => void) => () => void
  }
  soundNotifier: {
    settings: {
      get: () => Promise<SynapseSoundNotifierSettings>
      update: (input: SynapseSoundNotifierSettingsPatch) => Promise<SynapseSoundNotifierSettings>
    }
    sound: {
      play: (input?: SynapseSoundNotifierPlayInput) => Promise<SynapseSoundNotifierPlayResult>
      preview: (input?: SynapseSoundNotifierPlayInput) => Promise<SynapseSoundNotifierPlayResult>
    }
    operation: {
      onChanged: (listener: (event: SynapseSoundNotifierChangedEvent) => void) => () => void
      onPlayRequested: (listener: (event: SynapseSoundNotifierPlayRequestedEvent) => void) => () => void
    }
  }
  systemNotifier: {
    settings: {
      get: () => Promise<SynapseSystemNotifierSettings>
      update: (input: SynapseSystemNotifierSettingsPatch) => Promise<SynapseSystemNotifierSettings>
    }
    notification: {
      test: () => Promise<SynapseSystemNotificationResult>
    }
  }
  jsonRepair: {
    text: {
      repair: (input: JsonRepairInput) => Promise<JsonRepairResponse>
    }
  }
  terminal: {
    globalLaunch: {
      get: () => Promise<SynapseTerminalGlobalLaunchSettings>
      update: (input: SynapseTerminalUpdateGlobalLaunchSettingsInput) => Promise<SynapseTerminalGlobalLaunchSettings>
    }
    launch: {
      chooseCwd: () => Promise<string | null>
      revealEnvironmentValue: (input: SynapseTerminalEnvironmentValueInput) => Promise<string | null>
      copyEnvironmentValue: (input: SynapseTerminalEnvironmentValueInput) => Promise<void>
    }
    group: {
      list: () => Promise<SynapseTerminalGroupSummary[]>
      get: (input: { groupId: string }) => Promise<SynapseTerminalGroup>
      create: (input: SynapseTerminalCreateGroupInput) => Promise<SynapseTerminalGroupSummary>
      rename: (input: SynapseTerminalRenameGroupInput) => Promise<SynapseTerminalGroupSummary>
      updateSettings: (input: SynapseTerminalUpdateGroupSettingsInput) => Promise<SynapseTerminalGroupSummary>
      delete: (input: SynapseTerminalDeleteGroupInput) => Promise<void>
    }
    groupCommand: {
      get: (input: { groupId: string; commandId: string }) => Promise<SynapseTerminalGroupCommand>
      create: (input: SynapseTerminalCreateGroupCommandInput) => Promise<SynapseTerminalGroupCommand>
      update: (input: SynapseTerminalUpdateGroupCommandInput) => Promise<SynapseTerminalGroupCommand>
      delete: (input: SynapseTerminalDeleteGroupCommandInput) => Promise<void>
      launch: (input: SynapseTerminalLaunchGroupCommandInput) => Promise<SynapseTerminalSession>
    }
    workspace: {
      list: () => Promise<SynapseTerminalWorkspace[]>
      get: (input: { workspaceId: string }) => Promise<SynapseTerminalWorkspace>
      getForSession: (input: { sessionId: string }) => Promise<SynapseTerminalWorkspace>
      rename: (input: SynapseTerminalRenameWorkspaceInput) => Promise<SynapseTerminalWorkspace>
      close: (input: SynapseTerminalCloseWorkspaceInput) => Promise<SynapseTerminalCloseWorkspaceResult>
    }
    pane: {
      split: (input: SynapseTerminalSplitPaneInput) => Promise<SynapseTerminalSplitPaneResult>
      updateRatio: (input: SynapseTerminalSetSplitRatioInput) => Promise<SynapseTerminalWorkspace>
      close: (input: SynapseTerminalClosePaneInput) => Promise<SynapseTerminalCloseWorkspaceResult>
    }
    session: {
      list: () => Promise<SynapseTerminalSession[]>
      create: (input: SynapseTerminalCreateSessionInput) => Promise<SynapseTerminalSession>
      get: (input: { sessionId: string }) => Promise<SynapseTerminalSession>
      attach: (input: SynapseTerminalAttachSessionInput) => Promise<SynapseTerminalAttachSessionResult>
      read: (input: SynapseTerminalReadSessionInput) => Promise<SynapseTerminalReadSessionResult>
      rename: (input: SynapseTerminalRenameSessionInput) => Promise<SynapseTerminalSession>
      write: (input: SynapseTerminalWriteSessionInput) => Promise<void>
      resize: (input: SynapseTerminalResizeSessionInput) => Promise<void>
      delete: (input: SynapseTerminalDeleteSessionInput) => Promise<void>
      stop: (input: SynapseTerminalStopSessionInput) => Promise<void>
      runStartupCommand: (input: SynapseTerminalRunStartupCommandInput) => Promise<void>
    }
    operation: {
      onData: (listener: (event: SynapseTerminalDataEvent) => void) => () => void
      onSessionChanged: (listener: (session: SynapseTerminalSession) => void) => () => void
      onSessionDeleted: (listener: (event: SynapseTerminalSessionDeletedEvent) => void) => () => void
      onResized: (listener: (event: SynapseTerminalResizedEvent) => void) => () => void
      onDomainChanged: (listener: (event: SynapseTerminalDomainChangedEvent) => void) => () => void
    }
  }
  git: {
    checkEnvironment: () => Promise<SynapseGitEnvironmentState>
    configureIdentity: (input: { userName: string; userEmail: string }) => Promise<void>
    getSshPublicKey: () => Promise<SynapseGitSshPublicKey | null>
    checkAccess: (input?: { hosts?: { host: string; protocol: SynapseGitProtocol; provider: SynapseGitProvider }[] }) => Promise<SynapseGitAccessState>
    configureCredentialHelper: (input: { helper: string }) => Promise<void>
    saveHttpsCredential: (input: SynapseGitSaveHttpsCredentialInput) => Promise<void>
    clearHttpsCredential: (input: SynapseGitClearHttpsCredentialInput) => Promise<void>
    generateSshKey: (input: SynapseGitGenerateSshKeyInput) => Promise<void>
    testSshConnection: (input: SynapseGitTestSshConnectionInput) => Promise<SynapseGitSshTestResult>
    scanSshHostKey: (input: SynapseGitTestSshConnectionInput) => Promise<SynapseGitSshHostKeyCandidate>
    trustSshHostKey: (input: { host: string; port?: number | null; fingerprints: readonly string[] }) => Promise<void>
    listRepositories: () => Promise<SynapseGitRepository[]>
    listRepositorySummaries: () => Promise<SynapseGitRepositorySummary[]>
    addLocalRepository: (input: { name: string; localPath: string }) => Promise<SynapseGitRepository>
    removeRepository: (repositoryId: string) => Promise<void>
    cloneRepository: (input: {
      remoteUrl: string
      parentDirectory: string
      directoryName: string
      operationId?: string
    }) => Promise<SynapseGitCloneResult>
    getSnapshot: (repositoryId: string) => Promise<SynapseGitRepositorySnapshot>
    getDiff: (input: {
      repositoryId: string
      path: string
    }) => Promise<SynapseGitDiffResult>
    prepareChangeSelection: (input: {
      repositoryId: string
      paths: string[]
    }) => Promise<SynapseGitChangeSelection>
    discardChanges: (input: {
      repositoryId: string
      selectionId: string
      operationId?: string
    }) => Promise<SynapseGitDiscardChangesResult>
    commit: (input: {
      repositoryId: string
      message: string
      selectionId: string
      operationId?: string
    }) => Promise<SynapseGitOperationResult>
    fetch: (repositoryId: string, operationId?: string) => Promise<SynapseGitOperationResult>
    pull: (repositoryId: string, operationId?: string) => Promise<SynapseGitOperationResult>
    push: (repositoryId: string, remoteName?: string, operationId?: string) => Promise<SynapseGitOperationResult>
    inspectInitialization: (input: {
      repositoryId: string
      remoteName?: string
      operationId?: string
    }) => Promise<SynapseGitInitializationPlan>
    initializeRepository: (input: {
      repositoryId: string
      branchName: string
      kind: SynapseGitInitializationPlan["kind"]
      message?: string
      remoteName: string
      operationId?: string
    }) => Promise<SynapseGitOperationResult>
    listPushTargets: (repositoryId: string) => Promise<SynapseGitPushTarget[]>
    sync: (repositoryId: string, operationId?: string) => Promise<SynapseGitOperationResult>
    listBranches: (repositoryId: string) => Promise<SynapseGitBranch[]>
    checkoutBranch: (repositoryId: string, branchName: string, operationId?: string) => Promise<void>
    createBranch: (repositoryId: string, branchName: string, operationId?: string) => Promise<void>
    listRemoteBranches: (repositoryId: string) => Promise<SynapseGitRemoteBranchGroup[]>
    fetchRemoteBranches: (repositoryId: string, operationId?: string) => Promise<void>
    checkoutRemoteBranch: (
      repositoryId: string,
      input: SynapseGitCheckoutRemoteBranchInput,
      operationId?: string,
    ) => Promise<SynapseGitCheckoutRemoteBranchResult>
    cancelOperation: (operationId: string) => Promise<boolean>
    onOperationChanged: (listener: (state: SynapseGitOperationState) => void) => () => void
    listHistory: (input: {
      repositoryId: string
      limit: number
      offset: number
    }) => Promise<SynapseGitCommitSummary[]>
    getCommit: (repositoryId: string, hash: string) => Promise<SynapseGitCommitDetail>
  }
  account: {
    getState: () => Promise<SynapseAccountState>
    startLogin: () => Promise<SynapseAccountState>
    cancelLogin: () => Promise<SynapseAccountState>
    refresh: () => Promise<SynapseAccountState>
    logout: () => Promise<SynapseAccountState>
    listWebhooks: () => Promise<DashboardWebhookDto[]>
    onStateChanged: (listener: (event: SynapseAccountStateChangedEvent) => void) => () => void
  }
  drive: {
    item: {
      list: (input?: DriveItemListInput) => Promise<DriveItemListPageDto>
      get: (input: { itemId: string }) => Promise<DriveItemDto>
      previewUrl: (input: { itemId: string }) => Promise<{ url: string }>
      download: (input: { itemId: string }) => Promise<{ ok: true; path: string } | null>
      rename: (input: { itemId: string; name: string }) => Promise<DriveItemDto>
      move: (input: { itemId: string; parentId: string | null }) => Promise<DriveItemDto>
      delete: (input: { itemId: string }) => Promise<{ ok: true }>
    }
    upload: {
      prepare: (input: { parentId?: string | null; name: string; size: string; mimeType?: string | null; expectedItemId?: string | null }) => Promise<DriveUploadPrepareResult>
      folder: { prepare: (input: { parentId?: string | null; folderName: string; files: Array<{ relativePath: string; size: string; mimeType?: string | null }> }) => Promise<DriveFolderUploadPrepareResult> }
      complete: (input: { sessionId: string }) => Promise<DriveItemDto>
      put: (input: { method: "PUT"; url: string; headers: Record<string, string>; body: ArrayBuffer }) => Promise<{ ok: true }>
      localItems: (input: DriveLocalUploadRequest) => Promise<DriveLocalUploadResult>
      cancel: (input: { sessionId: string }) => Promise<{ ok: true }>
      onLocalProgress: (listener: (event: DriveLocalUploadProgressEvent) => void) => () => void
    }
    localFile: { pathForDroppedFile: (file: File) => string | null }
    folder: { create: (input: { parentId?: string | null; name: string }) => Promise<DriveItemDto> }
    fileVersion: {
      list: (input: { itemId: string } & DriveFileVersionListInput) => Promise<DriveFileVersionListPageDto>
      restore: (input: { itemId: string; versionId: string }) => Promise<DriveItemDto>
      delete: (input: { itemId: string; versionId: string }) => Promise<DriveFileVersionDeleteResult>
    }
    fileVersionDownload: { create: (input: { itemId: string; versionId: string; outputPath: string }) => Promise<{ ok: true; path: string }> }
    fileVersionPin: { update: (input: { itemId: string; versionId: string; isPinned: boolean }) => Promise<DriveFileVersionDto> }
    link: {
      resolve: (input: DriveLinkResolveInput) => Promise<DriveLinkResolveDto>
      list: (input: DriveLinkListInput) => Promise<DriveLinkListDto>
      readText: (input: DriveLinkReadTextInput) => Promise<DriveLinkReadTextDto>
      materialize: (input: DriveLinkMaterializeInput) => Promise<DriveLinkMaterializeDto>
      downloadFile: (input: DriveLinkDownloadFileInput) => Promise<DriveLinkDownloadFileDto>
    }
    share: {
      create: (input: { itemId: string } & DriveAccessSettingsUpdateInput) => Promise<DriveShareDto>
      disable: (input: { shareId: string }) => Promise<{ ok: true }>
      get: (input: { shareId: string }) => Promise<DriveShareListItemDto>
      list: (input?: DrivePublicLinksPageInput) => Promise<DriveShareListPageDto>
    }
    usage: { get: () => Promise<DriveUsageDto> }
    directLink: {
      list: (input?: DrivePublicLinksPageInput) => Promise<DrivePublicAssetListPageDto>
      get: (input: { assetId: string }) => Promise<DrivePublicAssetDto>
      upload: (input: DrivePublicAssetUploadRequest) => Promise<DrivePublicAssetUploadResult>
      uploadBinary: (input: DrivePublicAssetBinaryUploadRequest) => Promise<DrivePublicAssetDto>
      update: (input: { assetId: string } & DrivePublicAssetLocalFile) => Promise<DrivePublicAssetDto>
      rename: (input: { assetId: string; name: string }) => Promise<DrivePublicAssetDto>
      delete: (input: { assetId: string }) => Promise<DrivePublicAssetDto>
      restore: (input: { assetId: string }) => Promise<DrivePublicAssetDto>
    }
    documentImages: {
      scan: (input: DriveDocumentImageSourceContext) => Promise<DriveDocumentImageSourcesDto>
      import: (input: DriveDocumentImageImportBridgeRequest) => Promise<DriveDocumentImageImportResult>
    }
    site: {
      preflight: (input: { sourceFolderItemId: string }) => Promise<DriveSitePreflightDto>
      create: (input: DriveSiteCreateInput) => Promise<DriveSiteDto>
      list: (input?: DriveSiteListInput) => Promise<DriveSiteListPageDto>
      updateAccess: (input: { siteId: string } & DriveSiteAccessUpdateInput) => Promise<DriveSiteDto>
      disable: (input: { siteId: string }) => Promise<DriveSiteDto>
      enable: (input: { siteId: string }) => Promise<DriveSiteDto>
      delete: (input: { siteId: string }) => Promise<{ ok: true }>
      republish: (input: { siteId: string; entryPath?: string | null }) => Promise<DriveSiteDto>
    }
    trash: {
      list: (input?: DrivePublicLinksPageInput) => Promise<DriveTrashListPageDto>
      restore: (input: { itemId: string; kind?: DriveTrashItemDto["kind"]; assetId?: string }) => Promise<DriveItemDto | DrivePublicAssetDto>
      delete: (input: { itemId: string }) => Promise<{ ok: true }>
    }
  }
  live: {
    getState: () => Promise<SynapseLiveState>
    retry: () => Promise<SynapseLiveState>
    onStateChanged: (listener: (event: SynapseLiveStateChangedEvent) => void) => () => void
  }
  resourceRepository: {
    item: {
      list: <T extends SynapseContentType>(args: { contentType: T }) => Promise<SynapseContentMeta<T>[]>
      create: (request: SynapseCreateContentRequest) => Promise<SynapseContentMutationResult>
      update: (request: SynapseUpdateContentRequest) => Promise<SynapseContentMutationResult>
      restore: (payload: SynapseRestoreContentPayload) => Promise<SynapseContentMutationResult>
      purge: (payload: SynapsePurgeContentPayload) => Promise<SynapseContentMutationResult>
      download: (args: { contentType: SynapseContentType; id: string }) => Promise<SynapseContentDownloadResult>
      onChanged: (listener: (payload: SynapseContentChangedEvent) => void) => () => void
    }
    operation: {
      getContent: (args: { contentType: SynapseContentType; id: string }) => Promise<SynapseTextContentFile>
      getDetail: (args: { contentType: SynapseContentType; id: string }) => Promise<SynapseContentDetail>
      getAttachmentFile: (args: { contentType: SynapseContentType; historyDirname: string; id: string; originalName: string }) => Promise<SynapseContentFile | null>
      deleteContent: (payload: SynapseDeleteContentPayload) => Promise<SynapseContentMutationResult>
      listDeleted: <T extends SynapseContentType>(args: { contentType: T }) => Promise<SynapseContentMeta<T>[]>
      openDetailWindow: (payload: SynapseOpenContentWindowPayload) => Promise<void>
      openCreateWindow: (payload: SynapseOpenContentCreateWindowPayload) => Promise<void>
      openEditWindow: (payload: SynapseOpenContentEditWindowPayload) => Promise<void>
      readEditorInitPayload: (payload: { requestId: string }) => Promise<SynapseOpenContentCreateWindowPayload | SynapseOpenContentEditWindowPayload | null>
      getEditorAdapters: () => Promise<SynapseEditorAdapterSummary[]>
      installToEditor: (payload: SynapseInstallToEditorPayload) => Promise<SynapseContentInstallResult>
      readEditorInstallFormValues: (payload: SynapseReadEditorInstallFormValuesPayload) => Promise<SynapseReadEditorInstallFormValuesResult>
      getIconPromptTemplate: (args: { contentType: SynapseContentType; id: string }) => Promise<string | null>
      readIconImage: (args: { contentType: SynapseContentType; id: string }) => Promise<string | null>
      resolveEditorInstallTarget: (payload: SynapseResolveEditorTargetPayload) => Promise<SynapseEditorResolvedTarget>
    }
  }
  skillRepositoryInstall: {
    resolve: (sessionId: string) => Promise<SynapseSkillRepositoryInstallResolveResult>
    prepare: (sessionId: string) => Promise<SynapseSkillRepositoryInstallPrepareResult>
    recordComplete: (sessionId: string) => Promise<{ ok: true }>
  }
  installers: {
    inspectGlobalSkillInstallations: (
      source: SynapseSkillInstallerSource,
    ) => Promise<SynapseEditorInstallStatusResult>
    inspectSkillEnvSource: (
      source: SynapseSkillInstallerSource,
    ) => Promise<SynapseSkillEnvInspectionResult>
    installSourceToEditor: (
      payload: SynapseInstallSourceToEditorPayload,
    ) => Promise<SynapseContentInstallResult>
    installSourceToEditorTargets: (
      payload: SynapseInstallSourceToEditorTargetsPayload,
    ) => Promise<SynapseInstallSourceToEditorTargetsResult>
    prepareLocalSkillSource: (
      payload: SynapsePrepareLocalSkillSourcePayload,
    ) => Promise<SynapseSkillInstallerSource>
    prepareInlineRuleSource: (
      payload: SynapsePrepareInlineRuleSourcePayload,
    ) => Promise<SynapseRuleInstallerSource>
  }
  synapseSkill: {
    prepareInstallSource: () => Promise<SynapseSkillInstallerSource>
    releaseInstallSource: (preparedSourceId: string) => Promise<void>
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
    write: (payload: SynapseRendererLogPayload) => Promise<void>
  }
  editor: {
    getGlobalDirectories: () => Promise<SynapseEditorGlobalDirectory[]>
    createDirectory: (dirPath: string) => Promise<void>
  }
  editorScan: {
    scanAll: (request: EditorScanRequest) => Promise<EditorScanResult>
    cancelScan: (request: EditorScanRequest) => Promise<EditorScanCancelResult>
    readItemContent: (filePath: string) => Promise<string>
    listSkillFiles: (dirPath: string) => Promise<EditorScanSkillFileEntry[]>
    prepareQuickPublishDraft: (
      request: EditorScanQuickPublishRequest,
    ) => Promise<EditorScanQuickPublishDraft>
    finalizeQuickPublish: (
      request: EditorScanFinalizeQuickPublishRequest,
    ) => Promise<EditorScanFinalizeQuickPublishResult>
    trashItem: (request: EditorScanTrashRequest) => Promise<EditorScanTrashResult>
    uploadSkillToSkillRepository: (
      request: EditorScanSkillRepositoryUploadRequest,
    ) => Promise<EditorScanSkillRepositoryUploadResult>
    retrySkillRepositoryIdentity: (
      request: EditorScanSkillRepositoryIdentityRetryRequest,
    ) => Promise<EditorScanSkillRepositoryIdentityRetryResult>
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
    uninstall: (payload: { contentId: string; editorId: string }) => Promise<InstallStatusUninstallResult>
    onChanged: (listener: (payload: InstallStatusChangedEvent) => void) => () => void
  }
  knowledgeBase: {
    createManaged: (
      payload: SynapseKnowledgeBaseCreateManagedPayload,
    ) => Promise<SynapseKnowledgeBaseCreateManagedResult>
    deleteManaged: (
      payload: SynapseKnowledgeBaseDeleteManagedPayload,
    ) => Promise<SynapseKnowledgeBaseDeleteManagedResult>
    selectImportFolder: () => Promise<SynapseKnowledgeBaseImportPreview | null>
    importManagedFolder: (
      payload: SynapseKnowledgeBaseImportManagedPayload,
    ) => Promise<SynapseKnowledgeBaseImportManagedResult>
    exportManagedFolder: (
      payload: SynapseKnowledgeBaseExportManagedPayload,
    ) => Promise<SynapseKnowledgeBaseExportManagedResult | null>
    getTransferState: () => Promise<SynapseKnowledgeBaseTransferProgress>
    cancelTransfer: () => Promise<void>
    listRawDirectory: (
      payload: SynapseKnowledgeBaseListRawDirectoryPayload,
    ) => Promise<SynapseKnowledgeBaseListRawDirectoryResult>
    uploadRawFiles: (
      payload: SynapseKnowledgeBaseUploadRawFilesPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    uploadRawItems: (
      payload: SynapseKnowledgeBaseUploadRawItemsPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    createRawFolder: (
      payload: SynapseKnowledgeBaseCreateRawFolderPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    renameRawEntry: (
      payload: SynapseKnowledgeBaseRenameRawEntryPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    moveRawEntries: (
      payload: SynapseKnowledgeBaseMoveRawEntriesPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    trashRawEntries: (
      payload: SynapseKnowledgeBaseTrashRawEntriesPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    addUrlSource: (
      payload: SynapseKnowledgeBaseAddUrlSourcePayload,
    ) => Promise<SynapseKnowledgeBaseUploadSourcesResult>
    selectAndUploadRawFiles: (
      payload: Omit<SynapseKnowledgeBaseUploadRawFilesPayload, "filePaths">,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    selectAndUploadRawDirectory: (
      payload: SynapseKnowledgeBaseSelectAndUploadRawDirectoryPayload,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    exportRawEntries: (
      payload: Omit<SynapseKnowledgeBaseExportRawEntriesPayload, "targetDirectoryPath">,
    ) => Promise<SynapseKnowledgeBaseRawMutationResult>
    openSourceManager: (payload: SynapseKnowledgeBaseOpenSourceManagerPayload) => Promise<void>
    getStorageStatus: () => Promise<SynapseKnowledgeBaseStorageStatus>
    getStorageMigrationState: () => Promise<SynapseKnowledgeBaseStorageMigrationProgress>
    startStorageMigration: (
      payload: SynapseKnowledgeBaseStorageMigrationPayload,
    ) => Promise<SynapseKnowledgeBaseStorageMigrationResult>
    cancelStorageMigration: () => Promise<void>
    recheckStorage: () => Promise<SynapseKnowledgeBaseStorageStatus>
    onStorageMigrationChanged: (
      listener: (payload: SynapseKnowledgeBaseStorageMigrationProgress) => void,
    ) => () => void
    onTransferChanged: (
      listener: (payload: SynapseKnowledgeBaseTransferProgress) => void,
    ) => () => void
    filePathForDroppedFile: (file: File) => string | null
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (filePath: string) => Promise<void>
    filePathForDroppedFile: (file: File) => string | null
  }
  settings: {
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
        options?: SynapseRepositoryInitializationOptions,
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
  }
  updater: {
    acknowledgeOpenRequest: (id: number) => Promise<void>
    cancelDownload: () => Promise<void>
    checkForUpdates: () => Promise<SynapseAppUpdateState>
    checkForUpdatesOnPageEnter: () => Promise<SynapseAppUpdateState>
    downloadUpdate: () => Promise<SynapseAppUpdateState>
    getPendingOpenRequest: () => Promise<SynapseAppUpdateOpenRequest | null>
    getState: () => Promise<SynapseAppUpdateState>
    installUpdate: () => Promise<void>
    onOpenRequest: (listener: (payload: SynapseAppUpdateOpenRequest) => void) => () => void
    onStateChanged: (listener: (payload: SynapseAppUpdateState) => void) => () => void
    onOpenUpdatePage: (listener: () => void) => () => void
  }
  cheatCodes: {
    getStates: (names?: readonly string[]) => Promise<SynapseCheatCodeStateMap>
    setState: (payload: SynapseCheatCodeStateResult) => Promise<SynapseCheatCodeStateResult>
    toggleState: (name: string) => Promise<SynapseCheatCodeStateResult>
    onStateChanged: (listener: (payload: SynapseCheatCodeStateChangedEvent) => void) => () => void
  }
  database: {
    table: {
      list: () => Promise<DatabaseTableInfo[]>
      create: (params: { name: string; description?: string; columns: Column[] }) => Promise<void>
      delete: (name: string) => Promise<void>
      describe: (name: string) => Promise<DatabaseTableSchema>
      update: (params: { table: string; description: string }) => Promise<void>
      rename: (params: { from: string; to: string }) => Promise<void>
      export: (table: string) => Promise<{ success: boolean; path?: string }>
      import: (input: { sourcePath: string; sourceDigest: string }) => Promise<{ success: boolean; tableName?: string }>
    }
    tableImport: { inspect: () => Promise<{ success: false } | ({ success: true } & DatabaseTableImportInspection)> }
    overview: { get: () => Promise<DatabaseOverview> }
    column: {
      create: (params: { table: string; column: Column & { default?: unknown } }) => Promise<void>
      update: (params: { table: string; column: string; description: string }) => Promise<void>
      rename: (params: { table: string; from: string; to: string }) => Promise<void>
      delete: (params: { table: string; column: string }) => Promise<void>
    }
    choice: { update: (params: { table: string; column: string; choices: string[] }) => Promise<void> }
    choiceUsage: { get: (params: { table: string; column: string }) => Promise<Record<string, number>> }
    row: {
      create: (params: { table: string; data: Record<string, unknown> }) => Promise<{ id: number }>
      list: (params: DatabaseQueryParams) => Promise<DatabaseQueryResult>
      update: (params: { table: string; id: number; data: Record<string, unknown> }) => Promise<{ affected: number }>
      delete: (params: { table: string; id: number }) => Promise<{ affected: number }>
      count: (params: { table: string; where?: DatabaseWhereClause }) => Promise<{ count: number }>
    }
    rows: {
      create: (params: { table: string; rows: Record<string, unknown>[] }) => Promise<{ ids: number[] }>
      update: (params: { table: string; where: DatabaseWhereClause; data: Record<string, unknown> }) => Promise<{ affected: number; ids: number[] }>
      delete: (params: { table: string; where: DatabaseWhereClause }) => Promise<{ affected: number; ids: number[] }>
    }
    sql: { execute: (params: { sql: string; params?: unknown[] }) => Promise<{ rows?: Record<string, unknown>[]; changes?: number; lastInsertRowid?: number }> }
    status: { get: () => Promise<DatabaseStatus> }
    operation: {
      export: () => Promise<{ success: boolean; path?: string }>
      import: () => Promise<{ success: boolean }>
      onChanged: (listener: (event: DatabaseChangeEvent) => void) => () => void
    }
    folder: {
      list: () => Promise<DatabaseFolder[]>
      create: (params: { name: string }) => Promise<{ id: number }>
      rename: (params: { id: number; name: string }) => Promise<void>
      delete: (params: { id: number }) => Promise<void>
      moveTable: (params: { tableName: string; folderId: number | null }) => Promise<void>
      reorder: (params: { folderId: number; tableNames: string[] }) => Promise<void>
      reorderFolders: (params: { folderIds: number[] }) => Promise<void>
    }
  }
  mcp: {
    server: {
      get: () => Promise<McpServerStatus>
    }
    registration: {
      list: () => Promise<McpRegistrationInfo[]>
      openSettings: (target: McpTarget) => Promise<{ success: boolean; error?: string }>
      register: (target: McpTarget) => Promise<{ success: boolean; error?: string }>
    }
  }
  automation: {
    editor: {
      openCreate: () => Promise<void>
      openEdit: (id: string) => Promise<void>
    }
    item: {
      list: () => Promise<AutomationItem[]>
      get: (id: string) => Promise<AutomationItem | null>
      create: (input: AutomationCreateInput) => Promise<AutomationItem>
      update: (payload: { id: string; patch: AutomationUpdateInput }) => Promise<AutomationItem>
      delete: (id: string) => Promise<{ deleted: boolean }>
      setEnabled: (payload: { id: string; enabled: boolean }) => Promise<AutomationItem>
      onChanged: (listener: (event: AutomationChangedEvent) => void) => () => void
    }
    run: {
      execute: (id: string) => Promise<AutomationRun | null>
      disable: (runId: string) => Promise<AutomationStopRunResult>
      list: (automationId: string, options?: { limit?: number }) => Promise<AutomationRun[]>
    }
  }
  agent: {
    status: (projectId: string) => Promise<SynapseAgentStatus>
    listSessions: (projectId: string) => Promise<SynapseAgentSessionSummary[]>
    listAllSessions: (request: { excludeProjectIds?: string[]; limit?: number }) => Promise<SynapseAgentSessionSummary[]>
    openConversationWindow: (
      request: AgentConversationWindowRequest,
    ) => Promise<AgentConversationWindowOpenResult>
    focusConversationWindow: (
      target: AgentConversationTarget,
    ) => Promise<AgentConversationWindowFocusResult>
    replaceConversationWindowTarget: (
      request: AgentConversationWindowReplaceRequest,
    ) => Promise<AgentConversationWindowReplaceResult>
    listDetachedConversationWindows: () => Promise<AgentDetachedConversation[]>
    getTimeline: (
      args: { projectId: string; sessionKey?: string; conversationId?: string; limit?: number; beforeIndex?: number },
    ) => Promise<SynapseAgentTimelineResult>
    getFileCheckpoint: (
      args: { projectId: string; conversationId: string; checkpointId: string },
    ) => Promise<SynapseAgentFileCheckpointDetail>
    getFileCheckpointDiff: (
      args: { projectId: string; conversationId: string; checkpointId: string; fileId: string },
    ) => Promise<SynapseAgentFileCheckpointDiff>
    prepareFileCheckpointRewind: (
      args: { projectId: string; conversationId: string; checkpointId: string },
    ) => Promise<SynapseAgentFileCheckpointPrepareResult>
    confirmFileCheckpointRewind: (
      args: { projectId: string; conversationId: string; operationId: string },
    ) => Promise<SynapseAgentFileCheckpointRewindResult>
    exportConversationBundle: (
      args: { projectId: string; sessionKey?: string; conversationId: string },
    ) => Promise<SynapseAgentConversationExportResult>
    createSession: (
      args: {
        projectId: string
        sessionKey?: string
        name?: string
        agentType?: string
        providerId?: string
        mode?: SynapseAgentPermissionMode
        modelTier?: string
        personaId?: string | null
      },
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
      args: {
        projectId: string
        sessionKey?: string
        conversationId?: string
        content: string
        displayContent?: string
        draftScopeId?: string
        attachments?: readonly SynapseAgentBridgeAttachment[]
        clientSubmittedAt?: string
        providerId?: string
      },
    ) => Promise<SynapseAgentSendResult>
    chooseAttachments: (
      args: { projectId: string; draftScopeId: string; kind: "file" | "directory" },
    ) => Promise<SynapseAgentAttachmentSelectionResult>
    resolveAttachmentPaths: (
      args: { projectId: string; draftScopeId: string; paths: readonly string[] },
    ) => Promise<SynapseAgentAttachmentSelectionResult>
    stageClipboardImage: (
      args: { projectId: string; draftScopeId: string; name?: string },
    ) => Promise<SynapseAgentAttachmentSelectionResult>
    releaseAttachments: (
      args: { projectId: string; draftScopeId: string; attachmentIds: readonly string[] },
    ) => Promise<{ releasedCount: number }>
    listPendingPermissions: (projectId: string) => Promise<SynapseAgentPendingPermission[]>
    respondPermission: (
      args: {
        projectId: string
        requestId: string
        behavior: "allow" | "deny"
        scope?: SynapseAgentPermissionScope
        updatedInput?: Record<string, unknown>
        message?: string
      },
    ) => Promise<{ ok: true }>
    setPermissionMode: (
      args: {
        projectId: string
        conversationId: string
        mode: SynapseAgentPermissionMode
      },
    ) => Promise<SynapseAgentSessionSummary>
    cancelTurn: (
      args: { projectId: string; conversationId: string },
    ) => Promise<SynapseAgentCancelTurnResult>
    forceKillTurn: (
      args: { projectId: string; conversationId: string },
    ) => Promise<SynapseAgentCancelTurnResult>
    getProviders: () => Promise<SynapseAgentProviderState>
    listProviders: () => Promise<SynapseAgentProvider[]>
    listProviderPresets: () => Promise<SynapseAgentProviderPreset[]>
    createProvider: (
      args: { provider: SynapseCreateAgentProviderInput },
    ) => Promise<SynapseAgentProvider>
    createProviderFromPreset: (
      args: SynapseCreateProviderFromPresetInput,
    ) => Promise<SynapseAgentProvider>
    previewCcSwitchClaudeProviders: (
      args?: { source?: SynapseCcSwitchImportSource },
    ) => Promise<SynapseCcSwitchClaudeImportPreviewResult>
    importCcSwitchClaudeProviders: (
      args: { source: SynapseCcSwitchImportSource; providerIds: readonly string[] },
    ) => Promise<SynapseImportCcSwitchClaudeProvidersResult>
    chooseCcSwitchClaudeImportSource: () => Promise<{ source?: SynapseCcSwitchImportSource }>
    chooseProviderPackageImportSource: () => Promise<{ sourcePath?: string }>
    chooseProviderPackageExportTarget: (
      args: { providerName: string },
    ) => Promise<{ targetPath?: string }>
    previewProviderPackageImport: (
      args: { sourcePath: string },
    ) => Promise<SynapseProviderPackageImportPreview>
    importProviderPackage: (
      args: { sourcePath: string; contentSha256: string },
    ) => Promise<SynapseProviderPackageImportResult>
    exportProviderPackage: (
      args: { providerId: string; targetPath: string },
    ) => Promise<SynapseProviderPackageExportResult>
    updateProvider: (
      args: { providerId: string; patch: SynapseUpdateAgentProviderInput },
    ) => Promise<SynapseAgentProvider>
    archiveProvider: (
      args: { providerId: string },
    ) => Promise<{ ok: true }>
    deleteProvider: (
      args: { providerId: string },
    ) => Promise<{ ok: true }>
    listAllProviders: () => Promise<SynapseAgentProvider[]>
    scanProviderReferences: (
      args: { providerId: string },
    ) => Promise<{
      providerId: string
      references: Array<{
        kind: "workflow-node" | "conversation" | "agent-persona"
        entityId: string
        entityName: string
        projectId?: string
        nodeId?: string
        nodeName?: string
        providerId: string
        modelTier: string
      }>
      workflowNodeCount: number
      conversationCount: number
      agentPersonaCount: number
    }>
    migrateProviderReferences: (
      args: {
        sourceProviderId: string
        targetProviderId: string
        targetModelTier: string
        scope: "workflow-node"[]
      },
    ) => Promise<{
      migratedWorkflowNodes: number
      errors: Array<{ entityId: string; error: string }>
    }>
    setActiveProvider: (
      args: { providerId: string },
    ) => Promise<{ ok: true }>
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
    openReferenceDefault: (args: AgentReferenceActionInput) => Promise<AgentReferenceActionResult>
    showReferenceInFolder: (args: AgentReferenceActionInput) => Promise<AgentReferenceActionResult>
    openConversation: (
      target: SynapseAgentConversationReference,
    ) => Promise<SynapseOpenAgentConversationResult>
    onOpenConversation: (listener: (payload: OpenAgentSessionPayload) => void) => () => void
    onEvent: (listener: (event: SynapseAgentDomainEvent) => void) => () => void
    onDetachedConversationWindowsChanged: (
      listener: (items: AgentDetachedConversation[]) => void,
    ) => () => void
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
    definition: {
      list: () => Promise<WorkflowListResult>
      get: (id: string) => Promise<WorkflowDefinition | null>
      create: () => Promise<{ id: string; versionHash: string } | { errors: ValidationError[] }>
      update: (def: WorkflowDefinition) => Promise<{ versionHash: string } | { errors: ValidationError[] }>
      delete: (id: string, options?: { cleanupImportedChildren?: boolean }) => Promise<void>
      inspect: (def: WorkflowDefinition) => Promise<ValidationResult>
    }
    run: {
      execute: (id: string, params: Record<string, unknown>, scriptConfirmationToken?: string) => Promise<{ runId: string; definition?: WorkflowDefinition } | { errors: ValidationError[] }>
      disable: (runId: string) => Promise<void>
      listActive: () => Promise<WorkflowRunListItem[]>
      list: (workflowId: string) => Promise<WorkflowRunListItem[]>
      get: (runId: string, workflowId?: string) => Promise<WorkflowRunStatus | null>
    }
    operation: {
      runDefinition: (def: WorkflowDefinition, params: Record<string, unknown>, force?: boolean, scriptConfirmationToken?: string) => Promise<{ runId: string; definition?: WorkflowDefinition } | { errors: ValidationError[] } | { conflict: true; activeRunId: string; definition?: WorkflowDefinition }>
      rerun: (previousRunId: string, params: Record<string, unknown>, force?: boolean, workflowId?: string, scriptConfirmationToken?: string) => Promise<{ runId: string } | { errors: ValidationError[] } | { conflict: true; activeRunId: string }>
      openRunner: (workflowId: string, runId: string) => Promise<void>
      openEditor: (id: string, runId?: string) => Promise<void>
      editorState: () => Promise<{ openEditors: string[]; states: Array<{ workflowId: string; dirty: boolean; saving: boolean }> }>
      setEditorMutationState: (workflowId: string, dirty: boolean, saving: boolean) => Promise<void>
      checkCanSync: () => Promise<{ canSync: boolean; blockers: string[] }>
      inspectDeletePackage: (workflowId: string) => Promise<WorkflowShareDeletePlan>
      inspectExportPackage: (workflowId: string) => Promise<WorkflowShareExportPreflight>
      exportPackage: (workflowId: string, workflowName?: string, migrationDiagnosticId?: string, shareNote?: string, expectedDigestSeed?: string) => Promise<{ path: string; kind: "package" | "future-raw" } | null>
      inspectImportPackage: () => Promise<WorkflowImportPreview | WorkflowShareImportPreview | null>
      importPackage: (packagePath: string, mappings: WorkflowModelMapping[], options?: WorkflowImportOptions, packageDigest?: string) => Promise<{ workflowId: string; versionHash: string } | { errors: ValidationError[] }>
      importSharePackage: (packagePath: string, selections: WorkflowShareImportSelections, packageDigest: string) => Promise<{ workflowId: string; workflowIds?: string[]; versionHash: string; mutated?: boolean; undoCreated?: boolean } | { errors: ValidationError[] }>
      undoShareImport: (lineageId: string) => Promise<{ workflowIds: string[] }>
      onEvent: (listener: (event: WorkflowEvent) => void) => () => void
      onRunnerSwitchRun: (listener: (payload: { runId: string }) => void) => () => void
      onEditorRefocus: (listener: (payload: { runId?: string }) => void) => () => void
    }
    paramFile: { choose: () => Promise<string | null> }
    paramDirectory: { choose: () => Promise<string | null> }
    paramFiles: { choose: () => Promise<string[]> }
    paramDirectories: { choose: () => Promise<string[]> }
    paramPreset: {
      list: (workflowId: string) => Promise<WorkflowParamPreset[]>
      resolveResourceEntryTypes: (id: string) => Promise<Record<string, WorkflowParamPresetResourceEntryType>>
      save: (input: SaveWorkflowParamPresetInput) => Promise<WorkflowParamPreset>
      delete: (id: string) => Promise<void>
    }
    editor: {
      onDefinitionUpdated: (listener: (payload: { workflowId: string; source?: string; versionHash?: string }) => void) => () => void
    }
  }
  usageAnalysis: {
    cc: ClaudeCodeUsageAnalysisBridgeDomain
    codex: UsageAnalysisBridgeDomain
  }
  modelPrice: {
    usedModel: {
      list: (input?: ModelPriceCoverageInput) => Promise<ModelPriceCoverageRow[]>
    }
    preset: {
      list: () => Promise<ModelPricePresetSummary[]>
      import: (presetIds: ModelPricePresetId | ModelPricePresetId[]) => Promise<ModelPriceRule[]>
    }
    rule: {
      list: () => Promise<ModelPriceRule[]>
      save: (rules: ModelPriceRuleInput[]) => Promise<ModelPriceRule[]>
      clear: () => Promise<ModelPriceRule[]>
    }
  }
  http: {
    testRequest: (config: Record<string, unknown>) => Promise<{
      status: number
      statusText: string
      headers: Record<string, string>
      body: string
      durationMs: number
    }>
  }
  diagnostics?: {
    onPing: (listener: () => void) => () => void
    pong: () => void
  }
}
