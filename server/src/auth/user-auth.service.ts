import { BadRequestException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { Cron } from "@nestjs/schedule"
import { Prisma, type TeamAccessRole, type TeamMembership, type TeamRole, type User } from "@prisma/client"
import { AuditLogService } from "../common/audit-log.service"
import { hashPassword, verifyPassword } from "./password"
import { createOpaqueToken, hashToken } from "./token"
import { InvitationsService } from "../invitations/invitations.service"
import { PermissionsService } from "../permissions/permissions.service"
import { PrismaService } from "../prisma/prisma.service"

export const userAuthOptionsToken = "USER_AUTH_OPTIONS"

export interface UserAuthOptions {
  readonly accessMinutes: number
  readonly refreshDays: number
}

export interface UserTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
}

export interface UserMeAccessRole {
  readonly id: TeamAccessRole["id"]
  readonly name: TeamAccessRole["name"]
}

export interface UserMeTeam {
  readonly id: string
  readonly name: string
  readonly membershipId: TeamMembership["id"]
  readonly membershipRole: TeamRole
  readonly roles: readonly UserMeAccessRole[]
  readonly effectivePermissions: readonly string[]
}

export interface UserMeResponse {
  readonly user: Pick<User, "id" | "email" | "status">
  readonly teams: readonly UserMeTeam[]
}

interface UserJwtPayload {
  readonly sub: string
  readonly email: string
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const revokedSessionRetentionMs = 7 * 24 * 60 * 60 * 1000

@Injectable()
export class UserAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly jwt: JwtService,
    @Inject(userAuthOptionsToken) private readonly options: UserAuthOptions,
    private readonly permissions: PermissionsService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async register(input: { invitationToken: string; email: string; password: string }, ipAddress = "system"): Promise<UserTokenPair> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: input.email.trim().toLowerCase(),
            passwordHash: await hashPassword(input.password),
          },
        })
        await this.invitations.consumeInvitation({
          token: input.invitationToken,
          type: "user_signup",
          acceptedByUserId: user.id,
        }, tx)
        const tokens = await this.issueTokenPair(user, tx)
        return { tokens, user }
      })
      await this.auditLog?.record({
        adminEmail: result.user.email,
        action: "user.register.success",
        targetType: "user",
        targetId: result.user.id,
        ipAddress,
      })
      return result.tokens
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已注册。")
      }
      throw error
    }
  }

  async login(input: { email: string; password: string }, ipAddress = "system"): Promise<UserTokenPair> {
    const email = input.email.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    const passwordMatches = user ? await verifyPassword(input.password, user.passwordHash) : false
    if (!user || !passwordMatches) {
      await this.auditLog?.record({
        adminEmail: email,
        action: "user.login.failure",
        targetType: "user",
        targetId: user?.id ?? "unknown",
        ipAddress,
      })
      throw new UnauthorizedException("邮箱或密码错误。")
    }
    if (user.status !== "active") {
      await this.auditLog?.record({
        adminEmail: email,
        action: "user.login.disabled",
        targetType: "user",
        targetId: user.id,
        ipAddress,
      })
      throw new UnauthorizedException("账号已停用。")
    }
    const tokens = await this.issueTokenPair(user)
    await this.auditLog?.record({
      adminEmail: user.email,
      action: "user.login.success",
      targetType: "user",
      targetId: user.id,
      ipAddress,
    })
    return tokens
  }

  async refresh(input: { refreshToken: string }, ipAddress = "system"): Promise<UserTokenPair> {
    const currentRefreshTokenHash = hashToken(input.refreshToken)
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: currentRefreshTokenHash },
      include: { user: true },
    })
    const now = new Date()
    if (!session) {
      await this.recordUserAudit({
        adminEmail: "unknown",
        action: "user.refresh.invalid",
        targetId: "unknown",
        ipAddress,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    if (session.revokedAt) {
      await this.recordUserAudit({
        adminEmail: session.user.email,
        action: "user.refresh.revoked",
        targetId: session.user.id,
        ipAddress,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    if (session.expiresAt <= now) {
      await this.recordUserAudit({
        adminEmail: session.user.email,
        action: "user.refresh.expired",
        targetId: session.user.id,
        ipAddress,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    if (session.user.status !== "active") {
      await this.auditLog?.record({
        adminEmail: session.user.email,
        action: "user.refresh.disabled",
        targetType: "user",
        targetId: session.user.id,
        ipAddress,
      })
      throw new UnauthorizedException("账号已停用。")
    }

    const refreshToken = createOpaqueToken()
    const result = await this.prisma.userSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: currentRefreshTokenHash,
      },
      data: {
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: addDays(new Date(), this.options.refreshDays),
        lastUsedAt: new Date(),
      },
    })
    if (result.count === 0) {
      await this.recordUserAudit({
        adminEmail: session.user.email,
        action: "user.refresh.race_lost",
        targetId: session.user.id,
        ipAddress,
      })
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    return { accessToken: this.signAccessToken(session.user), refreshToken }
  }

  async logout(input: { refreshToken: string }): Promise<{ ok: true }> {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hashToken(input.refreshToken) },
    })
    if (session && !session.revokedAt) {
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      })
    }
    return { ok: true }
  }

  @Cron("0 4 * * *")
  async scheduledSessionCleanup(): Promise<void> {
    await this.cleanupExpiredSessions()
  }

  async cleanupExpiredSessions(now = new Date()): Promise<number> {
    const revokedBefore = new Date(now.getTime() - revokedSessionRetentionMs)
    const result = await this.prisma.userSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: revokedBefore } },
        ],
      },
    })
    return result.count
  }

  async getMe(userId: string): Promise<UserMeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        memberships: {
          select: {
            id: true,
            teamId: true,
            role: true,
            accessRoles: {
              select: {
                role: { select: { id: true, name: true } },
              },
              orderBy: { assignedAt: "asc" },
            },
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    const teams = await Promise.all(user.memberships.map(async (membership) => ({
      id: membership.team.id,
      name: membership.team.name,
      membershipId: membership.id,
      membershipRole: membership.role,
      roles: membership.accessRoles.map((item) => item.role),
      effectivePermissions: await this.permissions.getEffectivePermissions(user.id, membership.teamId),
    })))

    return {
      user: { id: user.id, email: user.email, status: user.status },
      teams,
    }
  }

  async verifyAccessToken(token: string): Promise<{ userId: string }> {
    try {
      const payload = this.jwt.verify<UserJwtPayload>(token)
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
      if (!user || user.status !== "active" || user.email !== payload.email) {
        throw new UnauthorizedException("未登录或登录已过期。")
      }
      return { userId: user.id }
    } catch {
      throw new UnauthorizedException("未登录或登录已过期。")
    }
  }

  private signAccessToken(user: Pick<User, "id" | "email">): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email } satisfies UserJwtPayload,
      { expiresIn: `${this.options.accessMinutes}m` },
    )
  }

  private async recordUserAudit(input: {
    readonly adminEmail: string
    readonly action: string
    readonly targetId: string
    readonly ipAddress: string
  }): Promise<void> {
    await this.auditLog?.record({
      adminEmail: input.adminEmail,
      action: input.action,
      targetType: "user",
      targetId: input.targetId,
      ipAddress: input.ipAddress,
    })
  }

  private async issueTokenPair(
    user: Pick<User, "id" | "email">,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<UserTokenPair> {
    const refreshToken = createOpaqueToken()
    await client.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: addDays(new Date(), this.options.refreshDays),
      },
    })
    return { accessToken: this.signAccessToken(user), refreshToken }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}
