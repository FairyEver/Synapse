import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Must mock the module before importing
vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: vi.fn(),
}))

import { installHeartbeatResponder } from "../heartbeat-responder"
import { getSynapseBridge } from "@/lib/electron-bridge"

const mockGetBridge = vi.mocked(getSynapseBridge)

describe("installHeartbeatResponder", () => {
  let pingListener: (() => void) | null = null
  let pongFn: ReturnType<typeof vi.fn>
  let unsubFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    pingListener = null
    pongFn = vi.fn()
    unsubFn = vi.fn()
    mockGetBridge.mockReturnValue({
      diagnostics: {
        onPing: (listener: () => void) => {
          pingListener = listener
          return unsubFn
        },
        pong: pongFn,
      },
    } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("responds to ping with pong", () => {
    installHeartbeatResponder()
    expect(pingListener).not.toBeNull()
    pingListener!()
    expect(pongFn).toHaveBeenCalledTimes(1)
  })

  it("unsubscribes on cleanup", () => {
    const cleanup = installHeartbeatResponder()
    cleanup()
    expect(unsubFn).toHaveBeenCalledTimes(1)
  })

  it("returns no-op cleanup when bridge is unavailable", () => {
    mockGetBridge.mockReturnValue(undefined)
    const cleanup = installHeartbeatResponder()
    expect(() => cleanup()).not.toThrow()
  })
})
