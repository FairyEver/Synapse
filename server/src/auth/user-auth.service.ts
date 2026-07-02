import { createHash, timingSafeEqual } from "node:crypto"
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { Cron } from "@nestjs/schedule"
import { Prisma, type TeamMembership, type TeamRole, type User } from "@prisma/client"
import {
  DESKTOP_CLIENT_ID,
  DESKTOP_PKCE_CHALLENGE_METHOD,
  DESKTOP_REDIRECT_URI,
  buildPasswordResetUrl as buildSharedPasswordResetUrl,
  normalizeUserHandle,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { hashPassword, verifyPassword } from "./password"
import { createOpaqueToken, hashToken } from "./token"
import { PrismaService } from "../prisma/prisma.service"

export const userAuthOptionsToken = "USER_AUTH_OPTIONS"

export interface UserAuthOptions {
  readonly accessMinutes: number
  readonly refreshDays: number
  readonly exposePasswordResetUrl: boolean
}

export interface UserTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
}

type RefreshFailureCode = "refresh_invalid" | "refresh_expired" | "refresh_revoked" | "account_disabled"

export interface UserRegistrationResult {
  readonly ok: true
}

export interface UserMeTeam {
  readonly id: string
  readonly name: string
  readonly membershipId: TeamMembership["id"]
  readonly membershipRole: TeamRole
}

export interface UserMeResponse {
  readonly user: Pick<User, "id" | "email" | "status" | "displayName" | "handle">
  readonly teams: readonly UserMeTeam[]
}

export interface PasswordResetRequestResult {
  readonly ok: true
  readonly resetUrl?: string
  readonly expiresAt?: Date
}

interface UserJwtPayload {
  readonly sub: string
  readonly email: string
  readonly iat?: number
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

function refreshUnauthorized(code: RefreshFailureCode, message = "未登录或登录已过期。"): UnauthorizedException {
  return new UnauthorizedException({ message, code })
}

const revokedSessionRetentionMs = 7 * 24 * 60 * 60 * 1000
const desktopLoginCodeTtlMs = 5 * 60 * 1000
const passwordResetTokenTtlMs = 30 * 60 * 1000
const refreshTokenGraceMs = 24 * 60 * 60 * 1000

type DesktopLoginExchangeFailureReason =
  | "code_not_found"
  | "code_already_used"
  | "code_expired"
  | "invalid_client"
  | "invalid_redirect_uri"
  | "invalid_code_challenge_method"
  | "state_mismatch"
  | "pkce_mismatch"
  | "user_disabled"
  | "concurrent_race"

type DesktopLoginExchangeRecord = {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
  readonly codeChallenge: string
  readonly codeChallengeMethod: string
  readonly usedAt: Date | null
  readonly expiresAt: Date
  readonly user: Pick<User, "id" | "email" | "status">
}

function buildDesktopDeepLink(code: string, state: string): string {
  const query = new URLSearchParams({ code, state })
  return `${DESKTOP_REDIRECT_URI}?${query.toString()}`
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(hashToken(left), "hex")
  const rightBuffer = Buffer.from(hashToken(right), "hex")
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function createPkceS256Challenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url")
}

function desktopLoginExchangeFailureReason(
  record: DesktopLoginExchangeRecord | null,
  now: Date,
  state: string,
  codeVerifier: string,
): DesktopLoginExchangeFailureReason | null {
  if (!record) return "code_not_found"
  if (record.usedAt) return "code_already_used"
  if (record.expiresAt <= now) return "code_expired"
  if (record.clientId !== DESKTOP_CLIENT_ID) return "invalid_client"
  if (record.redirectUri !== DESKTOP_REDIRECT_URI) return "invalid_redirect_uri"
  if (record.codeChallengeMethod !== DESKTOP_PKCE_CHALLENGE_METHOD) return "invalid_code_challenge_method"
  if (!timingSafeEqualText(record.state, state)) return "state_mismatch"
  if (!timingSafeEqualText(record.codeChallenge, createPkceS256Challenge(codeVerifier))) return "pkce_mismatch"
  if (record.user.status !== "active") return "user_disabled"
  return null
}

function tokenIssuedBeforePasswordChange(payload: { readonly iat?: number }, passwordChangedAt?: Date | null): boolean {
  if (!passwordChangedAt) return false
  if (!payload.iat) return true
  return payload.iat <= Math.floor(passwordChangedAt.getTime() / 1000)
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim()
  if (!displayName) throw new BadRequestException("displayName is required.")
  if (displayName.length > 40) {
    throw new BadRequestException("displayName must be at most 40 characters.")
  }
  return displayName
}

function normalizeProfileHandle(value: string): string {
  try {
    return normalizeUserHandle(value)
  } catch (error) {
    if (error instanceof Error) throw new BadRequestException(error.message)
    throw error
  }
}

function toUserMeResponse(user: {
  readonly id: string
  readonly email: string
  readonly status: User["status"]
  readonly displayName: string | null
  readonly handle: string | null
  readonly memberships: ReadonlyArray<{
    readonly id: string
    readonly role: TeamRole
    readonly team: { readonly id: string; readonly name: string }
  }>
}): UserMeResponse {
  return {
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
      displayName: user.displayName,
      handle: user.handle,
    },
    teams: user.memberships.map((membership) => ({
      id: membership.team.id,
      name: membership.team.name,
      membershipId: membership.id,
      membershipRole: membership.role,
    })),
  }
}

