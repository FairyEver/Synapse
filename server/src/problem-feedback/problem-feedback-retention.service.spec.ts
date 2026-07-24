import { describe, expect, it, vi } from "vitest"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"
import {
  PROBLEM_FEEDBACK_RETENTION_BATCH_SIZE,
  PROBLEM_FEEDBACK_RETENTION_DAYS,
} from "./problem-feedback.constants"
import {
  ProblemFeedbackRetentionService,
  type ProblemFeedbackRetentionClient,
} from "./problem-feedback-retention.service"

describe("ProblemFeedbackRetentionService", () => {
  it("uses one advisory lock and deletes expired rows in bounded batches", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1000 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const client = createClient(query)
    const diagnostics = new ProblemFeedbackDiagnostics()
    const service = new ProblemFeedbackRetentionService(
      diagnostics,
      () => client,
    )

    await service.runCleanup()

    const deleteCalls = query.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM \"ProblemFeedback\""))
    expect(deleteCalls).toHaveLength(2)
    expect(deleteCalls[0]?.[1]).toEqual([
      PROBLEM_FEEDBACK_RETENTION_BATCH_SIZE,
      PROBLEM_FEEDBACK_RETENTION_DAYS,
    ])
    expect(String(deleteCalls[0]?.[0])).toContain(
      "\"receivedAt\" <= CURRENT_TIMESTAMP - make_interval(days => $2)",
    )
    expect(diagnostics.snapshot().retention_deleted).toBe(1002)
    expect(client.end).toHaveBeenCalledOnce()
  })

  it("rolls back a failed batch and waits for a future scheduled run", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const diagnostics = new ProblemFeedbackDiagnostics()
    const service = new ProblemFeedbackRetentionService(
      diagnostics,
      () => createClient(query),
    )

    await service.runCleanup()

    expect(query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK")
    expect(diagnostics.snapshot().retention_failed).toBe(1)
    expect(diagnostics.snapshot().retention_deleted).toBe(0)
  })

  it("does no deletion when another instance holds the lock", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ acquired: false }], rowCount: 1 })
    const client = createClient(query)
    const service = new ProblemFeedbackRetentionService(
      new ProblemFeedbackDiagnostics(),
      () => client,
    )

    await service.runCleanup()

    expect(query).toHaveBeenCalledTimes(1)
    expect(client.end).toHaveBeenCalledOnce()
  })
})

function createClient(query: ReturnType<typeof vi.fn>) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    query,
    end: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProblemFeedbackRetentionClient & {
    readonly end: ReturnType<typeof vi.fn>
  }
}
