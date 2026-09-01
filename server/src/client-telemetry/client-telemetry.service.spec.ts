import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { ClientTelemetryService } from "./client-telemetry.service"

describe("ClientTelemetryService", () => {
  it("adds the server-derived user and keeps retries idempotent", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const service = new ClientTelemetryService({
      clientTelemetryEvent: { createMany },
    } as unknown as PrismaService)
    const result = await service.ingest("user-1", [{
      eventId: "event-1",
      category: "operation",
      eventKey: "workflow.run",
      component: "async-operation",
      action: "complete",
      outcome: "success",
      durationMs: 120,
      windowType: "main",
      clientInstanceId: "client-1",
      sessionId: "session-1",
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      occurredAt: "2026-09-01T00:00:00.000Z",
    }])

    expect(result).toEqual({ accepted: 1, duplicates: 0 })
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({ userId: "user-1", eventId: "event-1" })],
    }))
  })

  it("returns only aggregate metrics and distributions", async () => {
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([{
        events: 12n,
        authenticatedUsers: 2n,
        anonymousClients: 3n,
        sessions: 5n,
        failures: 1n,
        completedOperations: 4n,
        p95DurationMs: 245.4,
      }])
      .mockResolvedValueOnce([{
        date: "2026-09-01",
        events: 12n,
        authenticatedEvents: 8n,
        anonymousEvents: 4n,
        activeUsers: 2n,
        anonymousClients: 3n,
        sessions: 5n,
        failures: 1n,
      }])
    for (let index = 0; index < 12; index += 1) {
      queryRaw.mockResolvedValueOnce([{ value: `value-${index}`, count: 2n }])
    }
    const service = new ClientTelemetryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService)

    const result = await service.getStats({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      timezoneOffsetMinutes: 480,
      identity: "all",
    })

    expect(result.summary).toEqual({
      events: 12,
      authenticatedUsers: 2,
      anonymousClients: 3,
      sessions: 5,
      failures: 1,
      failureRate: 0.25,
      p95DurationMs: 245,
    })
    expect(result.trend).toEqual([expect.objectContaining({ date: "2026-09-01", events: 12 })])
    expect(result.filterOptions.modules).toEqual([{ value: "value-7", count: 2 }])
    expect(result).not.toHaveProperty("rawEvents")
  })
})
