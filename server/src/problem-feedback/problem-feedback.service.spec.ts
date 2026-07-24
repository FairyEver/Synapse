import { Prisma } from "@prisma/client"
import { PROBLEM_FEEDBACK_POLICY_FIXTURES } from "@synapse/shared"
import { describe, expect, it, vi } from "vitest"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"
import { PROBLEM_FEEDBACK_RETENTION_DAYS } from "./problem-feedback.constants"
import { ProblemFeedbackService } from "./problem-feedback.service"

function createService(create: ReturnType<typeof vi.fn>) {
  const prisma = {
    problemFeedback: { create },
  }
  const auditLog = { recordWithClient: vi.fn() }
  const diagnostics = new ProblemFeedbackDiagnostics()
  return {
    service: new ProblemFeedbackService(prisma as never, auditLog as never, diagnostics),
    diagnostics,
  }
}

describe("problem feedback service", () => {
  it("reuses the shared synthetic corpus and preserves accepted content", async () => {
    const create = vi.fn().mockResolvedValue({ id: "unused" })
    const { service } = createService(create)

    for (const fixture of PROBLEM_FEEDBACK_POLICY_FIXTURES.valid) {
      await expect(service.submit(fixture.input)).resolves.toEqual({ outcome: "success" })
      expect(create).toHaveBeenLastCalledWith({
        data: { content: fixture.input.content },
        select: { id: true },
      })
    }
  })

  it("rejects shared privacy fixtures before persistence", async () => {
    const create = vi.fn()
    const { service } = createService(create)

    for (const fixture of PROBLEM_FEEDBACK_POLICY_FIXTURES.privacy) {
      await expect(service.submit({ content: fixture.rejected })).resolves.toMatchObject({
        outcome: "invalid",
        validation: {
          code: "PRIVACY_RISK",
          data: { category: fixture.category },
        },
      })
    }
    expect(create).not.toHaveBeenCalled()
  })

  it("returns determinate failure only for a provable pre-insert failure", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("pool unavailable", {
      code: "P2024",
      clientVersion: "test",
    })
    const { service } = createService(vi.fn().mockRejectedValue(error))

    await expect(service.submit(PROBLEM_FEEDBACK_POLICY_FIXTURES.valid[0].input))
      .resolves.toEqual({ outcome: "failed" })
  })

  it("keeps an ambiguous database failure unknown", async () => {
    const { service, diagnostics } = createService(
      vi.fn().mockRejectedValue(new Error("connection lost after COMMIT")),
    )

    await expect(service.submit(PROBLEM_FEEDBACK_POLICY_FIXTURES.valid[0].input))
      .resolves.toEqual({ outcome: "unknown" })
    expect(diagnostics.snapshot().persistence_failed).toBe(1)
  })

  it("reads, counts, and audits one admin page in the same transaction", async () => {
    const row = {
      id: "00112233-4455-4677-8899-aabbccddeeff",
      content: "synthetic",
      receivedAt: new Date("2026-01-02T03:04:05.000Z"),
    }
    const queryRaw = vi.fn()
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ total: 1 }])
    const transaction = { $queryRaw: queryRaw }
    const prisma = {
      problemFeedback: { create: vi.fn() },
      $transaction: vi.fn(async (operation) => operation(transaction)),
    }
    const auditLog = { recordWithClient: vi.fn().mockResolvedValue(undefined) }
    const service = new ProblemFeedbackService(
      prisma as never,
      auditLog as never,
      new ProblemFeedbackDiagnostics(),
    )

    await expect(service.listAdminPage({
      page: 2,
      adminEmail: "admin@example.invalid",
      ipAddress: "192.0.2.1",
    })).resolves.toEqual({
      data: [{
        id: row.id,
        content: row.content,
        receivedAt: "2026-01-02T03:04:05.000Z",
      }],
      total: 1,
      page: 2,
      pageSize: 10,
    })
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(transaction, {
      adminEmail: "admin@example.invalid",
      action: "admin.problem_feedback.list",
      targetType: "problem_feedback",
      targetId: "list",
      detail: { result: "success", page: 2, pageSize: 10 },
      ipAddress: "192.0.2.1",
    })
    for (const [query] of queryRaw.mock.calls) {
      expect(query.strings.join("?")).toContain(
        "CURRENT_TIMESTAMP - make_interval(days => ?)",
      )
      expect(query.values).toContain(PROBLEM_FEEDBACK_RETENTION_DAYS)
    }
  })

  it("does not return an admin page when its audit write fails", async () => {
    const transaction = {
      $queryRaw: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]),
    }
    const prisma = {
      problemFeedback: { create: vi.fn() },
      $transaction: vi.fn(async (operation) => operation(transaction)),
    }
    const service = new ProblemFeedbackService(
      prisma as never,
      { recordWithClient: vi.fn().mockRejectedValue(new Error("audit failed")) } as never,
      new ProblemFeedbackDiagnostics(),
    )

    await expect(service.listAdminPage({
      page: 1,
      adminEmail: "admin@example.invalid",
      ipAddress: "192.0.2.1",
    })).rejects.toThrow("audit failed")
  })

  it.each([
    [1, "deleted", "success"],
    [0, "not_found", "not_found"],
  ] as const)("deletes one record and audits outcome %s atomically", async (
    count,
    expected,
    auditResult,
  ) => {
    const transaction = {
      problemFeedback: { deleteMany: vi.fn().mockResolvedValue({ count }) },
    }
    const prisma = {
      problemFeedback: { create: vi.fn() },
      $transaction: vi.fn(async (operation) => operation(transaction)),
    }
    const auditLog = { recordWithClient: vi.fn().mockResolvedValue(undefined) }
    const service = new ProblemFeedbackService(
      prisma as never,
      auditLog as never,
      new ProblemFeedbackDiagnostics(),
    )
    const id = "00112233-4455-4677-8899-aabbccddeeff"

    await expect(service.deleteAdminRecord({
      id,
      adminEmail: "admin@example.invalid",
      ipAddress: "192.0.2.1",
    })).resolves.toBe(expected)
    expect(auditLog.recordWithClient).toHaveBeenCalledWith(transaction, {
      adminEmail: "admin@example.invalid",
      action: "admin.problem_feedback.delete",
      targetType: "problem_feedback",
      targetId: id,
      detail: { result: auditResult },
      ipAddress: "192.0.2.1",
    })
  })
})
