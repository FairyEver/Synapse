/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useAgentClock } from "../use-agent-clock"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
function Clock({ active }: { active: boolean }) { return <span>{useAgentClock(active)}</span> }

it("releases intervals after 300 mount/unmount cycles and stops ticking on completion", () => {
  vi.useFakeTimers()
  const root = createRoot(document.createElement("div"))
  try {
    for (let index = 0; index < 300; index += 1) {
      act(() => root.render(<Clock active />))
      expect(vi.getTimerCount()).toBe(1)
      act(() => root.render(<Clock active={false} />))
      expect(vi.getTimerCount()).toBe(0)
      act(() => root.render(<Clock active />))
      act(() => root.render(null))
      expect(vi.getTimerCount()).toBe(0)
    }
  } finally {
    act(() => root.unmount())
    vi.useRealTimers()
  }
})
