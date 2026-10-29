import { describe, expect, it, vi } from "vitest"

// Schema tests must not start the real services' asynchronous protocol imports.
vi.mock("../../../services/live-connection-service-instance", () => ({
  liveConnectionService: {
    getDeviceSettings: vi.fn(),
    setDeviceName: vi.fn(),
    getState: vi.fn(),
    retryNow: vi.fn(),
  },
}))

import { liveIpcModule } from "../ipc"

describe("liveIpcModule", () => {
  it("validates device names before writing settings", () => {
    const schema = liveIpcModule.methods.setDeviceName.request
    expect(schema.parse({ name: "  公司 Mac  " })).toEqual({ name: "公司 Mac" })
    for (const name of ["", "  ", "a".repeat(121), "bad\nname", "bad\u0000name"]) {
      expect(schema.safeParse({ name }).success).toBe(false)
    }
  })
  it("declares live invoke and event channels", () => {
    expect(liveIpcModule.id).toBe("live")
    expect(liveIpcModule.methods.getState.operationId).toBe("app.live.operation.get_state")
    expect(liveIpcModule.methods.retry.operationId).toBe("app.live.operation.retry")
    expect(liveIpcModule.events.stateChanged.operationId).toBe("app.live.state.changed")
  })

  it("validates state changed domain events", () => {
    const parsed = liveIpcModule.events.stateChanged.payload.parse({
      domain: "live",
      type: "live.stateChanged",
      payload: {
        state: {
          status: "connected",
          clientInstanceId: "client-a",
          connectedAt: "2026-06-06T10:00:00.000Z",
          lastSeenAt: "2026-06-06T10:00:01.000Z",
          lastError: null,
        },
      },
      timestamp: "2026-06-06T10:00:01.000Z",
    })

    expect(parsed).toMatchObject({
      payload: {
        state: {
          status: "connected",
          clientInstanceId: "client-a",
        },
      },
    })
  })
})
