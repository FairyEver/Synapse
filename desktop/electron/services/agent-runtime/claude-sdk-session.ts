import { AssistantOutputIntegrity } from "./assistant-output-integrity"
import {
  TASK_PROGRESS_GUIDANCE,
  TaskProgressValidationError,
  type TaskEvidenceGap,
  type TaskEvidenceGaps,
  type TaskProgressSession,
} from "./task-progress"
import { expectedNativeReadDelivery, nativeReadDeliveredHash, recordTaskToolResult } from "./task-progress-hooks"
import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  Options,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Query,
  RewindFilesResult,
  SDKControlGetContextUsageResponse,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import {
  buildHostEnvironment,
  mergeEnvironmentWithPath,
  resolveCachedLoginShellPath,
} from "../../runtime/process"
import type { StructuredLogger } from "../../runtime/service-registry"
import { isFileNotFoundError, isPathInside } from "../fs-utils"
import type {
  AgentContextWindowConfigurationSource,
  AgentModelContextReference,
} from "../model-capability/catalog"
import type {
  AgentSdkAgentDefinitions,
  AgentSdkPluginSpec,
  AgentSdkSubagentToolPolicies,
} from "./project-contributions"
import {
  AGENT_CANCELLED_MESSAGE,
  AGENT_INVALID_ASK_USER_QUESTION_INPUT_MESSAGE,
  AGENT_PERMISSION_CANCELLED_MESSAGE,
  AGENT_PERMISSION_NOT_PENDING_MESSAGE,
  AGENT_QUERY_FINISHED_PERMISSION_MESSAGE,
  AGENT_SESSION_CLOSED_MESSAGE,
  AGENT_TURN_PERMISSION_CANCELLED_MESSAGE,
  sdkQueryErrorPresentation,
  webFetchPreflightFailureMeta,
} from "./agent-error-messages"
import { isSafeTokenMeasurement, isSensitiveTextKey, redactSensitiveText, REDACTED } from "./redaction"
import { errorLogMeta as baseErrorLogMeta } from "../error-sanitize"
import { agentRuntimeErrorMessage } from "./error-message"
import { bridgeSdkMessage, type AgentEventEnvelope } from "./sdk-event-bridge"
import { AgentContextUsageTracker } from "./context-usage"
import {
  buildAgentRuntimeUserContent,
  mergeAdditionalDirectories,
  normalizeAgentAttachments,
} from "./attachments"
import type {
  AgentContextUsage,
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
  AgentSteerMessage,
  AgentUserQuestion,
  AgentUserQuestionOption,
} from "./types"
import {
  createMissingPackagedClaudeRuntimeError,
  inspectPackagedClaudeRuntime,
  type PackagedClaudeRuntimeStatus,
} from "./claude-runtime-binary"
import { DEFAULT_CLAUDE_SDK_MAX_TURNS } from "./turn-limits"
import {
  SYNAPSE_MCP_TOOL_PREFIX,
  SYNAPSE_TOOL_ROUTER_INVOKE_TOOL,
  SYNAPSE_TOOL_ROUTER_SEARCH_TOOL,
  isSynapseToolReadOnly,
  originalSynapseSdkToolName,
  parseSynapseToolRouterInvoke,
} from "./synapse-tool-router"
import {
  createDirectValidatedQuery,
  SynapseToolRouterQuery,
  type SynapseToolRouterQueryOptions,
} from "./synapse-tool-router-query"
import {
  AgentFileCheckpointTracker,
  isReplayedUserMessage,
} from "./agent-file-checkpoint-tracker"
import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  governToolOutput,
  isFileMutationTool,
  isStructuredFileMutationOutput,
  replaceToolOutput,
  measureToolOutput,
} from "./tool-output-governor"
import {
  AgentContextBudget,
  DEFAULT_TOOL_OUTPUT_BATCH_MAX_BYTES,
  type AgentContextBudgetSnapshot,
} from "./context-budget"
import { sumClaudeSdkUsage } from "../../../src/lib/token-usage"
import type { AgentContextRotation } from "./context-continuation"
import type { PersistedToolOutputText } from "./artifact-store"
import { captureImagePresentation, mergePendingImages, verifyImagePresentation, type PendingImagePresentation } from "./image-presentation"
import { stopQueryAtBoundary } from "./query-stop-barrier"

export interface QueryLike {
  next(): Promise<IteratorResult<SDKMessage, void>>
  interrupt(): Promise<unknown>
  close(): void | Promise<void>
  streamInput?(stream: AsyncIterable<SDKUserMessage>): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
  grantAdditionalDirectories?(directories: readonly string[]): Promise<void>
  getContextUsage?(): Promise<SDKControlGetContextUsageResponse>
  rewindFiles?(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>
  reconnectMcpServer?(serverName: string): Promise<void>
}

export type QueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
  expectedMcpServerNames?: readonly string[]
  logger?: Pick<StructuredLogger, "warn"> & Partial<Pick<StructuredLogger, "info">>
  synapseToolRouter?: SynapseToolRouterQueryOptions
}) => QueryLike

export interface ClaudeSDKSessionOptions {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly sdkSessionId?: string
  readonly taskProgress?: TaskProgressSession
  readonly taskListId?: string
  readonly env: Record<string, string>
  readonly hostEnv?: NodeJS.ProcessEnv
  readonly resolveShellPath?: () => string | null
  readonly nodeRuntimeBinPath?: string
  readonly mode?: string
  readonly model?: string
  readonly modelContext?: AgentModelContextReference
  readonly contextWindowConfigurationSource?: AgentContextWindowConfigurationSource
  readonly autoCompactWindowTokens?: number
  readonly maxRequestBodyBytes?: number
  readonly requestBodyBudgetBytes?: number
  readonly maxToolOutputBytes?: number
  readonly maxToolBatchOutputBytes?: number
  readonly maxTurns?: number
  readonly plugins?: readonly AgentSdkPluginSpec[]
  readonly allowPluginHooks?: boolean
  readonly agent?: string
  readonly agentDefinitionsHash?: string
  readonly agents?: AgentSdkAgentDefinitions
  readonly systemPrompt?: Options["systemPrompt"]
  readonly tools?: Options["tools"]
  readonly disallowedTools?: readonly string[]
  readonly personaToolPolicy?: ClaudeSDKPersonaToolPolicy
  readonly subagentToolPolicies?: AgentSdkSubagentToolPolicies
  readonly toolPolicy?: ClaudeSDKToolPolicy
  readonly abortSignal?: AbortSignal
  readonly additionalDirectories?: readonly string[]
  readonly readOnlyAdditionalDirectories?: readonly string[]
  /** Evidence roots whose content is durable by construction; re-reads must not be persisted again. */
  readonly durableEvidenceRoots?: readonly string[]
  readonly persistToolOutputText?: (input: {
    readonly projectId: string
    readonly conversationId: string
    readonly turnId: string
    readonly toolUseId?: string
    readonly toolName?: string
    readonly content: string
  }) => Promise<PersistedToolOutputText | undefined>
  readonly sdkSettings?: ClaudeSDKRuntimeSettings
  readonly mcpServers?: Options["mcpServers"]
  readonly expectedMcpServerNames?: readonly string[]
  readonly onElicitation?: Options["onElicitation"]
  readonly onConversationTitle?: (title: string) => void | Promise<void>
  readonly queryFactory?: QueryFactory
  readonly synapseToolRouter?: SynapseToolRouterQueryOptions
  readonly routerSubagentToolAccess?: Readonly<Record<string, {
    readonly allowedTools?: readonly string[]
    readonly disallowedTools?: readonly string[]
  }>>
  readonly logger?: Pick<StructuredLogger, "warn"> & Partial<Pick<StructuredLogger, "info">>
  readonly now?: () => Date
}

export interface ClaudeSDKRuntimeSettings {
  readonly skipWebFetchPreflight?: boolean
  readonly autoCompactEnabled?: boolean
  readonly autoCompactWindow?: number
  readonly precomputeCompactionEnabled?: boolean
}

interface PendingPermission {
  readonly input: Record<string, unknown>
  readonly sessionDirectoryUpdates: readonly SessionDirectoryPermissionUpdate[]
  readonly resolve: (decision: PermissionResult) => void
  readonly cleanup: () => void
  readonly projectUpdatedInput?: (input: Record<string, unknown>) => Record<string, unknown>
}

type SessionDirectoryPermissionUpdate = Extract<PermissionUpdate, { type: "addDirectories" }>

interface ForwardedAbortController {
  readonly controller: AbortController
  cleanup(): void
}

function createSdkDiagnosticSummary(): {
  observedCount: number
  thinkingTokenCount: number
  firstObservedAt?: string
  lastObservedAt?: string
  types: Map<string, number>
} {
  return {
    observedCount: 0,
    thinkingTokenCount: 0,
    types: new Map(),
  }
}

type CanUseToolContext = Parameters<NonNullable<Options["canUseTool"]>>[2]
export type ClaudeSDKToolPolicy = (
  toolName: string,
  input: Record<string, unknown>,
) => PermissionResult | undefined

export type ClaudeSDKPersonaToolPolicy = {
  readonly mode: "all" | "allowlist" | "disabled"
  readonly allowedTools: readonly string[]
}

export { DEFAULT_CLAUDE_SDK_MAX_TURNS } from "./turn-limits"

class FailedQuery implements QueryLike {
  readonly #error: Error

  constructor(error: Error) {
    this.#error = error
  }

  next(): Promise<IteratorResult<SDKMessage, void>> {
    return Promise.reject(this.#error)
  }

  interrupt(): Promise<void> {
    return Promise.resolve()
  }

  close(): void {}
}

export class ClaudeSDKSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"

  private readonly taskProgress?: TaskProgressSession
  private readonly taskProgressToolsAvailable: boolean
  private readonly pendingProgressReceipts = new Set<string>()
  private readonly expectedReadDeliveries = new Map<string, { kind: "text" | "image"; hash: string }>()
  /** Tool results already accounted from their PostToolUse payload; mutation confirmations are accounted in PostToolBatch instead. */
  private readonly accountedToolResults = new Set<string>()
  private governedToolOutputPath?: string
  private governedReadDelivery?: { sourceLines: number; kept: "head" | "tail" }
  private eligiblePresentation?: { receipts: string[]; images: string[]; acquired: string[] }
  private presentationAcknowledgement: Promise<void> = Promise.resolve()
  private textBodyPressure = false
  private readonly confirmedImagePresentations = new Set<string>()
  private deferredImages: readonly PendingImagePresentation[] = []
  private deferredImagePressure = false
  private assistantOutputIntegrity = new AssistantOutputIntegrity()
  private outputRepairAttempted = false
  private completionRetryMarker: string | undefined
  private readonly projectId: string
  private readonly conversationId: string
  private readonly providerId: string
  private readonly now: () => Date
  private readonly inputQueue = new AsyncQueue<SDKUserMessage>()
  private readonly eventQueue = new AsyncQueue<AgentEvent>()
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly logger: Pick<StructuredLogger, "warn"> & Partial<Pick<StructuredLogger, "info">> | undefined
  private readonly subagentToolPolicies: AgentSdkSubagentToolPolicies
  private readonly personaToolPolicy: ClaudeSDKPersonaToolPolicy | undefined
  private readonly toolPolicy: ClaudeSDKToolPolicy | undefined
  private readonly synapseToolRouterEnabled: boolean
  private readonly routerSubagentToolAccess: NonNullable<ClaudeSDKSessionOptions["routerSubagentToolAccess"]>
  private readonly cwd: string
  private readonly query: QueryLike
  private additionalDirectories: readonly string[]
  private readonly abortController: AbortController | undefined
  private readonly abortCleanup: (() => void) | undefined
  private readonly pumpPromise: Promise<void>
  private readonly toolNamesByUseId = new Map<string, string>()
  private readonly routerInvocationsByUseId = new Map<string, {
    readonly toolName: string
    readonly arguments: Record<string, unknown>
  }>()
  private readonly subagentTypesById = new Map<string, string>()
  private readonly attachmentPathLabels = new Map<string, string>()
  private readonly contextUsageTracker: AgentContextUsageTracker
  private readonly maxRequestBodyBytes: number | undefined
  private readonly readOnlyAdditionalDirectories: readonly string[]
  private readonly durableEvidenceRoots: readonly string[]
  private readonly persistToolOutputText: ClaudeSDKSessionOptions["persistToolOutputText"]
  private readonly contextBudget: AgentContextBudget
  private readonly fileCheckpointTracker: AgentFileCheckpointTracker
  private sdkDiagnosticSummary: {
    observedCount: number
    thinkingTokenCount: number
    firstObservedAt?: string
    lastObservedAt?: string
    types: Map<string, number>
  } = createSdkDiagnosticSummary()
  private lastTodoWriteSignature: string | undefined
  private repeatedTodoWriteCount = 0
  private activeTurnId: string | undefined
  private pendingCompaction: {
    readonly startedAt: number
    readonly trigger: "manual" | "auto"
    readonly before: AgentContextBudgetSnapshot
    summaryBytes?: number
    summaryRequestBytes?: number
  } | undefined
  private outputGovernance: Promise<unknown> = Promise.resolve()
  private rotation: AgentContextRotation | undefined
  private releaseRotation: (() => void) | undefined
  private lastCompactSummary = ""
  private confirmedCostWatermark = 0
  private pendingImages: PendingImagePresentation[] = []
  private imageBodyPressure = false
  private resumedImages: readonly PendingImagePresentation[] = []
  private presentedImages = new Set<string>()
  private completedBatches = 0
  private lastToolBatch: import("@anthropic-ai/claude-agent-sdk", { with: { "resolution-mode": "import" } }).PostToolBatchToolCall[] = []
  private readonly observedMessageUsage = new Map<string, Record<string, unknown>>()
  private readonly deliveredToolResults = new Set<string>()
  private lastNativeToolResultTokens: number | undefined
  private abortRequested = false
  private closed = false
  private closePromise: Promise<void> | undefined
  private outputIntegrityFailed = false
  private queryFinished = false
  private permissionMode: PermissionMode | undefined
  private synapseToolRouterFallbackEmitted = false
  private readonly mcpServerNames: readonly string[]
  private mcpServersReconnected = false
  mainThreadAgentName: string | undefined
  readonly agentDefinitionsHash: string | undefined
  get finished(): boolean {
    return this.queryFinished
  }

