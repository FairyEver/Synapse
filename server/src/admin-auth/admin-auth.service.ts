import { Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { verifyPassword } from "../auth/password"
import { PrismaService } from "../prisma/prisma.service"

interface AdminJwtPayload {
  readonly sub: string
  readonly email: string
}

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async getEmail(): Promise<string> {
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    return admin?.email ?? ""
  }

  async login(email: string, password: string): Promise<{ email: string; token: string }> {
    const normalizedEmail = email.trim().toLowerCase()
    const admin = await this.prisma.adminUser.findFirst({ orderBy: { createdAt: "asc" } })
    const passwordMatches = admin ? await verifyPassword(password, admin.passwordHash) : false
    if (!admin || admin.status !== "active" || normalizedEmail !== admin.email || !passwordMatches) {
      throw new UnauthorizedException("管理员账号或密码错误。")
    }

    const token = this.jwt.sign({ sub: admin.id, email: admin.email } satisfies AdminJwtPayload)
    return { email: admin.email, token }
  }

  async verify(token: string): Promise<{ id: string; email: string } | null> {
    try {
      const payload = this.jwt.verify<AdminJwtPayload>(token)
      const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } })
      if (!admin || admin.status !== "active" || admin.email !== payload.email) return null
      return { id: admin.id, email: admin.email }
    } catch {
      return null
    }
  }
}
