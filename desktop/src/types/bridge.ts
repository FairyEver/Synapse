import type {
  DatabaseChangeEvent,
  DatabaseFolder,
  DatabaseMcpHttpStatus,
  DatabaseMcpServerInfo,
  DatabaseMcpStatus,
  DatabaseMcpTarget,
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
import type {
  SynapseAccountState,
  SynapseAccountStateChangedEvent,
} from "./account"
import type {
  GenerateDocxInput,
  GenerateDocxResult,
} from "../../app-capabilities/document-template/shared/schema"
import type {
  SynapseQuickInputChangedEvent,
  SynapseQuickInputItem,
} from "./quick-input"
import type {
  SynapseAgentPersona,
  SynapseAgentPersonaBuiltinModelUpdateInput,
  SynapseAgentPersonaChangedEvent,
  SynapseAgentPersonaCreateInput,
  SynapseAgentPersonaIdInput,
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
  ScreenshotArtifact,
  ScreenshotCaptureInput,
  ScreenshotCaptureToFileInput,
  ScreenshotClipboardResult,
  ScreenshotInteractiveCaptureInput,
  ScreenshotRegion,
  ScreenshotSaveArtifactInput,
  ScreenshotSaveResult,
} from "../../app-capabilities/screenshot/shared/schema"
import type {
  SynapseTerminalCreateGroupCommandInput,
  SynapseTerminalCreateGroupInput,
  SynapseTerminalCreateSessionInput,
  SynapseTerminalDataEvent,
  SynapseTerminalDeleteGroupCommandInput,
  SynapseTerminalDeleteGroupInput,
  SynapseTerminalDeleteSessionInput,
  SynapseTerminalGroup,
  SynapseTerminalGroupCommand,
  SynapseTerminalLaunchGroupCommandInput,
  SynapseTerminalReadSessionInput,
  SynapseTerminalReadSessionResult,
  SynapseTerminalRenameGroupInput,
  SynapseTerminalRenameSessionInput,
  SynapseTerminalResizeSessionInput,
  SynapseTerminalRunStartupCommandInput,
  SynapseTerminalSession,
  SynapseTerminalSessionDeletedEvent,
  SynapseTerminalStopSessionInput,
  SynapseTerminalUpdateGroupCommandInput,
  SynapseTerminalUpdateGroupSettingsInput,
  SynapseTerminalWriteSessionInput,
} from "./terminal"
import type {
  SynapseContentStoreInstallPrepareResult,
  SynapseContentStoreInstallResolveResult,
} from "./content-store-install"
import type {
  SynapseInstallSourceToEditorPayload,
  SynapsePrepareInlineRuleSourcePayload,
  SynapsePrepareLocalSkillSourcePayload,
  SynapseRuleInstallerSource,
  SynapseSkillInstallerSource,
} from "./installers"
import type {
  DashboardWebhookDto,
  DriveDocumentImageImportRequest,
  DriveDocumentImageImportResult,
  DriveDocumentImageSourcesDto,
  DriveAccessSettingsInput,
  DriveFileVersionDto,
  DriveFileVersionListInput,
  DriveFileVersionListPageDto,
  DriveFolderUploadPrepareResult,
  DriveItemDto,
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
  DriveSyncSnapshotDto,
  DriveUsageDto,
} from "@synapse/shared" with { "resolution-mode": "import" }

export type DriveLocalUploadFileItem = {
  readonly kind: "file"
  readonly path: string
  readonly name: string
  readonly mimeType?: string | null
}

export type DriveLocalUploadFolderItem = {
  readonly kind: "folder"
  readonly folderName: string
  readonly files: Array<{
    readonly path: string
    readonly relativePath: string
    readonly mimeType?: string | null
  }>
}

export type DriveLocalUploadItem = DriveLocalUploadFileItem | DriveLocalUploadFolderItem

export type DriveLocalUploadRequest = {
  readonly parentId?: string | null
  readonly items: DriveLocalUploadItem[]
}

export type DriveLocalUploadResult = {
  readonly completed: number
  readonly failed: number
  readonly skipped: number
  readonly message?: string
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
  SynapseAgentConversationTarget,
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
  EditorScanQuickPublishDraft,
  EditorScanQuickPublishRequest,
  EditorScanContentStoreUploadRequest,
  EditorScanContentStoreUploadResult,
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
  SynapseGitClearHttpsCredentialInput,
  SynapseGitCommitDetail,
  SynapseGitCommitSummary,
  SynapseGitDiffResult,
  SynapseGitEnvironmentState,
  SynapseGitGenerateSshKeyInput,
  SynapseGitOperationResult,
  SynapseGitProvider,
  SynapseGitProtocol,
  SynapseGitRemoteKind,
  SynapseGitRepository,
  SynapseGitRepositoryRemoveInput,
  SynapseGitRepositorySummary,
  SynapseGitRepositorySnapshot,
  SynapseGitSaveHttpsCredentialInput,
  SynapseGitSshPublicKey,
  SynapseGitSshTestResult,
  SynapseGitTestSshConnectionInput,
} from "./git"
import type { SynapseAppUpdateState } from "./update"
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
  WorkflowMeta,
  SaveWorkflowParamPresetInput,
  ValidationError,
  ValidationResult,
  WorkflowEvent,
  WorkflowParamPreset,
  WorkflowRunListItem,
  WorkflowRunStatus,
} from "./workflow"
import type {
  SynapseSystemAppContentOpenRequest,
  SynapseSystemAppId,
  SynapseSystemAppOpenOptions,
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

export type SynapseAgentBridgeImageAttachment = {
  readonly kind: "image"
  readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  readonly data: ArrayBuffer
  readonly name?: string
  readonly size: number
}

export type SynapseAgentBridgePathAttachment = {
  readonly kind: "path"
  readonly path: string
  readonly entryType: "file" | "directory"
  readonly name?: string
}

export type SynapseAgentBridgeAttachment =
  | SynapseAgentBridgeImageAttachment
  | SynapseAgentBridgePathAttachment

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
  }
  documentTemplate: {
    chooseTemplateFile: () => Promise<string | null>
    chooseJsonFile: () => Promise<string | null>
    chooseOutputFile: (input?: { defaultPath?: string }) => Promise<string | null>
    generateDocx: (input: GenerateDocxInput) => Promise<GenerateDocxResult>
  }
  quickInput: {
    list: () => Promise<SynapseQuickInputItem[]>
    create: (input: { content: string }) => Promise<SynapseQuickInputItem>
    update: (input: { id: string; content: string }) => Promise<SynapseQuickInputItem>
    delete: (input: { id: string }) => Promise<void>
    onChanged: (listener: (event: SynapseQuickInputChangedEvent) => void) => () => void
  }
  agentPersonas: {
    list: () => Promise<SynapseAgentPersona[]>
    create: (input: SynapseAgentPersonaCreateInput) => Promise<SynapseAgentPersona>
    update: (input: SynapseAgentPersonaUpdateInput) => Promise<SynapseAgentPersona>
    updateBuiltinModel: (input: SynapseAgentPersonaBuiltinModelUpdateInput) => Promise<SynapseAgentPersona>
    delete: (input: SynapseAgentPersonaIdInput) => Promise<void>
    onChanged: (listener: (event: SynapseAgentPersonaChangedEvent) => void) => () => void
  }
  driveSync: {
    getSnapshot: () => Promise<DriveSyncSnapshotDto>
    createBinding: (input: {
      driveItemId: string
      driveItemName: string
      kind: "file" | "folder"
      drivePathHint?: string | null
      localPath: string
      remoteCursor?: string | null
      excludeRules?: readonly string[]
    }) => Promise<DriveSyncBindingDto>
    previewBinding: (input: {
      driveItemId: string
      driveItemName: string
      kind: "file" | "folder"
      drivePathHint?: string | null
      localPath: string
      remoteExists: boolean
      directionHint?: "remote_to_local" | "local_to_remote" | "bind_existing" | null
      importGitignore?: boolean
    }) => Promise<DriveSyncBindingPreviewDto>
    createSafeBinding: (input: DriveSyncCreateSafeBindingInput) => Promise<DriveSyncBindingDto>
    removeBinding: (input: { id: string }) => Promise<void>
    pauseBinding: (input: { id: string }) => Promise<DriveSyncBindingDto>
    resumeBinding: (input: { id: string }) => Promise<DriveSyncBindingDto>
    updateExcludeRules: (input: { id: string; user: readonly string[] }) => Promise<DriveSyncBindingDto>
    rescanBinding: (input: { id: string }) => Promise<void>
    pollRemoteChanges: (input?: { id?: string }) => Promise<void>
    resolveConflict: (input: DriveSyncConflictResolutionInput) => Promise<void>
    chooseLocalPath: (input: { kind: "file" | "folder"; mode?: "bind_existing" | "remote_to_local" | "local_to_remote"; defaultName?: string }) => Promise<string | null>
    onChanged: (listener: (snapshot: DriveSyncSnapshotDto) => void) => () => void
  }
  soundNotifier: {
    getSettings: () => Promise<SynapseSoundNotifierSettings>
    updateSettings: (input: SynapseSoundNotifierSettingsPatch) => Promise<SynapseSoundNotifierSettings>
    play: (input?: SynapseSoundNotifierPlayInput) => Promise<SynapseSoundNotifierPlayResult>
    preview: (input?: SynapseSoundNotifierPlayInput) => Promise<SynapseSoundNotifierPlayResult>
    onChanged: (listener: (event: SynapseSoundNotifierChangedEvent) => void) => () => void
    onPlayRequested: (listener: (event: SynapseSoundNotifierPlayRequestedEvent) => void) => () => void
  }
  terminal: {
    chooseDefaultCwd: () => Promise<string | null>
    listGroups: () => Promise<SynapseTerminalGroup[]>
    createGroup: (input: SynapseTerminalCreateGroupInput) => Promise<SynapseTerminalGroup>
    renameGroup: (input: SynapseTerminalRenameGroupInput) => Promise<SynapseTerminalGroup>
    updateGroupSettings: (input: SynapseTerminalUpdateGroupSettingsInput) => Promise<SynapseTerminalGroup>
    createGroupCommand: (input: SynapseTerminalCreateGroupCommandInput) => Promise<SynapseTerminalGroupCommand>
    updateGroupCommand: (input: SynapseTerminalUpdateGroupCommandInput) => Promise<SynapseTerminalGroupCommand>
    deleteGroupCommand: (input: SynapseTerminalDeleteGroupCommandInput) => Promise<void>
    launchGroupCommand: (input: SynapseTerminalLaunchGroupCommandInput) => Promise<SynapseTerminalSession>
    deleteGroup: (input: SynapseTerminalDeleteGroupInput) => Promise<void>
    listSessions: () => Promise<SynapseTerminalSession[]>
    createSession: (input: SynapseTerminalCreateSessionInput) => Promise<SynapseTerminalSession>
    getSession: (input: { sessionId: string }) => Promise<SynapseTerminalSession>
    readSession: (input: SynapseTerminalReadSessionInput) => Promise<SynapseTerminalReadSessionResult>
    renameSession: (input: SynapseTerminalRenameSessionInput) => Promise<SynapseTerminalSession>
    writeSession: (input: SynapseTerminalWriteSessionInput) => Promise<void>
    resizeSession: (input: SynapseTerminalResizeSessionInput) => Promise<void>
    deleteSession: (input: SynapseTerminalDeleteSessionInput) => Promise<void>
    stopSession: (input: SynapseTerminalStopSessionInput) => Promise<void>
    runStartupCommand: (input: SynapseTerminalRunStartupCommandInput) => Promise<void>
    onData: (listener: (event: SynapseTerminalDataEvent) => void) => () => void
    onSessionChanged: (listener: (session: SynapseTerminalSession) => void) => () => void
    onSessionDeleted: (listener: (event: SynapseTerminalSessionDeletedEvent) => void) => () => void
  }
  screenshot: {
    capture: (input: ScreenshotCaptureInput) => Promise<ScreenshotArtifact>
    captureToFile: (input: ScreenshotCaptureToFileInput) => Promise<ScreenshotSaveResult>
    saveArtifact: (input: ScreenshotSaveArtifactInput) => Promise<ScreenshotSaveResult>
    copyToClipboard: (input: ScreenshotCaptureInput) => Promise<ScreenshotClipboardResult>
    copyArtifactToClipboard: (input: ScreenshotArtifact) => Promise<ScreenshotClipboardResult>
    startInteractiveCapture: (input?: ScreenshotInteractiveCaptureInput) => Promise<ScreenshotArtifact | null>
    completeInteractiveCapture: (input: ScreenshotRegion) => Promise<boolean>
    cancelInteractiveCapture: () => Promise<boolean>
    chooseOutputFile: (input?: { defaultPath?: string }) => Promise<string | null>
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
    listRepositories: () => Promise<SynapseGitRepository[]>
    listRepositorySummaries: () => Promise<SynapseGitRepositorySummary[]>
    addLocalRepository: (input: { name: string; localPath: string }) => Promise<SynapseGitRepository>
    removeRepository: (input: SynapseGitRepositoryRemoveInput) => Promise<void>
    cloneRepository: (input: {
      remoteUrl: string
      targetPath: string
      name: string
    }) => Promise<{ repository: SynapseGitRepository; remoteKind: SynapseGitRemoteKind }>
    getSnapshot: (repositoryId: string) => Promise<SynapseGitRepositorySnapshot>
    getDiff: (input: {
      repositoryId: string
      path: string
      originalPath?: string | null
      staged: boolean
    }) => Promise<SynapseGitDiffResult>
    commit: (input: {
      repositoryId: string
      message: string
      paths: string[]
    }) => Promise<SynapseGitOperationResult>
    fetch: (repositoryId: string) => Promise<SynapseGitOperationResult>
    pull: (repositoryId: string) => Promise<SynapseGitOperationResult>
    push: (repositoryId: string) => Promise<SynapseGitOperationResult>
    sync: (repositoryId: string) => Promise<SynapseGitOperationResult>
    listBranches: (repositoryId: string) => Promise<SynapseGitBranch[]>
    checkoutBranch: (repositoryId: string, branchName: string) => Promise<void>
    createBranch: (repositoryId: string, branchName: string) => Promise<void>
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
    refresh: () => Promise<SynapseAccountState>
    logout: () => Promise<SynapseAccountState>
    listWebhooks: () => Promise<DashboardWebhookDto[]>
    listDriveItems: (input: { parentId?: string | null }) => Promise<DriveItemDto[]>
    prepareDriveUpload: (input: { parentId?: string | null; name: string; size: string; mimeType?: string | null }) => Promise<DriveUploadPrepareResult>
    prepareDriveFolderUpload: (input: { parentId?: string | null; folderName: string; files: Array<{ relativePath: string; size: string; mimeType?: string | null }> }) => Promise<DriveFolderUploadPrepareResult>
    completeDriveUpload: (input: { sessionId: string }) => Promise<DriveItemDto>
    uploadDrivePreparedFile: (input: { method: "PUT"; url: string; headers: Record<string, string>; body: ArrayBuffer }) => Promise<{ ok: true }>
    uploadDriveLocalItems: (input: DriveLocalUploadRequest) => Promise<DriveLocalUploadResult>
    filePathForDroppedFile: (file: File) => string | null
    cancelDriveUpload: (input: { sessionId: string }) => Promise<{ ok: true }>
    createDriveFolder: (input: { parentId?: string | null; name: string }) => Promise<DriveItemDto>
    getDriveItemPreviewUrl: (input: { itemId: string }) => Promise<{ url: string }>
    renameDriveItem: (input: { itemId: string; name: string }) => Promise<DriveItemDto>
    moveDriveItem: (input: { itemId: string; parentId: string | null }) => Promise<DriveItemDto>
    deleteDriveItem: (input: { itemId: string }) => Promise<{ ok: true }>
    listDriveFileVersions: (input: { itemId: string } & DriveFileVersionListInput) => Promise<DriveFileVersionListPageDto>
    downloadDriveFileVersion: (input: { itemId: string; versionId: string; outputPath: string }) => Promise<{ ok: true; path: string }>
    restoreDriveFileVersion: (input: { itemId: string; versionId: string }) => Promise<DriveItemDto>
    deleteDriveFileVersion: (input: { itemId: string; versionId: string }) => Promise<{ ok: true }>
    updateDriveFileVersionPin: (input: { itemId: string; versionId: string; isPinned: boolean }) => Promise<DriveFileVersionDto>
    resolveDriveLink: (input: DriveLinkResolveInput) => Promise<DriveLinkResolveDto>
    listDriveLink: (input: DriveLinkListInput) => Promise<DriveLinkListDto>
    readDriveLinkText: (input: DriveLinkReadTextInput) => Promise<DriveLinkReadTextDto>
    materializeDriveLink: (input: DriveLinkMaterializeInput) => Promise<DriveLinkMaterializeDto>
    downloadDriveLinkFile: (input: DriveLinkDownloadFileInput) => Promise<DriveLinkDownloadFileDto>
    shareDriveItem: (input: { itemId: string } & DriveAccessSettingsInput) => Promise<DriveShareDto>
    disableDriveShare: (input: { shareId: string }) => Promise<{ ok: true }>
    getDriveUsage: () => Promise<DriveUsageDto>
    getDriveShare: (input: { shareId: string }) => Promise<DriveShareListItemDto>
    listDriveShares: (input?: DrivePublicLinksPageInput) => Promise<DriveShareListPageDto>
    listDrivePublicAssets: (input?: { offset?: number; limit?: number }) => Promise<DrivePublicAssetListPageDto>
    getDrivePublicAsset: (input: { assetId: string }) => Promise<DrivePublicAssetDto>
    uploadDrivePublicAssets: (input: DrivePublicAssetUploadRequest) => Promise<DrivePublicAssetUploadResult>
    uploadDrivePublicAssetBinary: (input: DrivePublicAssetBinaryUploadRequest) => Promise<DrivePublicAssetDto>
    scanDriveDocumentImageSources: (input: DriveDocumentImageSourceContext) => Promise<DriveDocumentImageSourcesDto>
    importDriveDocumentImages: (input: DriveDocumentImageImportBridgeRequest) => Promise<DriveDocumentImageImportResult>
    replaceDrivePublicAssetFile: (input: { assetId: string } & DrivePublicAssetLocalFile) => Promise<DrivePublicAssetDto>
    renameDrivePublicAsset: (input: { assetId: string; name: string }) => Promise<DrivePublicAssetDto>
    trashDrivePublicAsset: (input: { assetId: string }) => Promise<DrivePublicAssetDto>
    restoreDrivePublicAsset: (input: { assetId: string }) => Promise<DrivePublicAssetDto>
    preflightDriveSite: (input: { sourceFolderItemId: string }) => Promise<DriveSitePreflightDto>
    createDriveSite: (input: DriveSiteCreateInput) => Promise<DriveSiteDto>
    listDriveSites: (input?: DriveSiteListInput) => Promise<DriveSiteListPageDto>
    updateDriveSiteAccess: (input: { siteId: string } & DriveSiteAccessUpdateInput) => Promise<DriveSiteDto>
    disableDriveSite: (input: { siteId: string }) => Promise<DriveSiteDto>
    enableDriveSite: (input: { siteId: string }) => Promise<DriveSiteDto>
    deleteDriveSite: (input: { siteId: string }) => Promise<{ ok: true }>
    republishDriveSite: (input: { siteId: string; entryPath?: string | null }) => Promise<DriveSiteDto>
    listDriveTrash: (input?: { offset?: number; limit?: number }) => Promise<DriveTrashListPageDto>
    restoreDriveTrashItem: (input: { itemId: string; kind?: DriveTrashItemDto["kind"]; assetId?: string }) => Promise<DriveItemDto | DrivePublicAssetDto>
    deleteDriveTrashItem: (input: { itemId: string }) => Promise<{ ok: true }>
    onStateChanged: (listener: (event: SynapseAccountStateChangedEvent) => void) => () => void
  }
  live: {
    getState: () => Promise<SynapseLiveState>
    onStateChanged: (listener: (event: SynapseLiveStateChangedEvent) => void) => () => void
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
    getAttachmentFile: (
      args: {
        contentType: SynapseContentType
        historyDirname: string
        id: string
        originalName: string
      },
    ) => Promise<SynapseContentFile | null>
    create: (request: SynapseCreateContentRequest) => Promise<SynapseContentMutationResult>
    update: (request: SynapseUpdateContentRequest) => Promise<SynapseContentMutationResult>
    deleteContent: (payload: SynapseDeleteContentPayload) => Promise<SynapseContentMutationResult>
    onChanged: (listener: (payload: SynapseContentChangedEvent) => void) => () => void
    listDeleted: <T extends SynapseContentType>(
      args: { contentType: T },
    ) => Promise<SynapseContentMeta<T>[]>
    restore: (payload: SynapseRestoreContentPayload) => Promise<SynapseContentMutationResult>
    purge: (payload: SynapsePurgeContentPayload) => Promise<SynapseContentMutationResult>
    download: (
      args: { contentType: SynapseContentType; id: string },
    ) => Promise<SynapseContentDownloadResult>
    openDetailWindow: (payload: SynapseOpenContentWindowPayload) => Promise<void>
    openCreateWindow: (payload: SynapseOpenContentCreateWindowPayload) => Promise<void>
    openEditWindow: (payload: SynapseOpenContentEditWindowPayload) => Promise<void>
    readEditorInitPayload: (payload: { requestId: string }) => Promise<
      SynapseOpenContentCreateWindowPayload | SynapseOpenContentEditWindowPayload | null
    >
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
  contentStoreInstall: {
    resolve: (sessionId: string) => Promise<SynapseContentStoreInstallResolveResult>
    prepare: (sessionId: string) => Promise<SynapseContentStoreInstallPrepareResult>
    recordComplete: (sessionId: string) => Promise<{ ok: true }>
  }
  installers: {
    installSourceToEditor: (
      payload: SynapseInstallSourceToEditorPayload,
    ) => Promise<SynapseContentInstallResult>
    prepareLocalSkillSource: (
      payload: SynapsePrepareLocalSkillSourcePayload,
    ) => Promise<SynapseSkillInstallerSource>
    prepareInlineRuleSource: (
      payload: SynapsePrepareInlineRuleSourcePayload,
    ) => Promise<SynapseRuleInstallerSource>
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
    scanAll: () => Promise<EditorScanResult>
    readItemContent: (filePath: string) => Promise<string>
    listSkillFiles: (dirPath: string) => Promise<EditorScanSkillFileEntry[]>
    prepareQuickPublishDraft: (
      request: EditorScanQuickPublishRequest,
    ) => Promise<EditorScanQuickPublishDraft>
    trashItem: (request: EditorScanTrashRequest) => Promise<EditorScanTrashResult>
    uploadSkillDraftToContentStore: (
      request: EditorScanContentStoreUploadRequest,
    ) => Promise<EditorScanContentStoreUploadResult>
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
  knowledgeBase: {
    createManaged: (
      payload: SynapseKnowledgeBaseCreateManagedPayload,
    ) => Promise<SynapseKnowledgeBaseCreateManagedResult>
    deleteManaged: (
      payload: SynapseKnowledgeBaseDeleteManagedPayload,
    ) => Promise<SynapseKnowledgeBaseDeleteManagedResult>
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
    filePathForDroppedFile: (file: File) => string | null
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (filePath: string) => Promise<void>
    filePathForDroppedFile: (file: File) => string | null
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
  updater: {
    cancelDownload: () => Promise<void>
    checkForUpdates: () => Promise<SynapseAppUpdateState>
    getState: () => Promise<SynapseAppUpdateState>
    installUpdate: () => Promise<void>
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
    databaseTableList: () => Promise<DatabaseTableInfo[]>
    databaseTableCreate: (params: { name: string; description?: string; columns: Column[] }) => Promise<void>
    databaseTableDelete: (name: string) => Promise<void>
    databaseTableDescribe: (name: string) => Promise<DatabaseTableSchema>
    databaseOverviewGet: () => Promise<DatabaseOverview>
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
    databaseTableImport: (input: { sourcePath: string; sourceDigest: string }) => Promise<{ success: boolean; tableName?: string }>
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
  automation: {
    openCreateEditorWindow: () => Promise<void>
    openEditorWindow: (id: string) => Promise<void>
    listItems: () => Promise<AutomationItem[]>
    getItem: (id: string) => Promise<AutomationItem | null>
    createItem: (input: AutomationCreateInput) => Promise<AutomationItem>
    updateItem: (payload: { id: string; patch: AutomationUpdateInput }) => Promise<AutomationItem>
    deleteItem: (id: string) => Promise<{ deleted: boolean }>
    setItemEnabled: (payload: { id: string; enabled: boolean }) => Promise<AutomationItem>
    runItem: (id: string) => Promise<AutomationRun | null>
    stopRun: (runId: string) => Promise<AutomationStopRunResult>
    listRuns: (automationId: string, options?: { limit?: number }) => Promise<AutomationRun[]>
    onChanged: (listener: (event: AutomationChangedEvent) => void) => () => void
  }
  agent: {
    status: (projectId: string) => Promise<SynapseAgentStatus>
    listSessions: (projectId: string) => Promise<SynapseAgentSessionSummary[]>
    listAllSessions: () => Promise<SynapseAgentSessionSummary[]>
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
      args: { projectId: string; sessionKey?: string; conversationId?: string; limit?: number },
    ) => Promise<SynapseAgentTimelineResult>
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
      },
    ) => Promise<SynapseAgentSessionSummary>
    switchSession: (
      args: { projectId: string; sessionKey?: string; conversationId: string },
    ) => Promise<SynapseAgentSessionSummary>
    updateSessionPersona: (
      args: { projectId: string; conversationId: string; personaId: string | null },
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
        attachments?: readonly SynapseAgentBridgeAttachment[]
        clientSubmittedAt?: string
        providerId?: string
        mainThreadPersonaId?: string | null
        mainThreadPersonaName?: string
        mainThreadPersonaSource?: "builtin" | "user"
      },
    ) => Promise<SynapseAgentSendResult>
    listPendingPermissions: (projectId: string) => Promise<SynapseAgentPendingPermission[]>
    respondPermission: (
      args: {
        projectId: string
        requestId: string
        behavior: "allow" | "deny"
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
        kind: "workflow-node" | "conversation"
        entityId: string
        entityName: string
        nodeId?: string
        nodeName?: string
        providerId: string
        modelTier: string
      }>
      workflowNodeCount: number
      conversationCount: number
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
    openConversation: (
      target: SynapseAgentConversationTarget,
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
    list: () => Promise<WorkflowMeta[]>
    get: (id: string) => Promise<WorkflowDefinition | null>
    create: () => Promise<{ id: string; versionHash: string } | { errors: ValidationError[] }>
    save: (def: WorkflowDefinition) => Promise<{ versionHash: string } | { errors: ValidationError[] }>
    delete: (id: string) => Promise<void>
    validate: (def: WorkflowDefinition) => Promise<ValidationResult>
    run: (id: string, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] }>
    runDefinition: (def: WorkflowDefinition, params: Record<string, unknown>, force?: boolean) => Promise<{ runId: string } | { errors: ValidationError[] } | { conflict: true; activeRunId: string }>
    rerun: (previousRunId: string, params: Record<string, unknown>, force?: boolean) => Promise<{ runId: string } | { errors: ValidationError[] } | { conflict: true; activeRunId: string }>
    openRunner: (workflowId: string, runId: string) => Promise<void>
    cancel: (runId: string) => Promise<void>
    activeRuns: () => Promise<WorkflowRunListItem[]>
    runHistory: (workflowId: string) => Promise<WorkflowRunListItem[]>
    runStatus: (runId: string) => Promise<WorkflowRunStatus | null>
    openEditor: (id: string, runId?: string) => Promise<void>
    editorState: () => Promise<{ openEditors: string[] }>
    checkCanSync: () => Promise<{ canSync: boolean; blockers: string[] }>
    exportPackage: (workflowId: string, workflowName?: string) => Promise<{ path: string } | null>
    inspectImportPackage: () => Promise<WorkflowImportPreview | null>
    importPackage: (packagePath: string, mappings: WorkflowModelMapping[], options?: WorkflowImportOptions, packageDigest?: string) => Promise<{ workflowId: string; versionHash: string } | { errors: ValidationError[] }>
    chooseParamFile: () => Promise<string | null>
    chooseParamDirectory: () => Promise<string | null>
    onEvent: (listener: (event: WorkflowEvent) => void) => () => void
    onDefinitionUpdated: (listener: (payload: { workflowId: string; source?: string; versionHash?: string }) => void) => () => void
    onRunnerSwitchRun: (listener: (payload: { runId: string }) => void) => () => void
    onEditorRefocus: (listener: (payload: { runId?: string }) => void) => () => void
  }
  workflowParamPresets: {
    list: (workflowId: string) => Promise<WorkflowParamPreset[]>
    save: (input: SaveWorkflowParamPresetInput) => Promise<WorkflowParamPreset>
    delete: (id: string) => Promise<void>
  }
  usageAnalysis: {
    cc: ClaudeCodeUsageAnalysisBridgeDomain
    codex: UsageAnalysisBridgeDomain
    getPricingRules: () => Promise<UsageAnalysisModelPriceRule[]>
    savePricingRules: (rules: UsageAnalysisModelPriceRuleInput[]) => Promise<UsageAnalysisModelPriceRule[]>
    /** @deprecated Compatibility alias with clear semantics. New code should use modelPrice.clearRules(). */
    resetPricingRules: () => Promise<UsageAnalysisModelPriceRule[]>
  }
  modelPrice: {
    listCoverage: (input?: ModelPriceCoverageInput) => Promise<ModelPriceCoverageRow[]>
    listPresets: () => Promise<ModelPricePresetSummary[]>
    importPreset: (presetId: ModelPricePresetId) => Promise<ModelPriceRule[]>
    importPresets: (presetIds: ModelPricePresetId[]) => Promise<ModelPriceRule[]>
    getRules: () => Promise<ModelPriceRule[]>
    saveRules: (rules: ModelPriceRuleInput[]) => Promise<ModelPriceRule[]>
    clearRules: () => Promise<ModelPriceRule[]>
    /** @deprecated Compatibility alias for clearRules. New code should call clearRules(). */
    resetRules: () => Promise<ModelPriceRule[]>
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
