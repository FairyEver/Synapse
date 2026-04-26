import type { ActorIdentity } from "../../runtime/security"

export const AGENT_RUNTIME_SERVICE_ID = "agent.runtime"

export interface AgentAttachment {
  readonly kind: string
  readonly path?: string
  readonly mimeType?: string
  readonly metadata?: Record<string, unknown>
}

export interface AgentMessage {
  readonly projectId: string
  readonly sessionKey: string
  readonly platform: string
  readonly userId?: string
  readonly userName?: string
  readonly content: string
  readonly attachments?: readonly AgentAttachment[]
  readonly replyCtx?: unknown
  readonly modeOverride?: string
}

interface AgentEventBase {
  readonly type:
    | "text"
    | "thinking"
    | "toolUse"
    | "toolResult"
    | "result"
    | "error"
  readonly agentSessionId?: string
  readonly threadId?: string
}

export interface AgentTextEvent extends AgentEventBase {
  readonly type: "text"
  readonly content: string
}

export interface AgentThinkingEvent extends AgentEventBase {
  readonly type: "thinking"
  readonly content: string
}

export interface AgentToolUseEvent extends AgentEventBase {
  readonly type: "toolUse"
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
}

export interface AgentToolResultEvent extends AgentEventBase {
  readonly type: "toolResult"
  readonly toolName: string
  readonly content?: string
  readonly status?: string
  readonly exitCode?: number
  readonly success?: boolean
}

export interface AgentResultEvent extends AgentEventBase {
  readonly type: "result"
  readonly content: string
  readonly done: true
}

export interface AgentErrorEvent extends AgentEventBase {
  readonly type: "error"
  readonly message: string
}

export type AgentEvent =
  | AgentTextEvent
  | AgentThinkingEvent
  | AgentToolUseEvent
  | AgentToolResultEvent
  | AgentResultEvent
  | AgentErrorEvent

export interface AgentExecutionContext {
  readonly projectId: string
  readonly workDir: string
  readonly threadId?: string
  readonly actor: ActorIdentity
}

export interface AgentExecutionResult {
  readonly events: readonly AgentEvent[]
  readonly resultText: string
  readonly agentSessionId?: string
  readonly threadId?: string
  readonly error?: string
}

export interface AgentAdapter {
  readonly agentType: string
  execute(
    message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>
}

export interface AgentRuntimeTurnResult {
  readonly conversationId: string
  readonly events: readonly AgentEvent[]
  readonly resultText: string
  readonly agentSessionId?: string
  readonly threadId?: string
  readonly error?: string
}
