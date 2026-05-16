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
  intervalSeconds: number
  timeoutMinutes: number
  maxLogs: number
  provider: Provider
  codex: CodexConfig
  claudeCode: ClaudeCodeConfig
}

export type WorkerStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout'
export type BatchStatus = 'running' | 'success' | 'partial' | 'error'

export interface WorkerResult {
  id: number
  status: WorkerStatus
  durationMs: number
  exitCode: number | null
  logPath: string
  lastMessage: string
}

export interface BatchSnapshot {
  id: string
  status: BatchStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number
  workers: WorkerResult[]
  summaryPath: string
}

export type SchedulerStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'error'

export interface SchedulerSnapshot {
  status: SchedulerStatus
  drainAfterCurrent: boolean
  activeConfig: UiConfig | null
  currentBatch: BatchSnapshot | null
  lastBatch: (BatchSnapshot & { finishedAt: string }) | null
  error: string
}

export interface OutputLine {
  workerId: number
  stream: 'stdout' | 'stderr' | 'event'
  text: string
  ts: number
}
