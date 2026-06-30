import { stat } from "node:fs/promises"

import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { CCProvider, ProviderService } from "../provider"
import {
  AGENT_CANCELLED_MESSAGE,
  AGENT_PROJECT_WORKSPACE_REQUIRED_MESSAGE,
  AGENT_PROVIDER_REQUIRED_MESSAGE,
  AGENT_SESSION_RESETTING_MESSAGE,
} from "./agent-error-messages"
import {
  directoriesForPathAttachments,
  hasUnconfiguredAttachmentDirectories,
  normalizeAgentAttachments,
} from "./attachments"
import {
  ClaudeSDKSession,
  DEFAULT_CLAUDE_SDK_MAX_TURNS,
  type ClaudeSDKRuntimeSettings,
} from "./claude-sdk-session"
import type {
  AgentSdkAgentDefinitions,
  AgentSdkPluginSpec,
  AgentSdkSubagentToolPolicies,
} from "./project-contributions"
import type { ResolvedPersonaSdkConfig } from "./persona-runtime"
import type { AgentSessionRepository } from "./session-repository"
import type {
  PendingPermissionState,
  RuntimeSessionState,
} from "./session-lifecycle"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentRuntimeTurnResult,
} from "./types"

export interface CreateAgentLiveSessionInput {
  readonly projectId: string
  readonly conversation: ConversationEntryV1
  readonly providerId: string
  readonly cwd: string
  readonly sdkSessionId?: string
  readonly env: Record<string, string>
  readonly model?: string
  readonly mode?: string
  readonly maxTurns?: number
  readonly plugins?: readonly AgentSdkPluginSpec[]
  readonly allowPluginHooks?: boolean
  readonly agent?: string
  readonly agentDefinitionsHash?: string
  readonly agents?: AgentSdkAgentDefinitions
  readonly subagentToolPolicies?: AgentSdkSubagentToolPolicies
  readonly additionalDirectories?: readonly string[]
  readonly sdkSettings?: ClaudeSDKRuntimeSettings
  readonly abortSignal?: AbortSignal
}

export type AgentLiveSessionFactory = (
  input: CreateAgentLiveSessionInput,
) => AgentLiveSession | Promise<AgentLiveSession>

export type AgentLiveSessionHandle = {
  readonly liveSession: AgentLiveSession
  readonly created: boolean
}

export interface SessionManagerDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly repository: AgentSessionRepository
  readonly providerService: ProviderService
  readonly states: Map<string, RuntimeSessionState>
  readonly pendingPermissions: Map<string, PendingPermissionState>
  readonly logger?: StructuredLogger
  readonly now?: () => Date
  readonly createSession?: AgentLiveSessionFactory
  readonly validateWorkspacePath?: (cwd: string) => void | Promise<void>
  readonly getReplyTargetEnv?: (
    projectId: string,
    sessionKey: string,
  ) => Record<string, string> | undefined
  readonly sdkPlugins?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    readonly AgentSdkPluginSpec[] | Promise<readonly AgentSdkPluginSpec[]>
  readonly allowPluginHooks?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    boolean | Promise<boolean>
  readonly sdkAgents?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    AgentSdkAgentDefinitions | Promise<AgentSdkAgentDefinitions>
  readonly sdkPersonaConfig?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    ResolvedPersonaSdkConfig | Promise<ResolvedPersonaSdkConfig>
  readonly sdkSubagentToolPolicies?: (message: AgentMessage, conversation: ConversationEntryV1) =>
    AgentSdkSubagentToolPolicies | Promise<AgentSdkSubagentToolPolicies>
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const AGENT_ATTACHMENT_DIRECTORIES_UNAVAILABLE_MESSAGE = "当前会话无法访问新附件路径。请开启新会话后重试。"

export class SessionManager {
  private readonly deps: SessionManagerDeps
  private readonly createSession: AgentLiveSessionFactory
  private readonly resettingConversations = new Set<string>()

