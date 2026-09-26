import type { Decision, RunResult, TaskResult } from './scoring.d.mts'
import type { Task } from './tasks.d.mts'

export interface ModelUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  requests: number
}

export interface ModelConfig {
  baseUrl: string
  token: string
  model: string
}

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface RequestStat {
  round: number
  input_tokens: number
  output_tokens: number
  stop_reason: string | null
  toolsOffered: number
  forced: boolean
}

export interface TraceStep {
  call: string
  saw: string
}

export interface ToolStep {
  index: number
  tool: string
  args: Record<string, unknown>
  ok: boolean
  error: string | null
  resultBytes: number
  saw: string
  result: unknown
}

export interface TaskRun {
  taskId: string
  kind: string
  utterance: string
  decision: Decision | null
  rawDecision: Record<string, unknown> | null
  trace: TraceStep[]
  steps: ToolStep[]
  usage: ModelUsage
  perRequest: RequestStat[]
  rounds: number
  catalogCalls: number
  refusedCalls: number
  forcedSubmit: boolean
  budgetExceeded: boolean
  error: string | null
}

export interface ProtocolFingerprint {
  recommendKeys: string[]
  describeKeys: string[]
  nextStepKeys: string[]
  hasInvokeBinding: boolean
  hasLookup: boolean
  hasEdgeRole: boolean
  hasIntentSignal: boolean
  hasExplicitNegative: boolean
  registeredCapabilityIds: string[]
}

export interface ModelRunPayload {
  runAt: string
  model: string
  endpointHost: string | null
  maxCatalogCalls: number
  system: string
  registeredCapabilityIds: string[]
  fingerprint?: ProtocolFingerprint
  distEntry?: string
  redactedKeyCount: number
  usage: ModelUsage
  summary: { total: number; passed: number; failed: number }
  results: Array<TaskResult & {
    outcome: string | null
    capabilityId: string | null
    catalogCalls: number
    rounds: number
    budgetExceeded: boolean
    error: string | null
  }>
  runs: TaskRun[]
  runFile?: string
  label?: string
}

export type CallMessages = (body: Record<string, unknown>) => Promise<Record<string, unknown>>
export type FetchImpl = (url: string, init: Record<string, unknown>) => Promise<Record<string, unknown>>

export declare const MAX_CATALOG_CALLS: number
export declare const MAX_ROUNDS: number
export declare const MAX_NUDGES: number
export declare const DEFAULT_MAX_TOKENS: number
export declare const DEFAULT_MODEL: string
export declare const ANTHROPIC_VERSION: string
export declare const DEFAULT_RUN_DIR: string
export declare const CATALOG_TOOLS: ToolDefinition[]
export declare const SUBMIT_DECISION_TOOL: ToolDefinition
export declare const SYSTEM_PROMPT: string

export declare function readModelConfig(env?: Record<string, string | undefined>): ModelConfig
export declare function messagesUrl(baseUrl: string): string
export declare function toolsForRequest(catalogCalls: number, maxCatalogCalls?: number): ToolDefinition[]

export declare function createModelClient(options: {
  config: ModelConfig
  fetchImpl?: FetchImpl
  maxRetries?: number
}): { callMessages: CallMessages; url: string }

export declare function emptyUsage(): ModelUsage
export declare function addUsage(total: ModelUsage, usage: unknown): ModelUsage

export declare function executeCatalogTool(
  sdk: unknown,
  toolName: string,
  input: Record<string, unknown> | undefined,
): { ok: boolean; result: unknown; error?: string }

export declare function summarize(toolName: string, result: unknown): string
export declare function formatCall(toolName: string, input: Record<string, unknown> | undefined): string
export declare function normalizeDecision(raw: unknown, taskId: string): Decision

export declare function runTaskWithModel(options: {
  task: Task
  sdk: unknown
  callMessages: CallMessages
  model: string
  maxCatalogCalls?: number
  maxRounds?: number
  maxTokens?: number
  system?: string
  log?: (line: string) => void
}): Promise<TaskRun>

export declare function makeSdkAt(entryPath: string): Promise<unknown>
export declare function protocolFingerprint(sdk: unknown): ProtocolFingerprint

export declare function runModelEval(options?: {
  tasks?: Task[]
  config?: ModelConfig
  fetchImpl?: FetchImpl
  maxCatalogCalls?: number
  system?: string
  maxTokens?: number
  client?: { callMessages: CallMessages }
  sdk?: unknown
  entryPath?: string
  /** 显式给出用哪份入口（测试传 `SOURCE_ENTRY_CANDIDATES`）；优先于 `entryPath` */
  entryCandidates?: string[]
  log?: (line: string) => void
}): Promise<ModelRunPayload>

export declare function runFileName(now?: Date, label?: string): string
export declare function writeRunFile(
  payload: ModelRunPayload,
  options?: { dir?: string; now?: Date; label?: string },
): string
export declare function scoreRunFile(file: string): { payload: ModelRunPayload; scored: RunResult }
export declare function printReport(payload: ModelRunPayload, options?: { withTrace?: boolean }): void
