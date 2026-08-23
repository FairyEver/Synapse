import { describe, expect, it, vi } from "vitest"
import { OpenApiUsageLogService } from "./open-api-usage-log.service"

describe("OpenApiUsageLogService", () => {
  it("writes only the fixed request summary fields", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "usage-1",
      startedAt: new Date("2026-08-23T09:00:00.000Z"),
    })
    const service = new OpenApiUsageLogService(
      { openApiUsageLog: { create } } as never,
      { error: vi.fn(), warn: vi.fn() } as never,
    )

    await service.start({
      userId: "user-1",
      apiKeyId: "key-1",
      requestId: "req-1",
      operation: "grant_create",
      scope: "drive.share_link.download",
      ipAddress: "203.0.113.1",
    })

    const serialized = JSON.stringify(create.mock.calls[0]?.[0]?.data)
    expect(serialized).not.toContain("url")
    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("token")
    expect(serialized).not.toContain("fileName")
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        apiKeyId: "key-1",
        grantId: null,
        requestId: "req-1",
        operation: "grant_create",
        scope: "drive.share_link.download",
        status: "started",
        sourceType: null,
        artifactType: null,
        ipAddress: "203.0.113.1",
      },
      select: { id: true, startedAt: true },
    })
  })

  it("fails closed when the initial log cannot be written", async () => {
    const service = new OpenApiUsageLogService(
      { openApiUsageLog: { create: vi.fn().mockRejectedValue(new Error("db unavailable")) } } as never,
      { error: vi.fn(), warn: vi.fn() } as never,
    )

    await expect(service.start({
      userId: "user-1",
      apiKeyId: "key-1",
      requestId: "req-1",
      operation: "download",
      scope: "drive.share_link.download",
      ipAddress: "203.0.113.1",
    })).rejects.toMatchObject({ statusCode: 503, code: "USAGE_LOG_UNAVAILABLE" })
  })
})
