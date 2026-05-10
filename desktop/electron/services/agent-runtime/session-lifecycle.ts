import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AgentSessionRepository } from "./session-repository"
import type { AgentMessage, AgentLiveSession, AgentPendingPermission } from "./types"

export interface RuntimeSessionState {
  key: string
  workspaceKey?: string
  workspacePath?: string
  readonly queue: QueuedTurn[]
  busy: boolean
  activeTurns: number
  lastActivity: number
  liveSession?: AgentLiveSession
  pending?: PendingPermissionState
  turnAbortController?: AbortController
  cancelState?: {
    requestedAt: number
    escalationTimer?: ReturnType<typeof setTimeout>
  }
}

export interface QueuedTurn {
  readonly message: AgentMessage
  readonly conversationId: string
  resolve(result: unknown): void
}

export interface PendingPermissionState extends AgentPendingPermission {
  readonly stateKey: string
  readonly liveSession: AgentLiveSession
  resolve(): void
}

export interface SessionLifecycleDeps {
  readonly projectId: string
  readonly repository: AgentSessionRepository
  readonly states: Map<string, RuntimeSessionState>
  readonly pendingPermissions: Map<string, PendingPermissionState>
  readonly logger?: StructuredLogger
  readonly getActiveAgentType: () => Promise<string>
}

const IDLE_TIMEOUT_MS = 10 * 60 * 1000

export class SessionLifecycleManager {
  private readonly deps: SessionLifecycleDeps
  private reclaimInterval?: ReturnType<typeof setInterval>

  constructor(deps: SessionLifecycleDeps) {
    this.deps = deps
  }

  async listSessions(): Promise<readonly ConversationEntryV1[]> {
    return this.deps.repository.listSessions()
  }

  async getSession(conversationIdValue: string): Promise<ConversationEntryV1 | null> {
    return this.deps.repository.get(conversationIdValue)
  }

  async createSession(input: {
    readonly sessionKey: string
    readonly platform?: string
    readonly name?: string
    readonly agentType?: string
    readonly workspaceKey?: string
    readonly workspacePath?: string
  }): Promise<ConversationEntryV1> {
    return this.deps.repository.createSession({
      sessionKey: input.sessionKey,
      platform: input.platform,
      name: input.name,
      agentType: input.agentType,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      resumePolicy: "resume",
    })
  }

  async switchSession(
    sessionKey: string,
    conversationIdValue: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<ConversationEntryV1> {
    const target = await this.deps.repository.get(conversationIdValue)
    if (!target || target.sessionKey !== sessionKey) {
      throw new Error(`Conversation "${conversationIdValue}" is not available for this session key`)
    }
    const effectiveWorkspaceKey = workspaceKey ?? target.workspaceKey
    return this.deps.repository.setActiveSession(sessionKey, conversationIdValue, platform, effectiveWorkspaceKey)
  }

  async renameSession(conversationIdValue: string, name: string): Promise<boolean> {
    await this.deps.repository.renameSession(conversationIdValue, name)
    return true
  }

  async deleteSession(conversationIdValue: string): Promise<boolean> {
    const conversation = await this.deps.repository.get(conversationIdValue)
    if (!conversation) return false
    const state = this.deps.states.get(conversationIdValue)
    if (state) {
      if (state.pending) {
        this.deps.pendingPermissions.delete(state.pending.requestId)
        state.pending = undefined
      }
      if (state.liveSession) {
        await state.liveSession.close()
        state.liveSession = undefined
      }
      state.queue.length = 0
      this.deps.states.delete(conversationIdValue)
    }
    await this.deps.repository.deleteSession(conversationIdValue)
    return true
  }

  async clearCurrentAgentSessionId(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const conversation = await this.deps.repository.getActive(sessionKey, platform, workspaceKey)
    if (!conversation) return null
    return this.deps.repository.clearCurrentAgentSessionId(conversation.id, await this.deps.getActiveAgentType())
  }

  async resetSession(
    sessionKey: string,
    platform = "local",
    workspaceKey?: string,
  ): Promise<ConversationEntryV1 | null> {
    const conversation = await this.deps.repository.getActive(sessionKey, platform, workspaceKey)
    if (conversation) {
      const state = this.deps.states.get(conversation.id)
      if (state?.pending) {
        this.deps.pendingPermissions.delete(state.pending.requestId)
        state.pending = undefined
      }
      if (state?.liveSession) {
        await state.liveSession.close()
        state.liveSession = undefined
      }
    }
    return this.clearCurrentAgentSessionId(sessionKey, platform, workspaceKey)
  }

  async reclaimIdleSessions(): Promise<void> {
    const now = Date.now()
    for (const [key, state] of this.deps.states) {
      if (state.busy || state.activeTurns > 0 || state.queue.length > 0) continue
      if (!state.liveSession) continue
      if (now - state.lastActivity < IDLE_TIMEOUT_MS) continue
      await state.liveSession.close()
      state.liveSession = undefined
      this.deps.logger?.info("Reclaimed idle agent session.", { conversationId: key })
    }
  }

  startIdleReclaim(): void {
    this.reclaimInterval = setInterval(() => {
      void this.reclaimIdleSessions()
    }, 60_000)
  }

  stopIdleReclaim(): void {
    if (this.reclaimInterval) {
      clearInterval(this.reclaimInterval)
      this.reclaimInterval = undefined
    }
  }

  async reapIdleWorkspaceRuntimes(
    idleTimeoutMs: number,
    nowMs = Date.now(),
  ): Promise<readonly string[]> {
    const cutoff = nowMs - idleTimeoutMs
    const reaped: string[] = []
    for (const [key, state] of this.deps.states) {
      if (!state.workspaceKey || !state.workspacePath) continue
      if (state.busy || state.activeTurns > 0 || state.queue.length > 0) continue
      if (state.lastActivity >= cutoff) continue
      if (state.liveSession?.alive()) {
        await state.liveSession.close()
      }
      reaped.push(state.workspacePath)
      this.deps.states.delete(key)
    }
    return reaped
  }

  async closeIdleStateForConversation(
    sessionKey: string,
    platform?: string,
    workspaceKey?: string,
  ): Promise<void> {
    const conversation = await this.deps.repository.getActive(sessionKey, platform, workspaceKey)
    if (!conversation) return
    const state = this.deps.states.get(conversation.id)
    if (!state) return
    if (state.busy || state.activeTurns > 0 || state.queue.length > 0) {
      throw new Error("Session is busy.")
    }
    if (state.pending) {
      this.deps.pendingPermissions.delete(state.pending.requestId)
      state.pending = undefined
    }
    if (state.liveSession) {
      await state.liveSession.close()
      state.liveSession = undefined
    }
  }

  stateForConversation(conversationIdValue: string, message?: AgentMessage): RuntimeSessionState {
    const existing = this.deps.states.get(conversationIdValue)
    if (existing) {
      if (message) {
        existing.workspaceKey = message.workspaceKey ?? existing.workspaceKey
        existing.workspacePath = message.workspacePath ?? existing.workspacePath
      }
      existing.lastActivity = Date.now()
      return existing
    }
    const state: RuntimeSessionState = {
      key: conversationIdValue,
      workspaceKey: message?.workspaceKey,
      workspacePath: message?.workspacePath,
      queue: [],
      busy: false,
      activeTurns: 0,
      lastActivity: Date.now(),
    }
    this.deps.states.set(conversationIdValue, state)
    return state
  }
}
