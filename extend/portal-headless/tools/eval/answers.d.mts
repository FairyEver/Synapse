import type { Decision } from './scoring.d.mts'

export interface TraceStep {
  call: string
  saw: string
}

export interface Answer {
  decision: Decision
  trace: TraceStep[]
}

export declare const ANSWERS: Record<string, Answer>