  constructor(deps: SessionManagerDeps) {
    this.deps = deps
    this.createSession = deps.createSession ?? ((input) =>
      new ClaudeSDKSession({
        projectId: input.projectId,
        conversationId: input.conversation.id,
        providerId: input.providerId,
        cwd: input.cwd,
        sdkSessionId: input.sdkSessionId,
        env: input.env,
        model: input.model,
        mode: input.mode,
        maxTurns: input.maxTurns ?? DEFAULT_CLAUDE_SDK_MAX_TURNS,
        plugins: input.plugins,
        allowPluginHooks: input.allowPluginHooks,
        agent: input.agent,
        agentDefinitionsHash: input.agentDefinitionsHash,
        agents: input.agents,
        subagentToolPolicies: input.subagentToolPolicies,
        additionalDirectories: input.additionalDirectories,
        sdkSettings: input.sdkSettings,
        abortSignal: input.abortSignal,
        logger: deps.logger,
        now: deps.now,
      }))
  }

  stateForConversation(conversationId: string, message?: AgentMessage): RuntimeSessionState {
    if (this.resettingConversations.has(conversationId)) {
      throw new Error(AGENT_SESSION_RESETTING_MESSAGE)
    }
    const existing = this.deps.states.get(conversationId)
    if (existing) {
      if (message) {
        existing.workspaceKey = message.workspaceKey ?? existing.workspaceKey
        existing.workspacePath = message.workspacePath ?? existing.workspacePath
      }
      existing.lastActivity = Date.now()
      return existing
    }
    const state: RuntimeSessionState = {
      key: conversationId,
      workspaceKey: message?.workspaceKey,
      workspacePath: message?.workspacePath,
      queue: [],
      busy: false,
      activeTurns: 0,
      lastActivity: Date.now(),
    }
    this.deps.states.set(conversationId, state)
    return this.deps.states.get(conversationId) ?? state
  }

  beginReset(conversationId: string): void {
    this.resettingConversations.add(conversationId)
  }

  endReset(conversationId: string): void {
    this.resettingConversations.delete(conversationId)
  }

