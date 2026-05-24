import { Injectable, Optional, UnauthorizedException } from "@nestjs/common"
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
  readonly exp?: number
}

export type DashboardRole = "admin" | "user"

export interface DashboardSession {
  readonly id: string
  readonly email: string
  readonly role: DashboardRole
}

const dashboardJwtExpiresIn = "8h"

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async getEmail(): Promise<string> {
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    return admin?.email ?? ""
  }

  async login(email: string, password: string, ipAddress = "system"): Promise<{ email: string; token: string; role: DashboardRole }> {
    const normalizedEmail = email.trim().toLowerCase()
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    const matchedAdmin = admin && normalizedEmail === admin.email ? admin : null
    const passwordMatches = matchedAdmin ? await verifyPassword(password, matchedAdmin.passwordHash) : false
    let disabledAdminPasswordMatched = false
    if (matchedAdmin && matchedAdmin.status === "active" && passwordMatches) {
      const token = this.signDashboardToken({ sub: matchedAdmin.id, email: matchedAdmin.email, type: "admin" })
      await this.auditLog?.record({
        adminEmail: matchedAdmin.email,
        action: "admin.login.success",
        targetType: "admin",
        targetId: matchedAdmin.id,
        ipAddress,
      })
      return { email: matchedAdmin.email, token, role: "admin" }
    }
    if (matchedAdmin && matchedAdmin.status !== "active" && passwordMatches) {
      await this.auditLog?.record({
        adminEmail: matchedAdmin.email,
        action: "dashboard.login.disabled",
        targetType: "admin",
        targetId: matchedAdmin.id,
        ipAddress,
      })
      disabledAdminPasswordMatched = true
    }

    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } })
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
      return { email: user.email, token, role: "user" }
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

    if (disabledAdminPasswordMatched) {
      throw new UnauthorizedException("邮箱或密码错误。")
    }

    await this.auditLog?.record({
      adminEmail: normalizedEmail,
      action: "dashboard.login.failure",
      targetType: "account",
      targetId: matchedAdmin?.id ?? user?.id ?? "unknown",
      ipAddress,
    })
    throw new UnauthorizedException("邮箱或密码错误。")
  }

  async verify(token: string): Promise<{ id: string; email: string } | null> {
    const session = await this.verifyDashboardSession(token)
    if (session?.role !== "admin") return null
    return { id: session.id, email: session.email }
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
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
        if (!user || user.status !== "active" || user.email !== payload.email) return null
        return { id: user.id, email: user.email, role: "user" }
      }
      const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } })
      if (!admin || admin.status !== "active" || admin.email !== payload.email) return null
      return { id: admin.id, email: admin.email, role: "admin" }
    } catch {
      return null
    }
  }

  async revokeDashboardSession(token: string): Promise<void> {
    try {
      const payload = this.jwt.verify<AdminJwtPayload>(token)
      const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 8 * 60 * 60 * 1000)
      await this.prisma.dashboardRevokedToken.upsert({
        where: { tokenHash: hashToken(token) },
        update: { expiresAt, revokedAt: new Date() },
        create: { tokenHash: hashToken(token), expiresAt },
      })
    } catch {
      return
    }
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