  private sdkSessionId: string | undefined
  private permissionSeq = 0

  constructor(options: ClaudeSDKSessionOptions) {
    this.projectId = options.projectId
    this.conversationId = options.conversationId
    this.providerId = options.providerId
    this.cwd = path.resolve(options.cwd)
    this.contextUsageTracker = new AgentContextUsageTracker({
      modelContext: options.modelContext,
      contextWindowConfigurationSource: options.contextWindowConfigurationSource,
      autoCompactWindowTokens: options.autoCompactWindowTokens,
    })
    this.maxRequestBodyBytes = options.maxRequestBodyBytes
    this.readOnlyAdditionalDirectories = mergeAdditionalDirectories(options.readOnlyAdditionalDirectories ?? [])
    this.durableEvidenceRoots = mergeAdditionalDirectories(options.durableEvidenceRoots ?? [])
    this.taskProgress = options.taskProgress
    this.taskProgressToolsAvailable = ["TaskCreate", "TaskUpdate"].every((name) =>
      (options.tools === undefined || !Array.isArray(options.tools) || options.tools.includes(name))
      && !options.disallowedTools?.some((rule) => rule === "*" || rule === name || rule === `${name}(*)`)
      && (!options.personaToolPolicy || options.personaToolPolicy.mode === "all"
        || (options.personaToolPolicy.mode === "allowlist" && options.personaToolPolicy.allowedTools.includes(name))))
    this.persistToolOutputText = options.persistToolOutputText
    this.contextBudget = new AgentContextBudget({
      maxToolResultBytes: options.maxToolOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES,
      maxToolBatchBytes: options.maxToolBatchOutputBytes ?? DEFAULT_TOOL_OUTPUT_BATCH_MAX_BYTES,
      maxContextTokens: options.autoCompactWindowTokens ?? options.modelContext?.contextWindowTokens,
      maxRequestBodyBytes: options.maxRequestBodyBytes,
      requestBodyBudgetBytes: options.requestBodyBudgetBytes,
      initialRequestBytes: estimatedStaticRequestBytes(options),
    })
    this.fileCheckpointTracker = new AgentFileCheckpointTracker({
      cwd: this.cwd,
      logger: options.logger,
    })
    this.sdkSessionId = options.sdkSessionId
    this.logger = options.logger
    this.subagentToolPolicies = options.subagentToolPolicies ?? {}
    this.personaToolPolicy = options.personaToolPolicy
    this.toolPolicy = options.toolPolicy
    this.synapseToolRouterEnabled = Boolean(options.synapseToolRouter)
    this.routerSubagentToolAccess = options.routerSubagentToolAccess ?? {}
    this.mcpServerNames = Object.keys(options.mcpServers ?? {})
    this.permissionMode = parsePermissionMode(options.mode)
    this.now = options.now ?? (() => new Date())
    this.mainThreadAgentName = options.agent
    this.agentDefinitionsHash = options.agentDefinitionsHash
    this.additionalDirectories = mergeAdditionalDirectories(options.additionalDirectories ?? [])
    const forwardedAbort = createForwardedAbortController(options.abortSignal, () => {
      this.abortRequested = true
      // Do not abort the SDK transport before its interrupt acknowledgement.
      queueMicrotask(() => { void this.close().catch((error) => this.logger?.warn("SDK external cancellation stop remains unconfirmed.", {
        boundary: "claude-sdk-query.cancel-stop", ...errorLogMeta(error),
      })) })
    })
    this.abortController = forwardedAbort?.controller
    this.abortCleanup = forwardedAbort?.cleanup

    const packagedRuntime = inspectPackagedClaudeRuntime()
    if (options.abortSignal?.aborted) {
      this.abortRequested = true
      this.query = new FailedQuery(new Error(AGENT_CANCELLED_MESSAGE))
    } else if (packagedRuntime.status === "missing") {
      this.query = new FailedQuery(createMissingPackagedClaudeRuntimeError(packagedRuntime))
    } else {
      const queryFactory = options.queryFactory ?? defaultQueryFactory
      const queryOptions = this.buildQueryOptions(options, packagedRuntime)
      const synapseToolRouter = options.synapseToolRouter
        ? {
            ...options.synapseToolRouter,
            onFallback: (reason: Parameters<NonNullable<SynapseToolRouterQueryOptions["onFallback"]>>[0]) => {
              options.synapseToolRouter?.onFallback?.(reason)
              this.notifySynapseToolRouterFallback(reason)
            },
          }
        : undefined
      this.query = queryFactory({
        prompt: this.inputQueue,
        options: queryOptions,
        expectedMcpServerNames: options.expectedMcpServerNames,
        logger: this.logger,
        synapseToolRouter,
      })
    }
    this.pumpPromise = this.pumpQueryEvents()
  }

  async send(message: AgentMessage): Promise<boolean> {
    if (this.closed || this.abortRequested) return false
    if (this.queryFinished) {
      this.logger?.warn("Claude SDK send rejected after query finished.", {
        boundary: "claude-sdk-send",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
      })
      return false
    }
    const attachments = normalizeAgentAttachments(message.attachments)
    for (const attachment of attachments) {
      const name = attachment.name ?? path.basename(attachment.path)
      this.attachmentPathLabels.set(attachment.path, `[Synapse attachment: ${name}]`)
    }
    for (const directory of message.runtimeAttachmentDirectories ?? []) {
      this.attachmentPathLabels.set(directory, "[Synapse attachment root]")
    }
    const content = buildAgentRuntimeUserContent(message.content, attachments)
    const sdkMessage = {
      type: "user" as const,
      message: {
        role: "user" as const,
        content,
      },
      parent_tool_use_id: null,
    }
    this.observedMessageUsage.clear()
    this.completedBatches = 0
    this.lastToolBatch = []
    this.pendingImages = []
    this.imageBodyPressure = false
    this.textBodyPressure = false
    this.pendingProgressReceipts.clear()
    this.expectedReadDeliveries.clear()
    this.eligiblePresentation = undefined
    this.resumedImages = message.pendingImagePresentations ?? []
    this.deferredImages = message.deferredImagePresentations ?? []
    this.deferredImagePressure = false
    this.confirmedImagePresentations.clear()
    this.presentedImages.clear()
    this.activeTurnId = message.runtimeTurnId
    this.completionRetryMarker = undefined
    this.outputRepairAttempted = false
    this.assistantOutputIntegrity = new AssistantOutputIntegrity()
    if (message.runtimeTurnId) await this.taskProgress?.begin(message.runtimeTurnId,
      Boolean(message.contextRecoveryTurnId) || /^(继续|继续上一个任务|continue)$/i.test(message.content.trim()))
    if (this.closed || this.abortRequested || this.abortController?.signal.aborted) return false
    this.contextBudget.beginTurn(serializedByteLength(sdkMessage))
    this.inputQueue.push(sdkMessage)
    return true
  }

  async steer(message: AgentSteerMessage): Promise<boolean> {
    if (this.closed || this.queryFinished || this.rotation) return false
    const sdkMessage = {
      type: "user",
      message: {
        role: "user" as const,
        content: message.content,
      },
      parent_tool_use_id: null,
      origin: { kind: "human" },
      timestamp: message.submittedAt,
    } as const
    this.contextBudget.recordModelVisibleBytes(serializedByteLength(sdkMessage))
    this.inputQueue.push(sdkMessage)
    return true
  }

  async respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void> {
    const pending = this.permissions.get(requestId)
    if (!pending) {
      this.logger?.warn("Claude SDK permission response rejected.", {
        boundary: "claude-sdk-permission-response",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        requestId,
        behavior: decision.behavior,
      })
      throw new Error(AGENT_PERMISSION_NOT_PENDING_MESSAGE)
    }

    if (decision.behavior === "allow"
      && decision.scope === "session"
      && pending.sessionDirectoryUpdates.length === 0) {
      throw new Error("当前权限请求不支持会话级目录授权。")
    }

    this.permissions.delete(requestId)
    pending.cleanup()
    if (decision.behavior === "allow" && decision.scope === "session") {
      this.additionalDirectories = mergeAdditionalDirectories(
        this.additionalDirectories,
        pending.sessionDirectoryUpdates.flatMap((update) => update.directories),
      )
    }
    pending.resolve(toPermissionResult(
      decision,
      pending.input,
      pending.sessionDirectoryUpdates,
      pending.projectUpdatedInput,
    ))
  }

  beginFileCheckpoint(turnId: string): void {
    this.fileCheckpointTracker.begin(turnId)
  }

  async finalizeFileCheckpoint() {
    const sdkUserMessageId = this.fileCheckpointTracker.activeSdkUserMessageId()
    return this.fileCheckpointTracker.finalize(
      this.sdkSessionId,
      () => sdkUserMessageId && this.query.rewindFiles
        ? this.query.rewindFiles(sdkUserMessageId, { dryRun: true })
        : Promise.resolve({ canRewind: false }),
    )
  }

  async rewindFiles(
    sdkUserMessageId: string,
    options?: { readonly dryRun?: boolean },
  ): Promise<RewindFilesResult> {
    if (!this.query.rewindFiles) {
      return { canRewind: false, error: "当前 Agent Runtime 不支持文件撤销。" }
    }
    return this.query.rewindFiles(sdkUserMessageId, options)
  }

  contextRotation(): AgentContextRotation | undefined {
    return this.rotation
  }

  imagePresentationCapacityBytes(): number { return this.contextBudget.availableNonTextBytes() }

  nextEvent(): Promise<AgentEvent | null> {
    return this.eventQueue.next()
  }

  nextEventWithTimeout(timeoutMs: number): Promise<AgentEvent | null> {
    return this.eventQueue.nextWithTimeout(timeoutMs)
  }

  currentSessionId(): string | undefined {
    return this.sdkSessionId
  }

  alive(): boolean {
    return (this.outputIntegrityFailed && this.eventQueue.hasValues())
      || (!this.closed && (!this.queryFinished || this.eventQueue.hasValues()))
  }

  async cancelCurrentTurn(): Promise<boolean> {
    if (!this.alive()) return false
    this.denyPendingPermissions(AGENT_TURN_PERMISSION_CANCELLED_MESSAGE)
    if (this.rotation) {
      await this.close()
    } else {
      await this.query.interrupt()
    }
    return true
  }

  async setPermissionMode(mode: string): Promise<void> {
    const permissionMode = parsePermissionMode(mode)
    if (!permissionMode) {
      throw new Error(`Unsupported permission mode: ${mode}`)
    }
    if (!this.query.setPermissionMode) {
      throw new Error("当前会话不支持切换权限模式")
    }
    await this.query.setPermissionMode(permissionMode)
    this.permissionMode = permissionMode
  }

  async grantAdditionalDirectories(directories: readonly string[]): Promise<void> {
    const nextDirectories = mergeAdditionalDirectories(this.additionalDirectories, directories)
    if (sameDirectories(this.additionalDirectories, nextDirectories)) return
    if (!this.query.grantAdditionalDirectories) {
      throw new Error("当前会话不支持动态授权附件目录。")
    }
    await this.query.grantAdditionalDirectories(mergeAdditionalDirectories(
      nextDirectories,
      this.readOnlyAdditionalDirectories,
    ))
    this.additionalDirectories = nextDirectories
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeAtBoundary()
    return this.closePromise
  }

  private async closeAtBoundary(): Promise<void> {
    this.taskProgress?.close()
    this.closed = true
    this.inputQueue.close()
    this.denyPendingPermissions("Session closed before permission was resolved.")
    try {
      if (this.queryFinished) {
        await this.query.close()
        this.releaseRotation?.()
      } else {
        await stopQueryAtBoundary({ query: this.query,
          release: () => this.releaseRotation?.(), settled: this.pumpPromise })
      }
      this.queryFinished = true
      this.abortController?.abort()
      this.abortCleanup?.()
      this.eventQueue.close()
    } catch (error) {
      this.logger?.warn("Claude SDK query close failed.", {
        boundary: "claude-sdk-query.close",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        ...errorLogMeta(error),
      })
      this.eventQueue.close()
      throw new Error("SDK 停止未确认，无法安全交接。", { cause: error })
    }
  }

