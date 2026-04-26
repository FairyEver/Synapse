import type { ConversationEntryV1 } from "../../runtime/data-repo"
import type { DataNamespace } from "../../runtime/data-repo"
import type { ScopedEventBus } from "../../runtime/project-container"
import type { StructuredLogger } from "../../runtime/service-registry"
import type {
  AgentAdapter,
  AgentEvent,
  AgentMessage,
  AgentRuntimeTurnResult,
} from "./types"

export interface AgentRuntimeServiceDeps {
  readonly projectId: string
  readonly workDir?: string
  readonly conversations: DataNamespace<ConversationEntryV1>
  readonly adapter: AgentAdapter
  readonly eventBus?: ScopedEventBus
  readonly logger?: StructuredLogger
  readonly now?: () => Date
}

export class AgentRuntimeService {
  private readonly deps: AgentRuntimeServiceDeps

  constructor(deps: AgentRuntimeServiceDeps) {
    this.deps = deps
  }

  async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    if (message.projectId !== this.deps.projectId) {
      throw new Error(
        `AgentRuntime project mismatch: expected "${this.deps.projectId}", got "${message.projectId}"`,
      )
    }

    const conversation = await this.loadConversation(message)
    const withUserTurn = this.appendUserTurn(conversation, message)
    await this.deps.conversations.upsert(withUserTurn)

    if (!this.deps.workDir) {
      return this.finishWithError(message, withUserTurn.id, "Project workspace path is required")
    }

    try {
      const execution = await this.deps.adapter.execute(message, {
        projectId: this.deps.projectId,
        workDir: this.deps.workDir,
        threadId: withUserTurn.agentSessionId,
        actor: { kind: "user" },
      })
      const saved = this.applyExecutionResult(withUserTurn, execution)
      await this.deps.conversations.upsert(saved)

      for (const event of execution.events) {
        this.emitEvent(message, saved.id, event)
      }

      return {
        conversationId: saved.id,
        events: execution.events,
        resultText: execution.resultText,
        agentSessionId: saved.agentSessionId,
        threadId: saved.agentSessionId,
        error: execution.error,
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error)
      this.deps.logger?.warn("AgentRuntime turn failed.", {
        error: messageText,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
      })
      return this.finishWithError(message, withUserTurn.id, messageText)
    }
  }

  private async loadConversation(message: AgentMessage): Promise<ConversationEntryV1> {
    const id = conversationId(message.platform, message.sessionKey)
    const existing = await this.deps.conversations.get(id)
    if (existing) {
      return {
        ...existing,
        platform: message.platform,
        userMeta: mergeUserMeta(existing.userMeta, message),
        updatedAt: this.isoNow(),
      }
    }

    const now = this.isoNow()
    return {
      id,
      schemaVersion: 1,
      projectId: this.deps.projectId,
      sessionKey: message.sessionKey,
      platform: message.platform,
      agentType: this.deps.adapter.agentType,
      history: [],
      userMeta: mergeUserMeta(undefined, message),
      active: true,
      name: message.sessionKey,
      createdAt: now,
      updatedAt: now,
    }
  }

  private appendUserTurn(
    conversation: ConversationEntryV1,
    message: AgentMessage,
  ): ConversationEntryV1 {
    return {
      ...conversation,
      history: [
        ...conversation.history,
        historyEntry("user", message.content, this.isoNow()),
      ],
      updatedAt: this.isoNow(),
    }
  }

  private applyExecutionResult(
    conversation: ConversationEntryV1,
    execution: {
      readonly resultText: string
      readonly agentSessionId?: string
      readonly threadId?: string
    },
  ): ConversationEntryV1 {
    const nextAgentSessionId = execution.threadId ?? execution.agentSessionId
    const history = execution.resultText
      ? [
        ...conversation.history,
        historyEntry("assistant", execution.resultText, this.isoNow()),
      ]
      : conversation.history

    return {
      ...conversation,
      agentType: this.deps.adapter.agentType,
      agentSessionId: nextAgentSessionId ?? conversation.agentSessionId,
      pastAgentSessionIds: pastAgentSessionIds(
        conversation.pastAgentSessionIds,
        conversation.agentSessionId,
        nextAgentSessionId,
      ),
      history,
      updatedAt: this.isoNow(),
    }
  }

  private finishWithError(
    message: AgentMessage,
    conversationIdValue: string,
    error: string,
  ): AgentRuntimeTurnResult {
    const event: AgentEvent = { type: "error", message: error }
    this.emitEvent(message, conversationIdValue, event)
    return {
      conversationId: conversationIdValue,
      events: [event],
      resultText: "",
      error,
    }
  }

  private emitEvent(
    message: AgentMessage,
    conversationIdValue: string,
    event: AgentEvent,
  ): void {
    this.deps.eventBus?.emit({
      domain: "agent",
      type: event.type,
      payload: {
        event,
        projectId: this.deps.projectId,
        sessionKey: message.sessionKey,
        platform: message.platform,
      },
      scope: { sessionId: conversationIdValue },
      timestamp: this.isoNow(),
    })
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

export function conversationId(platform: string, sessionKey: string): string {
  const key = Buffer.from(`${platform}:${sessionKey}`).toString("base64url")
  return `agent-runtime:${key}`
}

function historyEntry(
  role: ConversationEntryV1["history"][number]["role"],
  content: string,
  timestamp: string,
): ConversationEntryV1["history"][number] {
  return { role, content, timestamp }
}

function mergeUserMeta(
  current: ConversationEntryV1["userMeta"] | undefined,
  message: AgentMessage,
): ConversationEntryV1["userMeta"] {
  return {
    ...(current ?? {}),
    userId: message.userId ?? current?.userId,
    userName: message.userName ?? current?.userName,
    platform: message.platform,
  }
}

function pastAgentSessionIds(
  current: string[] | undefined,
  previous: string | undefined,
  next: string | undefined,
): string[] | undefined {
  if (!previous || previous === next) return current
  const values = current ? [...current] : []
  if (!values.includes(previous)) values.push(previous)
  return values.length > 0 ? values : undefined
}
