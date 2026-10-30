/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDealAnimation } from "../hooks/useDealAnimation"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
function Cards({
  count,
  hand = "h",
  replay = 0,
}: {
  count: number
  hand?: string
  replay?: number
}) {
  return <output>{useDealAnimation(hand, count, replay)}</output>
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe("发牌观看连续性", () => {
  it("同一手新增公共牌时保留已展示的牌，只逐张加入新牌", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () => root.render(<Cards count={2} />))
    await act(async () => vi.advanceTimersByTime(110))
    expect(host.textContent).toBe("2")
    await act(async () => root.render(<Cards count={5} />))
    expect(host.textContent).toBe("2")
    await act(async () => vi.advanceTimersByTime(55))
    expect(host.textContent).toBe("3")
    await act(async () => vi.advanceTimersByTime(110))
    expect(host.textContent).toBe("5")
    await act(async () => root.render(<Cards count={5} replay={1} />))
    expect(host.textContent).toBe("0")
    await act(async () => vi.advanceTimersByTime(55))
    await act(async () => root.render(<Cards count={2} hand="next" />))
    expect(host.textContent).toBe("0")
    await act(async () => root.unmount())
  })
  it("减弱动态效果下直接呈现所有牌，不等待发牌间隔", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("matchMedia", () => ({ matches: true }))
    const host = document.createElement("div"),
      root = createRoot(host)
    await act(async () => root.render(<Cards count={5} />))
    expect(host.textContent).toBe("5")
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => root.unmount())
  })
})
