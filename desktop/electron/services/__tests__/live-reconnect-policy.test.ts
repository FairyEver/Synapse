import { describe, expect, it } from "vitest"
import { createLiveReconnectDelay, isStableLiveConnection } from "../live-reconnect-policy"

describe("createLiveReconnectDelay", () => {
  it("starts near two seconds", () => {
    const delay = createLiveReconnectDelay({ attempt: 0, random: () => 0 })

    expect(delay).toBe(2_000)
  })

  it("caps reconnect delay and adds deterministic jitter", () => {
    const delay = createLiveReconnectDelay({ attempt: 20, random: () => 1 })

    expect(delay).toBe(156_000)
  })
})

describe("isStableLiveConnection", () => {
  it("does not count a connection that closed as soon as it was welcomed", () => {
    expect(isStableLiveConnection(0)).toBe(false)
    expect(isStableLiveConnection(1_000)).toBe(false)
  })

  it("counts a connection that stayed up", () => {
    expect(isStableLiveConnection(5 * 60_000)).toBe(true)
  })
})
