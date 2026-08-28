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
  AGENT_INVALID_ASK_USER_QUESTION_INPUT_MESSAGE,
  AGENT_PERMISSION_CANCELLED_MESSAGE,
  AGENT_PERMISSION_NOT_PENDING_MESSAGE,
  AGENT_QUERY_FINISHED_PERMISSION_MESSAGE,
  AGENT_SESSION_CLOSED_MESSAGE,
  AGENT_TURN_PERMISSION_CANCELLED_MESSAGE,
  sdkQueryErrorPresentation,
  webFetchPreflightFailureMeta,
} from "./agent-error-messages"
import { isSensitiveTextKey, redactSensitiveText, REDACTED } from "./redaction"
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
  SynapseToolRouterQuery,
  type SynapseToolRouterQueryOptions,
} from "./synapse-tool-router-query"
import {
  AgentFileCheckpointTracker,
  isReplayedUserMessage,
} from "./agent-file-checkpoint-tracker"

export interface QueryLike {
  next(): Promise<IteratorResult<SDKMessage, void>>
  interrupt(): Promise<void>
  close(): void | Promise<void>
  streamInput?(stream: AsyncIterable<SDKUserMessage>): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
  grantAdditionalDirectories?(directories: readonly string[]): Promise<void>
  getContextUsage?(): Promise<SDKControlGetContextUsageResponse>
  rewindFiles?(userMessageId: string, options?: { dryRun?: boolean }): Promise<RewindFilesResult>
}

export type QueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
  logger?: Pick<StructuredLogger, "warn">
  synapseToolRouter?: SynapseToolRouterQueryOptions
}) => QueryLike

export interface ClaudeSDKSessionOptions {
  readonly projectId: string
  readonly conversationId: string
  readonly providerId: string
  readonly cwd: string
  readonly sdkSessionId?: string
  readonly env: Record<string, string>
  readonly hostEnv?: NodeJS.ProcessEnv
  readonly resolveShellPath?: () => string | null
  readonly nodeRuntimeBinPath?: string
  readonly mode?: string
  readonly model?: string
  readonly modelContext?: AgentModelContextReference
  readonly contextWindowConfigurationSource?: AgentContextWindowConfigurationSource
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
  readonly sdkSettings?: ClaudeSDKRuntimeSettings
  readonly onConversationTitle?: (title: string) => void | Promise<void>
  readonly queryFactory?: QueryFactory
  readonly synapseToolRouter?: SynapseToolRouterQueryOptions
  readonly routerSubagentToolAccess?: Readonly<Record<string, {
    readonly allowedTools?: readonly string[]
    readonly disallowedTools?: readonly string[]
  }>>
  readonly logger?: Pick<StructuredLogger, "warn">
  readonly now?: () => Date
}

export interface ClaudeSDKRuntimeSettings {
  readonly skipWebFetchPreflight?: boolean
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

  private readonly projectId: string
  private readonly conversationId: string
  private readonly providerId: string
  private readonly now: () => Date
  private readonly inputQueue = new AsyncQueue<SDKUserMessage>()
  private readonly eventQueue = new AsyncQueue<AgentEvent>()
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly logger: Pick<StructuredLogger, "warn"> | undefined
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
  private readonly fileCheckpointTracker: AgentFileCheckpointTracker
  private lastTodoWriteSignature: string | undefined
  private repeatedTodoWriteCount = 0
  private closed = false
  private queryFinished = false
  private permissionMode: PermissionMode | undefined
  private synapseToolRouterFallbackEmitted = false
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
    this.permissionMode = parsePermissionMode(options.mode)
    this.now = options.now ?? (() => new Date())
    this.mainThreadAgentName = options.agent
    this.agentDefinitionsHash = options.agentDefinitionsHash
    this.additionalDirectories = mergeAdditionalDirectories(options.additionalDirectories ?? [])
    const forwardedAbort = createForwardedAbortController(options.abortSignal)
    this.abortController = forwardedAbort?.controller
    this.abortCleanup = forwardedAbort?.cleanup

