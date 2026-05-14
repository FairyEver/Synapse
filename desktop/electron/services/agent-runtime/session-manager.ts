import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { ProviderService } from "../provider"
import { ClaudeSDKSession } from "./claude-sdk-session"
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
  readonly mode?: string
  readonly abortSignal?: AbortSignal
}

export type AgentLiveSessionFactory = (
  input: CreateAgentLiveSessionInput,
) => AgentLiveSession | Promise<AgentLiveSession>

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
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000

export class SessionManager {
  private readonly deps: SessionManagerDeps
  private readonly createSession: AgentLiveSessionFactory

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
        mode: input.mode,
        abortSignal: input.abortSignal,
        logger: deps.logger,
        now: deps.now,
      }))
  }

  stateForConversation(conversationId: string, message?: AgentMessage): RuntimeSessionState {
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
    return state
  }

  async getOrCreateSession(input: {
    readonly state: RuntimeSessionState
    readonly conversation: ConversationEntryV1
    readonly message: AgentMessage
    readonly abortSignal?: AbortSignal
  }): Promise<AgentLiveSession> {
    const providerId = input.conversation.providerId ?? input.message.providerId
    if (!providerId) {
      throw new Error("Provider is required")
    }
    const modeOverride = input.message.modeOverride ?? input.conversation.agentConfig?.mode
    const providerMatches = input.state.providerId === providerId
    const modeMatches = input.state.modeOverride === modeOverride
    if (
      input.state.liveSession
      && input.state.liveSession.alive()
      && providerMatches
      && modeMatches
    ) {
      return input.state.liveSession
    }

    if (input.state.liveSession) {
      if (input.state.liveSession.alive() && (!providerMatches || !modeMatches)) {
        this.deps.logger?.info("Recreating agent live session.", {
          conversationId: input.conversation.id,
          providerChanged: !providerMatches,
          modeChanged: !modeMatches,
          previousProviderId: input.state.providerId,
          nextProviderId: providerId,
          previousMode: input.state.modeOverride,
          nextMode: modeOverride,
        })
      }
      await this.closeLiveSession(input.state, input.conversation.id)
    }

    const cwd = input.message.workspacePath ?? this.deps.workDir
    if (!cwd) {
      throw new Error("Project workspace path is required")
    }
    const env = await this.deps.providerService.buildEnv(providerId, {
      actor: { kind: "user", id: input.message.userId },
      projectId: this.deps.projectId,
    })
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
      mode: modeOverride,
      abortSignal: input.abortSignal,
    })
    input.state.liveSession = liveSession
    input.state.providerId = providerId
    input.state.modeOverride = modeOverride
    return liveSession
  }

  async getActiveProviderId(): Promise<string | undefined> {
    return (await this.deps.providerService.getActiveProvider())?.id
  }

  async interrupt(conversationId: string): Promise<boolean> {
    const state = this.deps.states.get(conversationId)
    const liveSession = state?.liveSession
    if (!liveSession?.cancelCurrentTurn) return false
    try {
      return await liveSession.cancelCurrentTurn()
    } catch (error) {
      this.deps.logger?.warn("Agent session interrupt failed.", {
        conversationId,
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
    await this.closeLiveSession(state, conversationId)
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
      await this.closeCurrentTurn(conversationId)
      this.deps.logger?.info("Reclaimed idle agent session.", { conversationId })
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
    error: "cancelled",
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
