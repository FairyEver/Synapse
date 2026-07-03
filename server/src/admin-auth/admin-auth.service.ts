import { Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { Cron } from "@nestjs/schedule"
import { hashToken } from "../auth/token"
import { verifyPassword } from "../auth/password"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"

interface AdminJwtPayload {
  readonly sub: string
  readonly email: string
  readonly type?: "admin" | "user"
  readonly iat?: number
  readonly exp?: number
}

export type DashboardRole = "admin" | "user"

export interface DashboardSession {
  readonly id: string
  readonly email: string
  readonly handle: string | null
  readonly role: DashboardRole
}

const dashboardSessionMaxAgeMs = 30 * 24 * 60 * 60 * 1000
const dashboardJwtExpiresIn = "30d"

function tokenIssuedBeforePasswordChange(payload: { readonly iat?: number }, passwordChangedAt?: Date | null): boolean {
  if (!passwordChangedAt) return false
  if (!payload.iat) return true
  return payload.iat <= Math.floor(passwordChangedAt.getTime() / 1000)
}

function isExpectedDashboardSessionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === "JsonWebTokenError" ||
    error.name === "TokenExpiredError" ||
    error.name === "NotBeforeError"
}

function safeDashboardAuthErrorDetail(error: unknown): { readonly errorName?: string; readonly errorCode?: string } {
  if (error === undefined) return {}
  const errorCode = typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : undefined
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    ...(errorCode ? { errorCode } : {}),
  }
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name)

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async getEmail(): Promise<string> {
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    return admin?.email ?? ""
  }

  async login(email: string, password: string, ipAddress = "system"): Promise<{ email: string; handle: string | null; token: string; role: DashboardRole }> {
    const normalizedEmail = email.trim().toLowerCase()
    const matchedAdmin = await this.prisma.adminUser.findUnique({ where: { email: normalizedEmail } })
    const passwordMatches = matchedAdmin ? await verifyPassword(password, matchedAdmin.passwordHash) : false
    if (matchedAdmin && matchedAdmin.status === "active" && passwordMatches) {
      const token = this.signDashboardToken({ sub: matchedAdmin.id, email: matchedAdmin.email, type: "admin" })
      await this.auditLog?.record({
        adminEmail: matchedAdmin.email,
        action: "admin.login.success",
        targetType: "admin",
        targetId: matchedAdmin.id,
        ipAddress,
      })
      return { email: matchedAdmin.email, handle: null, token, role: "admin" }
    }
    if (matchedAdmin) {
      const adminLoginFailureAction = matchedAdmin.status === "active"
        ? "admin.login.failure"
        : "dashboard.login.disabled"
      await this.auditLog?.record({
        adminEmail: matchedAdmin.email,
        action: adminLoginFailureAction,
        targetType: "admin",
        targetId: matchedAdmin.id,
        ipAddress,
      })
      throw new UnauthorizedException("邮箱或密码错误。")
    }

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        handle: true,
      },
    })
    const userPasswordMatches = user ? await verifyPassword(password, user.passwordHash) : false
    if (user && user.status === "active" && userPasswordMatches) {
      const token = this.signDashboardToken({ sub: user.id, email: user.email, type: "user" })
      await this.auditLog?.record({
        adminEmail: user.email,
        action: "user.dashboard_login.success",
        targetType: "user",
        targetId: user.id,
        ipAddress,
      })
      return {
        email: user.email,
        handle: user.handle,
        token,
        role: "user",
      }
    }
    if (user && user.status !== "active" && userPasswordMatches) {
      await this.auditLog?.record({
        adminEmail: user.email,
        action: "user.dashboard_login.disabled",
        targetType: "user",
        targetId: user.id,
        ipAddress,
      })
      throw new UnauthorizedException("邮箱或密码错误。")
    }

    await this.auditLog?.record({
      adminEmail: normalizedEmail,
      action: "dashboard.login.failure",
      targetType: "account",
      targetId: user?.id ?? "unknown",
      ipAddress,
    })
    throw new UnauthorizedException("邮箱或密码错误。")
  }

  async verifyDashboardSession(token: string): Promise<DashboardSession | null> {
    try {
      const payload = this.jwt.verify<AdminJwtPayload>(token)
      const revoked = await this.prisma.dashboardRevokedToken.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { id: true },
      })
      if (revoked) return null
      if (payload.type === "user") {
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            email: true,
            status: true,
            handle: true,
            passwordChangedAt: true,
          },
        })
        if (
          !user ||
          user.status !== "active" ||
          user.email !== payload.email ||
          tokenIssuedBeforePasswordChange(payload, user.passwordChangedAt)
        ) return null
        return {
          id: user.id,
          email: user.email,
          handle: user.handle,
          role: "user",
        }
      }
      const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } })
      if (!admin || admin.status !== "active" || admin.email !== payload.email) return null
      return { id: admin.id, email: admin.email, handle: null, role: "admin" }
    } catch (error) {
      if (isExpectedDashboardSessionFailure(error)) return null
      this.logger.warn(safeDashboardAuthErrorDetail(error), "Dashboard session verification failed")
      throw new ServiceUnavailableException("认证服务暂时不可用，请稍后重试。")
    }
  }

  async revokeDashboardSession(token: string): Promise<void> {
    let payload: AdminJwtPayload
    try {
      payload = this.jwt.verify<AdminJwtPayload>(token)
    } catch {
      return
    }
    const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + dashboardSessionMaxAgeMs)
    await this.prisma.dashboardRevokedToken.upsert({
      where: { tokenHash: hashToken(token) },
      update: { expiresAt, revokedAt: new Date() },
      create: { tokenHash: hashToken(token), expiresAt },
    })
  }

  @Cron("0 4 * * *")
  async cleanupExpiredRevokedDashboardTokens(): Promise<void> {
    await this.prisma.dashboardRevokedToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
  }

  private signDashboardToken(payload: Omit<AdminJwtPayload, "exp">): string {
    return this.jwt.sign(payload, { expiresIn: dashboardJwtExpiresIn })
  }
}
