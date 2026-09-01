import { describe, expect, it, vi } from "vitest"
import type { PrismaService } from "../prisma/prisma.service"
import { ClientTelemetryRetentionService } from "./client-telemetry-retention.service"

describe("ClientTelemetryRetentionService", () => {
  it("deletes expired telemetry in bounded batches", async () => {
    const executeRaw = vi.fn()
      .mockResolvedValueOnce(10_000)
      .mockResolvedValueOnce(4)
    const service = new ClientTelemetryRetentionService({
      $executeRaw: executeRaw,
    } as unknown as PrismaService)

    await expect(service.deleteExpired()).resolves.toBe(10_004)
    expect(executeRaw).toHaveBeenCalledTimes(2)
  })
})
