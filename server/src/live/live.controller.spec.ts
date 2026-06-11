import { firstValueFrom, of } from "rxjs"
import { describe, expect, it, vi } from "vitest"
import { PATH_METADATA } from "@nestjs/common/constants"
import { LiveController } from "./live.controller"
import type { LiveDeviceService } from "./live-device.service"
import type { LiveQueryService } from "./live-query.service"
import type { LiveStreamService } from "./live-stream.service"
import type { LiveClientChangedEvent } from "./live.types"

function createController(
  query: Partial<LiveQueryService> = {},
  stream: Partial<LiveStreamService> = {},
  devices: Partial<LiveDeviceService> = {},
) {
  const ControllerCtor = LiveController as new (
    query: LiveQueryService,
    stream: LiveStreamService,
    devices: LiveDeviceService,
  ) => LiveController
  return new ControllerCtor(
    query as LiveQueryService,
    stream as LiveStreamService,
    devices as LiveDeviceService,
  )
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
  it("mounts canonical console routes with legacy dashboard aliases", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LiveController.prototype.listDashboardClients)).toEqual([
      "/api/console/live-clients",
      "/api/dashboard/live-clients",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, LiveController.prototype.listDashboardDevices)).toEqual([
      "/api/console/devices",
      "/api/dashboard/devices",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, LiveController.prototype.renameDashboardDevice)).toEqual([
      "/api/console/devices/:clientInstanceId",
      "/api/dashboard/devices/:clientInstanceId",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, LiveController.prototype.dashboardStream)).toBe("/api/console/live/stream")
    expect(Reflect.getMetadata(PATH_METADATA, LiveController.prototype.legacyDashboardStream)).toBe("/api/dashboard/live/stream")
  })

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

  it("returns only current user's devices for dashboard users", async () => {
    const listUserDevices = vi.fn().mockResolvedValue([{ clientInstanceId: "client-a", displayName: "工作电脑" }])
    const controller = createController({}, {}, { listUserDevices })

    await expect(controller.listDashboardDevices({ user: { id: "user-1" } } as never)).resolves.toEqual([
      { clientInstanceId: "client-a", displayName: "工作电脑" },
    ])
    expect(listUserDevices).toHaveBeenCalledWith("user-1")
  })

  it("renames only the current user's device", async () => {
    const renameUserDevice = vi.fn().mockResolvedValue({ clientInstanceId: "client-a", displayName: "Studio Mac" })
    const controller = createController({}, {}, { renameUserDevice })

    await expect(
      controller.renameDashboardDevice(
        "client-a",
        { displayName: " Studio Mac " },
        { user: { id: "user-1" } } as never,
      ),
    ).resolves.toEqual({ clientInstanceId: "client-a", displayName: "Studio Mac" })
    expect(renameUserDevice).toHaveBeenCalledWith("user-1", "client-a", "Studio Mac")
  })

  it("rejects invalid dashboard device rename payloads", () => {
    const renameUserDevice = vi.fn()
    const controller = createController({}, {}, { renameUserDevice })

    expect(() =>
      controller.renameDashboardDevice("client-a", { displayName: "" }, { user: { id: "user-1" } } as never),
    ).toThrow("设备名称无效")
    expect(renameUserDevice).not.toHaveBeenCalled()
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
