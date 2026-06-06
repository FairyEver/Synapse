import { Test } from "@nestjs/testing"
import { describe, expect, it, vi } from "vitest"
import { LiveClientRegistry } from "./live-client-registry"

describe("LiveClientRegistry", () => {
  it("can be constructed as a normal Nest provider", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LiveClientRegistry],
    }).compile()

    expect(moduleRef.get(LiveClientRegistry)).toBeInstanceOf(LiveClientRegistry)
  })

  it("allows one user to keep multiple client instances online", () => {
    const registry = new LiveClientRegistry()
    const now = new Date("2026-06-06T10:00:00.000Z")

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now,
    })
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-b",
      connectionId: "conn-b",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now,
    })

    expect(registry.listByUser("user-1").map((client) => client.clientInstanceId).sort()).toEqual([
      "client-a",
      "client-b",
    ])
    expect(registry.listByUser("user-1").every((client) => client.status === "online")).toBe(true)
  })

  it("supersedes the old connection for the same client instance", () => {
    const registry = new LiveClientRegistry()
    const onSupersede = vi.fn()

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-old",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
      onSupersede,
    })
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-new",
      appVersion: "0.2.254",
      platform: "darwin-arm64",
      deviceName: "MacBook Pro",
      now: new Date("2026-06-06T10:01:00.000Z"),
      onSupersede,
    })

    expect(onSupersede).toHaveBeenCalledWith("conn-old")
    expect(registry.listByUser("user-1")).toMatchObject([
      {
        clientInstanceId: "client-a",
        connectionId: "conn-new",
        appVersion: "0.2.254",
        deviceName: "MacBook Pro",
        status: "online",
      },
    ])
  })

  it("marks clients stale and offline by heartbeat age", () => {
    const registry = LiveClientRegistry.withOptions({
      heartbeatTimeoutMs: 30_000,
      staleGraceMs: 30_000,
    })

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })

    const staleClients = registry.markStaleClients(new Date("2026-06-06T10:00:31.000Z"))
    expect(registry.listByUser("user-1")[0]?.status).toBe("stale")
    expect(staleClients).toEqual([
      expect.objectContaining({
        clientInstanceId: "client-a",
        status: "stale",
      }),
    ])

    const offlineClients = registry.markStaleClients(new Date("2026-06-06T10:01:02.000Z"))
    expect(registry.listByUser("user-1")[0]).toMatchObject({
      status: "offline",
      connectionId: null,
      disconnectReason: "heartbeat_timeout",
    })
    expect(offlineClients).toEqual([
      expect.objectContaining({
        clientInstanceId: "client-a",
        status: "offline",
        disconnectReason: "heartbeat_timeout",
      }),
    ])
  })

  it("marks a specific connection offline on close", () => {
    const registry = new LiveClientRegistry()
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })

    registry.markDisconnected({
      connectionId: "conn-a",
      now: new Date("2026-06-06T10:02:00.000Z"),
      reason: "socket_close",
    })

    expect(registry.listByUser("user-1")[0]).toMatchObject({
      status: "offline",
      connectionId: null,
      disconnectedAt: "2026-06-06T10:02:00.000Z",
      disconnectReason: "socket_close",
    })
  })
})