  async getOrCreateSession(input: {
    readonly state: RuntimeSessionState
    readonly conversation: ConversationEntryV1
    readonly message: AgentMessage
    readonly abortSignal?: AbortSignal
  }): Promise<AgentLiveSessionHandle> {
    const providerId = input.conversation.providerId ?? input.message.providerId
    if (!providerId) {
      throw new Error(AGENT_PROVIDER_REQUIRED_MESSAGE)
    }
    const cwd = input.message.workspacePath ?? this.deps.workDir
    if (!cwd) {
      throw new Error(AGENT_PROJECT_WORKSPACE_REQUIRED_MESSAGE)
    }
    await this.deps.validateWorkspacePath?.(cwd)
    const attachments = normalizeAgentAttachments(input.message.attachments)
    const additionalDirectories = directoriesForPathAttachments({
      cwd,
      attachments,
    })

    const modeOverride = input.message.modeOverride ?? input.conversation.agentConfig?.mode
    const providerMatches = input.state.providerId === providerId
    const modeMatches = input.state.modeOverride === modeOverride
    const providerEnv = await this.deps.providerService.buildEnv(providerId, {
      actor: { kind: "user", id: input.message.userId },
      projectId: this.deps.projectId,
    })
    const replyTargetEnv = this.deps.getReplyTargetEnv?.(this.deps.projectId, input.message.sessionKey) ?? {}
    const env = {
      ...replyTargetEnv,
      ...providerEnv,
    }
    const effectiveTier = input.message.modelTier ?? input.conversation.agentConfig?.modelTier
    if (effectiveTier) {
      const tierModel = resolveTierFromEnv(env, effectiveTier)
      if (tierModel) {
        env.ANTHROPIC_MODEL = tierModel
      }
    }
    const modelMatches = input.state.effectiveModel === env.ANTHROPIC_MODEL
    const sdkSettings = await this.resolveSdkSettings(providerId, env)
    const sdkSettingsMatch = sdkSettingsEqual(input.state.sdkSettings, sdkSettings)
    const personaConfig = await Promise.resolve(this.deps.sdkPersonaConfig?.(
      input.message,
      input.conversation,
    ) ?? ordinaryPersonaSdkConfig())
    const contributionAgents = await Promise.resolve(this.deps.sdkAgents?.(input.message, input.conversation) ?? {})
    const agents = { ...contributionAgents, ...personaConfig.agents }
    const activeAgentName = personaConfig.activeAgentName
    const agentDefinitionsHash = personaConfig.definitionsHash
    const personaDefinitionsMatch = (input.state.agentDefinitionsHash ?? "") === agentDefinitionsHash
    const activeAgentMatches = input.state.mainThreadAgentName === activeAgentName
    const canReuseBaseSession =
      input.state.liveSession
      && input.state.liveSession.alive()
      && !input.state.liveSession.finished
      && providerMatches
      && modeMatches
      && modelMatches
      && sdkSettingsMatch
    const reusableLiveSession = input.state.liveSession
    if (canReuseBaseSession && personaDefinitionsMatch && reusableLiveSession) {
      if (hasUnconfiguredAttachmentDirectories({
        cwd,
        attachments,
        configuredDirectories: input.state.additionalDirectories ?? [],
      })) {
        throw new Error(AGENT_ATTACHMENT_DIRECTORIES_UNAVAILABLE_MESSAGE)
      }
      if (activeAgentMatches || await this.trySwitchMainThreadAgent(input.state, activeAgentName, input.conversation.id)) {
        return { liveSession: reusableLiveSession, created: false }
      }
    }

    if (input.state.liveSession) {
      if (
        input.state.liveSession.alive()
        && (!providerMatches || !modeMatches || !modelMatches || !sdkSettingsMatch || !personaDefinitionsMatch)
      ) {
        this.deps.logger?.info("Recreating agent live session.", {
          conversationId: input.conversation.id,
          providerChanged: !providerMatches,
          modeChanged: !modeMatches,
          modelChanged: !modelMatches,
          sdkSettingsChanged: !sdkSettingsMatch,
          agentDefinitionsChanged: !personaDefinitionsMatch,
          previousProviderId: input.state.providerId,
          nextProviderId: providerId,
          previousMode: input.state.modeOverride,
          nextMode: modeOverride,
          previousModel: input.state.effectiveModel,
          nextModel: env.ANTHROPIC_MODEL,
          previousAgentDefinitionsHash: input.state.agentDefinitionsHash,
          nextAgentDefinitionsHash: agentDefinitionsHash,
        })
      }
      await this.closeLiveSession(input.state, input.conversation.id)
    }

    const sdkSessionId = input.conversation.resumePolicy === "fresh"
      ? undefined
      : input.conversation.sdkSessionId
    const liveSession = await this.createSession({
      projectId: this.deps.projectId,
      conversation: input.conversation,
      providerId,
      cwd,
      sdkSessionId,
      env,
      model: env.ANTHROPIC_MODEL,
      mode: modeOverride,
      maxTurns: DEFAULT_CLAUDE_SDK_MAX_TURNS,
      plugins: await Promise.resolve(this.deps.sdkPlugins?.(input.message, input.conversation) ?? []),
      allowPluginHooks: await Promise.resolve(
        this.deps.allowPluginHooks?.(input.message, input.conversation) ?? false,
      ),
      agent: activeAgentName,
      agentDefinitionsHash,
      agents,
      subagentToolPolicies: await Promise.resolve(
        this.deps.sdkSubagentToolPolicies?.(input.message, input.conversation) ?? {},
      ),
      additionalDirectories,
      sdkSettings,
      abortSignal: input.abortSignal,
    })
    input.state.liveSession = liveSession
    input.state.providerId = providerId
    input.state.effectiveModel = env.ANTHROPIC_MODEL
    input.state.sdkSettings = sdkSettings
    input.state.modeOverride = modeOverride
    input.state.mainThreadAgentName = activeAgentName
    input.state.agentDefinitionsHash = agentDefinitionsHash
    input.state.additionalDirectories = additionalDirectories
    this.deps.logger?.info("Created agent live session.", {
      boundary: "agent-runtime.live-session.create",
      projectId: this.deps.projectId,
      conversationId: input.conversation.id,
      providerId,
      mode: modeOverride,
      sessionKey: input.message.sessionKey,
      platform: input.message.platform,
      workspaceKey: input.message.workspaceKey,
      hasWorkspacePath: Boolean(input.message.workspacePath),
      resumePolicy: input.conversation.resumePolicy,
      sdkSessionId,
    })
    return { liveSession, created: true }
  }

  async getActiveProviderId(): Promise<string | undefined> {
    return (await this.deps.providerService.getActiveProvider())?.id
  }

  private async resolveSdkSettings(
    providerId: string,
    env: Record<string, string>,
  ): Promise<ClaudeSDKRuntimeSettings | undefined> {
    const provider = await this.getProviderSafe(providerId)
    return resolveProviderSdkSettings(provider, env)
  }

