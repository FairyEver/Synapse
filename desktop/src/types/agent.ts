export type SynapseAgentEvent =
  | {
      type: "text"
      content: string
      agentSessionId?: string
      threadId?: string
    }
  | {
      type: "thinking"
      content: string
      agentSessionId?: string
      threadId?: string
    }
  | {
      type: "toolUse"
      toolName: string
      toolInput?: string
      toolInputRaw?: Record<string, unknown>
      agentSessionId?: string
      threadId?: string
    }
  | {
      type: "toolResult"
      toolName: string
      content?: string
      status?: string
      exitCode?: number
      success?: boolean
      agentSessionId?: string
      threadId?: string
    }
  | {
      type: "permissionRequest"
      requestId: string
      toolName: string
      toolInput?: string
      toolInputRaw?: Record<string, unknown>
      agentSessionId?: string
      threadId?: string
    }
  | {
      type: "result"
      content: string
      done: true
      metadata?: {
        model?: string
        effort?: string
        contextRemainingPercent?: number
        workDir?: string
      }
      agentSessionId?: string
      threadId?: string
    }
  | {
      type: "error"
      message: string
      agentSessionId?: string
      threadId?: string
    }

export interface SynapseAgentTimelineEntry {
  readonly id: string
  readonly role: "user" | "assistant" | "system" | "tool"
  readonly content: string
  readonly timestamp: string
}

export interface SynapseAgentSessionSummary {
  readonly id: string
  readonly sessionKey: string
  readonly name?: string
  readonly platform?: string
  readonly sourceLabel?: string
  readonly agentType?: string
  readonly agentSessionId?: string
  readonly active: boolean
  readonly historyCount: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastMessage?: SynapseAgentTimelineEntry
}

export interface SynapseAgentStatus {
  readonly projectId: string
  readonly projectName: string
  readonly agentType: string
  readonly liveSessions: number
  readonly busySessions: number
  readonly queuedTurns: number
  readonly pendingPermissions: number
}

export interface SynapseAgentProviderSummary {
  readonly id: string
  readonly display?: string
  readonly active: boolean
  readonly model?: string
  readonly baseUrl?: string
  readonly scope: "global" | "project"
}

export interface SynapseAgentProviderState {
  readonly projectId: string
  readonly agentType: string
  readonly providers: SynapseAgentProviderSummary[]
  readonly activeProviderId?: string
  readonly activeModel?: string
  readonly activeMode?: string
}

export interface SynapseAgentPublishedCommand {
  readonly name: string
  readonly description?: string
  readonly source: "builtin" | "custom" | "skill" | "agent-native"
  readonly kind: "builtin" | "prompt" | "exec" | "skill" | "agent-native"
  readonly adminOnly: boolean
  readonly allowedPlatforms?: string[]
}

export interface SynapseAgentPendingPermission {
  readonly requestId: string
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId: string
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
  readonly createdAt: string
}

export interface SynapseAgentSendResult {
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId: string
  readonly resultText: string
  readonly events: SynapseAgentEvent[]
  readonly agentSessionId?: string
  readonly threadId?: string
  readonly error?: string
}

export interface SynapseAgentTimelineResult {
  readonly projectId: string
  readonly sessionKey: string
  readonly conversationId?: string
  readonly entries: SynapseAgentTimelineEntry[]
}

export interface SynapseAgentEventEnvelope {
  readonly event: SynapseAgentEvent
  readonly projectId: string
  readonly sessionKey: string
  readonly platform: string
}

export interface SynapseAgentConversationUpdatedPayload {
  readonly projectId: string
  readonly sessionKey: string
  readonly platform: string
  readonly conversationId: string
}

interface SynapseAgentDomainEventBase {
  readonly domain: "agent"
  readonly timestamp: string
  readonly scope?: {
    readonly projectId?: string
    readonly sessionId?: string
    readonly repositoryId?: string
  }
}

export interface SynapseAgentStreamDomainEvent extends SynapseAgentDomainEventBase {
  readonly type: SynapseAgentEvent["type"]
  readonly payload: SynapseAgentEventEnvelope
}

export interface SynapseAgentConversationUpdatedDomainEvent extends SynapseAgentDomainEventBase {
  readonly type: "conversationUpdated"
  readonly payload: SynapseAgentConversationUpdatedPayload
}

export type SynapseAgentDomainEvent =
  | SynapseAgentStreamDomainEvent
  | SynapseAgentConversationUpdatedDomainEvent
