export type TaskKind = 'direct' | 'drilldown' | 'missing' | 'slang' | 'unsupported'

export type ArgRule =
  | { kind: 'nonEmpty'; arg: string }
  | { kind: 'range'; arg: string; min: number; max: number }
  | { kind: 'maxLength'; arg: string; max: number }
  | { kind: 'minuteIn'; arg: string; allow: string[] }
  | { kind: 'secondsZero'; arg: string }
  | { kind: 'before'; arg: string; other: string }

export interface TaskExpect {
  outcome: 'call' | 'clarify' | 'unsupported'
  acceptableCapabilityIds?: string[]
  requiredChain?: string[]
  argRules?: ArgRule[]
  missingAnyOf?: string[]
  forbiddenCapabilityIds?: string[]
  acceptablePageRefs?: string[]
  expectZeroSearchHits?: boolean
}

export interface Task {
  id: string
  kind: TaskKind
  utterance: string
  goal: string
  why: string
  expect: TaskExpect
}

export declare const EVAL_TODAY: string
export declare const TASKS: Task[]
export declare function getTask(taskId: string): Task
