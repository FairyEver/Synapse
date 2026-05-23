import { Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { verifyPassword } from "../auth/password"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"

interface AdminJwtPayload {
  readonly sub: string
  readonly email: string
  readonly type?: "admin" | "user"
}

export type DashboardRole = "admin" | "user"

export interface DashboardSession {
  readonly id: string
  readonly email: string
  readonly role: DashboardRole
}

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
      const token = this.jwt.sign({ sub: matchedAdmin.id, email: matchedAdmin.email, type: "admin" } satisfies AdminJwtPayload)
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
      const token = this.jwt.sign({ sub: user.id, email: user.email, type: "user" } satisfies AdminJwtPayload)
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
      throw new UnauthorizedException("账号已停用。")
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
}
