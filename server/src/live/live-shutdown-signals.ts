import type { LiveDesktopGateway } from "./live-desktop.gateway"

export interface LiveShutdownSignalTarget {
  once(signal: NodeJS.Signals, listener: () => void): unknown
}

const liveShutdownSignals: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"]

export function registerLiveShutdownSignalHandlers(
  gateway: Pick<LiveDesktopGateway, "onApplicationShutdown">,
  target: LiveShutdownSignalTarget = process,
  signals: readonly NodeJS.Signals[] = liveShutdownSignals,
): void {
  for (const signal of signals) {
    target.once(signal, () => {
      gateway.onApplicationShutdown(signal)
    })
  }
}
