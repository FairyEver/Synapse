import type { ActorIdentity } from "../../runtime/security"
import type { ControlledProcessIsolationOptions } from "../../runtime/process"

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
  readonly channelKey?: string
  readonly platform: string
  readonly messageId?: string
  readonly userId?: string
  readonly userName?: string
  readonly chatName?: string
  readonly chatType?: "direct" | "group"
  readonly channelName?: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly mentions?: readonly string[]
  readonly createdAt?: string
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
    | "permissionRequest"
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

export interface AgentUserQuestionOption {
  readonly label: string
  readonly description?: string
}

export interface AgentUserQuestion {
  readonly question: string
  readonly header?: string
  readonly options?: readonly AgentUserQuestionOption[]
  readonly multiSelect?: boolean
}

export interface AgentPermissionRequestEvent extends AgentEventBase {
  readonly type: "permissionRequest"
  readonly requestId: string
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
  readonly questions?: readonly AgentUserQuestion[]
}

export interface AgentResultMetadata {
  readonly model?: string
  readonly effort?: string
  readonly contextRemainingPercent?: number
  readonly workDir?: string
}

export interface AgentResultEvent extends AgentEventBase {
  readonly type: "result"
  readonly content: string
  readonly done: true
  readonly metadata?: AgentResultMetadata
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
  | AgentPermissionRequestEvent
  | AgentResultEvent
  | AgentErrorEvent

export interface AgentExecutionContext {
  readonly projectId: string
  readonly workDir: string
  readonly threadId?: string
  readonly agentSessionId?: string
  readonly sessionEnv?: Record<string, string>
  readonly processIsolation?: ControlledProcessIsolationOptions
  readonly actor: ActorIdentity
  onEvent?(event: AgentEvent): void
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
  readonly compressionCommand?: string
  execute(
    message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult>
  startSession?(
    context: AgentExecutionContext,
  ): Promise<AgentLiveSession>
}

export type AgentPermissionBehavior = "allow" | "deny"

export interface AgentPermissionDecision {
  readonly behavior: AgentPermissionBehavior
  readonly updatedInput?: Record<string, unknown>
  readonly message?: string
}

export interface AgentPermissionResponseRequest extends AgentPermissionDecision {
  readonly requestId: string
  readonly actor: ActorIdentity
}

export interface AgentPendingPermission {
  readonly requestId: string
  readonly projectId: string
  readonly sessionKey: string
  readonly workspaceKey?: string
  readonly workspacePath?: string
  readonly conversationId: string
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
  readonly createdAt: string
}

export interface AgentLiveSession {
  readonly agentType: string
  send(message: AgentMessage): Promise<void>
  respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void>
  nextEvent(): Promise<AgentEvent | null>
  currentSessionId(): string | undefined
  alive(): boolean
  close(): Promise<void>
}

export interface AgentRuntimeTurnResult {
  readonly conversationId: string
  readonly events: readonly AgentEvent[]
  readonly resultText: string
  readonly agentSessionId?: string
  readonly threadId?: string
  readonly error?: string
}

export interface AgentRuntimeRelayResult extends AgentRuntimeTurnResult {
  readonly timedOut: boolean
  readonly partialText?: string
}

export type ScheduledAgentSendInput = {
  readonly projectId: string
  readonly agentType: string
  readonly mode: string
  readonly prompt: string
  readonly sessionPolicy: "fresh" | "resume"
  readonly timeoutMs: number
  readonly lastConversationId?: string
  readonly abortSignal?: AbortSignal
}

export type ScheduledAgentSendResult = {
  readonly conversationId: string
  readonly status: "success" | "error" | "timeout"
  readonly summary?: string
  readonly error?: string
  readonly durationMs: number
}
