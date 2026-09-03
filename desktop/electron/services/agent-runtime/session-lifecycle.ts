import type { ConversationEntryV1, ConversationMainThreadPersonaSnapshotV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/service-registry"
import type { AgentSessionRepository } from "./session-repository"
import type { SessionManager } from "./session-manager"
import type {
  AgentMessage,
  AgentLiveSession,
  AgentPendingPermission,
  AgentUserQuestionResolution,
} from "./types"
import type { ClaudeSDKRuntimeSettings } from "./claude-sdk-session"
import type { TurnLifecycle } from "./turn-outcome"

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
  providerId?: string
  effectiveModel?: string
  modelContextConfigurationKey?: string
  sdkSettings?: ClaudeSDKRuntimeSettings
  synapseToolRouterEnabled?: boolean
  additionalDirectories?: readonly string[]
  allowedWriteDirectories?: readonly string[]
  modeOverride?: string
  mainThreadAgentName?: string
  agentDefinitionsHash?: string
  closing?: boolean
  activeLifecycle?: TurnLifecycle
  cancelState?: {
    requestedAt: number
    escalationTimer?: ReturnType<typeof setTimeout>
  }
}

export interface QueuedTurn {
  readonly message: AgentMessage
  readonly conversationId: string
  readonly turnId: string
  readonly lifecycle: TurnLifecycle
  readonly userHistoryMetadata?: Record<string, unknown>
  readonly abortSignal?: AbortSignal
  readonly liveEventTimeoutMs?: number
  readonly onResponseStarted?: () => void
  resolve(result: unknown): void
}

export interface PendingPermissionState extends AgentPendingPermission {
  readonly stateKey: string
  readonly liveSession: AgentLiveSession
  resolutionClaimed?: boolean
  sdkAcceptedUserQuestionResolution?: AgentUserQuestionResolution
  resolve(): void
}

export interface SessionLifecycleDeps {
  readonly projectId: string
  readonly repository: AgentSessionRepository
  readonly states: Map<string, RuntimeSessionState>
  readonly pendingPermissions: Map<string, PendingPermissionState>
  readonly sessionManager: SessionManager
  readonly logger?: StructuredLogger
  readonly getActiveAgentType: () => Promise<string>
}

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
    readonly providerId?: string
    readonly mode?: string
    readonly modelTier?: string
    readonly experimentalSynapseToolRouterEnabled?: boolean
    readonly connectorIds?: readonly string[]
    readonly mainThreadPersonaSnapshot?: ConversationMainThreadPersonaSnapshotV1
  }): Promise<ConversationEntryV1> {
    return this.deps.repository.createSession({
      sessionKey: input.sessionKey,
      platform: input.platform,
      name: input.name,
      agentType: input.agentType,
      workspaceKey: input.workspaceKey,
      workspacePath: input.workspacePath,
      providerId: input.providerId,
      mode: input.mode,
      modelTier: input.modelTier,
      experimentalSynapseToolRouterEnabled: input.experimentalSynapseToolRouterEnabled,
      connectorIds: input.connectorIds,
      mainThreadPersonaSnapshot: input.mainThreadPersonaSnapshot,
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

  async renameSession(conversationIdValue: string, name: string): Promise<ConversationEntryV1> {
    return this.deps.repository.renameSession(conversationIdValue, name)
  }

  async deleteSession(conversationIdValue: string): Promise<boolean> {
    const conversation = await this.deps.repository.get(conversationIdValue)
    if (!conversation) return false
    await this.deps.sessionManager.closeState(conversationIdValue)
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
    const agentType = conversation ? await this.deps.getActiveAgentType() : undefined
    if (conversation) {
      optionalResetCoordinator(this.deps.sessionManager).beginReset?.(conversation.id)
    }
    try {
      if (conversation) {
        await this.deps.sessionManager.closeState(conversation.id)
      }
      const reset = conversation
        ? await this.deps.repository.clearCurrentAgentSessionId(conversation.id, agentType)
        : null
      this.deps.logger?.info("Agent session reset.", {
        projectId: this.deps.projectId,
        boundary: "agent-runtime.session.reset",
        sessionKey,
        platform,
        workspaceKey,
        conversationId: conversation?.id,
        agentType,
        hadConversation: Boolean(conversation),
      })
      return reset
    } finally {
      if (conversation) {
        optionalResetCoordinator(this.deps.sessionManager).endReset?.(conversation.id)
      }
    }
  }

  async reclaimIdleSessions(): Promise<void> {
    return this.deps.sessionManager.closeIdleSessions()
  }

  startIdleReclaim(): void {
    if (this.reclaimInterval) return
    this.reclaimInterval = setInterval(() => {
      void this.reclaimIdleSessions().catch((error) => {
        this.deps.logger?.warn("Agent idle reclaim failed.", {
          projectId: this.deps.projectId,
          boundary: "agent-runtime-idle-reclaim",
          ...errorDiagnostic(error),
        })
      })
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
    return this.deps.sessionManager.reapIdleWorkspaceRuntimes(idleTimeoutMs, nowMs)
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
      return
    }
    await this.deps.sessionManager.closeCurrentTurn(conversation.id)
  }

  stateForConversation(conversationIdValue: string, message?: AgentMessage): RuntimeSessionState {
    return this.deps.sessionManager.stateForConversation(conversationIdValue, message)
  }
}

function optionalResetCoordinator(
  sessionManager: SessionManager,
): Pick<SessionManager, "beginReset" | "endReset"> & {
  beginReset?: (conversationId: string) => void
  endReset?: (conversationId: string) => void
} {
  return sessionManager
}

function errorDiagnostic(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}
