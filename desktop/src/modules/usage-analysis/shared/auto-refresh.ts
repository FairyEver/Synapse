import { useEffect } from "react"

type UsageAutoRefreshSource = "cc" | "codex"

type UsageAutoRefreshOptions = {
  readonly now?: () => number
}

type UsageRefreshRunner = () => Promise<unknown>

export const USAGE_AUTO_REFRESH_COOLDOWN_MS = 10 * 60 * 1000

const lastAutoRefreshAt: Partial<Record<UsageAutoRefreshSource, number>> = {}
const autoRefreshInFlight: Partial<Record<UsageAutoRefreshSource, Promise<unknown>>> = {}

export function runUsageAutoRefreshOnce(
  source: UsageAutoRefreshSource,
  refresh: UsageRefreshRunner,
  options: UsageAutoRefreshOptions = {},
): Promise<unknown> | null {
  const now = options.now?.() ?? Date.now()
  const lastStartedAt = lastAutoRefreshAt[source]
  if (autoRefreshInFlight[source]) return null
  if (lastStartedAt !== undefined && now - lastStartedAt < USAGE_AUTO_REFRESH_COOLDOWN_MS) return null

  lastAutoRefreshAt[source] = now
  const refreshPromise = refresh().finally(() => {
    if (autoRefreshInFlight[source] === refreshPromise) {
      delete autoRefreshInFlight[source]
    }
  })
  autoRefreshInFlight[source] = refreshPromise
  return refreshPromise
}

export function useUsageAutoRefresh(source: UsageAutoRefreshSource, refresh: UsageRefreshRunner): void {
  useEffect(() => {
    void runUsageAutoRefreshOnce(source, refresh)?.catch(() => undefined)
  }, [source, refresh])
}

export function resetUsageAutoRefreshStateForTests(): void {
  delete lastAutoRefreshAt.cc
  delete lastAutoRefreshAt.codex
  delete autoRefreshInFlight.cc
  delete autoRefreshInFlight.codex
}