@Injectable()
export class UserAuthService {
  private readonly logger = new Logger(UserAuthService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(userAuthOptionsToken) private readonly options: UserAuthOptions,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  async register(input: { email: string; password: string }, ipAddress = "system"): Promise<UserRegistrationResult> {
    const email = input.email.trim().toLowerCase()
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await this.lockAdminEmailsForRegistration(tx)
        const existingAdmin = await tx.adminUser.findUnique({
          where: { email },
          select: { id: true },
        })
        if (existingAdmin) return { registered: false as const }
        const existingUser = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        })
        if (existingUser) return { registered: false as const }

        const user = await tx.user.create({
          data: {
            email,
            passwordHash: await hashPassword(input.password),
          },
          select: {
            id: true,
            email: true,
          },
        })
        return { registered: true as const, user }
      })
      if (!result.registered) {
        await this.recordUserRegistrationFailure({
          adminEmail: email,
          reason: "duplicate_email",
          ipAddress,
        })
        throw new BadRequestException("邮箱已注册。")
      }
      await this.recordUserRegistrationSuccessAuditSafely({
        adminEmail: result.user.email,
        targetId: result.user.id,
        ipAddress,
      })
      return { ok: true }
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        await this.recordUserRegistrationFailure({
          adminEmail: email,
          reason: "duplicate_email",
          ipAddress,
        })
        throw new BadRequestException("邮箱已注册。")
      }
      if (error instanceof BadRequestException) {
        throw error
      }
      await this.recordUserRegistrationFailure({
        adminEmail: email,
        reason: "infrastructure_error",
        ipAddress,
        error,
      }).catch(() => undefined)
      throw error
    }
  }

  async requestPasswordReset(
    input: { email: string; publicAppUrl: string },
    ipAddress = "system",
  ): Promise<PasswordResetRequestResult> {
    const email = input.email.trim().toLowerCase()
    if (!this.options.exposePasswordResetUrl) {
      await this.auditLog?.record({
        adminEmail: email,
        action: "user.password_reset.request_unavailable",
        targetType: "user",
        targetId: "unknown",
        ipAddress,
      })
      throw new ServiceUnavailableException("找回密码暂不可用。")
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, status: true },
    })
    if (!user || user.status !== "active") {
      await this.auditLog?.record({
        adminEmail: email,
        action: "user.password_reset.request_ignored",
        targetType: "user",
        targetId: user?.id ?? "unknown",
        ipAddress,
      })
      return { ok: true }
    }

    const token = createOpaqueToken()
    const expiresAt = new Date(Date.now() + passwordResetTokenTtlMs)
    await this.prisma.userPasswordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt,
      },
    })
    await this.recordUserAuthSuccessAuditSafely({
      adminEmail: user.email,
      action: "user.password_reset.request",
      targetId: user.id,
      ipAddress,
    })

    return {
      ok: true,
      resetUrl: buildSharedPasswordResetUrl({ publicAppUrl: input.publicAppUrl, token }),
      expiresAt,
    }
  }

  async resetPassword(input: { token: string; password: string }, ipAddress = "system"): Promise<{ ok: true }> {
    const token = input.token.trim()
    if (!token) throw new UnauthorizedException("重置链接无效或已过期。")

    const record = await this.prisma.userPasswordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    })
    const now = new Date()
    if (!record || record.usedAt || record.expiresAt <= now || record.user.status !== "active") {
      await this.recordPasswordResetFailure(record, ipAddress)
      throw new UnauthorizedException("重置链接无效或已过期。")
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const update = await tx.userPasswordResetToken.updateMany({
          where: {
            id: record.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        })
        if (update.count !== 1) {
          throw new UnauthorizedException("重置链接无效或已过期。")
        }

        const userUpdate = await tx.user.updateMany({
          where: { id: record.userId, status: "active" },
          data: {
            passwordHash: await hashPassword(input.password),
            passwordChangedAt: now,
          },
        })
        if (userUpdate.count !== 1) {
          throw new UnauthorizedException("重置链接无效或已过期。")
        }
        await tx.userSession.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: now },
        })
        await tx.userSessionRefreshToken.updateMany({
          where: {
            session: { userId: record.userId },
            revokedAt: null,
          },
          data: { revokedAt: now },
        })
        await tx.userPasswordResetToken.updateMany({
          where: { userId: record.userId, usedAt: null },
          data: { usedAt: now },
        })
      })
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.recordPasswordResetFailure(record, ipAddress)
      }
      throw error
    }

    await this.recordUserAuthSuccessAuditSafely({
      adminEmail: record.user.email,
      action: "user.password_reset.success",
      targetId: record.user.id,
      ipAddress,
    })
    return { ok: true }
  }

  async login(input: { email: string; password: string }, ipAddress = "system"): Promise<UserTokenPair> {
    const email = input.email.trim().toLowerCase()
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
      },
    })
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
      throw new UnauthorizedException("邮箱或密码错误。")
    }
    const tokens = await this.issueTokenPair(user)
    await this.recordUserAuthSuccessAuditSafely({
      adminEmail: user.email,
      action: "user.login.success",
      targetId: user.id,
      ipAddress,
    })
    return tokens
  }

  async authorizeDesktopLogin(input: {
    readonly userId: string
    readonly clientId: string
    readonly redirectUri: string
    readonly state: string
    readonly codeChallenge: string
    readonly codeChallengeMethod: string
    readonly ipAddress: string
    readonly userAgent?: string
  }): Promise<{ code: string; deepLinkUrl: string; expiresAt: Date }> {
    const state = input.state.trim()
    const clientId = input.clientId.trim()
    const redirectUri = input.redirectUri.trim()
    const codeChallenge = input.codeChallenge.trim()
    const codeChallengeMethod = input.codeChallengeMethod.trim()
    if (
      !state ||
      !codeChallenge ||
      clientId !== DESKTOP_CLIENT_ID ||
      redirectUri !== DESKTOP_REDIRECT_URI ||
      codeChallengeMethod !== DESKTOP_PKCE_CHALLENGE_METHOD
    ) {
      throw new BadRequestException("登录状态无效。")
    }
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, status: true },
    })
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("未登录或登录已过期。")
    }

    const code = createOpaqueToken()
    const expiresAt = new Date(Date.now() + desktopLoginCodeTtlMs)
    await this.prisma.desktopLoginCode.create({
      data: {
        codeHash: hashToken(code),
        userId: user.id,
        clientId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
        expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    })
    await this.recordUserAuthSuccessAuditSafely({
      adminEmail: user.email,
      action: "user.desktop_login.issue",
      targetId: user.id,
      ipAddress: input.ipAddress,
    })

    return { code, deepLinkUrl: buildDesktopDeepLink(code, state), expiresAt }
  }

  async exchangeDesktopLoginToken(input: {
    readonly code: string
    readonly state: string
    readonly codeVerifier: string
    readonly ipAddress: string
  }): Promise<UserTokenPair> {
    const code = input.code.trim()
    const state = input.state.trim()
    const codeVerifier = input.codeVerifier.trim()
    if (!code || !state || !codeVerifier) {
      throw new UnauthorizedException("登录凭证无效或已过期。")
    }

    const record = await this.prisma.desktopLoginCode.findUnique({
      where: { codeHash: hashToken(code) },
      include: { user: true },
    })
    const now = new Date()
    const failureReason = desktopLoginExchangeFailureReason(record, now, state, codeVerifier)
    if (failureReason || !record) {
      await this.recordDesktopLoginExchangeFailure(record, input.ipAddress, failureReason ?? "code_not_found")
      throw new UnauthorizedException("登录凭证无效或已过期。")
    }

    let tokens: UserTokenPair
    try {
      tokens = await this.prisma.$transaction(async (tx) => {
        const result = await tx.desktopLoginCode.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: now },
        })
        if (result.count !== 1) {
          throw new UnauthorizedException("登录凭证无效或已过期。")
        }
        return this.issueTokenPair(record.user, tx)
      })
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.recordDesktopLoginExchangeFailure(record, input.ipAddress, "concurrent_race")
      }
      throw error
    }

    await this.recordUserAuthSuccessAuditSafely({
      adminEmail: record.user.email,
      action: "user.desktop_login.exchange.success",
      targetId: record.user.id,
      ipAddress: input.ipAddress,
    })
    return tokens
  }

  async refresh(input: { refreshToken: string }, ipAddress = "system"): Promise<UserTokenPair> {
    const currentRefreshTokenHash = hashToken(input.refreshToken)
    const tokenRecord = await this.prisma.userSessionRefreshToken.findUnique({
      where: { refreshTokenHash: currentRefreshTokenHash },
      include: { session: { include: { user: true } } },
    })
    const now = new Date()
    if (!tokenRecord) {
      await this.recordUserAudit({
        adminEmail: "unknown",
        action: "user.refresh.invalid",
        targetId: "unknown",
        ipAddress,
      })
      throw refreshUnauthorized("refresh_invalid")
    }
    const session = tokenRecord.session
    if (tokenRecord.revokedAt || session.revokedAt) {
      await this.recordUserAudit({
        adminEmail: session.user.email,
        action: "user.refresh.revoked",
        targetId: session.user.id,
        ipAddress,
      })
      throw refreshUnauthorized("refresh_revoked")
    }
    if (tokenRecord.expiresAt <= now || session.expiresAt <= now) {
      await this.recordUserAudit({
        adminEmail: session.user.email,
        action: "user.refresh.expired",
        targetId: session.user.id,
        ipAddress,
      })
      throw refreshUnauthorized("refresh_expired")
    }
    if (tokenRecord.replacedAt && (!tokenRecord.graceExpiresAt || tokenRecord.graceExpiresAt <= now)) {
      await this.recordUserAudit({
        adminEmail: session.user.email,
        action: "user.refresh.invalid",
        targetId: session.user.id,
        ipAddress,
      })
      throw refreshUnauthorized("refresh_invalid")
    }
    if (session.user.status !== "active") {
      await this.auditLog?.record({
        adminEmail: session.user.email,
        action: "user.refresh.disabled",
        targetType: "user",
        targetId: session.user.id,
        ipAddress,
      })
      throw refreshUnauthorized("account_disabled", "账号已停用。")
    }

    const refreshToken = createOpaqueToken()
    await this.prisma.$transaction(async (tx) => {
      await tx.userSessionRefreshToken.updateMany({
        where: {
          sessionId: session.id,
          refreshTokenHash: currentRefreshTokenHash,
          revokedAt: null,
        },
        data: {
          replacedAt: now,
          graceExpiresAt: addMs(now, refreshTokenGraceMs),
        },
      })
      await tx.userSessionRefreshToken.create({
        data: {
          sessionId: session.id,
          refreshTokenHash: hashToken(refreshToken),
          expiresAt: addDays(now, this.options.refreshDays),
        },
      })
      await tx.userSession.updateMany({
        where: {
          id: session.id,
          revokedAt: null,
        },
        data: {
          refreshTokenHash: hashToken(refreshToken),
          expiresAt: addDays(now, this.options.refreshDays),
          lastUsedAt: now,
        },
      })
    })
    return { accessToken: this.signAccessToken(session.user), refreshToken }
  }

  async logout(input: { refreshToken: string }, ipAddress = "system"): Promise<{ ok: true }> {
    const tokenRecord = await this.prisma.userSessionRefreshToken.findUnique({
      where: { refreshTokenHash: hashToken(input.refreshToken) },
      include: { session: { include: { user: { select: { id: true, email: true } } } } },
    })
    const session = tokenRecord?.session
    if (session && !session.revokedAt) {
      const now = new Date()
      await this.prisma.$transaction(async (tx) => {
        await tx.userSession.update({
          where: { id: session.id },
          data: { revokedAt: now },
        })
        await tx.userSessionRefreshToken.updateMany({
          where: { sessionId: session.id, revokedAt: null },
          data: { revokedAt: now },
        })
      })
      await this.recordUserAuthSuccessAuditSafely({
        adminEmail: session.user.email,
        action: "user.logout.success",
        targetId: session.user.id,
        ipAddress,
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
    const [sessionResult, desktopLoginCodeResult, passwordResetTokenResult] = await Promise.all([
      this.prisma.userSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { revokedAt: { lt: revokedBefore } },
          ],
        },
      }),
      this.prisma.desktopLoginCode.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { usedAt: { not: null } },
          ],
        },
      }),
      this.prisma.userPasswordResetToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: now } },
            { usedAt: { not: null } },
          ],
        },
      }),
    ])
    return sessionResult.count + desktopLoginCodeResult.count + passwordResetTokenResult.count
  }

  async getMe(userId: string): Promise<UserMeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        displayName: true,
        handle: true,
        memberships: {
          select: {
            id: true,
            role: true,
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    return toUserMeResponse(user)
  }

  async updateMyProfile(
    userId: string,
    input: { readonly displayName?: string; readonly handle?: string },
    ipAddress = "system",
  ): Promise<UserMeResponse> {
    if (input.displayName === undefined && input.handle === undefined) {
      throw new BadRequestException("profile update is empty.")
    }
    const auditFields: string[] = []
    if (input.displayName !== undefined) auditFields.push("displayName")
    if (input.handle !== undefined) auditFields.push("handle")

    const user = await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          status: true,
          displayName: true,
          handle: true,
        },
      })
      const data: Prisma.UserUpdateInput = {}

      if (input.displayName !== undefined) {
        data.displayName = normalizeDisplayName(input.displayName)
      }

      if (input.handle !== undefined) {
        const nextHandle = normalizeProfileHandle(input.handle)
        if (nextHandle !== current.handle) {
          const reserved = await tx.userHandleRedirect.findUnique({
            where: { oldHandle: nextHandle },
            select: { userId: true },
          })
          if (reserved && reserved.userId !== userId) {
            throw new BadRequestException("用户名已被保留。")
          }
          const existingUser = await tx.user.findUnique({
            where: { handle: nextHandle },
            select: { id: true },
          })
          if (existingUser && existingUser.id !== userId) {
            throw new BadRequestException("用户名已被使用。")
          }
          if (current.handle) {
            await tx.userHandleRedirect.upsert({
              where: { oldHandle: current.handle },
              create: { userId, oldHandle: current.handle },
              update: { userId },
            })
          }
          data.handle = nextHandle
        }
      }

      try {
        return await tx.user.update({
          where: { id: userId },
          data,
          select: {
            id: true,
            email: true,
            status: true,
            displayName: true,
            handle: true,
            memberships: {
              select: {
                id: true,
                role: true,
                team: { select: { id: true, name: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        })
      } catch (error) {
        if (data.handle !== undefined && isUniqueConstraintError(error)) {
          throw new BadRequestException("用户名已被使用。")
        }
        throw error
      }
    })

    await this.recordUserProfileUpdateAuditSafely({
      adminEmail: user.email,
      targetId: user.id,
      fields: auditFields,
      ipAddress,
    })

    return toUserMeResponse(user)
  }

  async verifyAccessToken(token: string): Promise<{ userId: string }> {
    try {
      const payload = this.jwt.verify<UserJwtPayload>(token)
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          status: true,
          passwordChangedAt: true,
        },
      })
      if (
        !user ||
        user.status !== "active" ||
        user.email !== payload.email ||
        tokenIssuedBeforePasswordChange(payload, user.passwordChangedAt)
      ) {
        throw new UnauthorizedException("未登录或登录已过期。")
      }
      return { userId: user.id }
    } catch (error) {
      if (isExpectedAccessTokenFailure(error)) {
        throw new UnauthorizedException("未登录或登录已过期。")
      }
      this.logger.warn(safeAuditErrorDetail(error), "User access token verification failed")
      throw new ServiceUnavailableException("认证服务暂时不可用，请稍后重试。")
    }
  }

  private signAccessToken(user: Pick<User, "id" | "email">): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email } satisfies UserJwtPayload,
      { expiresIn: `${this.options.accessMinutes}m` },
    )
  }

  private async lockAdminEmailsForRegistration(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`LOCK TABLE "AdminUser" IN SHARE MODE`
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

  private async recordUserAuthSuccessAuditSafely(input: {
    readonly adminEmail: string
    readonly action: string
    readonly targetId: string
    readonly ipAddress: string
  }): Promise<void> {
    try {
      await this.auditLog?.record({
        adminEmail: input.adminEmail,
        action: input.action,
        targetType: "user",
        targetId: input.targetId,
        ipAddress: input.ipAddress,
      })
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: "user",
        targetId: input.targetId,
        ...safeAuditErrorDetail(error),
      }, "Failed to record user authentication success audit log")
    }
  }

  private async recordUserProfileUpdateAuditSafely(input: {
    readonly adminEmail: string
    readonly targetId: string
    readonly fields: readonly string[]
    readonly ipAddress: string
  }): Promise<void> {
    try {
      await this.auditLog?.record({
        adminEmail: input.adminEmail,
        action: "user.profile.update",
        targetType: "user",
        targetId: input.targetId,
        detail: { fields: input.fields },
        ipAddress: input.ipAddress,
      })
    } catch (error) {
      this.logger.warn({
        action: "user.profile.update",
        targetType: "user",
        targetId: input.targetId,
        ...safeAuditErrorDetail(error),
      }, "Failed to record user profile update audit log")
    }
  }

  private async recordUserRegistrationSuccessAuditSafely(input: {
    readonly adminEmail: string
    readonly targetId: string
    readonly ipAddress: string
  }): Promise<void> {
    try {
      await this.auditLog?.record({
        adminEmail: input.adminEmail,
        action: "user.register.success",
        targetType: "user",
        targetId: input.targetId,
        ipAddress: input.ipAddress,
      })
    } catch (error) {
      this.logger.warn({
        action: "user.register.success",
        targetType: "user",
        targetId: input.targetId,
        ...safeAuditErrorDetail(error),
      }, "Failed to record user registration success audit log")
    }
  }

  private async recordUserRegistrationFailure(input: {
    readonly adminEmail: string
    readonly reason: "duplicate_email" | "infrastructure_error"
    readonly ipAddress: string
    readonly error?: unknown
  }): Promise<void> {
    await this.auditLog?.record({
      adminEmail: input.adminEmail,
      action: "user.register.failure",
      targetType: "user",
      targetId: "unknown",
      detail: {
        reason: input.reason,
        ...safeAuditErrorDetail(input.error),
      },
      ipAddress: input.ipAddress,
    })
  }

  private async recordPasswordResetFailure(
    record: { user?: Pick<User, "id" | "email"> } | null,
    ipAddress: string,
  ): Promise<void> {
    await this.auditLog?.record({
      adminEmail: record?.user?.email ?? "unknown",
      action: "user.password_reset.failure",
      targetType: "user",
      targetId: record?.user?.id ?? "unknown",
      ipAddress,
    })
  }

  private async recordDesktopLoginExchangeFailure(
    record: { user?: Pick<User, "id" | "email"> } | null,
    ipAddress: string,
    reason: DesktopLoginExchangeFailureReason,
  ): Promise<void> {
    await this.auditLog?.record({
      adminEmail: record?.user?.email ?? "unknown",
      action: "user.desktop_login.exchange.failure",
      targetType: "user",
      targetId: record?.user?.id ?? "unknown",
      detail: { reason },
      ipAddress,
    })
  }

  private async issueTokenPair(
    user: Pick<User, "id" | "email">,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<UserTokenPair> {
    const refreshToken = createOpaqueToken()
    const expiresAt = addDays(new Date(), this.options.refreshDays)
    const session = await client.userSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt,
      },
    })
    await client.userSessionRefreshToken.create({
      data: {
        sessionId: session.id,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt,
      },
    })
    return { accessToken: this.signAccessToken(user), refreshToken }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function isExpectedAccessTokenFailure(error: unknown): boolean {
  if (error instanceof UnauthorizedException) return true
  if (!(error instanceof Error)) return false
  return error.name === "JsonWebTokenError" ||
    error.name === "TokenExpiredError" ||
    error.name === "NotBeforeError"
}

function safeAuditErrorDetail(error: unknown): { readonly errorName?: string; readonly errorCode?: string } {
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
