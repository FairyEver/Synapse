import { describe, expect, it } from "vitest"
import {
  IPC_MINIMUM_CLIENT_VERSION,
  IPC_PROTOCOL_VERSION,
  computeHandshakeResponse,
  createInMemoryHarness,
  systemIpcModule,
} from "../index"

describe("IPC handshake (T3.11)", () => {
  it("compatible client → ok=true with server version", () => {
    const response = computeHandshakeResponse({ clientVersion: IPC_PROTOCOL_VERSION })
    expect(response.ok).toBe(true)
    expect(response.serverVersion).toBe(IPC_PROTOCOL_VERSION)
  })

  it("client below minimum → ok=false with minimumClientVersion", () => {
    const response = computeHandshakeResponse({
      clientVersion: IPC_MINIMUM_CLIENT_VERSION - 1,
    })
    expect(response.ok).toBe(false)
    if (response.ok === false) {
      expect(response.serverVersion).toBe(IPC_PROTOCOL_VERSION)
      expect(response.minimumClientVersion).toBe(IPC_MINIMUM_CLIENT_VERSION)
    }
  })

  it("future client (clientVersion > server) is still treated as ok", () => {
    const response = computeHandshakeResponse({
      clientVersion: IPC_PROTOCOL_VERSION + 5,
    })
    expect(response.ok).toBe(true)
  })

  it("systemIpcModule registers cleanly with the IpcRegistry runtime", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(systemIpcModule, {
      moduleId: "system",
      resolve: () => {
        throw new Error("unused")
      },
    })
    const reply = await harness.invoke("synapse:system:handshake", {
      clientVersion: IPC_PROTOCOL_VERSION,
    })
    expect(reply).toEqual({ ok: true, serverVersion: IPC_PROTOCOL_VERSION })
  })

  it("systemIpcModule rejects malformed handshake payloads", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(systemIpcModule, {
      moduleId: "system",
      resolve: () => {
        throw new Error("unused")
      },
    })
    await expect(
      harness.invoke("synapse:system:handshake", { clientVersion: "not a number" }),
    ).rejects.toMatchObject({ code: "ipc/validation" })
  })
})
