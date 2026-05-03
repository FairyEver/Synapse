import { Injectable } from "@nestjs/common"
import type { PrismaService } from "../prisma/prisma.service"
import {
  ActivationError,
  type ActivationAttemptOutcome,
  type ActivationRiskSettings,
} from "./license.types"

const failureOutcomes: ActivationAttemptOutcome[] = [
  "invalid_code",
  "bound_conflict",
  "rate_limited",
  "risk_locked",
  "device_limit",
  "blocked",
]

export interface ActivationAttemptInput {
  readonly activationCodeId: string | null
  readonly activationCodeHash: string
  readonly activationCodeHint: string | null
  readonly email: string
  readonly deviceIdHash: string
  readonly ipAddress: string
  readonly userAgent: string
  readonly outcome: ActivationAttemptOutcome
  readonly reason: string
}

export interface ActivationRiskContext {
  readonly email: string
  readonly deviceIdHash: string
  readonly ipAddress: string
}

export interface ActivationCodeRiskContext {
  readonly activationCodeId: string
  readonly activationCodeHash: string
}

@Injectable()
export class ActivationRiskService {
  private readonly now: () => Date

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ActivationRiskSettings,
    now?: () => Date,
  ) {
    this.now = now ?? (() => new Date())
  }

  async assertNotRateLimited(context: ActivationRiskContext): Promise<void> {
    const since = minutesAgo(this.now(), this.settings.rateWindowMinutes)
    const whereBase = {
      createdAt: { gte: since },
      outcome: { in: failureOutcomes },
    }
    const [ipFailures, emailFailures, deviceFailures] = await Promise.all([
      this.prisma.activationAttempt.count({
        where: { ...whereBase, ipAddress: context.ipAddress },
      }),
      this.prisma.activationAttempt.count({
        where: { ...whereBase, email: context.email },
      }),
      this.prisma.activationAttempt.count({
        where: { ...whereBase, deviceIdHash: context.deviceIdHash },
      }),
    ])

    if (
      ipFailures >= this.settings.rateMaxFailuresPerIp
      || emailFailures >= this.settings.rateMaxFailuresPerEmail
      || deviceFailures >= this.settings.rateMaxFailuresPerDevice
    ) {
      throw new ActivationError("ACTIVATION_RATE_LIMITED", "尝试过于频繁，请稍后再试。")
    }
  }

  async recordAttempt(input: ActivationAttemptInput): Promise<void> {
    await this.prisma.activationAttempt.create({
      data: {
        activationCodeId: input.activationCodeId,
        activationCodeHash: input.activationCodeHash,
        activationCodeHint: input.activationCodeHint,
        email: input.email,
        deviceIdHash: input.deviceIdHash,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        outcome: input.outcome,
        reason: input.reason,
      },
    })
  }

  async evaluateCodeRisk(context: ActivationCodeRiskContext): Promise<void> {
    const since = minutesAgo(this.now(), this.settings.riskWindowMinutes)
    const where = {
      activationCodeHash: context.activationCodeHash,
      createdAt: { gte: since },
      outcome: { in: failureOutcomes },
    }

    const [ips, emails, devices, boundConflicts] = await Promise.all([
      this.prisma.activationAttempt.groupBy({
        by: ["ipAddress"],
        where,
      }),
      this.prisma.activationAttempt.groupBy({
        by: ["email"],
        where,
      }),
      this.prisma.activationAttempt.groupBy({
        by: ["deviceIdHash"],
        where,
      }),
      this.prisma.activationAttempt.count({
        where: {
          activationCodeHash: context.activationCodeHash,
          createdAt: { gte: since },
          outcome: "bound_conflict",
        },
      }),
    ])

    if (
      ips.length >= this.settings.riskMaxDistinctIpsPerCode
      || emails.length >= this.settings.riskMaxDistinctEmailsPerCode
      || devices.length >= this.settings.riskMaxDistinctDevicesPerCode
      || boundConflicts >= this.settings.riskMaxBoundConflictsPerCode
    ) {
      await this.prisma.activationCode.update({
        where: { id: context.activationCodeId },
        data: {
          riskLockedAt: this.now(),
          riskLockedReason: "激活码来源异常。",
        },
      })
    }
  }

  async setRiskLock(
    activationCodeId: string,
    input: { readonly locked: boolean; readonly note?: string | null },
  ): Promise<unknown> {
    if (input.locked) {
      return this.prisma.activationCode.update({
        where: { id: activationCodeId },
        data: {
          riskLockedAt: this.now(),
          riskLockedReason: input.note?.trim() || "管理员手动锁定。",
          riskReviewNote: input.note?.trim() || null,
        },
      })
    }

    return this.prisma.activationCode.update({
      where: { id: activationCodeId },
      data: {
        riskLockedAt: null,
        riskLockedReason: null,
        riskUnlockedAt: this.now(),
        riskReviewNote: input.note?.trim() || null,
      },
    })
  }

  async cleanupExpiredAttempts(): Promise<void> {
    await this.prisma.activationAttempt.deleteMany({
      where: {
        createdAt: { lt: daysAgo(this.now(), this.settings.attemptRetentionDays) },
      },
    })
  }
}

function minutesAgo(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60 * 1000)
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
