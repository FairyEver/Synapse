import type {
  HookCallbackMatcher,
  HookInput,
  HookJSONOutput,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import path from "node:path"

import {
  buildHostEnvironment,
  mergeEnvironmentWithPath,
  resolveCachedLoginShellPath,
} from "../../runtime/process"
import type { StructuredLogger } from "../../runtime/service-registry"
import type {
  AgentSdkAgentDefinitions,
  AgentSdkPluginSpec,
  AgentSdkSubagentToolPolicies,
} from "./project-contributions"
import {
  AGENT_INVALID_ASK_USER_QUESTION_INPUT_MESSAGE,
  AGENT_PERMISSION_CANCELLED_MESSAGE,
  AGENT_QUERY_FINISHED_PERMISSION_MESSAGE,
  AGENT_SESSION_CLOSED_MESSAGE,
  AGENT_TURN_PERMISSION_CANCELLED_MESSAGE,
  sdkQueryErrorPresentation,
  webFetchPreflightFailureMeta,
} from "./agent-error-messages"
import { isSensitiveTextKey, redactSensitiveText, REDACTED } from "./redaction"
import { errorLogMessage, errorLogMeta as baseErrorLogMeta } from "../error-sanitize"
import { bridgeSdkMessage, type AgentEventEnvelope } from "./sdk-event-bridge"
import {
  buildClaudeUserMessageContent,
  normalizeAgentAttachments,
} from "./attachments"
import type {
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

export interface QueryLike {
  next(): Promise<IteratorResult<SDKMessage, void>>
  interrupt(): Promise<void>
  close(): void | Promise<void>
  streamInput?(stream: AsyncIterable<SDKUserMessage>): Promise<void>
  setPermissionMode?(mode: PermissionMode): Promise<void>
  applyFlagSettings?(settings: Record<string, unknown>): Promise<void>
}

export type QueryFactory = (input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
  logger?: Pick<StructuredLogger, "warn">
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
  readonly queryFactory?: QueryFactory
  readonly logger?: Pick<StructuredLogger, "warn">
  readonly now?: () => Date
}

export interface ClaudeSDKRuntimeSettings {
  readonly skipWebFetchPreflight?: boolean
}

interface PendingPermission {
  readonly input: Record<string, unknown>
  readonly resolve: (decision: PermissionResult) => void
  readonly cleanup: () => void
}

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
  readonly mode: "inherit" | "allowlist" | "none"
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
  private readonly query: QueryLike
  private readonly abortController: AbortController | undefined
  private readonly abortCleanup: (() => void) | undefined
  private readonly pumpPromise: Promise<void>
  private readonly toolNamesByUseId = new Map<string, string>()
  private readonly subagentTypesById = new Map<string, string>()
  private lastTodoWriteSignature: string | undefined
  private repeatedTodoWriteCount = 0
  private closed = false
  private queryFinished = false
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
    this.sdkSessionId = options.sdkSessionId
    this.logger = options.logger
    this.subagentToolPolicies = options.subagentToolPolicies ?? {}
    this.personaToolPolicy = options.personaToolPolicy
    this.toolPolicy = options.toolPolicy
    this.now = options.now ?? (() => new Date())
    this.mainThreadAgentName = options.agent
    this.agentDefinitionsHash = options.agentDefinitionsHash
    const forwardedAbort = createForwardedAbortController(options.abortSignal)
    this.abortController = forwardedAbort?.controller
    this.abortCleanup = forwardedAbort?.cleanup

    const packagedRuntime = inspectPackagedClaudeRuntime()
    if (packagedRuntime.status === "missing") {
      this.query = new FailedQuery(createMissingPackagedClaudeRuntimeError(packagedRuntime))
    } else {
      const queryFactory = options.queryFactory ?? defaultQueryFactory
      this.query = queryFactory({
        prompt: this.inputQueue,
        options: this.buildQueryOptions(options, packagedRuntime),
        logger: this.logger,
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
    this.inputQueue.push({
      type: "user",
      message: {
        role: "user",
        content: buildClaudeUserMessageContent(message.content, attachments),
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
      this.logger?.warn("Claude SDK permission response ignored.", {
        boundary: "claude-sdk-permission-response",
        projectId: this.projectId,
        conversationId: this.conversationId,
        providerId: this.providerId,
        sdkSessionId: this.sdkSessionId,
        requestId,
        behavior: decision.behavior,
      })
      return
    }

    this.permissions.delete(requestId)
    pending.cleanup()
    pending.resolve(toPermissionResult(decision, pending.input))
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
  }

  async setMainThreadAgent(agentName: string | null): Promise<void> {
    if (this.closed) throw new Error(AGENT_SESSION_CLOSED_MESSAGE)
    if (!this.query.applyFlagSettings) {
      throw new Error("当前会话不支持切换智能体")
    }
    await this.query.applyFlagSettings({ agent: agentName })
    this.mainThreadAgentName = agentName ?? undefined
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
      BASH_DEFAULT_TIMEOUT_MS: CLAUDE_CODE_LONG_TASK_TIMEOUT_MS,
      BASH_MAX_TIMEOUT_MS: CLAUDE_CODE_LONG_TASK_TIMEOUT_MS,
    })
    const queryOptions: Partial<Options> = {
      cwd: options.cwd,
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
    if (options.systemPrompt) queryOptions.systemPrompt = options.systemPrompt
    if (options.tools !== undefined) queryOptions.tools = options.tools
    if (options.disallowedTools?.length) queryOptions.disallowedTools = [...options.disallowedTools]
    if (options.additionalDirectories?.length) {
      queryOptions.additionalDirectories = [...options.additionalDirectories]
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

    if (this.personaToolPolicy && this.personaToolPolicy.mode !== "inherit") {
      hooks.PreToolUse?.unshift({
        matcher: "*",
        hooks: [async (input: HookInput): Promise<HookJSONOutput> => this.guardPersonaToolPolicy(input)],
      })
    }

    if (Object.keys(this.subagentToolPolicies).length > 0) {
      Object.assign(hooks, this.subagentTrackingHooks())
    }

    return hooks
  }

  private guardPersonaToolPolicy(input: HookInput): HookJSONOutput {
    const record = input as unknown as Record<string, unknown>
    if (record.hook_event_name !== "PreToolUse") return {}
    const toolName = typeof record.tool_name === "string" ? record.tool_name : ""
    if (!toolName) return denyToolUse("当前智能体未允许使用该工具。")
    const policy = this.personaToolPolicy
    if (!policy || policy.mode === "inherit") return {}
    if (policy.mode === "none") {
      return denyToolUse("当前智能体未启用工具。")
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
    const toolPolicyResult = this.toolPolicy?.(toolName, input)
    if (toolPolicyResult) return toolPolicyResult
    const policyResult = this.evaluateSubagentToolPolicy(toolName, input, context)
    if (policyResult) return policyResult

    const requestId = this.nextPermissionRequestId()
    const timestamp = this.now().toISOString()
    const event: AgentEvent = {
      type: "permissionRequest",
      requestId,
      toolName,
      toolInput: summarizeToolInput(toolName, input),
      toolInputRaw: sanitizeToolInputRecord(input),
      conversationId: this.conversationId,
      providerId: this.providerId,
      projectId: this.projectId,
      sdkSessionId: this.sdkSessionId,
      timestamp,
    }

    this.eventQueue.push(event)

    return this.awaitPermissionResponse(requestId, input, context)
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

    return this.awaitPermissionResponse(requestId, input, context)
  }

  private awaitPermissionResponse(
    requestId: string,
    input: Record<string, unknown>,
    context: CanUseToolContext,
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const abort = (): void => {
        if (!this.permissions.delete(requestId)) return
        resolve({ behavior: "deny", message: AGENT_PERMISSION_CANCELLED_MESSAGE })
      }
      context.signal.addEventListener("abort", abort, { once: true })
      this.permissions.set(requestId, {
        input,
        resolve,
        cleanup: () => context.signal.removeEventListener("abort", abort),
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
        for (const event of this.bridgeMessage(result.value)) {
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

  private bridgeMessage(message: SDKMessage): readonly AgentEvent[] {
    const raw = message as unknown as Record<string, unknown>
    const messageSessionId = typeof raw.session_id === "string" ? raw.session_id : undefined
    if (messageSessionId) this.sdkSessionId = messageSessionId

    const envelope: AgentEventEnvelope & { readonly sdkSessionId?: string } = {
      conversationId: this.conversationId,
      providerId: this.providerId,
      sdkSessionId: this.sdkSessionId,
      timestamp: this.now().toISOString(),
    }
    this.rememberToolUseNames(raw)
    const bridged = bridgeSdkMessage(message, envelope)
    const events = Array.isArray(bridged) ? bridged : [bridged as AgentEvent]
    return events.map((event) => this.resolveToolResultName(event))
  }

  private rememberToolUseNames(raw: Record<string, unknown>): void {
    const message = asRecord(raw.message)
    const content = Array.isArray(message?.content) ? message.content : []
    for (const block of content) {
      const record = asRecord(block)
      const id = typeof record?.id === "string" ? record.id : undefined
      const name = typeof record?.name === "string" ? record.name : undefined
      if (record?.type === "tool_use" && id && name) {
        this.toolNamesByUseId.set(id, name)
      }
    }
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

function defaultQueryFactory(input: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Record<string, unknown>
  logger?: Pick<StructuredLogger, "warn">
}): QueryLike {
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
): PermissionResult {
  if (decision.behavior === "allow") {
    return {
      behavior: "allow",
      updatedInput: decision.updatedInput ?? originalInput,
    }
  }

  return {
    behavior: "deny",
    message: decision.message
      ?? "The user denied this tool use. Stop and wait for the user's instructions.",
  }
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

function allowedWriteRootsMessage(agentType: string, allowedWriteRoots: readonly string[] | undefined): string {
  const roots = allowedWriteRoots?.length ? allowedWriteRoots.join(", ") : "no paths"
  return `Subagent ${agentType} may write only inside: ${roots}.`
}

function errorMessage(error: unknown): string {
  return errorLogMessage(error, "SDK query failed")
}

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
    const id = stringValue(record?.id) ?? stringValue(record?.key)
    const multiSelect = typeof record?.multiSelect === "boolean" ? record.multiSelect : false
    questions.push({
      ...(id ? { id } : {}),
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
  for (const rawOption of value) {
    const record = asRecord(rawOption)
    const label = stringValue(record?.label)
    if (!label) return undefined
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
