import { Test } from "@nestjs/testing"
import { describe, expect, it, vi } from "vitest"
import { LiveClientRegistry } from "./live-client-registry"

/**
 * White-box probe for the `connectionId -> key` secondary index. Returns its size so
 * tests can assert that no stale entry survives a disconnect, a supersede or an expiry.
 */
function connectionIndexSize(registry: LiveClientRegistry): number {
  const index: unknown = Reflect.get(registry, "connectionKeys")

  if (!(index instanceof Map)) {
    throw new Error("LiveClientRegistry no longer exposes a connectionKeys index")
  }

  return index.size
}

describe("LiveClientRegistry", () => {
  it("retains the private machine binding across heartbeat updates", () => {
    const registry = new LiveClientRegistry()
    const client = registry.register({
      userId: "user-1", clientInstanceId: "client-a", connectionId: "conn-a",
      appVersion: "1", platform: "win32-x64", deviceName: "电脑",
      machineFingerprint: "a".repeat(64), now: new Date("2026-09-22T00:00:00.000Z"),
    })
    expect(client.machineFingerprint).toBe("a".repeat(64))
    expect(registry.touch("conn-a", new Date("2026-09-22T00:00:01.000Z"))?.machineFingerprint).toBe("a".repeat(64))
  })
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

  it("lists online clients for one user with active connections", () => {
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
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-c",
      connectionId: "conn-c",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now,
    })
    registry.markDisconnected({
      connectionId: "conn-b",
      now: new Date("2026-06-06T10:00:05.000Z"),
      reason: "socket_close",
    })

    expect(registry.listOnlineByUser("user-1")).toEqual([
      expect.objectContaining({
        clientInstanceId: "client-a",
        connectionId: "conn-a",
        status: "online",
      }),
    ])
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

  it("prunes offline clients after the retention window", () => {
    const registry = LiveClientRegistry.withOptions({ offlineRetentionMs: 60_000 })
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

    registry.markStaleClients(new Date("2026-06-06T10:02:59.000Z"))
    expect(registry.listByUser("user-1")).toHaveLength(1)

    registry.markStaleClients(new Date("2026-06-06T10:03:01.000Z"))
    expect(registry.listByUser("user-1")).toEqual([])
  })

  it("returns each user's clients in `${userId}:${clientInstanceId}` ascending order", () => {
    const registry = new LiveClientRegistry()
    const now = new Date("2026-06-06T10:00:00.000Z")

    // Registered deliberately out of order, and interleaved across two users.
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-z",
      connectionId: "conn-1",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now,
    })
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-m",
      connectionId: "conn-2",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now,
    })
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-3",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now,
    })
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-m",
      connectionId: "conn-4",
      appVersion: "0.2.253",
      platform: "linux-x64",
      deviceName: "Server",
      now,
    })
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-a",
      connectionId: "conn-5",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook Air",
      now,
    })

    expect(registry.listByUser("user-1").map((client) => client.clientInstanceId)).toEqual([
      "client-a",
      "client-m",
      "client-z",
    ])
    expect(registry.listByUser("user-2").map((client) => client.clientInstanceId)).toEqual([
      "client-a",
      "client-m",
    ])
    expect(registry.listByUser("user-3")).toEqual([])
  })

  it("resolves connection ids through the secondary index across register, touch and disconnect", () => {
    const registry = new LiveClientRegistry()
    const onSupersede = vi.fn()
    const t0 = new Date("2026-06-06T10:00:00.000Z")

    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      now: t0,
      onSupersede,
    })

    expect(connectionIndexSize(registry)).toBe(1)
    expect(registry.touch("conn-a", t0)?.clientInstanceId).toBe("client-a")
    expect(registry.touch("conn-missing", t0)).toBeUndefined()

    // Supersede: the previous connection id has to stop resolving.
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-b",
      appVersion: "0.2.254",
      platform: "darwin-arm64",
      deviceName: "MacBook Pro",
      now: new Date("2026-06-06T10:01:00.000Z"),
      onSupersede,
    })

    expect(onSupersede).toHaveBeenCalledWith("conn-a")
    expect(registry.touch("conn-b", t0)?.connectionId).toBe("conn-b")
    expect(registry.touch("conn-a", t0)).toBeUndefined()
    expect(connectionIndexSize(registry)).toBe(1)

    // Disconnect: the connection id is dropped together with the live connection.
    expect(
      registry.markDisconnected({
        connectionId: "conn-b",
        now: new Date("2026-06-06T10:02:00.000Z"),
        reason: "socket_close",
      })?.clientInstanceId,
    ).toBe("client-a")
    expect(registry.touch("conn-b", t0)).toBeUndefined()
    expect(connectionIndexSize(registry)).toBe(0)

    // Reconnect after a disconnect resolves again.
    registry.register({
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-c",
      appVersion: "0.2.254",
      platform: "darwin-arm64",
      deviceName: "MacBook Pro",
      now: new Date("2026-06-06T10:03:00.000Z"),
    })

    expect(registry.touch("conn-c", t0)?.connectionId).toBe("conn-c")
    expect(registry.touch("conn-b", t0)).toBeUndefined()
    expect(registry.touch("conn-a", t0)).toBeUndefined()
    expect(connectionIndexSize(registry)).toBe(1)
  })

  it("drops index entries when clients expire and stays correct when a connection id is reused", () => {
    const registry = LiveClientRegistry.withOptions({ offlineRetentionMs: 60_000 })
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
    registry.markDisconnected({
      connectionId: "conn-a",
      now: new Date("2026-06-06T10:02:00.000Z"),
      reason: "socket_close",
    })

    expect(connectionIndexSize(registry)).toBe(0)

    registry.markStaleClients(new Date("2026-06-06T10:02:59.000Z"))
    expect(registry.listByUser("user-1")).toHaveLength(1)

    registry.markStaleClients(new Date("2026-06-06T10:03:01.000Z"))
    expect(registry.listByUser("user-1")).toEqual([])
    expect(connectionIndexSize(registry)).toBe(0)
    expect(registry.touch("conn-a", new Date("2026-06-06T10:03:02.000Z"))).toBeUndefined()

    // The same connection id can be reused by a different client after the expiry.
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-b",
      connectionId: "conn-a",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now: new Date("2026-06-06T10:03:02.000Z"),
    })

    expect(connectionIndexSize(registry)).toBe(1)
    expect(registry.touch("conn-a", new Date("2026-06-06T10:03:03.000Z"))?.clientInstanceId).toBe("client-b")
    expect(
      registry.markDisconnected({
        connectionId: "conn-a",
        now: new Date("2026-06-06T10:03:04.000Z"),
        reason: "socket_close",
      })?.userId,
    ).toBe("user-2")
  })
})