    const packagedRuntime = inspectPackagedClaudeRuntime()
    if (packagedRuntime.status === "missing") {
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
        logger: this.logger,
        synapseToolRouter,
      })
    }
    this.pumpPromise = this.pumpQueryEvents()
  }

  async send(message: AgentMessage): Promise<boolean> {
    if (this.closed) return false
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
    this.inputQueue.push({
      type: "user",
      message: {
        role: "user",
        content: buildAgentRuntimeUserContent(message.content, attachments),
      },
      parent_tool_use_id: null,
    })
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
    return !this.closed && (!this.queryFinished || this.eventQueue.hasValues())
  }

  async cancelCurrentTurn(): Promise<boolean> {
    if (!this.alive()) return false
    this.denyPendingPermissions(AGENT_TURN_PERMISSION_CANCELLED_MESSAGE)
    await this.query.interrupt()
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
    await this.query.grantAdditionalDirectories(nextDirectories)
    this.additionalDirectories = nextDirectories
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.queryFinished = true
    this.inputQueue.close()
    this.denyPendingPermissions("Session closed before permission was resolved.")
    this.abortController?.abort()
    this.abortCleanup?.()
    this.eventQueue.close()
    try {
      await this.query.close()
    } catch (error) {
      this.logger?.warn("Claude SDK query close failed.", {
        boundary: "claude-sdk-query.close",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        ...errorLogMeta(error),
      })
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
        env: providerSettingsEnv(options.env),
      },
      env: sdkEnv,
      includePartialMessages: true,
      canUseTool: (toolName, input, context) => this.canUseTool(toolName, input, context),
    }

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
    queryOptions.systemPrompt = withConfiguredWorkspaceRoot(options.systemPrompt, this.cwd)
    if (options.tools !== undefined) queryOptions.tools = options.tools
    if (options.disallowedTools?.length) queryOptions.disallowedTools = [...options.disallowedTools]
    if (this.additionalDirectories.length > 0) {
      queryOptions.additionalDirectories = [...this.additionalDirectories]
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
        const workspaceBoundaryResult = await this.guardConfiguredWorkspaceWrite(input)
        if (workspaceBoundaryResult) return workspaceBoundaryResult
        await this.fileCheckpointTracker.captureBeforeTool(input)
        return {}
      }],
    })

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
      while (!this.closed) {
        const result = await this.query.next()
        if (result.done) break
        for (const event of await this.bridgeMessage(result.value)) {
          this.eventQueue.push(event)
        }
      }
    } catch (error) {
      if (!this.closed) {
        this.logger?.warn("Claude SDK query failed.", {
          boundary: "claude-sdk-query",
          projectId: this.projectId,
          conversationId: this.conversationId,
          providerId: this.providerId,
          sdkSessionId: this.sdkSessionId,
          ...errorLogMeta(error),
        })
        this.eventQueue.push(this.errorEvent(error))
      }
    } finally {
      this.queryFinished = true
      this.inputQueue.close()
      this.denyPendingPermissions(AGENT_QUERY_FINISHED_PERMISSION_MESSAGE)
      this.abortCleanup?.()
      this.eventQueue.close()
    }
  }

  private errorEvent(error: unknown): AgentEvent {
    const presentation = sdkQueryErrorPresentation(errorDiagnosticMessage(error))
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

  private async bridgeMessage(message: SDKMessage): Promise<readonly AgentEvent[]> {
    const raw = message as unknown as Record<string, unknown>
    const messageSessionId = typeof raw.session_id === "string" ? raw.session_id : undefined
    if (messageSessionId) this.sdkSessionId = messageSessionId
    if (isReplayedUserMessage(raw)) {
      this.fileCheckpointTracker.recordSdkUserMessageId(raw.uuid as string)
      return []
    }

    const envelope: AgentEventEnvelope & { readonly sdkSessionId?: string } = {
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    }
    this.rememberToolUseNames(raw)
    let contextUsage = this.contextUsageTracker.update(raw)
    if (raw.type === "system" && raw.subtype === "compact_boundary") {
      contextUsage = await this.refreshContextUsageAfterCompaction()
    }
    const bridged = bridgeSdkMessage(message, envelope)
    const events = Array.isArray(bridged) ? bridged : [bridged as AgentEvent]
    return events.map((event) => {
      const enriched = contextUsage && event.type === "result"
        ? { ...event, metadata: { ...(event.metadata ?? {}), contextUsage } }
        : contextUsage && (
          event.type === "assistant"
          || event.type === "stream"
          || event.type === "compactBoundary"
        )
          ? { ...event, contextUsage }
          : event
      return this.projectAttachmentEvent(
        this.projectSynapseToolRouterEvent(this.resolveToolResultName(enriched)),
      )
    })
  }

  private async refreshContextUsageAfterCompaction(): Promise<AgentContextUsage | undefined> {
    if (!this.query.getContextUsage) return undefined
    try {
      return this.contextUsageTracker.replaceFromContextUsage(await this.query.getContextUsage())
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
): NonNullable<Options["systemPrompt"]> {
  const workspaceBoundary = [
    "Synapse configured the exact workspace root for this session as",
    `${JSON.stringify(cwd)}.`,
    "Treat that exact directory as the project root.",
    "Resolve relative file paths and project commands from it.",
    "Do not substitute an ancestor repository root.",
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
  const { partialJson: _partialJson, ...rest } = event
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
  logger?: Pick<StructuredLogger, "warn">
  synapseToolRouter?: SynapseToolRouterQueryOptions
}): QueryLike {
  if (input.synapseToolRouter) {
    return new SynapseToolRouterQuery({
      prompt: input.prompt,
      options: input.options,
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
    readonly logger?: Pick<StructuredLogger, "warn">
  }) {
    this.query = import("@anthropic-ai/claude-agent-sdk")
      .then(({ query }) => query({
        prompt: input.prompt,
        options: input.options as Options,
      }))
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

function createForwardedAbortController(signal: AbortSignal | undefined): ForwardedAbortController | undefined {
  if (!signal) return undefined
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort(signal.reason)
    return { controller, cleanup: () => undefined }
  }
  const abort = (): void => {
    controller.abort(signal.reason)
  }
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
