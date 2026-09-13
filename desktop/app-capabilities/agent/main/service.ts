import type { DataRepository } from "../../../electron/runtime/data-repo"
import type { WindowManager } from "../../../electron/runtime/window"
import {
  OPEN_AGENT_SESSION_EVENT,
  type AgentConversationOpenRequest,
} from "../../../src/types/agent-navigation"
import { AgentConversationNavigationError } from "../shared/errors"
import {
  agentConversationOpenInputSchema,
  resolveAgentConversationTargetInput,
  type AgentConversationOpenInput,
  type AgentConversationOpenResult,
} from "../shared/schema"
import { AgentConversationTargetError, resolvePersistedAgentConversation } from "./conversation-target"
import { agentConversationSourceForPlatform } from "../shared/source"

type AgentConversationOpenConstraints = {
  readonly sessionKey?: string
  readonly platform?: string
}

type AgentConversationNavigationLogger = {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

export class AgentConversationNavigationService {
  private pendingOpenRequest: AgentConversationOpenRequest | null = null
  private nextOpenRequestId = 0

  constructor(private readonly deps: {
    readonly dataRepository: DataRepository
    readonly windowManager: WindowManager
    readonly logger: AgentConversationNavigationLogger
  }) {}

  async open(
    input: AgentConversationOpenInput,
    constraints: AgentConversationOpenConstraints = {},
  ): Promise<AgentConversationOpenResult> {
    const parsed = agentConversationOpenInputSchema.safeParse(input)
    if (!parsed.success) throw new AgentConversationNavigationError("invalid_input")

    let conversation
    try {
      conversation = await resolvePersistedAgentConversation(this.deps.dataRepository, parsed.data)
    } catch (error) {
      if (error instanceof AgentConversationTargetError) {
        if (error.code === "not_found") {
          const requested = resolveAgentConversationTargetInput(parsed.data)
          this.deps.logger.warn("Agent conversation open skipped.", {
            ...("projectId" in requested
              ? { projectId: requested.projectId, conversationId: requested.conversationId }
              : { conversationRef: requested.conversationRef }),
            sessionKey: constraints.sessionKey,
            platform: constraints.platform,
            reason: "not-found",
          })
        }
        throw new AgentConversationNavigationError(error.code)
      }
      throw error
    }
    if (
      (constraints.sessionKey !== undefined && conversation.sessionKey !== constraints.sessionKey)
      || (constraints.platform !== undefined && conversation.platform !== constraints.platform)
    ) {
      this.deps.logger.warn("Agent conversation open skipped.", {
        projectId: conversation.projectId,
        conversationId: conversation.id,
        sessionKey: constraints.sessionKey,
        platform: constraints.platform,
        reason: "not-found",
      })
      throw new AgentConversationNavigationError("not_found")
    }

    const request: AgentConversationOpenRequest = {
      requestId: this.nextOpenRequestId + 1,
      projectId: conversation.projectId,
      conversationId: conversation.id,
      sessionKey: conversation.sessionKey,
      sourceFilter: agentConversationSourceForPlatform(conversation.platform),
    }
    this.nextOpenRequestId = request.requestId
    this.pendingOpenRequest = request
    this.deps.windowManager.open("main")
    this.deps.windowManager.broadcast(
      OPEN_AGENT_SESSION_EVENT,
      request,
      (window) => window.role === "main",
    )
    this.deps.logger.info("Agent conversation opened.", {
      projectId: conversation.projectId,
      conversationId: conversation.id,
      sessionKey: conversation.sessionKey,
      platform: conversation.platform,
      requestId: request.requestId,
    })
    return { opened: true }
  }

  getPendingOpenRequest(): AgentConversationOpenRequest | null {
    return this.pendingOpenRequest ? { ...this.pendingOpenRequest } : null
  }

  acknowledgeOpenRequest(requestId: number): void {
    if (this.pendingOpenRequest?.requestId === requestId) {
      this.pendingOpenRequest = null
    }
  }
}
