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

export type SynapseAgentTimelineKind =
  | "message"
  | "thinking"
  | "toolCall"
  | "toolResult"
  | "permissionRequest"
  | "error"
  | "result"

interface SynapseAgentTimelineBase {
  readonly id: string
  readonly kind: SynapseAgentTimelineKind
  readonly timestamp: string
  readonly agentType?: string
  readonly agentSessionId?: string
  readonly threadId?: string
}

export interface SynapseAgentMessageTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "message"
  readonly role: "user" | "assistant" | "system" | "tool"
  readonly content: string
  readonly legacy?: boolean
}

export interface SynapseAgentThinkingTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "thinking"
  readonly content: string
}

export interface SynapseAgentToolCallTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "toolCall"
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
}

export interface SynapseAgentToolResultTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "toolResult"
  readonly toolName: string
  readonly content?: string
  readonly status?: string
  readonly exitCode?: number
  readonly success?: boolean
}

export interface SynapseAgentPermissionRequestTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "permissionRequest"
  readonly requestId: string
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
}

export interface SynapseAgentErrorTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "error"
  readonly message: string
}

export interface SynapseAgentResultTimelineItem extends SynapseAgentTimelineBase {
  readonly kind: "result"
  readonly content: string
  readonly metadata?: {
    readonly model?: string
    readonly effort?: string
    readonly contextRemainingPercent?: number
    readonly workDir?: string
  }
}

export type SynapseAgentTimelineItem =
  | SynapseAgentMessageTimelineItem
  | SynapseAgentThinkingTimelineItem
  | SynapseAgentToolCallTimelineItem
  | SynapseAgentToolResultTimelineItem
  | SynapseAgentPermissionRequestTimelineItem
  | SynapseAgentErrorTimelineItem
  | SynapseAgentResultTimelineItem

export type SynapseAgentToolCollapseDefault = "expanded" | "collapsed" | "auto"

export interface SynapseAgentToolDisplayRule {
  readonly label?: string
  readonly defaultCollapsed?: SynapseAgentToolCollapseDefault
  readonly previewLines?: number
  readonly previewChars?: number
}

export interface SynapseAgentDisplayProfile {
  readonly agentLabel: string
  readonly thinkingDefaultCollapsed: boolean
  readonly toolDefaultCollapsed: SynapseAgentToolCollapseDefault
  readonly toolPreviewLines: number
  readonly toolPreviewChars: number
  readonly aliases?: Record<string, string>
  readonly tools?: Record<string, SynapseAgentToolDisplayRule>
  readonly statusLabels: {
    readonly pending: string
    readonly running: string
    readonly success: string
    readonly error: string
    readonly denied: string
  }
}

export type SynapseAgentTimelineEntry = SynapseAgentTimelineItem

export interface SynapseAgentSessionSummary {
  readonly projectId: string
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
  readonly lastMessage?: SynapseAgentTimelineItem
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

export interface SynapseAgentRuntimeCliStatus {
  readonly required: boolean
  readonly binary?: string
  readonly installed: boolean
  readonly path: string | null
}

export interface SynapseAgentRuntimeProviderStatus {
  readonly projectId?: string
  readonly configured: boolean
  readonly activeProviderId?: string
  readonly activeModel?: string
}

export interface SynapseAgentRuntimeStatusItem {
  readonly id: string
  readonly label: string
  readonly ready: boolean
  readonly cli: SynapseAgentRuntimeCliStatus
  readonly provider?: SynapseAgentRuntimeProviderStatus
  readonly issues: string[]
}

export interface SynapseAgentRuntimeStatus {
  readonly projectId?: string
  readonly agents: SynapseAgentRuntimeStatusItem[]
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
  readonly entries: SynapseAgentTimelineItem[]
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
