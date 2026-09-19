export const httpShutdownForceCloseDelayMs = 5_000

export interface HttpConnectionShutdownServer {
  closeAllConnections?: () => void
}

export interface ShutdownDeadlineTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown
}

export type ShutdownDeadlineScheduler = (listener: () => void, delayMs: number) => { unref?: () => void }

const httpShutdownSignals: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"]

/**
 * `http.Server.close()` only drops connections that already finished their
 * response. A connection still waiting for one — a request whose handler never
 * returns, or a socket that connected and never spoke — keeps the close callback
 * pending forever, and Nest awaits that callback before re-raising the
 * termination signal. The process then stays alive with no listener: the port
 * stops answering and `nest start --watch` never spawns a replacement, because
 * it waits for the old child to exit first.
 *
 * Put an upper bound on shutdown: after a termination signal, force whatever
 * connections remain closed so the close callback can run. Connections still
 * serving a request when the grace period ends are cut, which is the intended
 * trade-off for a shutdown that is guaranteed to finish.
 */
export function registerHttpShutdownDeadline(
  httpServer: HttpConnectionShutdownServer,
  target: ShutdownDeadlineTarget = process,
  signals: readonly NodeJS.Signals[] = httpShutdownSignals,
  schedule: ShutdownDeadlineScheduler = (listener, delayMs) => setTimeout(listener, delayMs),
): void {
  for (const signal of signals) {
    target.once(signal, () => {
      const timer = schedule(() => {
        httpServer.closeAllConnections?.()
      }, httpShutdownForceCloseDelayMs)
      // A clean shutdown exits long before this fires; the fallback timer must
      // never be the reason the process lingers.
      timer.unref?.()
    })
  }
}