  private buildQueryOptions(
    options: ClaudeSDKSessionOptions,
    packagedRuntime: PackagedClaudeRuntimeStatus,
  ): Record<string, unknown> {
    const hostEnv = buildHostEnvironment({
      baseEnv: options.hostEnv ?? process.env,
      shellPath: options.resolveShellPath
        ? options.resolveShellPath()
        : resolveCachedLoginShellPath(options.hostEnv ?? process.env),
      appendPathEntries: [
        options.nodeRuntimeBinPath ?? process.env.SYNAPSE_NODE_RUNTIME_BIN ?? "",
      ],
    })
    const sdkEnv = mergeEnvironmentWithPath(hostEnv, {
      ...options.env,
      PWD: this.cwd,
      BASH_DEFAULT_TIMEOUT_MS: CLAUDE_CODE_LONG_TASK_TIMEOUT_MS,
      BASH_MAX_TIMEOUT_MS: CLAUDE_CODE_LONG_TASK_TIMEOUT_MS,
    })
    const taskListId = options.taskListId ?? randomUUID()
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskListId)) {
      throw new Error("Invalid SDK task-list identity")
    }
    sdkEnv.CLAUDE_CODE_TASK_LIST_ID = taskListId
    const queryOptions: Partial<Options> = {
      cwd: this.cwd,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      settingSources: ["user", "project", "local"],
      skills: "all",
      settings: {
        enableAllProjectMcpServers: true,
        disableAllHooks: options.allowPluginHooks === true ? false : true,
        ...options.sdkSettings,
        env: { ...providerSettingsEnv(options.env), CLAUDE_CODE_TASK_LIST_ID: taskListId },
      },
      env: sdkEnv,
      includePartialMessages: true,
      canUseTool: (toolName, input, context) => this.canUseTool(toolName, input, context),
    }
    if (options.mcpServers && Object.keys(options.mcpServers).length > 0) queryOptions.mcpServers = options.mcpServers
    if (options.onElicitation) queryOptions.onElicitation = options.onElicitation

    if (packagedRuntime.status === "present") {
      queryOptions.pathToClaudeCodeExecutable = packagedRuntime.executablePath
    }
    if (options.model) queryOptions.model = options.model
    queryOptions.maxTurns = options.maxTurns ?? DEFAULT_CLAUDE_SDK_MAX_TURNS
    if (options.plugins?.length) queryOptions.plugins = [...options.plugins]
    if (options.agent) {
      ;(queryOptions as Record<string, unknown>).agent = options.agent
    }
    if (options.agents && Object.keys(options.agents).length > 0) queryOptions.agents = options.agents
    queryOptions.systemPrompt = withConfiguredWorkspaceRoot(options.systemPrompt, this.cwd, Boolean(this.taskProgress), this.taskProgressToolsAvailable)
    if (options.tools !== undefined) queryOptions.tools = options.tools
    if (options.disallowedTools?.length) queryOptions.disallowedTools = [...options.disallowedTools]
    const queryDirectories = mergeAdditionalDirectories(
      this.additionalDirectories,
      this.readOnlyAdditionalDirectories,
    )
    if (queryDirectories.length > 0) {
      queryOptions.additionalDirectories = [...queryDirectories]
    }
    queryOptions.hooks = this.buildHooks()
    if (options.sdkSessionId) queryOptions.resume = options.sdkSessionId
    if (this.abortController) queryOptions.abortController = this.abortController

    const permissionMode = parsePermissionMode(options.mode)
    if (permissionMode) {
      queryOptions.permissionMode = permissionMode
      if (permissionMode === "bypassPermissions") {
        queryOptions.allowDangerouslySkipPermissions = true
      }
    }

    return queryOptions as Record<string, unknown>
  }

  private buildHooks(): NonNullable<Options["hooks"]> {
    const hooks: NonNullable<Options["hooks"]> = {
      PreToolUse: [{
        matcher: TODO_WRITE_TOOL_NAME,
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => this.guardRepeatedTodoWrite(input)],
      }],
    }
    hooks.PreToolUse?.push({
      matcher: "*",
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        if (this.closed || this.abortRequested || this.rotation || this.outputIntegrityFailed) return { continue: false }
        if (input.hook_event_name === "PreToolUse" && !input.agent_id) {
          try { await this.confirmPriorBatchPresentation() }
          catch { return this.stopForOutputIntegrity("呈现确认未能保存，已停止并保留任务进度。") }
          const filePath = asRecord(input.tool_input)?.file_path
          const required = this.resumedImages.filter((image) => !this.confirmedImagePresentations.has(image.toolUseId))
          if (required.length && !(input.tool_name === "Read" && typeof filePath === "string" && await this.findResumedImage(filePath, required))) {
            return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
              permissionDecisionReason: "自动交接必须先用原生 Read 呈现本批待续接原图，再处理其它工具或旧记录。该操作尚未执行。" } }
          }
          if (!required.length && this.taskProgressToolsAvailable && input.tool_name === "Read" && typeof filePath === "string") {
            const pending = await this.taskProgress?.pendingProcessingBeforeRead(filePath)
            if (pending) return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: pending } }
          }
          if (input.tool_name === "Read" && typeof filePath === "string" && await this.findResumedImage(filePath, this.deferredImages)) {
            this.deferredImagePressure = true
            return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
              permissionDecisionReason: "这张已取得的图片将在下一批干净会话呈现，当前调用未执行；即将自动交接。" } }
          }
        }
        if (input.hook_event_name === "PreToolUse" && input.tool_name === "Read") {
          const filePath = asRecord(input.tool_input)?.file_path
          const pending = typeof filePath === "string"
            ? await this.findResumedImage(filePath) : undefined
          if (pending) {
            try { await verifyImagePresentation(pending) }
            catch { return this.stopForOutputIntegrity("图片原件已变化或不可读，已保留交接记录并停止。") }
          }
        }
        const workspaceBoundaryResult = await this.guardConfiguredWorkspaceWrite(input)
        if (workspaceBoundaryResult) return workspaceBoundaryResult
        await this.fileCheckpointTracker.captureBeforeTool(input)
        return {}
      }],
    })
    hooks.PostToolUse = [{
      matcher: "*",
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        const governed = this.outputGovernance.then(async () => {
          const output = await this.limitToolOutput(input)
          if ("async" in output || !this.taskProgress || this.closed || output.continue === false) return output
          try {
            const result = await recordTaskToolResult(this.taskProgress, input, output, this.cwd, this.taskProgressToolsAvailable,
              this.persistToolOutputText && this.activeTurnId ? { outputPath: this.governedToolOutputPath,
                ...(this.governedReadDelivery ? { boundedDelivery: this.governedReadDelivery } : {}),
                runtimeEvidenceRoots: this.readOnlyAdditionalDirectories,
                persist: (content) => this.persistToolOutputText!({ projectId: this.projectId, conversationId: this.conversationId,
                  turnId: this.activeTurnId!, toolName: "task-evidence", content }),
              } : undefined)
            if (result.receiptId) {
              this.pendingProgressReceipts.add(result.receiptId)
              if (input.hook_event_name === "PostToolUse" && input.tool_name === "Read" && output.hookSpecificOutput?.hookEventName !== "PostToolUse") {
                const expected = expectedNativeReadDelivery(input.tool_response)
                if (expected) this.expectedReadDeliveries.set(result.receiptId, expected)
              }
            }
            if (!result.context) return output
            this.contextBudget.recordToolOutput(toolResultRequestBytes(result.context), this.completedBatches + 1)
            return { ...output, hookSpecificOutput: { ...output.hookSpecificOutput, hookEventName: "PostToolUse" as const, additionalContext: result.context } }
          } catch (error) {
            if (error instanceof TaskProgressValidationError) {
              this.contextBudget.recordToolOutput(toolResultRequestBytes(error.message), this.completedBatches + 1)
              this.eventQueue.push({ type: "sdkEvent", sdkType: "taskProgressCommitRejected", payload: { reason: redactSensitiveText(error.message) },
                conversationId: this.conversationId, providerId: this.providerId, sdkSessionId: this.sdkSessionId, timestamp: this.now().toISOString() })
              return { ...output, hookSpecificOutput: { ...output.hookSpecificOutput, hookEventName: "PostToolUse" as const, additionalContext: error.message } }
            }
            return this.stopForOutputIntegrity("任务证据未能完整保存，已停止执行；已有操作可能已生效，请依据保存状态继续。")
          }
        })
        this.outputGovernance = governed.catch(() => undefined)
        return governed
      }],
    }]
    hooks.PostToolBatch = [{
      matcher: "*",
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        if (input.hook_event_name === "PostToolBatch" && !input.agent_id) {
          // Invalid tool input can bypass PreToolUse. Its later batch still proves
          // the preceding results were delivered; preserve that acknowledgement.
          try { await this.confirmPriorBatchPresentation() }
          catch { return this.stopForOutputIntegrity("呈现确认未能保存，已停止并保留任务进度。") }
          for (const [id, expected] of this.expectedReadDeliveries) {
            const delivered = input.tool_calls.find((call) => call.tool_use_id === id)
            if (!delivered || nativeReadDeliveredHash(delivered.tool_response, expected.kind) !== expected.hash) {
              return this.stopForOutputIntegrity("原生读取结果在交付前发生变化，无法核验完整呈现。已保留取得的证据和任务进度。")
            }
          }
          this.expectedReadDeliveries.clear()
          if (input.tool_calls.length > 0) this.completedBatches += 1
          this.lastToolBatch = input.tool_calls
          this.eligiblePresentation = { receipts: [...this.pendingProgressReceipts], images: [...this.presentedImages],
            acquired: this.pendingImages.map((image) => image.toolUseId) }
          this.pendingProgressReceipts.clear()
          this.presentedImages.clear()
        }
        if (input.hook_event_name === "PostToolBatch") {
          // File-mutation results are passed through untouched, so their
          // model-visible confirmation is accounted here from the SDK's own
          // serialization instead of the structured PostToolUse payload.
          for (const call of input.tool_calls) {
            if (!isFileMutationTool(call.tool_name)) continue
            // PostToolUse already accounted results it bounded or measured itself.
            if (this.accountedToolResults.delete(call.tool_use_id)) continue
            this.contextBudget.recordToolOutput(toolResultRequestBytes(call.tool_response), this.completedBatches + 1)
          }
          this.accountedToolResults.clear()
        }
        const snapshot = this.contextBudget.finishToolBatch()
        if (snapshot.batchToolOutputBytes > 0) {
          this.logger?.info?.("Agent tool-output batch budget completed.", {
            boundary: "claude-sdk.tool-output-budget.batch",
            projectId: this.projectId,
            conversationId: this.conversationId,
            providerId: this.providerId,
            batchToolOutputBytes: snapshot.batchToolOutputBytes,
            turnToolOutputBytes: snapshot.turnToolOutputBytes,
            estimatedRequestTokens: snapshot.estimatedRequestTokens,
            estimatedRequestBytes: snapshot.estimatedRequestBytes,
            requestBodyBudgetBytes: snapshot.requestBodyBudgetBytes,
          })
        }
        if (this.textBodyPressure) return this.pauseForContextRotation("request-budget")
        if (this.imageBodyPressure || this.deferredImagePressure) return this.pauseForContextRotation("image-presentation")
        return this.guardNextRequest(input)
      }],
    }]
    hooks.PreCompact = [{
      matcher: "*",
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        if (input.hook_event_name === "PreCompact") {
          this.pendingCompaction = {
            startedAt: Date.now(),
            trigger: input.trigger,
            before: this.contextBudget.snapshot(),
          }
        }
        return {}
      }],
    }]
    hooks.PostCompact = [{
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        if (input.hook_event_name !== "PostCompact" || input.agent_id) return {}
        this.lastCompactSummary = input.compact_summary
        if (this.pendingCompaction) {
          this.pendingCompaction.summaryBytes = Buffer.byteLength(input.compact_summary, "utf8")
          this.pendingCompaction.summaryRequestBytes = compactSummaryRequestBytes(input.compact_summary)
        }
        return this.guardNextRequest(input, true)
      }],
    }]
    hooks.Stop = [{ hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
      if (input.hook_event_name !== "Stop" || input.agent_id || this.closed || this.rotation || this.abortController?.signal.aborted) return {}
      try { await this.confirmPriorBatchPresentation() }
      catch { return this.stopForOutputIntegrity("呈现确认未能保存，已停止并保留任务进度。") }
      if (typeof input.last_assistant_message === "string") this.assistantOutputIntegrity.inspect({ type: "assistant",
        message: { content: [{ type: "text", text: input.last_assistant_message }] } })
      if (this.deferredImages.length) return this.pauseForContextRotation("image-presentation")
      if (this.assistantOutputIntegrity.needsRepair()) {
        const claimed = this.taskProgress ? await this.taskProgress.claimOutputRepair() : !this.outputRepairAttempted
        this.outputRepairAttempted = true
        if (claimed) return { decision: "block", reason: "最终答复包含重复长段落或泄漏的思考标签。依据已保存的结果重新输出一次准确、无重复的最终答复，不重跑已执行的操作；保留未完成及未验证项。" }
      }
      const assessment = await this.taskProgress?.assessment()
      if (!assessment || assessment.status !== "partial") return {}
      const gaps = await this.taskProgress?.evidenceGaps(typeof input.last_assistant_message === "string" ? input.last_assistant_message : undefined)
      const hasEvidenceGaps = Boolean(gaps && (gaps.missingEvidence.length > 0 || gaps.overclaim.length > 0))
      if (!hasEvidenceGaps && assessment.conflictingFindings === 0) return {}
      // Retries are keyed to unit outcomes: acquiring or presenting more evidence
      // without changing a unit must not re-arm another correction.
      const marker = `evidence:${await this.taskProgress?.completionMarker()}:${assessment.conflictingFindings}:${hasEvidenceGaps ? "gap" : "conflict"}`
      if (this.completionRetryMarker === marker) return {}
      this.completionRetryMarker = marker
      const detail = hasEvidenceGaps
        ? `缺口 ${JSON.stringify([...(gaps?.overclaim ?? []), ...(gaps?.missingEvidence ?? [])].slice(0, 8))}`
        : "存在证据冲突"
      return { decision: "block", reason: `任务证据不完整：${JSON.stringify(assessment)}；${detail}。补齐读取覆盖（大文件可分段读取累计）、成功编辑回执，或为只处理部分内容的单元声明 scope；不能把抽样读取当作通读，也不能在证据不足时宣称完成。无法继续时保留未完成状态并说明原因。` }
    }] }]
    hooks.UserPromptSubmit = [{
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => this.guardNextRequest(input)],
    }]

    if (this.personaToolPolicy && this.personaToolPolicy.mode !== "all") {
      hooks.PreToolUse?.unshift({
        matcher: "*",
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => this.guardPersonaToolPolicy(input)],
      })
    }

    if (Object.keys(this.subagentToolPolicies).length > 0
      || Object.keys(this.routerSubagentToolAccess).length > 0) {
      Object.assign(hooks, this.subagentTrackingHooks())
    }

    return hooks
  }

  private async readContextUsage(): Promise<SDKControlGetContextUsageResponse | undefined> {
    if (!this.query.getContextUsage) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.query.getContextUsage(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Context snapshot timed out")), 5_000)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private async guardNextRequest(input: HookInput, afterCompact = false): Promise<HookJSONOutput> {
    if (this.outputIntegrityFailed) return { continue: false }
    if (this.closed || this.rotation) return { continue: false }
    if (input.agent_id) return {}
    // The SDK exposes request boundaries, not a mutable transcript API.
    // Holding this hook prevents the next request while the host checkpoints
    // and closes the old session. close()/cancel releases the pending hook.
    const snapshotWatermark = this.contextBudget.costWatermark()
    let response: SDKControlGetContextUsageResponse | undefined
    try {
      response = await this.readContextUsage()
    } catch (error) {
      this.logger?.warn("Context preflight snapshot unavailable; retaining conservative budget.", {
        boundary: "claude-sdk.request-budget", ...errorLogMeta(error),
      })
    }
    if (this.closed || this.abortRequested || this.abortController?.signal.aborted) return { continue: false }
    if (response) {
      const usage = this.contextUsageTracker.replaceFromContextUsage(response)
      if (usage) {
        // A hook snapshot can precede insertion of the current batch/prompt;
        // never erase bytes accrued since the last completed model response.
        if (afterCompact) {
          this.contextBudget.completeCompaction(usage.usedTokens, compactSummaryRequestBytes(this.lastCompactSummary), retainedPayloadTokens(response), snapshotWatermark)
        } else {
          this.contextBudget.observeContextTokens(usage.usedTokens, this.confirmedCostWatermark)
        }
        this.contextBudget.updateRequestTokenLimit(response.maxTokens)
      }
    }
    const pressure = this.contextBudget.availableModelVisibleBytes() < 4_096
    const ineffective = afterCompact && response !== undefined && pressure
    if (!ineffective && !pressure) return {}
    if (!this.persistToolOutputText || !this.activeTurnId) {
      return { continue: false, stopReason: "上下文空间不足，无法保存自动交接资料。" }
    }
    return this.pauseForContextRotation(ineffective ? "ineffective-compaction" : "request-budget")
  }

  private async pauseForContextRotation(reason: AgentContextRotation["reason"]): Promise<HookJSONOutput> {
    if (this.closed || this.abortRequested || this.abortController?.signal.aborted) return { continue: false }
    const budget = this.contextBudget.snapshot()
    this.logger?.info?.("Agent request paused for context handoff.", {
      boundary: "claude-sdk.request-budget", reason,
      tokenEstimate: budget.estimatedRequestTokens, tokenLimit: budget.maxContextTokens,
      serializedBytes: budget.retainedRequestBytes, bodyEstimate: budget.estimatedRequestBytes,
      bodyBudget: budget.requestBodyBudgetBytes, unknownTokenCosts: budget.unknownTokenCosts,
      costWatermark: budget.costWatermark, completedBatches: this.completedBatches,
    })
    this.eventQueue.push({ type: "sdkEvent", sdkType: "contextBudgetSnapshot", payload: {
      reason, tokenEstimate: budget.estimatedRequestTokens, tokenLimit: budget.maxContextTokens,
      serializedBytes: budget.retainedRequestBytes, bodyEstimate: budget.estimatedRequestBytes,
      bodyBudget: budget.requestBodyBudgetBytes, unknownTokenCosts: budget.unknownTokenCosts,
      costWatermark: budget.costWatermark, measurementSource: "host-ledger-with-sdk-snapshots", exactHttpBody: false,
    }, conversationId: this.conversationId, providerId: this.providerId,
    sdkSessionId: this.sdkSessionId, timestamp: this.now().toISOString() })
    this.rotation = {
      reason,
      ...(this.pendingImages.length || this.deferredImages.length ? { pendingImages: mergePendingImages(this.deferredImages, this.pendingImages) } : {}),
      summary: this.lastCompactSummary,
      completedBatches: this.completedBatches,
      lastToolBatch: this.lastToolBatch,
      usage: { ...sumClaudeSdkUsage([...this.observedMessageUsage.values()]) },
    }
    const paused = new Promise<void>((resolve) => { this.releaseRotation = resolve })
    // The SDK may not have yielded this batch's user/tool_result frames yet.
    // Project them before the maintenance marker so history/UI retain their outcomes.
    for (const tool of this.lastToolBatch) {
      if (this.deliveredToolResults.has(tool.tool_use_id)) continue
      const content = measureToolOutput(tool.tool_name, tool.tool_response)?.text
      this.eventQueue.push(this.projectAttachmentEvent(this.projectSynapseToolRouterEvent({
        type: "toolResult", toolName: tool.tool_name, toolUseId: tool.tool_use_id,
        content, status: "observed", conversationId: this.conversationId,
        providerId: this.providerId, sdkSessionId: this.sdkSessionId,
        timestamp: this.now().toISOString(),
      })))
      this.deliveredToolResults.add(tool.tool_use_id)
    }
    this.eventQueue.push({
      type: "sdkEvent", sdkType: "contextRotationRequested", payload: {},
      conversationId: this.conversationId, providerId: this.providerId,
      sdkSessionId: this.sdkSessionId, timestamp: this.now().toISOString(),
    })
    await paused
    return { continue: false, suppressOutput: true }
  }

  private async findResumedImage(filePath: string, images = this.resumedImages): Promise<PendingImagePresentation | undefined> {
    const absolute = path.resolve(this.cwd, filePath)
    const direct = images.find((image) => image.path === absolute)
    if (direct || images.length === 0) return direct
    try {
      const canonical = await realpath(absolute)
      return images.find((image) => image.path === canonical)
    } catch {
      return undefined // Native Read will report the inaccessible path; no permission is granted here.
    }
  }

  /** Native hook boundaries cannot lag into the next batch as the query iterator can. */
  private confirmPriorBatchPresentation(): Promise<void> {
    this.presentationAcknowledgement = this.presentationAcknowledgement.then(async () => {
      const batch = this.eligiblePresentation
      if (!batch || this.closed || this.rotation) return
      await this.taskProgress?.presented(batch.receipts)
      if (this.closed || this.rotation) return
      this.eligiblePresentation = undefined
      for (const toolUseId of batch.images) {
        this.confirmedImagePresentations.add(toolUseId)
        this.eventQueue.push({ type: "sdkEvent", sdkType: "imagePresentationCompleted", payload: { originalToolUseId: toolUseId },
          conversationId: this.conversationId, providerId: this.providerId, sdkSessionId: this.sdkSessionId, timestamp: this.now().toISOString() })
      }
      const acquired = new Set(batch.acquired)
      this.pendingImages = this.pendingImages.filter((image) => !acquired.has(image.toolUseId))
    })
    return this.presentationAcknowledgement
  }

  /** Durable evidence roots own their content; a bounded re-read must not be stored twice. */
  private async durableEvidenceReadPath(record: Record<string, unknown>): Promise<string | undefined> {
    if (record.tool_name !== "Read" || this.durableEvidenceRoots.length === 0) return undefined
    const requested = asRecord(record.tool_input)?.file_path
    if (typeof requested !== "string" || requested.length === 0) return undefined
    const absolutePath = path.resolve(this.cwd, requested)
    const roots = await resolveExistingRoots(this.durableEvidenceRoots)
    if (roots.length === 0) return undefined
    try {
      const target = await realpath(absolutePath)
      return roots.some((root) => isPathInside(root, target)) ? absolutePath : undefined
    } catch {
      return undefined // An unresolvable path cannot claim durable evidence.
    }
  }

  private async limitToolOutput(input: HookInput): Promise<HookJSONOutput> {
    this.governedToolOutputPath = undefined
    this.governedReadDelivery = undefined
    if (this.outputIntegrityFailed || this.closed || this.abortController?.signal.aborted) return { continue: false }
    const record = input as unknown as Record<string, unknown>
    if (record.hook_event_name !== "PostToolUse" || typeof record.tool_name !== "string") return {}
    // Native file-mutation results carry the whole file for hooks and the UI,
    // while the model only receives a short confirmation line. Nothing enters a
    // request body here, so there is nothing to bound or replace. The delivered
    // bytes are accounted for in PostToolBatch.
    if (isStructuredFileMutationOutput(record.tool_name, record.tool_response)) return {}
    const measurement = measureToolOutput(record.tool_name, record.tool_response)
    if (!measurement) {
      const responseBytes = serializedByteLength(record.tool_response)
      const availableBytes = Math.max(
        0,
        this.contextBudget.availableNonTextBytes() - toolResultRequestBytes(""),
      )
      if (responseBytes <= availableBytes) {
        const filePath = asRecord(record.tool_input)?.file_path
        const resumed = typeof filePath === "string"
          ? await this.findResumedImage(filePath) : undefined
        if (record.tool_name === "Read" && asRecord(record.tool_response)?.type === "image" && resumed) {
          this.presentedImages.add(resumed.toolUseId)
        }
        if (record.tool_name === "Read" && asRecord(record.tool_response)?.type === "image"
          && typeof filePath === "string" && typeof record.tool_use_id === "string"
          && this.persistToolOutputText && this.activeTurnId) {
          try {
            const captured = await captureImagePresentation(filePath, this.cwd, record.tool_use_id)
            if (resumed && (captured.sha256 !== resumed.sha256 || captured.size !== resumed.size)) {
              return this.stopForOutputIntegrity("图片原件在呈现期间发生变化，已停止并保留恢复状态。")
            }
            this.pendingImages.push(captured)
          }
          catch { return this.stopForOutputIntegrity("图片原件无法验证，已停止执行并保留已有工具结果。") }
        }
        this.contextBudget.recordToolOutputCost({ bytes: toolResultRequestBytes(record.tool_response),
          tokens: null, source: "native-non-text", batch: this.completedBatches + 1 })
        if (typeof record.tool_use_id === "string") this.accountedToolResults.add(record.tool_use_id)
        return {}
      }
      const filePath = asRecord(record.tool_input)?.file_path
      if (record.tool_name === "Read" && asRecord(record.tool_response)?.type === "image"
        && typeof filePath === "string" && typeof record.tool_use_id === "string"
        && this.persistToolOutputText && this.activeTurnId) {
        try {
          const image = await captureImagePresentation(filePath, this.cwd, record.tool_use_id)
          if (this.resumedImages.some((previous) => previous.path === image.path && previous.sha256 === image.sha256)) {
            return this.stopForOutputIntegrity(`图片在干净会话中仍无法容纳：body=${responseBytes}，可用=${availableBytes} 字节；视觉 token 未知。已保留原件引用。`)
          }
          this.pendingImages.push(image)
          this.imageBodyPressure = true
          // PostToolBatch is the request barrier. Let sibling results finish so
          // their already executed side effects are captured in the same checkpoint.
          return {}
        } catch {
          return this.stopForOutputIntegrity("图片原件无法验证，已停止执行并保留已有工具结果。")
        }
      }
      return this.stopForOutputIntegrity(`非文本结果无法安全续接：body=${responseBytes}，可用=${availableBytes} 字节；视觉 token 未知。`)
    }
    const availableBytes = Math.max(
      0,
      this.contextBudget.availableToolOutputBytes() - toolResultRequestBytes(""),
    )
    const needsRewrite = measurement.bytes > availableBytes
      || measurement.lines > 2_000
    // Re-reading durable evidence Synapse already stored must never mint another
    // copy: the complete content already lives at the path being read.
    const existingOutputPath = needsRewrite ? await this.durableEvidenceReadPath(record) : undefined
    let persisted: PersistedToolOutputText | undefined
    if (needsRewrite && !existingOutputPath && this.persistToolOutputText && this.activeTurnId) {
      try {
        persisted = await this.persistToolOutputText({
          projectId: this.projectId,
          conversationId: this.conversationId,
          turnId: this.activeTurnId,
          ...(typeof record.tool_use_id === "string" ? { toolUseId: record.tool_use_id } : {}),
          toolName: record.tool_name,
          content: measurement.text,
        })
      } catch (error) {
        this.logger?.warn("Agent tool output persistence failed; stopping before discarding evidence.", {
          boundary: "claude-sdk.tool-output-artifact",
          projectId: this.projectId,
          conversationId: this.conversationId,
          providerId: this.providerId,
          toolName: record.tool_name,
          ...errorLogMeta(error),
        })
      }
    }
    if (this.closed || this.abortRequested || this.abortController?.signal.aborted) return { continue: false }
    if (needsRewrite && !existingOutputPath && (!persisted || persisted.contentTruncated)) {
      return this.stopForOutputIntegrity("工具结果未能完整保存，已停止执行。该操作可能已生效，请核实已有结果后继续。")
    }
    this.governedToolOutputPath = persisted?.storagePath
    let governed = governToolOutput({
      toolName: record.tool_name,
      toolResponse: record.tool_response,
      maxBytes: availableBytes,
      ...(persisted ? { persistedOutputPath: persisted.storagePath } : existingOutputPath ? { existingOutputPath } : {}),
    })
    let updatedToolOutput = governed
      ? replaceToolOutput(record.tool_name, record.tool_response, governed.updatedToolOutput)
      : record.tool_response
    if (governed && updatedToolOutput === undefined) {
      this.logger?.warn("Agent tool result cannot be replaced safely; stopping before the next request.", {
        boundary: "claude-sdk.tool-output-integrity",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        toolName: record.tool_name,
        originalBytes: governed.originalBytes,
        availableBytes,
      })
      return this.stopForOutputIntegrity("工具结果已保存，但当前 SDK 输出结构无法安全替换，已停止执行。")
    }
    // Account for native result wrappers and JSON escaping, not just preview text.
    let previewBytes = availableBytes
    for (let attempt = 0; governed && attempt < 8; attempt += 1) {
      const excess = toolResultRequestBytes(updatedToolOutput) - this.contextBudget.availableToolOutputBytes()
      if (excess <= 0) break
      previewBytes = Math.max(0, previewBytes - excess)
      governed = governToolOutput({ toolName: record.tool_name, toolResponse: record.tool_response,
        maxBytes: previewBytes,
        ...(persisted ? { persistedOutputPath: persisted.storagePath } : existingOutputPath ? { existingOutputPath } : {}) })
      updatedToolOutput = governed ? replaceToolOutput(record.tool_name, record.tool_response, governed.updatedToolOutput) : record.tool_response
    }
    if (governed && governed.deliveredContentLines > 0 && record.tool_name === "Read") {
      // The bounded replacement carries only the lines actually delivered; coverage
      // must never credit the omitted original.
      this.governedReadDelivery = { sourceLines: governed.deliveredContentLines, kept: governed.kept }
    }
    if (governed && persisted && !governed.updatedToolOutput.includes(persisted.storagePath)) {
      this.textBodyPressure = true
      return {}
    }
    const deliveredRequestBytes = toolResultRequestBytes(updatedToolOutput)
    if (governed && deliveredRequestBytes > this.contextBudget.availableToolOutputBytes()) {
      this.textBodyPressure = true
      return {}
    }
    this.contextBudget.recordToolOutput(deliveredRequestBytes, this.completedBatches + 1)
    if (typeof record.tool_use_id === "string") this.accountedToolResults.add(record.tool_use_id)
    if (!governed) return {}
    const budget = this.contextBudget.snapshot()
    this.logger?.info?.("Agent tool output was bounded before the next model request.", {
      boundary: "claude-sdk.tool-output-governor",
      projectId: this.projectId,
      conversationId: this.conversationId,
      providerId: this.providerId,
      toolName: record.tool_name,
      originalBytes: governed.originalBytes,
      deliveredBytes: governed.deliveredBytes,
      originalLines: governed.originalLines,
      deliveredLines: governed.deliveredLines,
      kept: governed.kept,
      persisted: Boolean(persisted),
      existingOutput: existingOutputPath !== undefined,
      persistedBytes: persisted?.storedByteSize,
      persistedTruncated: persisted?.contentTruncated,
      batchToolOutputBytes: budget.batchToolOutputBytes,
      turnToolOutputBytes: budget.turnToolOutputBytes,
      estimatedRequestTokens: budget.estimatedRequestTokens,
      estimatedRequestBytes: budget.estimatedRequestBytes,
      requestBodyBudgetBytes: budget.requestBodyBudgetBytes,
    })
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput,
      },
    }
  }

  private stopForOutputIntegrity(message: string): HookJSONOutput {
    if (!this.outputIntegrityFailed && !this.closed && !this.abortController?.signal.aborted) {
      this.outputIntegrityFailed = true
      this.inputQueue.close()
      this.eventQueue.push({ type: "error", message, errorKind: "execution_failed", recoverable: true,
        conversationId: this.conversationId, providerId: this.providerId, sdkSessionId: this.sdkSessionId,
        timestamp: this.now().toISOString() })
      // Do not await close from inside the hook it may itself be waiting for.
      void this.closeAfterOutputIntegrityFailure()
    }
    return { continue: false, stopReason: message }
  }

  private async closeAfterOutputIntegrityFailure(): Promise<void> {
    try {
      await this.close()
    } catch (error) {
      this.logger?.warn("Claude SDK close after output integrity failure failed.", {
        boundary: "claude-sdk.tool-output-integrity", ...errorLogMeta(error),
      })
    } finally {
      this.denyPendingPermissions("Tool output integrity failed.")
      this.eventQueue.close()
    }
  }

  private async guardConfiguredWorkspaceWrite(input: HookInput): Promise<HookJSONOutput | undefined> {
    const record = input as unknown as Record<string, unknown>
    if (record.hook_event_name !== "PreToolUse" || typeof record.tool_name !== "string") return undefined
    if (!isWriteTool(record.tool_name)) return undefined
    const toolInput = asRecord(record.tool_input)
    const requestedPath = toolInput ? writePathForToolInput(toolInput) : undefined
    if (!requestedPath) return undefined
    const absolutePath = path.resolve(this.cwd, requestedPath)
    const allowedRoots = [this.cwd, ...this.additionalDirectories]
    if (!allowedRoots.some((root) => isPathInside(root, absolutePath))) {
      return denyToolUse(WORKSPACE_WRITE_BOUNDARY_MESSAGE)
    }
    const [resolvedTarget, resolvedRoots] = await Promise.all([
      resolveWorkspaceWriteTarget(absolutePath),
      resolveExistingRoots(allowedRoots),
    ])
    if (resolvedTarget && resolvedRoots.some((root) => isPathInside(root, resolvedTarget))) {
      return undefined
    }
    return denyToolUse(WORKSPACE_WRITE_BOUNDARY_MESSAGE)
  }

  private guardPersonaToolPolicy(input: HookInput): HookJSONOutput {
    const record = input as unknown as Record<string, unknown>
    if (record.hook_event_name !== "PreToolUse") return {}
    const toolName = typeof record.tool_name === "string" ? record.tool_name : ""
    if (!toolName) return denyToolUse("当前智能体未允许使用该工具。")
    const policy = this.personaToolPolicy
    if (!policy || policy.mode === "all") return {}
    if (policy.mode === "disabled") {
      return denyToolUse("当前智能体未启用工具。")
    }
    if (toolName === SYNAPSE_TOOL_ROUTER_SEARCH_TOOL) {
      return policy.allowedTools.some((allowed) => allowed.startsWith(SYNAPSE_MCP_TOOL_PREFIX))
        ? {}
        : denyToolUse("当前智能体未允许使用 Synapse 工具。")
    }
    if (toolName === SYNAPSE_TOOL_ROUTER_INVOKE_TOOL) {
      const routed = parseSynapseToolRouterInvoke(record.tool_input)
      return routed && policy.allowedTools.includes(originalSynapseSdkToolName(routed.toolName))
        ? {}
        : denyToolUse("当前智能体未允许使用该 Synapse 工具。")
    }
    if (policy.allowedTools.includes(toolName)) return {}
    return denyToolUse("当前智能体未允许使用该工具。")
  }

  private guardRepeatedTodoWrite(input: HookInput): HookJSONOutput {
    const record = input as unknown as Record<string, unknown>
    if (record.hook_event_name !== "PreToolUse" || record.tool_name !== TODO_WRITE_TOOL_NAME) {
      return {}
    }

    const signature = stableToolSignature(TODO_WRITE_TOOL_NAME, record.tool_input)
    if (signature === this.lastTodoWriteSignature) {
      this.repeatedTodoWriteCount += 1
    } else {
      this.lastTodoWriteSignature = signature
      this.repeatedTodoWriteCount = 1
    }

    if (this.repeatedTodoWriteCount <= MAX_CONSECUTIVE_IDENTICAL_TODO_WRITE_ALLOWS) {
      return {}
    }

    if (this.repeatedTodoWriteCount <= MAX_CONSECUTIVE_IDENTICAL_TODO_WRITE_ALLOWS
      + MAX_CONSECUTIVE_IDENTICAL_TODO_WRITE_DENIES) {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: TODO_WRITE_LOOP_GUIDANCE,
          additionalContext: TODO_WRITE_LOOP_GUIDANCE,
        },
      }
    }

    return {
      continue: false,
      stopReason: TODO_WRITE_LOOP_STOP_REASON,
    }
  }

  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    context: CanUseToolContext,
  ): Promise<PermissionResult> {
    if (this.closed) return { behavior: "deny", message: AGENT_SESSION_CLOSED_MESSAGE }
    if (context.signal.aborted) return permissionCancelledResult()
    if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
      return this.requestUserQuestion(input, context)
    }
    if (toolName === SYNAPSE_TOOL_ROUTER_SEARCH_TOOL) {
      const policy = this.personaToolPolicy
      if (policy?.mode === "disabled") {
        return { behavior: "deny", message: "当前智能体未启用工具。" }
      }
      if (policy?.mode === "allowlist"
        && !policy.allowedTools.some((allowed) => allowed.startsWith(SYNAPSE_MCP_TOOL_PREFIX))) {
        return { behavior: "deny", message: "当前智能体未允许使用 Synapse 工具。" }
      }
      return { behavior: "allow", updatedInput: input }
    }
    const routedInvoke = toolName === SYNAPSE_TOOL_ROUTER_INVOKE_TOOL
      ? parseSynapseToolRouterInvoke(input)
      : null
    if (toolName === SYNAPSE_TOOL_ROUTER_INVOKE_TOOL && !routedInvoke) {
      return { behavior: "deny", message: "Unknown or invalid Synapse MCP tool invocation." }
    }
    const effectiveToolName = routedInvoke
      ? originalSynapseSdkToolName(routedInvoke.toolName)
      : toolName
    const effectiveInput = routedInvoke?.arguments ?? input
    const personaPolicyResult = this.evaluatePersonaToolPolicy(effectiveToolName)
    if (personaPolicyResult) return personaPolicyResult
    const routerSubagentPolicyResult = this.evaluateRouterSubagentToolAccess(effectiveToolName, context)
    if (routerSubagentPolicyResult) return routerSubagentPolicyResult
    if (routedInvoke) {
      if (this.permissionMode === "dontAsk") {
        return { behavior: "deny", message: "Synapse tool invocation is disabled in dontAsk mode." }
      }
      if (this.permissionMode === "plan" && !isSynapseToolReadOnly(routedInvoke.toolName)) {
        return { behavior: "deny", message: "Only read-only Synapse tools are available in plan mode." }
      }
      if (this.permissionMode === "plan" || this.permissionMode === "bypassPermissions") {
        return { behavior: "allow", updatedInput: input }
      }
    }
    const toolPolicyResult = this.toolPolicy?.(effectiveToolName, effectiveInput)
    if (toolPolicyResult) {
      return routedInvoke && toolPolicyResult.behavior === "allow"
        ? {
            ...toolPolicyResult,
            updatedInput: {
              toolName: routedInvoke.toolName,
              arguments: toolPolicyResult.updatedInput,
            },
          }
        : toolPolicyResult
    }
    const policyResult = this.evaluateSubagentToolPolicy(effectiveToolName, effectiveInput, context)
    if (policyResult) return policyResult

    const requestId = this.nextPermissionRequestId()
    const timestamp = this.now().toISOString()
    const sessionDirectoryUpdates = sessionDirectoryPermissionUpdates(context.suggestions)
    const displayInput = projectAttachmentPaths(effectiveInput, this.attachmentPathLabels) as Record<string, unknown>
    const event: AgentEvent = {
      type: "permissionRequest",
      requestId,
      toolName: effectiveToolName,
      toolInput: summarizeToolInput(effectiveToolName, displayInput),
      toolInputRaw: sanitizeToolInputRecord(displayInput),
      conversationId: this.conversationId,
      providerId: this.providerId,
      projectId: this.projectId,
      sdkSessionId: this.sdkSessionId,
      timestamp,
      ...(context.blockedPath
        ? { blockedPath: projectAttachmentPathText(context.blockedPath, this.attachmentPathLabels) }
        : {}),
      ...(sessionDirectoryUpdates.length > 0
        ? { sessionDirectoryGrantAvailable: true }
        : {}),
    }

    this.eventQueue.push(event)

    return this.awaitPermissionResponse(
      requestId,
      input,
      context,
      sessionDirectoryUpdates,
      routedInvoke
        ? (updatedInput) => ({ toolName: routedInvoke.toolName, arguments: updatedInput })
        : undefined,
    )
  }

  private evaluatePersonaToolPolicy(toolName: string): PermissionResult | undefined {
    const policy = this.personaToolPolicy
    if (!policy || policy.mode === "all") return undefined
    if (policy.mode === "disabled") {
      return { behavior: "deny", message: "当前智能体未启用工具。" }
    }
    if (!policy.allowedTools.includes(toolName)) {
      return { behavior: "deny", message: "当前智能体未允许使用该工具。" }
    }
    return undefined
  }

  private evaluateRouterSubagentToolAccess(
    toolName: string,
    context: CanUseToolContext,
  ): PermissionResult | undefined {
    if (!toolName.startsWith(SYNAPSE_MCP_TOOL_PREFIX) || !context.agentID) return undefined
    const agentType = this.subagentTypesById.get(context.agentID)
    if (!agentType) return { behavior: "deny", message: "Subagent identity could not be verified." }
    const access = this.routerSubagentToolAccess[agentType]
    if (!access) return undefined
    if (access.allowedTools && !access.allowedTools.includes(toolName)) {
      return { behavior: "deny", message: `Subagent ${agentType} is not allowed to use this Synapse tool.` }
    }
    if (access.disallowedTools?.includes(toolName)) {
      return { behavior: "deny", message: `Subagent ${agentType} is not allowed to use this Synapse tool.` }
    }
    return undefined
  }

  private async requestUserQuestion(
    input: Record<string, unknown>,
    context: CanUseToolContext,
  ): Promise<PermissionResult> {
    const questions = parseAskUserQuestions(input)
    if (!questions) {
      return { behavior: "deny", message: AGENT_INVALID_ASK_USER_QUESTION_INPUT_MESSAGE }
    }

    const requestId = this.nextPermissionRequestId()
    const timestamp = this.now().toISOString()
    const event: AgentEvent = {
      type: "permissionRequest",
      requestId,
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      toolInput: summarizeToolInput(ASK_USER_QUESTION_TOOL_NAME, input),
      toolInputRaw: sanitizeToolInputRecord(input),
      questions,
      conversationId: this.conversationId,
      providerId: this.providerId,
      projectId: this.projectId,
      sdkSessionId: this.sdkSessionId,
      timestamp,
    }

    this.eventQueue.push(event)

    return this.awaitPermissionResponse(requestId, input, context, [])
  }

  private awaitPermissionResponse(
    requestId: string,
    input: Record<string, unknown>,
    context: CanUseToolContext,
    sessionDirectoryUpdates: readonly SessionDirectoryPermissionUpdate[],
    projectUpdatedInput?: (input: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const abort = (): void => {
        if (!this.permissions.delete(requestId)) return
        resolve({ behavior: "deny", message: AGENT_PERMISSION_CANCELLED_MESSAGE })
      }
      context.signal.addEventListener("abort", abort, { once: true })
      this.permissions.set(requestId, {
        input,
        sessionDirectoryUpdates,
        resolve,
        cleanup: () => context.signal.removeEventListener("abort", abort),
        projectUpdatedInput,
      })
      if (context.signal.aborted) abort()
    })
  }

  private subagentTrackingHooks(): NonNullable<Options["hooks"]> {
    const startHook: HookCallbackMatcher = {
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        if (input.hook_event_name === "SubagentStart") {
          this.subagentTypesById.set(input.agent_id, input.agent_type)
        }
        return { continue: true }
      }],
    }
    const stopHook: HookCallbackMatcher = {
      hooks: [async (input: HookInput): Promise<HookJSONOutput> => {
        if (input.hook_event_name === "SubagentStop") {
          this.subagentTypesById.delete(input.agent_id)
        }
        return { continue: true }
      }],
    }
    return {
      SubagentStart: [startHook],
      SubagentStop: [stopHook],
    }
  }

  private evaluateSubagentToolPolicy(
    toolName: string,
    input: Record<string, unknown>,
    context: CanUseToolContext,
  ): PermissionResult | undefined {
    if (!context.agentID || !isWriteTool(toolName)) return undefined
    const agentType = this.subagentTypesById.get(context.agentID)
    if (!agentType) return undefined
    const policy = this.subagentToolPolicies[agentType]
    if (!policy) return undefined
    const writePath = writePathForToolInput(input)
    if (!writePath) return {
      behavior: "deny",
      message: `Subagent ${agentType} write path could not be verified.`,
    }
    const normalizedPath = normalizeToolPath(writePath)
    if (!normalizedPath) {
      return {
        behavior: "deny",
        message: `Subagent ${agentType} write path is not allowed.`,
      }
    }
    if (policy.deniedWritePaths?.some((denied) => pathMatchesPolicy(normalizedPath, denied))) {
      return {
        behavior: "deny",
        message: allowedWriteRootsMessage(agentType, policy.allowedWriteRoots),
      }
    }
    if (policy.allowedWriteRoots?.length
      && !policy.allowedWriteRoots.some((allowed) => pathMatchesPolicy(normalizedPath, allowed))) {
      return {
        behavior: "deny",
        message: allowedWriteRootsMessage(agentType, policy.allowedWriteRoots),
      }
    }
    return undefined
  }

  private async pumpQueryEvents(): Promise<void> {
    try {
      while (true) {
        const result = await this.query.next()
        if (result.done) break
        // Keep draining to the actual native iterator termination. A late frame
        // after interrupt is not proof of termination and cannot update state.
        if (this.closed || this.outputIntegrityFailed) continue
        for (const event of await this.bridgeMessage(result.value)) {
          if (!this.closed) this.eventQueue.push(event)
        }
      }
    } catch (error) {
      if (!this.closed && !this.outputIntegrityFailed) {
        this.logger?.warn("Claude SDK query failed.", {
          boundary: "claude-sdk-query",
          projectId: this.projectId,
          conversationId: this.conversationId,
          providerId: this.providerId,
          sdkSessionId: this.sdkSessionId,
          ...errorLogMeta(error),
        })
        const event = this.errorEvent(error)
        if (this.canAutomaticallyRecoverCapacity(event)) {
          await this.pauseForContextRotation("request-budget")
        } else {
          this.eventQueue.push(event)
        }
      }
    } finally {
      this.flushSdkDiagnosticSummary()
      this.queryFinished = true
      this.inputQueue.close()
      this.denyPendingPermissions(AGENT_QUERY_FINISHED_PERMISSION_MESSAGE)
      this.abortCleanup?.()
      this.eventQueue.close()
    }
  }

  private errorEvent(error: unknown): AgentEvent {
    const presentation = this.scopedErrorPresentation(errorDiagnosticMessage(error))
    return {
      type: "error",
      message: presentation.message,
      errorKind: presentation.errorKind,
      recoverable: presentation.recoverable,
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    }
  }

  private canAutomaticallyRecoverCapacity(event: AgentEvent): boolean {
    return !this.closed && Boolean(this.persistToolOutputText && this.activeTurnId)
      && event.type === "error" && (
        event.errorKind === "context_refill_thrashing"
        || (event.errorKind === "request_body_too_large" && this.maxRequestBodyBytes === 6 * 1024 * 1024)
        || (this.maxRequestBodyBytes === 6 * 1024 * 1024
          && /InternalError\.Algo\.InvalidParameter: Range of input length should be \[1, [1-9]\d{0,6}\]/.test(event.message))
      )
  }

  private scopedErrorPresentation(diagnostic: string | undefined) {
    const presentation = sdkQueryErrorPresentation(diagnostic)
    if (presentation.errorKind !== "request_body_too_large" || this.maxRequestBodyBytes === 6 * 1024 * 1024) {
      return presentation
    }
    return {
      message: "Agent 执行失败。",
      errorKind: "execution_failed" as const,
      recoverable: false,
    }
  }

  private async bridgeMessage(message: SDKMessage): Promise<readonly AgentEvent[]> {
    const raw = message as unknown as Record<string, unknown>
    const outputDiagnostic = this.assistantOutputIntegrity.inspect(raw)
    if (outputDiagnostic?.duplicateDelivery) return []
    this.observeSdkDiagnostic(raw)
    if (raw.type === "system" && raw.subtype === "init") {
      await this.reconnectConfiguredMcpServers()
    }
    const messageSessionId = typeof raw.session_id === "string" ? raw.session_id : undefined
    if (messageSessionId) this.sdkSessionId = messageSessionId
    this.observeCompactionStatus(raw)
    if (isReplayedUserMessage(raw)) {
      this.fileCheckpointTracker.recordSdkUserMessageId(raw.uuid as string)
      if (raw.isReplay !== true) return []
    }

    const envelope: AgentEventEnvelope & { readonly sdkSessionId?: string } = {
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    }
    if (raw.type === "assistant" && raw.message && typeof raw.message === "object") {
      const assistant = raw.message as Record<string, unknown>
      if (typeof assistant.id === "string" && assistant.usage && typeof assistant.usage === "object") {
        this.observedMessageUsage.set(assistant.id, assistant.usage as Record<string, unknown>)
      }
    }
    if (raw.type === "assistant" && raw.parent_tool_use_id === null) {
      this.contextBudget.recordModelVisibleBytes(serializedByteLength(raw.message))
    }
    this.rememberToolUseNames(raw)
    let contextUsage = this.contextUsageTracker.update(raw)
    if (raw.type === "system" && raw.subtype === "compact_boundary") {
      contextUsage = await this.refreshContextUsageAfterCompaction()
    } else if (raw.type === "result") {
      contextUsage = await this.refreshContextUsageAfterTurn() ?? contextUsage
    }
    if (contextUsage) {
      const stream = asRecord(raw.event)
      if (raw.type === "assistant" || (raw.type === "stream_event" && stream?.type === "message_start")) {
        this.confirmedCostWatermark = this.contextBudget.costWatermark()
      }
      this.contextBudget.observeContextTokens(contextUsage.usedTokens, this.confirmedCostWatermark)
    }
    const bridged = bridgeSdkMessage(message, envelope)
    const events = Array.isArray(bridged) ? bridged : [bridged as AgentEvent]
    if (raw.type === "result" && this.taskProgress) {
      const taskCompletion = await this.taskProgress.assessment()
      const finalText = events.find((event) => event.type === "result")?.content
      const gaps = await this.taskProgress.evidenceGaps(typeof finalText === "string" ? finalText : undefined)
      const notice = evidenceNoticeMessage(gaps)
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i]!
        if (event.type === "result") events[i] = notice && !(event.queuedTurnCount && event.queuedTurnCount > 0)
          ? { type: "error", message: notice, errorKind: "task_evidence_incomplete",
            recoverable: true, usage: event.metadata?.usage ?? event.usage, modelUsage: event.modelUsage,
            costUsd: event.costUsd, sdkResultUuid: event.metadata?.sdkResultUuid, taskCompletion,
            payload: { taskCompletion, evidenceGaps: gaps }, ...envelope }
          : { ...event, metadata: { ...event.metadata, taskCompletion } }
      }
    }
    if (outputDiagnostic) events.push({ type: "sdkEvent", sdkType: "assistantOutputIntegrity", payload: { ...outputDiagnostic }, ...envelope })
    if (raw.type === "result" && events.some((event) => event.type === "result") && this.assistantOutputIntegrity.needsRepair()) {
      return [{ type: "error", message: "答复完整性检查未通过：重复内容或思考标签仍存在。已保存任务证据，可继续核对。", recoverable: true, ...envelope }]
    }
    const capacityFailure = raw.type === "result" && events.some((event) => this.canAutomaticallyRecoverCapacity(event))
    if (capacityFailure) {
      // The failed SDK turn has settled. Hand off its observed state, never
      // retry its HTTP request or replay a tool invocation.
      await this.pauseForContextRotation("request-budget")
      return []
    }
    for (const event of events) {
      if (event.type !== "error" || event.errorKind !== "connection_interrupted") continue
      this.logger?.warn("Claude SDK connection interrupted.", {
        boundary: "claude-sdk-query.connection-interrupted",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        sdkResultUuid: event.sdkResultUuid,
        terminalReason: typeof event.payload?.terminal_reason === "string"
          ? event.payload.terminal_reason
          : undefined,
        apiErrorStatus: typeof event.payload?.api_error_status === "number"
          ? event.payload.api_error_status
          : undefined,
      })
    }
    const projectedEvents = events.map((event) => {
      const scopedEvent = event.type === "error"
        && event.errorKind === "request_body_too_large"
        && this.maxRequestBodyBytes !== 6 * 1024 * 1024
        ? { ...event, message: "Agent 执行失败。", errorKind: "execution_failed" as const, recoverable: false }
        : event
      const enriched = contextUsage && scopedEvent.type === "result"
        ? { ...scopedEvent, metadata: { ...(scopedEvent.metadata ?? {}), contextUsage } }
        : contextUsage && (
          scopedEvent.type === "assistant"
          || scopedEvent.type === "stream"
          || scopedEvent.type === "compactBoundary"
        )
          ? { ...scopedEvent, contextUsage }
          : scopedEvent
      return this.projectAttachmentEvent(
        this.projectSynapseToolRouterEvent(this.resolveToolResultName(enriched)),
      )
    })
    for (const event of projectedEvents) {
      if (event.type === "toolResult" && event.toolUseId) this.deliveredToolResults.add(event.toolUseId)
    }
    if (raw.type === "result") this.flushSdkDiagnosticSummary()
    return projectedEvents
  }

  private observeSdkDiagnostic(raw: Record<string, unknown>): void {
    const type = typeof raw.type === "string" ? raw.type : "unknown"
    const subtype = typeof raw.subtype === "string" ? raw.subtype : undefined
    const isThinkingTelemetry = type === "system" && subtype === "thinking_tokens"
    const isKnown = type === "result"
      || type === "assistant"
      || type === "user"
      || type === "stream_event"
      || (type === "system" && (subtype === "init" || subtype === "status" || subtype === "compact_boundary"))
    if (isKnown && !isThinkingTelemetry) return

    const observedAt = this.now().toISOString()
    const summary = this.sdkDiagnosticSummary
    summary.observedCount += 1
    if (isThinkingTelemetry) summary.thinkingTokenCount += 1
    summary.firstObservedAt ??= observedAt
    summary.lastObservedAt = observedAt
    const key = `${type}/${subtype ?? "unknown"}`
    if (summary.types.has(key) || summary.types.size < 64) {
      summary.types.set(key, (summary.types.get(key) ?? 0) + 1)
    }
  }

  private flushSdkDiagnosticSummary(): void {
    const summary = this.sdkDiagnosticSummary
    if (summary.observedCount === 0) return
    this.logger?.info?.("Claude SDK diagnostic events aggregated.", {
      boundary: "claude-sdk.diagnostic-summary",
      projectId: this.projectId,
      conversationId: this.conversationId,
      providerId: this.providerId,
      observedCount: summary.observedCount,
      thinkingTokenCount: summary.thinkingTokenCount,
      distinctTypes: summary.types.size,
      types: [...summary.types.entries()].map(([type, count]) => ({ type, count })),
      firstObservedAt: summary.firstObservedAt,
      lastObservedAt: summary.lastObservedAt,
    })
    this.sdkDiagnosticSummary = createSdkDiagnosticSummary()
  }

  private async reconnectConfiguredMcpServers(): Promise<void> {
    if (this.mcpServersReconnected || this.mcpServerNames.length === 0) return
    this.mcpServersReconnected = true
    if (!this.query.reconnectMcpServer) return
    for (const serverName of this.mcpServerNames) {
      try {
        await this.query.reconnectMcpServer(serverName)
      } catch (error) {
        this.logger?.warn("MCP server reconnect failed; continuing with the session.", {
          boundary: "claude-sdk-mcp-reconnect",
          projectId: this.projectId,
          conversationId: this.conversationId,
          serverName,
          ...errorLogMeta(error),
        })
      }
    }
  }

  private async refreshContextUsageAfterCompaction(): Promise<AgentContextUsage | undefined> {
    if (!this.query.getContextUsage) return undefined
    const coveredWatermark = this.contextBudget.costWatermark()
    try {
      const response = await this.readContextUsage()
      if (!response) return undefined
      const usage = this.contextUsageTracker.replaceFromContextUsage(response)
      if (usage) {
        const categories = Array.isArray(response.categories) ? response.categories : []
        const previousToolResultTokens = this.lastNativeToolResultTokens
        const toolResultTokens = this.observeNativeToolResultTokens(response)
        const pending = this.pendingCompaction
        const after = this.contextBudget.completeCompaction(
          usage.usedTokens,
          pending?.summaryRequestBytes,
          retainedPayloadTokens(response), coveredWatermark,
        )
        this.logger?.info?.("Claude SDK native compaction completed.", {
          boundary: "claude-sdk.compaction-monitor",
          projectId: this.projectId,
          conversationId: this.conversationId,
          providerId: this.providerId,
          sdkSessionId: this.sdkSessionId,
          trigger: pending?.trigger,
          durationMs: pending ? Math.max(0, Date.now() - pending.startedAt) : undefined,
          beforeContextTokens: pending?.before.observedContextTokens,
          afterContextTokens: usage.usedTokens,
          estimatedDroppedTokens: pending?.before.observedContextTokens === undefined
            ? undefined
            : Math.max(0, pending.before.observedContextTokens - usage.usedTokens),
          compactSummaryBytes: pending?.summaryBytes,
          beforeToolOutputBytes: pending?.before.turnToolOutputBytes,
          beforeNativeToolResultTokens: previousToolResultTokens,
          afterNativeToolResultTokens: toolResultTokens,
          afterEstimatedRequestBytes: after.estimatedRequestBytes,
          sdkAutoCompactEnabled: response.isAutoCompactEnabled,
          sdkAutoCompactThreshold: response.autoCompactThreshold,
          contextCategoryCount: categories.length,
          contextCategories: categories.slice(0, 32).map((category) => ({
            name: category.name,
            tokens: category.tokens,
          })),
        })
        this.pendingCompaction = undefined
      }
      return usage
    } catch (error) {
      this.logger?.warn("Claude SDK context usage refresh failed after compaction.", {
        boundary: "claude-sdk-context-usage",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        ...errorLogMeta(error),
      })
      return undefined
    }
  }

  private async refreshContextUsageAfterTurn(): Promise<AgentContextUsage | undefined> {
    if (!this.query.getContextUsage) return undefined
    const coveredWatermark = this.contextBudget.costWatermark()
    try {
      const response = await this.readContextUsage()
      if (!response) return undefined
      const usage = this.contextUsageTracker.replaceFromContextUsage(response)
      if (!usage) return undefined
      this.contextBudget.observeContextTokens(usage.usedTokens, coveredWatermark)
      const previousToolResultTokens = this.lastNativeToolResultTokens
      const toolResultTokens = this.observeNativeToolResultTokens(response)
      const evictedTrackedRequestBytes = previousToolResultTokens !== undefined
        && toolResultTokens !== undefined
        ? this.contextBudget.applyNativeToolResultEviction(previousToolResultTokens, toolResultTokens)
        : 0
      if (previousToolResultTokens !== undefined
        && toolResultTokens !== undefined
        && toolResultTokens < previousToolResultTokens) {
        this.logger?.info?.("Claude SDK native tool-result eviction observed.", {
          boundary: "claude-sdk.tool-result-eviction-monitor",
          projectId: this.projectId,
          conversationId: this.conversationId,
          providerId: this.providerId,
          sdkSessionId: this.sdkSessionId,
          previousToolResultTokens,
          toolResultTokens,
          evictedToolResultTokens: previousToolResultTokens - toolResultTokens,
          evictedTrackedRequestBytes,
          contextTokens: usage.usedTokens,
        })
      }
      return usage
    } catch (error) {
      this.logger?.warn("Claude SDK context usage refresh failed after turn.", {
        boundary: "claude-sdk-context-usage",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        ...errorLogMeta(error),
      })
      return undefined
    }
  }

  private observeNativeToolResultTokens(response: SDKControlGetContextUsageResponse): number | undefined {
    const tokens = response.messageBreakdown?.toolResultTokens
    if (!Number.isSafeInteger(tokens) || (tokens ?? -1) < 0) return undefined
    this.lastNativeToolResultTokens = tokens
    return tokens
  }

  private observeCompactionStatus(raw: Record<string, unknown>): void {
    if (raw.type !== "system" || raw.subtype !== "status" || raw.compact_result !== "failed") return
    const pending = this.pendingCompaction
    this.logger?.warn("Claude SDK native compaction failed.", {
      boundary: "claude-sdk.compaction-monitor",
      projectId: this.projectId,
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      trigger: pending?.trigger,
      durationMs: pending ? Math.max(0, Date.now() - pending.startedAt) : undefined,
      beforeContextTokens: pending?.before.observedContextTokens,
      hasSdkError: typeof raw.compact_error === "string" && raw.compact_error.length > 0,
    })
    this.pendingCompaction = undefined
  }

  private projectAttachmentEvent(event: AgentEvent): AgentEvent {
    const projected = projectAttachmentPaths(event, this.attachmentPathLabels) as AgentEvent
    if (projected.type !== "stream"
      || projected.deltaType !== "input_json_delta") {
      return projected
    }
    if (this.attachmentPathLabels.size === 0 && !this.synapseToolRouterEnabled) return projected
    return stripStreamInputJson(projected)
  }

  private projectSynapseToolRouterEvent(event: AgentEvent): AgentEvent {
    if (!this.synapseToolRouterEnabled) return event
    if (event.type === "toolUse" && event.toolUseId) {
      const routed = this.routerInvocationsByUseId.get(event.toolUseId)
      if (!routed) return event
      const toolName = originalSynapseSdkToolName(routed.toolName)
      return {
        ...event,
        toolName,
        toolInput: summarizeToolInput(toolName, routed.arguments),
        toolInputRaw: sanitizeToolInputRecord(routed.arguments),
      }
    }
    if (event.type === "assistant") {
      return projectRouterAssistantEvent(event)
    }
    return event
  }

  private rememberToolUseNames(raw: Record<string, unknown>): void {
    const message = asRecord(raw.message)
    const content = Array.isArray(message?.content) ? message.content : []
    for (const block of content) {
      const record = asRecord(block)
      const id = typeof record?.id === "string" ? record.id : undefined
      const name = typeof record?.name === "string" ? record.name : undefined
      if (record?.type === "tool_use" && id && name) {
        const routed = name === SYNAPSE_TOOL_ROUTER_INVOKE_TOOL
          ? parseSynapseToolRouterInvoke(record.input)
          : null
        if (routed) {
          const projectedName = originalSynapseSdkToolName(routed.toolName)
          this.routerInvocationsByUseId.set(id, routed)
          this.toolNamesByUseId.set(id, projectedName)
        } else {
          this.toolNamesByUseId.set(id, name)
        }
      }
    }
  }

  private notifySynapseToolRouterFallback(_reason: string): void {
    if (this.synapseToolRouterFallbackEmitted || this.closed) return
    this.synapseToolRouterFallbackEmitted = true
    this.eventQueue.push({
      type: "sdkEvent",
      sdkType: "synapseToolRouterFallback",
      payload: {},
      conversationId: this.conversationId,
      providerId: this.providerId,
      projectId: this.projectId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    })
  }

  private resolveToolResultName(event: AgentEvent): AgentEvent {
    if (event.type !== "toolResult") return event
    const toolName = event.toolUseId ? this.toolNamesByUseId.get(event.toolUseId) : this.toolNamesByUseId.get(event.toolName)
    return toolName ? { ...event, toolName } : { ...event, toolName: "tool_result" }
  }

  private nextPermissionRequestId(): string {
    this.permissionSeq += 1
    return `${this.conversationId}-permission-${this.permissionSeq}`
  }

  private denyPendingPermissions(message: string): void {
    const pendingPermissions = Array.from(this.permissions.values())
    this.permissions.clear()
    for (const pending of pendingPermissions) {
      pending.cleanup()
      pending.resolve({ behavior: "deny", message })
    }
  }
}

