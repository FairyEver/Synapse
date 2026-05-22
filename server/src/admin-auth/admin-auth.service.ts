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

  async login(email: string, password: string): Promise<{ email: string; token: string; role: DashboardRole }> {
    const normalizedEmail = email.trim().toLowerCase()
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    const passwordMatches = admin ? await verifyPassword(password, admin.passwordHash) : false
    if (admin && admin.status === "active" && normalizedEmail === admin.email && passwordMatches) {
      const token = this.jwt.sign({ sub: admin.id, email: admin.email, type: "admin" } satisfies AdminJwtPayload)
      await this.auditLog?.record({
        adminEmail: admin.email,
        action: "admin.login.success",
        targetType: "admin",
        targetId: admin.id,
        ipAddress: "system",
      })
      return { email: admin.email, token, role: "admin" }
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
        ipAddress: "system",
      })
      return { email: user.email, token, role: "user" }
    }

    await this.auditLog?.record({
      adminEmail: normalizedEmail,
      action: "dashboard.login.failure",
      targetType: "account",
      targetId: admin?.id ?? user?.id ?? "unknown",
      ipAddress: "system",
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
