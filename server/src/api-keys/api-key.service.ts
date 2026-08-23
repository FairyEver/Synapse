import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import { isApiKeyScope, type ApiKeyScope } from "./api-key-capabilities"
import { createApiKeySecret, getApiKeyPrefix, hashApiKeySecret, isApiKeySecret } from "./api-key-token"

const apiKeySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  lastUsedAt: true,
  createdAt: true,
} satisfies Prisma.UserApiKeySelect

type ApiKeyRecord = Prisma.UserApiKeyGetPayload<{ select: typeof apiKeySelect }>

export type UserApiKeyDto = {
  readonly id: string
  readonly name: string
  readonly prefix: string
  readonly scopes: readonly string[]
  readonly lastUsedAt: string | null
  readonly createdAt: string
}

export type OpenApiPrincipal = {
  readonly userId: string
  readonly apiKeyId: string
  readonly scopes: readonly string[]
}

export type UserApiKeyCreateResult = {
  readonly apiKey: UserApiKeyDto
  readonly secret: string
}

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  async listForUser(userId: string): Promise<UserApiKeyDto[]> {
    const apiKeys = await this.prisma.userApiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: apiKeySelect,
    })
    return apiKeys.map(toUserApiKeyDto)
  }

  async createForUser(
    userId: string,
    input: { readonly name: string; readonly scopes: readonly ApiKeyScope[] },
    ipAddress = "system",
  ): Promise<UserApiKeyCreateResult> {
    if (
      input.scopes.length === 0
      || new Set(input.scopes).size !== input.scopes.length
      || input.scopes.some((scope) => !isApiKeyScope(scope))
    ) {
      throw new BadRequestException("API key scopes are invalid.")
    }
    const secret = createApiKeySecret()
    const apiKey = await this.prisma.$transaction(async (tx) => {
      const created = await tx.userApiKey.create({
        data: {
          userId,
          name: input.name,
          keyHash: hashApiKeySecret(secret),
          keyPrefix: getApiKeyPrefix(secret),
          scopes: [...input.scopes],
        },
        select: apiKeySelect,
      })
      await this.auditLog.recordWithClient(tx, {
        adminEmail: userId,
        action: "api_key.create",
        targetType: "api_key",
        targetId: created.id,
        detail: { name: created.name, scopes: [...input.scopes] },
        ipAddress,
      })
      return created
    })
    return { apiKey: toUserApiKeyDto(apiKey), secret }
  }

  async revokeForUser(
    userId: string,
    id: string,
    ipAddress = "system",
  ): Promise<{ readonly ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.userApiKey.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      if (result.count === 0) throw new NotFoundException("API key not found")
      await this.auditLog.recordWithClient(tx, {
        adminEmail: userId,
        action: "api_key.revoke",
        targetType: "api_key",
        targetId: id,
        ipAddress,
      })
    })
    return { ok: true }
  }

  async verifyOpenApiSecret(secret: string): Promise<OpenApiPrincipal | null> {
    if (!isApiKeySecret(secret)) return null
    const apiKey = await this.prisma.userApiKey.findUnique({
      where: { keyHash: hashApiKeySecret(secret) },
      select: {
        id: true,
        userId: true,
        scopes: true,
        revokedAt: true,
        user: { select: { status: true } },
      },
    })
    if (!apiKey || apiKey.revokedAt || apiKey.user.status !== "active") return null
    return { userId: apiKey.userId, apiKeyId: apiKey.id, scopes: apiKey.scopes }
  }

  async touchLastUsed(apiKeyId: string, now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - 5 * 60 * 1000)
    try {
      await this.prisma.userApiKey.updateMany({
        where: {
          id: apiKeyId,
          revokedAt: null,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: cutoff } }],
        },
        data: { lastUsedAt: now },
      })
    } catch (error) {
      this.logger?.warn({
        apiKeyId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "API key last-used update failed")
    }
  }
}

function toUserApiKeyDto(apiKey: ApiKeyRecord): UserApiKeyDto {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  }
}