const permissionModes = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
])
const CLAUDE_CODE_LONG_TASK_TIMEOUT_MS = "3600000"
const MAX_TOOL_INPUT_SUMMARY_LENGTH = 240
const MAX_TOOL_INPUT_STRING_LENGTH = 120
const MAX_DIAGNOSTIC_TEXT_LENGTH = 240
const ASK_USER_QUESTION_TOOL_NAME = "AskUserQuestion"
const TODO_WRITE_TOOL_NAME = "TodoWrite"
const MAX_CONSECUTIVE_IDENTICAL_TODO_WRITE_ALLOWS = 2
const MAX_CONSECUTIVE_IDENTICAL_TODO_WRITE_DENIES = 2
const TODO_WRITE_LOOP_GUIDANCE = "Repeated identical TodoWrite call was blocked to prevent a tool loop. Do not retry TodoWrite. Answer the user directly using the existing tool results."
const TODO_WRITE_LOOP_STOP_REASON = "Stopped repeated TodoWrite calls to prevent a tool loop."
const WORKSPACE_WRITE_BOUNDARY_MESSAGE = "文件写入仅允许当前项目或已明确授权的附加目录。"

function withConfiguredWorkspaceRoot(
  systemPrompt: Options["systemPrompt"],
  cwd: string,
  progressEnabled = false,
  progressToolsAvailable = true,
): NonNullable<Options["systemPrompt"]> {
  const workspaceBoundary = [
    "Synapse configured the exact workspace root for this session as",
    `${JSON.stringify(cwd)}.`,
    "Treat that exact directory as the project root.",
    "Resolve relative file paths and project commands from it.",
    "Do not substitute an ancestor repository root.",
    ...(progressEnabled ? [progressToolsAvailable ? TASK_PROGRESS_GUIDANCE : "Native task progress tools are unavailable under this session’s tool policy. Preserve progress with already permitted capabilities; scope verification is unavailable. Do not request forbidden tools or claim host-verified completion."] : []),
  ].join(" ")

  if (!systemPrompt) {
    return {
      type: "preset",
      preset: "claude_code",
      append: workspaceBoundary,
    }
  }
  if (typeof systemPrompt === "string") return `${systemPrompt}\n\n${workspaceBoundary}`
  if (Array.isArray(systemPrompt)) return [...systemPrompt, workspaceBoundary]
  return {
    ...systemPrompt,
    append: [systemPrompt.append, workspaceBoundary].filter(Boolean).join("\n\n"),
  }
}

