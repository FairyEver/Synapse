import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { Prisma, type User } from "@prisma/client"
import { hashPassword, verifyPassword } from "./password"
import { createOpaqueToken, hashToken } from "./token"
import { InvitationsService } from "../invitations/invitations.service"
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

interface UserJwtPayload {
  readonly sub: string
  readonly email: string
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

@Injectable()
export class UserAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationsService,
    private readonly jwt: JwtService,
    @Inject(userAuthOptionsToken) private readonly options: UserAuthOptions,
  ) {}

  async register(input: { invitationToken: string; email: string; password: string }): Promise<UserTokenPair> {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        return this.issueTokenPair(user, tx)
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("邮箱已注册。")
      }
      throw error
    }
  }

  async login(input: { email: string; password: string }): Promise<UserTokenPair> {
    const email = input.email.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({ where: { email } })
    const passwordMatches = user ? await verifyPassword(input.password, user.passwordHash) : false
    if (!user || !passwordMatches) {
      throw new UnauthorizedException("邮箱或密码错误。")
    }
    if (user.status !== "active") {
      throw new UnauthorizedException("账号已停用。")
    }
    return this.issueTokenPair(user)
  }

  async refresh(input: { refreshToken: string }): Promise<UserTokenPair> {
    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: hashToken(input.refreshToken) },
      include: { user: true },
    })
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException("未登录或登录已过期。")
    }
    if (session.user.status !== "active") {
      throw new UnauthorizedException("账号已停用。")
    }

    const refreshToken = createOpaqueToken()
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: addDays(new Date(), this.options.refreshDays),
        lastUsedAt: new Date(),
      },
    })
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

  async getMe(userId: string): Promise<unknown> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        memberships: {
          select: {
            role: true,
            team: { select: { id: true, name: true, createdByUserId: true } },
          },
        },
      },
    })
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
