import type { Task } from './tasks.d.mts'

export interface ArgSpec {
  value: unknown
  from: string
  deferred?: boolean
}

export interface Decision {
  taskId: string
  outcome: 'call' | 'clarify' | 'unsupported'
  capabilityId?: string
  chain?: string[]
  args?: Record<string, ArgSpec>
  missing?: string[]
  pageRef?: string
  notes?: string
}

export interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

export interface TaskResult {
  taskId: string
  kind: string
  passed: boolean
  checks: CheckResult[]
}

export interface RunResult {
  total: number
  passed: number
  failed: number
  results: TaskResult[]
}

export interface ScoringContext {
  registeredCapabilityIds: string[]
}

export declare function scoreDecision(task: Task, decision: Decision, ctx: ScoringContext): TaskResult
export declare function scoreRun(
  tasks: Task[],
  decisions: Record<string, Decision | undefined>,
  ctx: ScoringContext,
): RunResult
