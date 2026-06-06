import { firstValueFrom, of } from "rxjs"
import { describe, expect, it, vi } from "vitest"
import { LiveController } from "./live.controller"
import type { LiveQueryService } from "./live-query.service"
import type { LiveStreamService } from "./live-stream.service"
import type { LiveClientChangedEvent } from "./live.types"

function createController(query: Partial<LiveQueryService> = {}, stream: Partial<LiveStreamService> = {}) {
  return new LiveController(query as LiveQueryService, stream as LiveStreamService)
}

function createEvent(userId = "user-1"): LiveClientChangedEvent {
  return {
    type: "live.client.changed",
    occurredAt: "2026-06-06T10:00:00.000Z",
    client: {
      userId,
      clientInstanceId: "client-a",
      status: "online",
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      connectedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:00:00.000Z",
    },
  }
}

describe("LiveController", () => {
  it("returns all live clients for admins", () => {
    const listAdminClients = vi.fn().mockReturnValue([{ userId: "user-1", clientInstanceId: "client-a" }])
    const controller = createController({ listAdminClients })

    expect(controller.listAdminClients()).toEqual([{ userId: "user-1", clientInstanceId: "client-a" }])
    expect(listAdminClients).toHaveBeenCalledWith()
  })

  it("returns one user's live clients for admins", () => {
    const listAdminUserClients = vi.fn().mockReturnValue([{ userId: "user-1", clientInstanceId: "client-a" }])
    const controller = createController({ listAdminUserClients })

    expect(controller.listAdminUserClients("user-1")).toEqual([{ userId: "user-1", clientInstanceId: "client-a" }])
    expect(listAdminUserClients).toHaveBeenCalledWith("user-1")
  })

  it("returns only current user's live clients for dashboard users", () => {
    const listUserClients = vi.fn().mockReturnValue([{ clientInstanceId: "client-a" }])
    const controller = createController({ listUserClients })

    expect(controller.listDashboardClients({ user: { id: "user-1" } } as never)).toEqual([
      { clientInstanceId: "client-a" },
    ])
    expect(listUserClients).toHaveBeenCalledWith("user-1")
  })

  it("maps admin stream events to SSE messages", async () => {
    const event = createEvent()
    const adminEvents = vi.fn().mockReturnValue(of(event))
    const controller = createController({}, { adminEvents })

    await expect(firstValueFrom(controller.adminStream({} as never))).resolves.toEqual({
      type: "live.client.changed",
      data: event,
    })
    expect(adminEvents).toHaveBeenCalledWith()
  })

  it("maps dashboard stream events for the current user to SSE messages", async () => {
    const event = createEvent()
    const userEvents = vi.fn().mockReturnValue(of(event))
    const controller = createController({}, { userEvents })

    await expect(
      firstValueFrom(controller.dashboardStream({ user: { id: "user-1" } } as never)),
    ).resolves.toEqual({
      type: "live.client.changed",
      data: event,
    })
    expect(userEvents).toHaveBeenCalledWith("user-1")
  })
})
