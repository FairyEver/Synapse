import { Logger } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import { measureAnnotationStage, recordAnnotationMetrics, traceAnnotationOperation } from "./drive-annotation-diagnostics"

describe("Drive annotation diagnostics", () => {
  afterEach(() => vi.restoreAllMocks())

  it("summarizes parallel stages without logging their inputs or results", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined)
    const secret = { body: "private comment", cookie: "private cookie", sourceText: "private document" }
    const result = await traceAnnotationOperation("share.list", async () => {
      recordAnnotationMetrics({ threadCount: 2 })
      await Promise.all([1, 2].map(() => measureAnnotationStage("anchor.persist", async () => secret)))
      return secret
    })
    expect(result).toBe(secret)
    expect(log).toHaveBeenCalledTimes(1)
    const entry = log.mock.calls[0]![0]
    expect(entry).toMatchObject({
      event: "drive.annotation.performance", operation: "share.list", outcome: "success",
      durationMs: expect.any(Number), metrics: { threadCount: 2 },
      stages: { "anchor.persist": { calls: 2, failures: 0, totalWorkMs: expect.any(Number), maxMs: expect.any(Number) } },
    })
    expect(JSON.stringify(entry)).not.toMatch(/private|sourceText|cookie|body/)
  })

  it("records the failed stage and rethrows the original error without logging its message", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined)
    const failure = new Error("private database credentials")
    await expect(traceAnnotationOperation("share.create", () =>
      measureAnnotationStage("write.transaction", async () => { throw failure }),
    )).rejects.toBe(failure)
    expect(log.mock.calls[0]![0]).toMatchObject({
      outcome: "failure", stages: { "write.transaction": { calls: 1, failures: 1 } },
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message)
  })

  it("keeps concurrent operations separate and leaves untraced calls silent", async () => {
    const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined)
    await Promise.all([1, 2].map((threadCount) => traceAnnotationOperation("share.list", async () => {
      await Promise.resolve()
      recordAnnotationMetrics({ threadCount })
      await measureAnnotationStage("threads.read", async () => threadCount)
    })))
    const entries = log.mock.calls.map(([entry]) => entry as { traceId: string; metrics: { threadCount: number } })
    expect(new Set(entries.map((entry) => entry.traceId)).size).toBe(2)
    expect(entries.map((entry) => entry.metrics.threadCount).sort()).toEqual([1, 2])
    expect(await measureAnnotationStage("threads.read", async () => 3)).toBe(3)
    expect(log).toHaveBeenCalledTimes(2)
  })
})