  private async getProviderSafe(providerId: string): Promise<CCProvider | undefined> {
    const service = this.deps.providerService as ProviderService & {
      readonly getProvider?: ProviderService["getProvider"]
    }
    if (typeof service.getProvider !== "function") return undefined
    try {
      return await service.getProvider(providerId)
    } catch (error) {
      this.deps.logger?.warn("Failed to read provider SDK settings.", {
        boundary: "agent-runtime.provider-sdk-settings",
        providerId,
        ...errorDiagnostic(error),
      })
      return undefined
    }
  }

  private async trySwitchMainThreadAgent(
    state: RuntimeSessionState,
    activeAgentName: string | undefined,
    conversationId: string,
  ): Promise<boolean> {
    const liveSession = state.liveSession
    if (!liveSession) return false
    if (!liveSession.setMainThreadAgent) {
      this.deps.logger?.warn("Agent live session cannot switch main-thread agent.", {
        boundary: "agent-runtime.live-session.agent-switch",
        conversationId,
        providerId: state.providerId,
        mode: state.modeOverride,
        sdkSessionId: liveSession.currentSessionId(),
      })
      return false
    }
    try {
      await liveSession.setMainThreadAgent(activeAgentName ?? null)
      state.mainThreadAgentName = activeAgentName
      return true
    } catch (error) {
      this.deps.logger?.warn("Agent live session agent switch failed.", {
        boundary: "agent-runtime.live-session.agent-switch",
        conversationId,
        providerId: state.providerId,
        mode: state.modeOverride,
        sdkSessionId: liveSession.currentSessionId(),
        ...errorDiagnostic(error),
      })
      return false
    }
  }

  async interrupt(conversationId: string): Promise<boolean> {
    const state = this.deps.states.get(conversationId)
    const liveSession = state?.liveSession
    if (!liveSession?.cancelCurrentTurn) return false
    try {
      return await liveSession.cancelCurrentTurn()
    } catch (error) {
      this.deps.logger?.warn("Agent session interrupt failed.", {
        boundary: "agent-runtime.live-session.interrupt",
        conversationId,
        providerId: state?.providerId,
        mode: state?.modeOverride,
        sdkSessionId: liveSession.currentSessionId(),
        ...errorDiagnostic(error),
      })
      return false
    }
  }

  async closeCurrentTurn(conversationId: string): Promise<void> {
    const state = this.deps.states.get(conversationId)
    if (!state) return
    this.settlePending(state)
    if (!state.liveSession) return
    state.closing = true
    try {
      await this.closeLiveSession(state, conversationId)
    } finally {
      state.closing = false
    }
  }

  private async closeLiveSession(
    state: RuntimeSessionState,
    conversationId: string,
  ): Promise<void> {
    const liveSession = state.liveSession
    if (!liveSession) return
    try {
      await liveSession.close()
    } catch (error) {
      this.deps.logger?.warn("Agent live session close failed.", {
        boundary: "agent-runtime.live-session.close",
        conversationId,
        providerId: state.providerId,
        mode: state.modeOverride,
        sdkSessionId: liveSession.currentSessionId(),
        ...errorDiagnostic(error),
      })
    }
    state.liveSession = undefined
    state.providerId = undefined
    state.modeOverride = undefined
    state.mainThreadAgentName = undefined
    state.agentDefinitionsHash = undefined
    state.additionalDirectories = undefined
  }

  async closeState(conversationId: string): Promise<void> {
    const state = this.deps.states.get(conversationId)
    if (!state) return
    state.closing = true
    this.settlePending(state)
    this.settleQueued(state)
    await this.closeCurrentTurn(conversationId)
    this.deps.states.delete(conversationId)
  }

  settlePending(state: RuntimeSessionState | undefined): void {
    const pending = state?.pending
    if (!pending) return
    this.settlePendingPermission(pending)
  }

  settlePendingPermission(pending: PendingPermissionState): void {
    const state = this.deps.states.get(pending.stateKey)
    if (state?.pending?.requestId === pending.requestId) {
      state.pending = undefined
    }
    this.deps.pendingPermissions.delete(pending.requestId)
    pending.resolve()
  }

  settleQueued(state: RuntimeSessionState | undefined): void {
    if (!state) return
    const queued = state.queue.splice(0)
    for (const turn of queued) {
      turn.resolve(cancelledTurnResult(turn.conversationId))
    }
  }