function projectAttachmentPaths(
  value: unknown,
  labels: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") return projectAttachmentPathText(value, labels)
  if (Array.isArray(value)) return value.map((item) => projectAttachmentPaths(item, labels))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, projectAttachmentPaths(item, labels)]),
  )
}

function projectAttachmentPathText(
  value: string,
  labels: ReadonlyMap<string, string>,
): string {
  let projected = value
  const entries = [...labels.entries()].sort(([left], [right]) => right.length - left.length)
  for (const [attachmentPath, label] of entries) {
    projected = projected.split(attachmentPath).join(label)
  }
  return projected
}

function stripStreamInputJson(event: Extract<AgentEvent, { readonly type: "stream" }>): AgentEvent {
  const { partialJson, ...rest } = event
  void partialJson
  return {
    ...rest,
    event: removePartialJsonFields(event.event) as Record<string, unknown>,
    ...(event.payload
      ? { payload: removePartialJsonFields(event.payload) as Record<string, unknown> }
      : {}),
  }
}

function removePartialJsonFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removePartialJsonFields)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "partial_json" && key !== "partialJson")
      .map(([key, item]) => [key, removePartialJsonFields(item)]),
  )
}

function projectRouterAssistantEvent(
  event: Extract<AgentEvent, { readonly type: "assistant" }>,
): Extract<AgentEvent, { readonly type: "assistant" }> {
  return {
    ...event,
    message: projectRouterToolBlocks(event.message) as Record<string, unknown>,
    ...(event.contentBlocks
      ? { contentBlocks: projectRouterToolBlocks(event.contentBlocks) as readonly unknown[] }
      : {}),
  }
}

