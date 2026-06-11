import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  resetUsageAutoRefreshStateForTests,
  runUsageAutoRefreshOnce,
  USAGE_AUTO_REFRESH_COOLDOWN_MS,
} from "../shared/auto-refresh"

describe("usage analysis auto refresh", () => {
  beforeEach(() => {
    resetUsageAutoRefreshStateForTests()
  })

  it("starts once for the same source within the cooldown window", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)

    await runUsageAutoRefreshOnce("cc", refresh, { now: () => 1_000 })
    await runUsageAutoRefreshOnce("cc", refresh, { now: () => 1_000 + USAGE_AUTO_REFRESH_COOLDOWN_MS - 1 })

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("allows a new automatic refresh after the cooldown window", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)

    await runUsageAutoRefreshOnce("codex", refresh, { now: () => 1_000 })
    await runUsageAutoRefreshOnce("codex", refresh, { now: () => 1_000 + USAGE_AUTO_REFRESH_COOLDOWN_MS })

    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it("does not start duplicate refreshes while one is already running", async () => {
    let finishRefresh: (() => void) | undefined
    const refresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve
    }))

    const first = runUsageAutoRefreshOnce("cc", refresh, { now: () => 1_000 })
    const second = runUsageAutoRefreshOnce("cc", refresh, { now: () => 1_001 })

    finishRefresh?.()
    await Promise.all([first, second])

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
