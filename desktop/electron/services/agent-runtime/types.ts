import type { ActorIdentity } from "../../runtime/security"
import type { SynapseAgentConversationTarget } from "../../../src/types/agent-navigation"
import type { AgentTurnOutcome } from "./turn-outcome"

export const AGENT_RUNTIME_SERVICE_ID = "agent.runtime"

export type AgentImageAttachment = {
  readonly kind: "image"
  readonly mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp"
  readonly data: ArrayBuffer | Uint8Array
  readonly name?: string
  readonly size?: number
}

export type AgentPathAttachment = {
  readonly kind: "path"
  readonly path: string
  readonly entryType: "file" | "directory"
  readonly name?: string
}

export type AgentAttachment =
  | AgentImageAttachment
  | AgentPathAttachment

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
  readonly agentType?: string
  readonly providerId?: string
  readonly modelTier?: string
  readonly userMeta?: Record<string, unknown>
}

interface AgentEventBase {
  readonly type:
    | "text"
    | "thinking"
    | "toolUse"
    | "toolResult"
    | "permissionRequest"
    | "result"
    | "sessionInit"
    | "assistant"
    | "stream"
    | "status"
    | "compactBoundary"
    | "sdkEvent"
    | "error"
  readonly agentSessionId?: string
  readonly threadId?: string
  readonly conversationId?: string
  readonly turnId?: string
  readonly providerId?: string
  readonly projectId?: string
  readonly sdkSessionId?: string
  readonly timestamp?: string
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
  readonly toolUseId?: string
  readonly toolName: string
  readonly toolInput?: string
  readonly toolInputRaw?: Record<string, unknown>
}

export interface AgentToolResultEvent extends AgentEventBase {
  readonly type: "toolResult"
  readonly toolUseId?: string
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
  readonly id?: string
  readonly key?: string
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
  readonly cancelled?: boolean
  readonly turnOutcome?: AgentTurnOutcome
  readonly usage?: Record<string, unknown>
  readonly turnUsage?: Record<string, unknown>
  readonly modelUsage?: Record<string, unknown>
  readonly sdkResultUuid?: string
  readonly costUsd?: number
  readonly costCny?: number
  readonly costBreakdownCny?: Record<string, number>
  readonly totalCostUsd?: number
  readonly totalCostCny?: number
  readonly totalCostBreakdownCny?: Record<string, number>
  readonly costCurrency?: "CNY"
  readonly estimatedCost?: boolean
}

export type AgentErrorKind =
  | "execution_failed"
  | "tool_use_interrupted"
  | "webfetch_preflight_failed"

export interface AgentResultEvent extends AgentEventBase {
  readonly type: "result"
  readonly content: string
  readonly done: true
  readonly metadata?: AgentResultMetadata
  readonly costUsd?: number
  readonly costCny?: number
  readonly costCurrency?: "CNY"
  readonly usage?: Record<string, unknown>
  readonly modelUsage?: Record<string, unknown>
  readonly sdkResultUuid?: string
  readonly payload?: Record<string, unknown>
}

export interface AgentErrorEvent extends AgentEventBase {
  readonly type: "error"
  readonly message: string
  readonly errorKind?: AgentErrorKind
  readonly recoverable?: boolean
  readonly turnOutcome?: AgentTurnOutcome
  readonly usage?: Record<string, unknown>
  readonly modelUsage?: Record<string, unknown>
  readonly sdkResultUuid?: string
  readonly costUsd?: number
  readonly costCny?: number
  readonly costCurrency?: "CNY"
  readonly payload?: Record<string, unknown>
}

export interface AgentSessionInitEvent extends AgentEventBase {
  readonly type: "sessionInit"
  readonly tools?: readonly string[]
  readonly mcpServers?: readonly Record<string, unknown>[]
  readonly model?: string
  readonly payload?: Record<string, unknown>
}

export interface AgentAssistantEvent extends AgentEventBase {
  readonly type: "assistant"
  readonly message: Record<string, unknown>
  readonly contentBlocks?: readonly unknown[]
  readonly content?: string
  readonly payload?: Record<string, unknown>
}

export interface AgentStreamEvent extends AgentEventBase {
  readonly type: "stream"
  readonly event: Record<string, unknown>
  readonly blockIndex?: number
  readonly deltaType?: string
  readonly text?: string
  readonly thinking?: string
  readonly partialJson?: string
  readonly payload?: Record<string, unknown>
}