function projectRouterToolBlocks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectRouterToolBlocks)
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (record.type === "tool_use" && record.name === SYNAPSE_TOOL_ROUTER_INVOKE_TOOL) {
    const routed = parseSynapseToolRouterInvoke(record.input)
    if (routed) {
      return {
        ...record,
        name: originalSynapseSdkToolName(routed.toolName),
        input: routed.arguments,
      }
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, projectRouterToolBlocks(item)]),
  )
}

function defaultQueryFactory(input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
  expectedMcpServerNames?: readonly string[]
  logger?: Pick<StructuredLogger, "warn"> & Partial<Pick<StructuredLogger, "info">>
  synapseToolRouter?: SynapseToolRouterQueryOptions
}): QueryLike {
  if (input.synapseToolRouter) {
    return new SynapseToolRouterQuery({
      prompt: input.prompt,
      options: input.options,
      expectedMcpServerNames: input.expectedMcpServerNames,
      logger: input.logger,
      router: input.synapseToolRouter,
    })
  }
  return new LazyQuery(input)
}

class LazyQuery implements QueryLike {
  private readonly query: Promise<Query>
  private failed = false
  private failure: unknown

  constructor(input: {
    readonly prompt: AsyncIterable<SDKUserMessage>
    readonly options: Record<string, unknown>
    readonly expectedMcpServerNames?: readonly string[]
    readonly logger?: Pick<StructuredLogger, "warn"> & Partial<Pick<StructuredLogger, "info">>
  }) {
    this.query = import("@anthropic-ai/claude-agent-sdk")
      .then((sdk) => createDirectValidatedQuery(sdk, input))
      .catch((error) => {
        this.failed = true
        this.failure = error
        input.logger?.warn("Claude SDK import failed.", {
          boundary: "claude-sdk-import",
          ...errorLogMeta(error),
        })
        throw error
      })
  }

