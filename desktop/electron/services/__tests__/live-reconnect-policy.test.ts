import { describe, expect, it } from "vitest"
import { createLiveReconnectDelay } from "../live-reconnect-policy"

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
