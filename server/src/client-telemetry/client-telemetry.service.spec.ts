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

  it("stores server-derived browser information for Web events", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const service = new ClientTelemetryService({
      clientTelemetryEvent: { createMany },
    } as unknown as PrismaService)
    await service.ingest(null, [{
      eventId: "event-web",
      category: "navigation",
      eventKey: "web.drive.page.open",
      component: "drive-browser",
      action: "open",
      windowType: "web-drive",
      clientInstanceId: "client-web",
      sessionId: "session-web",
      appVersion: "web",
      platform: "web",
      occurredAt: "2026-09-01T00:00:00.000Z",
    }], {
      browserName: "chrome",
      browserVersion: "140.0.7339.81",
      osName: "windows-11",
      osVersion: "15.0.0",
    })

    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        browserName: "chrome",
        browserVersion: "140.0.7339.81",
        osName: "windows-11",
        osVersion: "15.0.0",
      })],
    }))
  })

  it("stores header-derived operating-system information for desktop events", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 })
    const service = new ClientTelemetryService({
      clientTelemetryEvent: { createMany },
    } as unknown as PrismaService)
    await service.ingest(null, [{
      eventId: "event-desktop",
      category: "navigation",
      eventKey: "app.page.open",
      component: "app-shell",
      action: "open",
      windowType: "main",
      clientInstanceId: "client-desktop",
      sessionId: "session-desktop",
      appVersion: "0.2.419",
      platform: "darwin-arm64",
      occurredAt: "2026-09-01T00:00:00.000Z",
    }], {}, {
      osName: "macos",
      osVersion: "15.6.1",
    })

    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ osName: "macos", osVersion: "15.6.1" })],
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
    for (let index = 0; index < 6; index += 1) {
      queryRaw.mockResolvedValueOnce([{ value: `value-${index}`, count: 2n }])
    }
    queryRaw.mockResolvedValueOnce([
      { bucket: "browserNames", value: "chrome", count: 3n },
      { bucket: "browserVersions", value: "chrome:140.0.7339.81", count: 2n },
      { bucket: "osNames", value: "windows-11", count: 3n },
      { bucket: "osVersions", value: "windows-11:15.0.0", count: 2n },
    ])
    for (let index = 6; index < 11; index += 1) {
      queryRaw.mockResolvedValueOnce([{ value: `value-${index}`, count: 2n }])
    }
    queryRaw.mockResolvedValueOnce([
      { bucket: "browserNames", value: "chrome", count: 3n },
      { bucket: "browserVersions", value: "140.0.7339.81", count: 2n },
      { bucket: "osNames", value: "windows-11", count: 3n },
      { bucket: "osVersions", value: "15.0.0", count: 2n },
    ])
    queryRaw.mockResolvedValueOnce([{ value: "value-11", count: 2n }])
    queryRaw
      .mockResolvedValueOnce([{ dau: 2n, wau: 4n, mau: 5n }])
      .mockResolvedValueOnce([{ averageDurationMs: 1_500.2, p95DurationMs: 4_200.8 }])
      .mockResolvedValueOnce([{ newIdentities: 2n, returningIdentities: 3n }])
      .mockResolvedValueOnce([{
        featureKey: "drive.upload",
        identities: 3n,
        sessions: 4n,
        events: 8n,
        successes: 3n,
        completed: 4n,
      }])
      .mockResolvedValueOnce([
        { funnelKey: "drive-upload", stageKey: "start", stageIndex: 1, identities: 4n },
        { funnelKey: "drive-upload", stageKey: "success", stageIndex: 2, identities: 3n },
      ])
      .mockResolvedValueOnce([{
        cohortDate: "2026-08-01",
        cohortSize: 4n,
        day1: 2n,
        day7: 1n,
        day30: 0n,
        day1Mature: true,
        day7Mature: true,
        day30Mature: false,
      }])
    const service = new ClientTelemetryService({
      $queryRaw: queryRaw,
    } as unknown as PrismaService)

    const result = await service.getStats({
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      timezoneOffsetMinutes: 480,
      identity: "all",
      browserName: "chrome",
      osName: "windows-11",
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
    expect(result.dimensions.browserNames).toEqual([{ value: "chrome", count: 3 }])
    expect(result.dimensions.browserVersions).toEqual([{ value: "chrome:140.0.7339.81", count: 2 }])
    expect(result.dimensions.osNames).toEqual([{ value: "windows-11", count: 3 }])
    expect(result.dimensions.osVersions).toEqual([{ value: "windows-11:15.0.0", count: 2 }])
    expect(result.filterOptions.modules).toEqual([{ value: "value-7", count: 2 }])
    expect(result.filterOptions.browserNames).toEqual([{ value: "chrome", count: 3 }])
    expect(result.filterOptions.browserVersions).toEqual([{ value: "140.0.7339.81", count: 2 }])
    expect(result.filterOptions.osVersions).toEqual([{ value: "15.0.0", count: 2 }])
    expect(result.insights).toEqual({
      active: { dau: 2, wau: 4, mau: 5, stickiness: 0.4 },
      sessions: { averageDurationMs: 1_500, p95DurationMs: 4_201 },
      identities: { new: 2, returning: 3 },
      adoption: [{
        featureKey: "drive.upload",
        identities: 3,
        sessions: 4,
        events: 8,
        successRate: 0.75,
      }],
      funnels: [{
        funnelKey: "drive-upload",
        stages: [
          { stageKey: "start", identities: 4, conversionFromStart: 1, conversionFromPrevious: 1 },
          { stageKey: "success", identities: 3, conversionFromStart: 0.75, conversionFromPrevious: 0.75 },
        ],
      }],
      retention: [{
        cohortDate: "2026-08-01",
        cohortSize: 4,
        day1Rate: 0.5,
        day7Rate: 0.25,
        day30Rate: null,
      }],
    })
    expect(result).not.toHaveProperty("rawEvents")
    const environmentQuery = queryRaw.mock.calls[8]?.[0] as { strings?: readonly string[] }
    const environmentSql = environmentQuery.strings?.join(" ") ?? ""
    expect(environmentSql).toContain("GROUPING SETS")
    expect(environmentSql).toContain('COUNT(DISTINCT "sessionId")')
    const activeQuery = queryRaw.mock.calls[16]?.[0] as { strings?: readonly string[] }
    expect(activeQuery.strings?.join(" ")).toContain('"occurredAt" >=')
    const funnelQuery = queryRaw.mock.calls[20]?.[0] as { strings?: readonly string[] }
    const funnelSql = funnelQuery.strings?.join(" ") ?? ""
    expect(funnelSql).toContain("generate_series")
    expect(funnelSql).toContain("git.repository.clone")
    expect(funnelSql).toContain("git.repository.push")
  })
})