  async next(): Promise<IteratorResult<SDKMessage, void>> {
    this.throwIfFailed()
    return (await this.query).next()
  }

  async interrupt(): Promise<void> {
    if (this.failed) return
    await (await this.query).interrupt()
  }

  async close(): Promise<void> {
    if (this.failed) return
    await (await this.query).close()
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    this.throwIfFailed()
    await (await this.query).streamInput(stream)
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.throwIfFailed()
    await (await this.query).setPermissionMode(mode)
  }

  async grantAdditionalDirectories(directories: readonly string[]): Promise<void> {
    this.throwIfFailed()
    await (await this.query).applyFlagSettings({
      permissions: { additionalDirectories: [...directories] },
    })
  }

  async getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    this.throwIfFailed()
    return (await this.query).getContextUsage()
  }

  async rewindFiles(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult> {
    this.throwIfFailed()
    return (await this.query).rewindFiles(userMessageId, options)
  }

  private throwIfFailed(): void {
    if (this.failed) throw this.failure
  }
}

function parsePermissionMode(mode: string | undefined): PermissionMode | undefined {
  if (!mode) return undefined
  return permissionModes.has(mode as PermissionMode) ? mode as PermissionMode : undefined
}

function providerSettingsEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => key.startsWith("ANTHROPIC_")),
  )
}