export interface AgentStatusEvent extends AgentEventBase {
  readonly type: "status"
  readonly status?: string | null
  readonly payload?: Record<string, unknown>
}

export interface AgentCompactBoundaryEvent extends AgentEventBase {
  readonly type: "compactBoundary"
  readonly payload: Record<string, unknown>
}

export interface AgentSdkEvent extends AgentEventBase {
  readonly type: "sdkEvent"
  readonly sdkType: string
  readonly sdkSubtype?: string
  readonly payload: Record<string, unknown>
}

export type AgentEvent =
  | AgentTextEvent
  | AgentThinkingEvent
  | AgentToolUseEvent
  | AgentToolResultEvent
  | AgentPermissionRequestEvent
  | AgentResultEvent
  | AgentErrorEvent
  | AgentSessionInitEvent
  | AgentAssistantEvent
  | AgentStreamEvent
  | AgentStatusEvent
  | AgentCompactBoundaryEvent
  | AgentSdkEvent

export type AgentPermissionBehavior = "allow" | "deny"

export interface AgentPermissionDecision {
  readonly behavior: AgentPermissionBehavior
  readonly updatedInput?: Record<string, unknown>
  readonly message?: string
}

export interface AgentPermissionResponseRequest extends AgentPermissionDecision {
  readonly requestId: string
  readonly actor: ActorIdentity
  readonly sessionKey?: string
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
  readonly questions?: readonly AgentUserQuestion[]
  readonly createdAt: string
}

export interface AgentLiveSession {
  readonly agentType: string
  readonly finished?: boolean
  readonly mainThreadAgentName?: string
  readonly agentDefinitionsHash?: string
  send(message: AgentMessage): Promise<boolean>
  respondPermission(
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void>
  nextEvent(): Promise<AgentEvent | null>
  nextEventWithTimeout?(timeoutMs: number): Promise<AgentEvent | null>
  currentSessionId(): string | undefined
  alive(): boolean
  close(): Promise<void>
  cancelCurrentTurn?(): Promise<boolean>
  setPermissionMode?(mode: string): Promise<void>
  setMainThreadAgent?(agentName: string | null): Promise<void>
}

export interface AgentUsageCostBreakdownCny {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
}

export interface AgentRuntimeTurnResult {
  readonly conversationId: string
  readonly events: readonly AgentEvent[]
  readonly resultText: string
  readonly agentSessionId?: string
  readonly threadId?: string
  readonly error?: string
  readonly usage?: Record<string, unknown>
  readonly modelName?: string
  readonly costUsd?: number
  readonly costCny?: number
  readonly costBreakdownCny?: AgentUsageCostBreakdownCny
  readonly costCurrency?: "CNY"
}

export interface AgentRuntimeRelayResult extends AgentRuntimeTurnResult {
  readonly timedOut: boolean
  readonly partialText?: string
}

export type ScheduledAgentSourcePlatform = "automation" | "workflow" | "scheduled"

export type ScheduledAgentSendInput = {
  readonly projectId: string
  readonly agentType: string
  readonly mode: string
  readonly prompt: string
  readonly sessionPolicy: "fresh" | "resume"
  readonly timeoutMs?: number
  readonly lastConversationId?: string
  readonly abortSignal?: AbortSignal
  readonly providerId?: string
  readonly modelTier?: string
  readonly sourcePlatform?: ScheduledAgentSourcePlatform
  readonly userMeta?: Record<string, unknown>
  readonly onConversationCreated?: (target: SynapseAgentConversationTarget) => void
}

export type CancelTurnResult = {
  readonly status: "no-active-turn" | "graceful-pending" | "hard-killed"
}

export type ScheduledAgentSendResult = {
  readonly conversationId: string
  readonly sessionKey: string
  readonly status: "success" | "error" | "timeout"
  readonly summary?: string
  readonly error?: string
  readonly durationMs: number
  readonly usage?: Record<string, unknown>
  readonly modelName?: string
  readonly costUsd?: number
  readonly costCny?: number
  readonly costBreakdownCny?: AgentUsageCostBreakdownCny
  readonly costCurrency?: "CNY"
}
