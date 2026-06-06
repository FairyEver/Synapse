import { firstValueFrom, take, toArray } from "rxjs"
import { describe, expect, it } from "vitest"
import { LiveStreamService } from "./live-stream.service"

describe("LiveStreamService", () => {
  it("streams every event to admins", async () => {
    const service = new LiveStreamService()
    const events = firstValueFrom(service.adminEvents().pipe(take(1), toArray()))

    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:00.000Z",
      client: {
        userId: "user-1",
        clientInstanceId: "client-a",
        status: "online",
        appVersion: "0.2.253",
        platform: "darwin-arm64",
        deviceName: "MacBook",
        connectedAt: "2026-06-06T10:00:00.000Z",
        lastSeenAt: "2026-06-06T10:00:00.000Z",
      },
    })

    await expect(events).resolves.toHaveLength(1)
  })

  it("does not leak internal client fields to admins", async () => {
    const service = new LiveStreamService()
    const events = firstValueFrom(service.adminEvents().pipe(take(1), toArray()))
    const client = {
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      status: "online" as const,
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      connectedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:00:00.000Z",
    }

    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:00.000Z",
      client,
    })

    const receivedEvents = await events

    expect(receivedEvents[0]?.client).toHaveProperty("userId", "user-1")
    expect(receivedEvents[0]?.client).not.toHaveProperty("connectionId")
  })

  it("streams only matching user events to normal users", async () => {
    const service = new LiveStreamService()
    const events = firstValueFrom(service.userEvents("user-1").pipe(take(1), toArray()))

    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:00.000Z",
      client: {
        userId: "user-2",
        clientInstanceId: "client-b",
        status: "online",
        appVersion: "0.2.253",
        platform: "win32-x64",
        deviceName: "Workstation",
        connectedAt: "2026-06-06T10:00:00.000Z",
        lastSeenAt: "2026-06-06T10:00:00.000Z",
      },
    })
    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:01.000Z",
      client: {
        userId: "user-1",
        clientInstanceId: "client-a",
        status: "online",
        appVersion: "0.2.253",
        platform: "darwin-arm64",
        deviceName: "MacBook",
        connectedAt: "2026-06-06T10:00:01.000Z",
        lastSeenAt: "2026-06-06T10:00:01.000Z",
      },
    })

    const receivedEvents = await events

    expect(receivedEvents).toEqual([
      expect.objectContaining({
        client: expect.objectContaining({ clientInstanceId: "client-a" }),
      }),
    ])
    expect(receivedEvents[0]?.client).not.toHaveProperty("userId")
  })

  it("does not leak internal client fields to normal users", async () => {
    const service = new LiveStreamService()
    const events = firstValueFrom(service.userEvents("user-1").pipe(take(1), toArray()))
    const client = {
      userId: "user-1",
      clientInstanceId: "client-a",
      connectionId: "conn-a",
      status: "online" as const,
      appVersion: "0.2.253",
      platform: "darwin-arm64",
      deviceName: "MacBook",
      connectedAt: "2026-06-06T10:00:00.000Z",
      lastSeenAt: "2026-06-06T10:00:00.000Z",
    }

    service.publish({
      type: "live.client.changed",
      occurredAt: "2026-06-06T10:00:00.000Z",
      client,
    })

    const receivedEvents = await events

    expect(receivedEvents[0]?.client).not.toHaveProperty("connectionId")
    expect(receivedEvents[0]?.client).not.toHaveProperty("userId")
  })
})
