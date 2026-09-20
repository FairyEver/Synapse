import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTerminalAtlasRepairScheduler } from "../terminal-atlas-repair"

const QUIET_MS = 1_000
const MIN_INTERVAL_MS = 10_000

/**
 * 假定时器同时驱动调度时间和假时钟，避免断言依赖 vitest 是否连 Date 一起伪造。
 */
function createClock() {
  let current = 0
  return {
    now: () => current,
    advance(ms: number) {
      current += ms
      vi.advanceTimersByTime(ms)
    },
  }
}

function createScheduler(clock: ReturnType<typeof createClock>) {
  return createTerminalAtlasRepairScheduler({
    quietMs: QUIET_MS,
    minIntervalMs: MIN_INTERVAL_MS,
    now: clock.now,
  })
}

describe("terminal glyph atlas repair", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("rebuilds every registered terminal once the atlas has been quiet", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)
    const first = vi.fn()
    const second = vi.fn()
    scheduler.register(first)
    scheduler.register(second)

    scheduler.notifyRestructured()
    clock.advance(QUIET_MS - 1)
    expect(first).not.toHaveBeenCalled()

    clock.advance(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it("coalesces a burst of merges into a single rebuild", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)
    const repair = vi.fn()
    scheduler.register(repair)

    scheduler.notifyRestructured()
    clock.advance(400)
    scheduler.notifyRestructured()
    clock.advance(400)
    scheduler.notifyRestructured()
    clock.advance(QUIET_MS - 1)
    expect(repair).not.toHaveBeenCalled()

    clock.advance(1)
    expect(repair).toHaveBeenCalledTimes(1)
  })

  it("holds the next rebuild back until the minimum interval has passed", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)
    const repair = vi.fn()
    scheduler.register(repair)

    scheduler.notifyRestructured()
    clock.advance(QUIET_MS)
    expect(repair).toHaveBeenCalledTimes(1)

    // 第二个安静期结束在 t=2000，那时距上次重建只过了 1000ms，重建要等间隔走完。
    scheduler.notifyRestructured()
    clock.advance(QUIET_MS)
    expect(repair).toHaveBeenCalledTimes(1)

    clock.advance(MIN_INTERVAL_MS - QUIET_MS - 1)
    expect(repair).toHaveBeenCalledTimes(1)

    clock.advance(1)
    expect(repair).toHaveBeenCalledTimes(2)
  })

  it("schedules nothing while no terminal is registered", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)

    scheduler.notifyRestructured()
    expect(vi.getTimerCount()).toBe(0)

    clock.advance(MIN_INTERVAL_MS * 2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("leaves out a terminal that unregistered before the rebuild", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)
    const closed = vi.fn()
    const open = vi.fn()
    const registration = scheduler.register(closed)
    scheduler.register(open)

    scheduler.notifyRestructured()
    registration.dispose()
    clock.advance(QUIET_MS)

    expect(closed).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it("cancels the pending rebuild when the last terminal goes away", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)
    const repair = vi.fn()
    const registration = scheduler.register(repair)

    scheduler.notifyRestructured()
    registration.dispose()
    expect(vi.getTimerCount()).toBe(0)

    clock.advance(QUIET_MS)
    expect(repair).not.toHaveBeenCalled()
  })

  it("stops rebuilding after the scheduler is disposed", () => {
    const clock = createClock()
    const scheduler = createScheduler(clock)
    const repair = vi.fn()
    scheduler.register(repair)

    scheduler.notifyRestructured()
    scheduler.dispose()
    clock.advance(QUIET_MS)

    expect(repair).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
