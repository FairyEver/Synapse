import { describe, expect, it } from "vitest"
import { LiveClientRegistry } from "./live-client-registry"
import { LiveQueryService } from "./live-query.service"

describe("LiveQueryService", () => {
  it("returns admin client snapshots with user ids", () => {
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
    const service = new LiveQueryService(registry)

    expect(service.listAdminClients()).toEqual([
      expect.objectContaining({
        userId: "user-1",
        clientInstanceId: "client-a",
        status: "online",
      }),
    ])
  })

  it("returns admin user client snapshots for one user with user ids", () => {
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
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-b",
      connectionId: "conn-b",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })
    const service = new LiveQueryService(registry)

    expect(service.listAdminUserClients("user-1")).toEqual([
      expect.objectContaining({
        userId: "user-1",
        clientInstanceId: "client-a",
      }),
    ])
  })

  it("returns user snapshots without leaking other users", () => {
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
    registry.register({
      userId: "user-2",
      clientInstanceId: "client-b",
      connectionId: "conn-b",
      appVersion: "0.2.253",
      platform: "win32-x64",
      deviceName: "Workstation",
      now: new Date("2026-06-06T10:00:00.000Z"),
    })
    const service = new LiveQueryService(registry)

    expect(service.listUserClients("user-1")).toEqual([
      expect.not.objectContaining({ userId: "user-2" }),
    ])
    expect(service.listUserClients("user-1")[0]).not.toHaveProperty("userId")
  })
})
