interface LiveReconnectDelayInput {
  readonly attempt: number
  readonly random?: () => number
}

const baseDelayMs = 2_000
const normalCapMs = 30_000
const longFailureCapMs = 120_000
const longFailureAttempt = 8
const jitterRatio = 0.3

export function createLiveReconnectDelay(input: LiveReconnectDelayInput): number {
  const random = input.random ?? Math.random
  const exponential = baseDelayMs * 2 ** Math.max(0, input.attempt)
  const cap = input.attempt >= longFailureAttempt ? longFailureCapMs : normalCapMs
  const capped = Math.min(exponential, cap)
  return Math.round(capped + capped * jitterRatio * random())
}
