import { Injectable } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  validateProblemFeedbackInput,
  type ProblemFeedbackValidationResult,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import {
  PROBLEM_FEEDBACK_PAGE_SIZE,
  PROBLEM_FEEDBACK_RETENTION_DAYS,
} from "./problem-feedback.constants"
import { ProblemFeedbackDiagnostics } from "./problem-feedback-diagnostics"

export type ProblemFeedbackSubmissionResult =
  | { readonly outcome: "success" }
  | {
    readonly outcome: "invalid"
    readonly validation: Exclude<ProblemFeedbackValidationResult, { readonly ok: true }>
  }
  | { readonly outcome: "failed" }
  | { readonly outcome: "unknown" }

export interface ProblemFeedbackAdminPage {
  readonly data: ReadonlyArray<{
    readonly id: string
    readonly content: string
    readonly receivedAt: string
  }>
  readonly total: number
  readonly page: number
  readonly pageSize: 10
}

type ProblemFeedbackRow = {
  readonly id: string
  readonly content: string
  readonly receivedAt: Date
}

@Injectable()
export class ProblemFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly diagnostics: ProblemFeedbackDiagnostics,
  ) {}

  async submit(input: unknown): Promise<ProblemFeedbackSubmissionResult> {
    const validation = validateProblemFeedbackInput(input)
    if (!validation.ok) {
      this.diagnostics.increment(
        validation.code === "PRIVACY_RISK" ? "privacy_rejected" : "invalid_input",
      )
      return { outcome: "invalid", validation }
    }

    try {
      await this.prisma.problemFeedback.create({
        data: { content: validation.data.content },
        select: { id: true },
      })
      this.diagnostics.increment("accepted")
      return { outcome: "success" }
    } catch (error) {
      this.diagnostics.increment("persistence_failed")
      return isDefinitelyNotPersisted(error)
        ? { outcome: "failed" }
        : { outcome: "unknown" }
    }
  }

  async listAdminPage(input: {
    readonly page: number
    readonly adminEmail: string
    readonly ipAddress: string
  }): Promise<ProblemFeedbackAdminPage> {
    const offset = (input.page - 1) * PROBLEM_FEEDBACK_PAGE_SIZE
    return this.prisma.$transaction(async (transaction) => {
      const data = await transaction.$queryRaw<ProblemFeedbackRow[]>(Prisma.sql`
        SELECT "id", "content", "receivedAt"
        FROM "ProblemFeedback"
        WHERE "receivedAt" > CURRENT_TIMESTAMP - make_interval(days => ${PROBLEM_FEEDBACK_RETENTION_DAYS})
        ORDER BY "receivedAt" DESC, "id" DESC
        LIMIT ${PROBLEM_FEEDBACK_PAGE_SIZE}
        OFFSET ${offset}
      `)
      const totals = await transaction.$queryRaw<Array<{ total: number }>>(Prisma.sql`
        SELECT COUNT(*)::integer AS "total"
        FROM "ProblemFeedback"
        WHERE "receivedAt" > CURRENT_TIMESTAMP - make_interval(days => ${PROBLEM_FEEDBACK_RETENTION_DAYS})
      `)
      await this.auditLog.recordWithClient(transaction, {
        adminEmail: input.adminEmail,
        action: "admin.problem_feedback.list",
        targetType: "problem_feedback",
        targetId: "list",
        detail: {
          result: "success",
          page: input.page,
          pageSize: PROBLEM_FEEDBACK_PAGE_SIZE,
        },
        ipAddress: input.ipAddress,
      })
      return {
        data: data.map((row) => ({
          id: row.id,
          content: row.content,
          receivedAt: row.receivedAt.toISOString(),
        })),
        total: totals[0]?.total ?? 0,
        page: input.page,
        pageSize: PROBLEM_FEEDBACK_PAGE_SIZE,
      }
    })
  }

  deleteAdminRecord(input: {
    readonly id: string
    readonly adminEmail: string
    readonly ipAddress: string
  }): Promise<"deleted" | "not_found"> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.problemFeedback.deleteMany({
        where: { id: input.id },
      })
      const outcome = result.count === 1 ? "success" : "not_found"
      await this.auditLog.recordWithClient(transaction, {
        adminEmail: input.adminEmail,
        action: "admin.problem_feedback.delete",
        targetType: "problem_feedback",
        targetId: input.id,
        detail: { result: outcome },
        ipAddress: input.ipAddress,
      })
      return outcome === "success" ? "deleted" : "not_found"
    })
  }
}

function isDefinitelyNotPersisted(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientValidationError
    || error instanceof Prisma.PrismaClientInitializationError
  ) {
    return true
  }
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false
  return new Set([
    "P1000",
    "P1001",
    "P1010",
    "P1013",
    "P2000",
    "P2002",
    "P2003",
    "P2011",
    "P2012",
    "P2013",
    "P2024",
  ]).has(error.code)
}
