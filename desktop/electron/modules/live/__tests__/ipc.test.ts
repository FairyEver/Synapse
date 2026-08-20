import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-live-${name}`),
    getAppPath: () => path.join(os.tmpdir(), "synapse-live-app"),
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}))

import { liveIpcModule } from "../ipc"

describe("liveIpcModule", () => {
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
