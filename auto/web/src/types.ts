export type Provider = 'codex' | 'claude-code'
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never'

export interface CodexConfig {
  command: string
  model: string
  sandbox: SandboxMode
  approvalPolicy: ApprovalPolicy
  json: boolean
  disableMcp?: boolean
}

export interface ClaudeCodeConfig {
  command: string
  model: string
  dangerouslySkipPermissions: boolean
  outputFormat: 'json' | 'stream-json' | 'text'
  maxTurns: number
  systemPrompt: string
}

export interface UiConfig {
  prompt: string
  activePromptName: string
  prompts: string[]
  workingDirectory: string
  concurrency: number
  timeoutMinutes: number
  maxLogs: number
  provider: Provider
  codex: CodexConfig
  claudeCode: ClaudeCodeConfig
}

export type WorkerStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout'

export interface WorkerResult {
  id: number
  status: WorkerStatus
  durationMs: number
  exitCode: number | null
  logPath: string
  lastMessage: string
}

export type SchedulerStatus = 'idle' | 'running' | 'draining' | 'stopped' | 'error'

export interface RunTotals {
  started: number
  success: number
  error: number
  timeout: number
}

export interface SlotSnapshot {
  slotId: number
  sequence: number
  worker: WorkerResult | null
}

export interface RunSessionSnapshot {
  id: string
  startedAt: string
  durationMs: number
  slots: SlotSnapshot[]
  recentRuns: WorkerResult[]
  totals: RunTotals
  summaryPath: string
}

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  session: RunSessionSnapshot | null
  error: string
}

export interface OutputLine {
  workerId: number
  sequence?: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number
}