function createForwardedAbortController(signal: AbortSignal | undefined, onAbort: () => void): ForwardedAbortController | undefined {
  if (!signal) return undefined
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort(signal.reason)
    return { controller, cleanup: () => undefined }
  }
  const abort = (): void => { onAbort() }
  signal.addEventListener("abort", abort, { once: true })
  return {
    controller,
    cleanup: () => signal.removeEventListener("abort", abort),
  }
}

function toPermissionResult(
  decision: AgentPermissionDecision,
  originalInput: Record<string, unknown>,
  sessionDirectoryUpdates: readonly SessionDirectoryPermissionUpdate[],
  projectUpdatedInput?: (input: Record<string, unknown>) => Record<string, unknown>,
): PermissionResult {
  if (decision.behavior === "allow") {
    const updatedInput = decision.updatedInput && projectUpdatedInput
      ? projectUpdatedInput(decision.updatedInput)
      : decision.updatedInput ?? originalInput
    return {
      behavior: "allow",
      updatedInput,
      ...(decision.scope === "session"
        ? { updatedPermissions: [...sessionDirectoryUpdates] }
        : {}),
    }
  }

  return {
    behavior: "deny",
    message: decision.message
      ?? "The user denied this tool use. Stop and wait for the user's instructions.",
  }
}

function sessionDirectoryPermissionUpdates(
  suggestions: CanUseToolContext["suggestions"],
): readonly SessionDirectoryPermissionUpdate[] {
  const directories = (suggestions ?? [])
    .filter((suggestion): suggestion is SessionDirectoryPermissionUpdate =>
      suggestion.type === "addDirectories")
    .flatMap((suggestion) => suggestion.directories)
  const normalizedDirectories = mergeAdditionalDirectories(directories)
  return normalizedDirectories.length > 0
    ? [{
        type: "addDirectories",
        directories: [...normalizedDirectories],
        destination: "session",
      }]
    : []
}

function sameDirectories(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function permissionCancelledResult(): PermissionResult {
  return { behavior: "deny", message: AGENT_PERMISSION_CANCELLED_MESSAGE }
}

function denyToolUse(message: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: message,
    },
  }
}

/** Plain-language advisory for substantive evidence gaps; never an execution failure. */
function evidenceNoticeMessage(gaps: TaskEvidenceGaps): string | undefined {
  const names = (items: readonly TaskEvidenceGap[]): string =>
    items.slice(0, 3).map((item) => path.basename(item.path)).join("、")
  const lines: string[] = []
  if (gaps.overclaim.length > 0) {
    lines.push(`答复声称已完整读取这些材料，但没有可核对的记录：${names(gaps.overclaim)}。`)
  }
  if (gaps.unregisteredClaim) {
    lines.push("答复声称已完整读取多份材料，但没有可核对的登记清单。")
  }
  if (gaps.missingEvidence.length > 0) {
    lines.push(`这些材料已登记但没有可核对的读取或修改记录：${names(gaps.missingEvidence)}。`)
  }
  return lines.length > 0 ? `${lines.join("")}已保存当前进度，可继续核对。` : undefined
}

function isWriteTool(toolName: string): boolean {
  return toolName === "Write"
    || toolName === "Edit"
    || toolName === "MultiEdit"
    || toolName === "NotebookEdit"
}

function writePathForToolInput(input: Record<string, unknown>): string | undefined {
  if (typeof input.file_path === "string") return input.file_path
  if (typeof input.notebook_path === "string") return input.notebook_path
  return undefined
}

function normalizeToolPath(value: string): string | undefined {
  const normalized = path.posix.normalize(value.split("\\").join("/"))
  if (normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) return undefined
  return normalized
}

function pathMatchesPolicy(filePath: string, policyPath: string): boolean {
  const normalizedPolicy = normalizeToolPath(policyPath)
  if (!normalizedPolicy) return false
  return filePath === normalizedPolicy || filePath.startsWith(`${normalizedPolicy.replace(/\/+$/, "")}/`)
}

async function resolveExistingRoots(roots: readonly string[]): Promise<readonly string[]> {
  const resolved = await Promise.all(roots.map(async (root) => {
    try {
      return await realpath(root)
    } catch {
      return undefined
    }
  }))
  return resolved.filter((root): root is string => typeof root === "string")
}

async function resolveWorkspaceWriteTarget(absolutePath: string): Promise<string | undefined> {
  try {
    await lstat(absolutePath)
  } catch (error) {
    if (!isFileNotFoundError(error)) return undefined
    return resolveNearestExistingParent(path.dirname(absolutePath))
  }
  try {
    return await realpath(absolutePath)
  } catch {
    return undefined
  }
}

async function resolveNearestExistingParent(startPath: string): Promise<string | undefined> {
  let candidate = startPath
  while (true) {
    try {
      await lstat(candidate)
    } catch (error) {
      if (!isFileNotFoundError(error)) return undefined
      const parent = path.dirname(candidate)
      if (parent === candidate) return undefined
      candidate = parent
      continue
    }
    try {
      return await realpath(candidate)
    } catch {
      return undefined
    }
  }
}

function allowedWriteRootsMessage(agentType: string, allowedWriteRoots: readonly string[] | undefined): string {
  const roots = allowedWriteRoots?.length ? allowedWriteRoots.join(", ") : "no paths"
  return `Subagent ${agentType} may write only inside: ${roots}.`
}

const errorMessage = (error: unknown): string => agentRuntimeErrorMessage(error, "SDK query failed")

function errorDiagnosticMessage(error: unknown): string | undefined {
  if (error instanceof Error) return sanitizeDiagnosticText(error.message)
  if (typeof error === "string") return sanitizeDiagnosticText(error)
  return undefined
}

function errorLogMeta(error: unknown): Record<string, unknown> {
  const message = errorMessage(error)
  return {
    ...baseErrorLogMeta(error, { fallbackMessage: "SDK query failed" }),
    ...webFetchPreflightFailureMeta(message),
  }
}

function parseAskUserQuestions(input: Record<string, unknown>): readonly AgentUserQuestion[] | undefined {
  const rawQuestions = input.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length < 1 || rawQuestions.length > 4) {
    return undefined
  }

  const questions: AgentUserQuestion[] = []
  for (const rawQuestion of rawQuestions) {
    const record = asRecord(rawQuestion)
    const question = stringValue(record?.question)
    const options = parseAskUserQuestionOptions(record?.options)
    if (!question || !options) return undefined
    const header = stringValue(record?.header)
    const id = stringValue(record?.id)
    const key = stringValue(record?.key)
    const multiSelect = typeof record?.multiSelect === "boolean" ? record.multiSelect : false
    questions.push({
      ...(id ? { id } : {}),
      ...(key ? { key } : {}),
      question,
      ...(header ? { header } : {}),
      options,
      multiSelect,
    })
  }
  return questions
}

function parseAskUserQuestionOptions(value: unknown): readonly AgentUserQuestionOption[] | undefined {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return undefined
  const options: AgentUserQuestionOption[] = []
  const labels = new Set<string>()
  for (const rawOption of value) {
    const record = asRecord(rawOption)
    const label = stringValue(record?.label)
    if (!label || labels.has(label)) return undefined
    labels.add(label)
    const description = stringValue(record?.description)
    options.push({
      label,
      ...(description ? { description } : {}),
    })
  }
  return options
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function estimatedStaticRequestBytes(options: ClaudeSDKSessionOptions): number {
  return serializedByteLength({
    systemPrompt: options.systemPrompt,
    tools: options.tools,
    disallowedTools: options.disallowedTools,
    mcpServers: options.mcpServers,
    plugins: options.plugins,
    agents: options.agents,
  })
}

function serializedByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : 0
  } catch {
    return 0
  }
}

function toolResultRequestBytes(value: unknown): number {
  return serializedByteLength({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "tool", content: value }],
  })
}

function compactSummaryRequestBytes(value: string): number {
  return serializedByteLength({
    role: "user",
    content: [{ type: "text", text: value }],
  })
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function sanitizeDiagnosticText(value: string): string {
  return truncateText(redactSensitiveText(value), MAX_DIAGNOSTIC_TEXT_LENGTH)
}

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string | undefined {
  const summary = toolName === "Bash" && typeof input.command === "string"
    ? redactSensitiveText(input.command)
    : JSON.stringify(sanitizeToolInput(input))
  if (summary === "{}") return undefined
  return truncateText(summary, MAX_TOOL_INPUT_SUMMARY_LENGTH)
}

function sanitizeToolInput(value: unknown, key = ""): unknown {
  if (isSafeTokenMeasurement(key, value)) return value
  if (isSensitiveTextKey(key)) return REDACTED
  if (typeof value === "string") {
    return truncateText(redactSensitiveText(value), MAX_TOOL_INPUT_STRING_LENGTH)
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeToolInput(item))
  if (!value || typeof value !== "object") return value

  const sanitized: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    sanitized[childKey] = sanitizeToolInput(childValue, childKey)
  }
  return sanitized
}

function sanitizeToolInputRecord(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeToolInput(input)
  return asRecord(sanitized) ?? {}
}

function stableToolSignature(toolName: string, input: unknown): string {
  return `${toolName}:${JSON.stringify(stableJsonValue(input))}`
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableJsonValue(item))
  if (!value || typeof value !== "object") return value

  const record = value as Record<string, unknown>
  const stable: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    stable[key] = stableJsonValue(record[key])
  }
  return stable
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated]`
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T, void>) => void> = []
  private closed = false

  push(value: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value })
      return
    }
    this.values.push(value)
  }

  next(): Promise<T | null> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve(value)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.waiters.push((result) => {
        resolve(result.done ? null : result.value)
      })
    })
  }

  nextWithTimeout(timeoutMs: number): Promise<T | null> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve(value)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      let settled = false
      const waiter = (result: IteratorResult<T, void>): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result.done ? null : result.value)
      }
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        resolve(null)
      }, timeoutMs)
      this.waiters.push(waiter)
    })
  }

  hasValues(): boolean {
    return this.values.length > 0
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      waiter({ done: true, value: undefined })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, void> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ done: false, value })
        if (this.closed) return Promise.resolve({ done: true, value: undefined })
        return new Promise((resolve) => {
          this.waiters.push(resolve)
        })
      },
    }
  }
}

function retainedPayloadTokens(response: SDKControlGetContextUsageResponse): number | undefined {
  const breakdown = response.messageBreakdown
  if (breakdown?.toolResultTokens === undefined) return undefined
  return breakdown.toolResultTokens + (breakdown.attachmentTokens ?? 0)
}
