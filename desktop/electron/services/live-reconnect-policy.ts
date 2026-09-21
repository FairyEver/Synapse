interface LiveReconnectDelayInput {
  readonly attempt: number
  readonly random?: () => number
}

const baseDelayMs = 2_000
const normalCapMs = 30_000
const longFailureCapMs = 120_000
const longFailureAttempt = 8
const jitterRatio = 0.3

/**
 * How long a connection has to survive before the backoff it took to get there is
 * forgiven.
 *
 * The attempt counter exists to slow down a loop that keeps failing, and the one moment
 * it is safe to forget is when a connection has demonstrably worked. Counting from
 * `welcome` alone is not that moment: a relay that is restarting, or a proxy draining a
 * node, accepts the socket, sends `welcome` and closes it again — every such connection
 * looked healthy for an instant, so clearing the counter there held the delay at its
 * floor and turned a flapping server into a 2 s loop with no ceiling. Measured from the
 * handshake, this is well past the point where a connection that is going to survive
 * has shown it — longer than a heartbeat round trip — while an ordinary brief drop
 * still reconnects at the floor.
 */
const stableConnectionMs = 30_000

export function createLiveReconnectDelay(input: LiveReconnectDelayInput): number {
  const random = input.random ?? Math.random
  const exponential = baseDelayMs * 2 ** Math.max(0, input.attempt)
  const cap = input.attempt >= longFailureAttempt ? longFailureCapMs : normalCapMs
  const capped = Math.min(exponential, cap)
  return Math.round(capped + capped * jitterRatio * random())
}

/** Whether a connection that has been up this long counts as one that worked. */
export function isStableLiveConnection(connectedForMs: number): boolean {
  return connectedForMs >= stableConnectionMs
}
