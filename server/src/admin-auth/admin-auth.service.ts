import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { AuditLogService, auditActors } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"

export const adminAuthOptionsToken = Symbol("adminAuthOptions")
export const adminSessionMaxAgeMs = 8 * 60 * 60 * 1000
const adminSessionRetentionMs = 7 * 24 * 60 * 60 * 1000

export interface AdminAuthOptions {
  readonly accessSecret: string
}

export interface AdminSessionIdentity {
  readonly sessionId: string
  readonly expiresAt: Date
}

export type AdminSessionVerification =
  | { readonly status: "active"; readonly session: AdminSessionIdentity }
  | { readonly status: "expired" | "revoked"; readonly sessionId: string }
  | { readonly status: "invalid" }

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(adminAuthOptionsToken) private readonly options: AdminAuthOptions,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async createSession(
    suppliedSecret: string,
    ipAddress: string,
  ): Promise<{ readonly token: string; readonly session: AdminSessionIdentity } | null> {
    if (!constantTimeSecretEquals(suppliedSecret, this.options.accessSecret)) {
      await this.recordAuditSafely({
        actor: auditActors.unknown(),
        action: "admin.session.unlock_failed",
        targetType: "admin_session",
        targetId: "unknown",
        ipAddress,
      })
      return null
    }

    const token = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + adminSessionMaxAgeMs)
    const record = await this.prisma.adminSession.create({
      data: {
        id: randomUUID(),
        tokenHash: this.hashSessionToken(token),
        ipAddress,
        expiresAt,
        lastUsedAt: new Date(),
      },
      select: { id: true, expiresAt: true },
    })
    const session = { sessionId: record.id, expiresAt: record.expiresAt }
    await this.recordAuditSafely({
      actor: auditActors.platformAdmin(session.sessionId),
      action: "admin.session.unlocked",
      targetType: "admin_session",
      targetId: session.sessionId,
      ipAddress,
    })
    return { token, session }
  }

  async verifySession(token: string): Promise<AdminSessionVerification> {
    try {
      const record = await this.prisma.adminSession.findUnique({
        where: { tokenHash: this.hashSessionToken(token) },
        select: { id: true, expiresAt: true, revokedAt: true },
      })
      if (!record) return { status: "invalid" }
      if (record.revokedAt) return { status: "revoked", sessionId: record.id }
      if (record.expiresAt.getTime() <= Date.now()) return { status: "expired", sessionId: record.id }
      await this.prisma.adminSession.update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      return {
        status: "active",
        session: { sessionId: record.id, expiresAt: record.expiresAt },
      }
    } catch {
      throw new ServiceUnavailableException("认证服务暂时不可用，请稍后重试。")
    }
  }

  async revokeSession(token: string, ipAddress: string): Promise<AdminSessionIdentity | null> {
    const verification = await this.verifySession(token)
    if (verification.status !== "active") return null
    await this.prisma.adminSession.update({
      where: { id: verification.session.sessionId },
      data: { revokedAt: new Date() },
    })
    await this.recordAuditSafely({
      actor: auditActors.platformAdmin(verification.session.sessionId),
      action: "admin.session.logged_out",
      targetType: "admin_session",
      targetId: verification.session.sessionId,
      ipAddress,
    })
    return verification.session
  }

  async recordRejectedSession(
    verification: Exclude<AdminSessionVerification, { readonly status: "active" }>,
    ipAddress: string,
  ): Promise<void> {
    if (verification.status === "invalid") return
    await this.recordAuditSafely({
      actor: auditActors.unknown(),
      action: verification.status === "expired"
        ? "admin.session.expired_access"
        : "admin.session.revoked_access",
      targetType: "admin_session",
      targetId: verification.sessionId,
      ipAddress,
    })
  }

  @Cron("0 4 * * *")
  async cleanupExpiredSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - adminSessionRetentionMs)
    await this.prisma.adminSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: cutoff } },
          { revokedAt: { lt: cutoff } },
        ],
      },
    })
  }

  private hashSessionToken(token: string): string {
    return createHmac("sha256", this.options.accessSecret).update(token).digest("hex")
  }

  private async recordAuditSafely(input: Parameters<AuditLogService["record"]>[0]): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Failed to record administrator session audit log")
    }
  }
}

function constantTimeSecretEquals(supplied: string, configured: string): boolean {
  const suppliedDigest = createHash("sha256").update(supplied).digest()
  const configuredDigest = createHash("sha256").update(configured).digest()
  return timingSafeEqual(suppliedDigest, configuredDigest)
}