  async closeIdleSessions(): Promise<void> {
    const now = Date.now()
    for (const [conversationId, state] of this.deps.states) {
      if (state.busy || state.activeTurns > 0 || state.queue.length > 0) continue
      if (!state.liveSession) continue
      if (now - state.lastActivity < IDLE_TIMEOUT_MS) continue
      const providerId = state.providerId
      const mode = state.modeOverride
      const sdkSessionId = state.liveSession.currentSessionId()
      await this.closeCurrentTurn(conversationId)
      this.deps.states.delete(conversationId)
      this.deps.logger?.info("Reclaimed idle agent session.", {
        boundary: "agent-runtime.live-session.idle-reclaim",
        conversationId,
        providerId,
        mode,
        sdkSessionId,
      })
    }
  }

  async reapIdleWorkspaceRuntimes(
    idleTimeoutMs: number,
    nowMs = Date.now(),
  ): Promise<readonly string[]> {
    const cutoff = nowMs - idleTimeoutMs
    const reaped: string[] = []
    for (const [conversationId, state] of this.deps.states) {
      if (!state.workspaceKey || !state.workspacePath) continue
      if (state.busy || state.activeTurns > 0 || state.queue.length > 0) continue
      if (state.lastActivity >= cutoff) continue
      await this.closeCurrentTurn(conversationId)
      reaped.push(state.workspacePath)
      this.deps.states.delete(conversationId)
    }
    return reaped
  }
}

function cancelledTurnResult(conversationId: string): AgentRuntimeTurnResult {
  const event: AgentEvent = {
    type: "result",
    content: "",
    done: true,
    metadata: { cancelled: true },
  }
  return {
    conversationId,
    events: [event],
    resultText: "",
    error: AGENT_CANCELLED_MESSAGE,
  }
}

export async function validateWorkspaceDirectory(cwd: string): Promise<void> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(cwd)
  } catch {
    throw new WorkspacePathUnavailableError(`项目路径不存在或不可访问：${cwd}。请在设置中修改项目路径后重试。`)
  }
  if (!info.isDirectory()) {
    throw new WorkspacePathUnavailableError(`项目路径不是目录：${cwd}。请在设置中修改项目路径后重试。`)
  }
}

export class WorkspacePathUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkspacePathUnavailableError"
  }
}

function resolveTierFromEnv(env: Record<string, string>, tier: string): string | undefined {
  switch (tier) {
    case "default": return env.ANTHROPIC_MODEL
    case "haiku":   return env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    case "sonnet":  return env.ANTHROPIC_DEFAULT_SONNET_MODEL
    case "opus":    return env.ANTHROPIC_DEFAULT_OPUS_MODEL
    default: return undefined
  }
}

function resolveProviderSdkSettings(
  provider: CCProvider | undefined,
  env: Record<string, string>,
): ClaudeSDKRuntimeSettings | undefined {
  const configured = provider?.settingsConfig?.skipWebFetchPreflight
  if (typeof configured === "boolean") {
    return { skipWebFetchPreflight: configured }
  }
  if (isThirdPartyAnthropicCompatibleBaseUrl(env.ANTHROPIC_BASE_URL)) {
    return { skipWebFetchPreflight: true }
  }
  return undefined
}

function isThirdPartyAnthropicCompatibleBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return !isAnthropicFirstPartyHost(host)
  } catch {
    return true
  }
}

function isAnthropicFirstPartyHost(host: string): boolean {
  return host === "api.anthropic.com"
    || host === "claude.ai"
    || host.endsWith(".claude.ai")
    || host === "platform.claude.com"
    || host.endsWith(".platform.claude.com")
}

function sdkSettingsEqual(
  left: ClaudeSDKRuntimeSettings | undefined,
  right: ClaudeSDKRuntimeSettings | undefined,
): boolean {
  return left?.skipWebFetchPreflight === right?.skipWebFetchPreflight
}

function ordinaryPersonaSdkConfig(): ResolvedPersonaSdkConfig {
  return {
    activePersonaId: null,
    agents: {},
    definitionsHash: "",
  }
}

function errorDiagnostic(error: unknown): {
  readonly errorName: string
  readonly errorLength: number
  readonly errorCode?: string
} {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : undefined
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
    ...(typeof code === "string" ? { errorCode: code } : {}),
  }
}
