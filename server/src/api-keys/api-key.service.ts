import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import type { CloudKeyResources, CloudMember } from "@synapse/shared"
import type { PinoLogger } from "nestjs-pino"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import {
  isApiKeyScope,
  normalizeApiKeyScopes,
  type ApiKeyScope,
} from "./api-key-capabilities"
import { createApiKeySecret, getApiKeyPrefix, hashApiKeySecret, isApiKeySecret } from "./api-key-token"

const apiKeySelect = {
  id: true,
  name: true,
  keyPrefix: true,
  scopes: true,
  lastUsedAt: true,
  createdAt: true,
  tableAccessMode: true,
  tableIds: true,
} satisfies Prisma.UserApiKeySelect

type ApiKeyRecord = Prisma.UserApiKeyGetPayload<{ select: typeof apiKeySelect }>

export type UserApiKeyDto = {
  readonly tableResources?: CloudKeyResources
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
    input: { readonly name: string; readonly scopes: readonly ApiKeyScope[]; readonly tableResources?: CloudKeyResources },
    ipAddress = "system",
  ): Promise<UserApiKeyCreateResult> {
    assertValidApiKeyScopes(input.scopes, false)
    const secret = createApiKeySecret()
    const apiKey = await this.prisma.$transaction(async (tx) => {
      if (input.tableResources) await this.assertTableResources(tx, userId, input.tableResources)
      const created = await tx.userApiKey.create({
        data: {
          userId,
          name: input.name,
          keyHash: hashApiKeySecret(secret),
          keyPrefix: getApiKeyPrefix(secret),
          scopes: [...input.scopes],
          tableAccessMode: input.tableResources?.mode ?? "selected",
          tableIds: input.tableResources?.tableIds ?? [],
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

  async updateScopesForUser(
    userId: string,
    id: string,
    input: { readonly scopes: readonly ApiKeyScope[] },
    ipAddress = "system",
  ): Promise<UserApiKeyDto> {
    assertValidApiKeyScopes(input.scopes, true)
    const scopes = [...input.scopes]
    const apiKey = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userApiKey.findFirst({
        where: { id, userId, revokedAt: null },
        select: apiKeySelect,
      })
      if (!existing) throw new NotFoundException("API key not found")
      const result = await tx.userApiKey.updateMany({
        where: { id, userId, revokedAt: null },
        data: { scopes },
      })
      if (result.count === 0) throw new NotFoundException("API key not found")
      await this.auditLog.recordWithClient(tx, {
        adminEmail: userId,
        action: "api_key.update",
        targetType: "api_key",
        targetId: id,
        detail: {
          name: existing.name,
          previousScopes: existing.scopes,
          scopes,
        },
        ipAddress,
      })
      return { ...existing, scopes }
    })
    return toUserApiKeyDto(apiKey)
  }

  async renameForUser(
    userId: string,
    id: string,
    input: { readonly name: string },
    ipAddress = "system",
  ): Promise<UserApiKeyDto> {
    const name = assertValidApiKeyName(input.name)
    const apiKey = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userApiKey.findFirst({
        where: { id, userId, revokedAt: null },
        select: apiKeySelect,
      })
      if (!existing) throw new NotFoundException("API key not found")
      const result = await tx.userApiKey.updateMany({
        where: { id, userId, revokedAt: null },
        data: { name },
      })
      if (result.count === 0) throw new NotFoundException("API key not found")
      await this.auditLog.recordWithClient(tx, {
        adminEmail: userId,
        action: "api_key.rename",
        targetType: "api_key",
        targetId: id,
        detail: {
          previousName: existing.name,
          name,
        },
        ipAddress,
      })
      return { ...existing, name }
    })
    return toUserApiKeyDto(apiKey)
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
    return {
      userId: apiKey.userId,
      apiKeyId: apiKey.id,
      scopes: normalizeApiKeyScopes(apiKey.scopes),
    }
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

  private async assertTableResources(tx: Prisma.TransactionClient, userId: string, resources: CloudKeyResources): Promise<void> {
    if (resources.mode === "all_owned") return
    const tables = await tx.cloudTable.findMany({ where: { id: { in: resources.tableIds }, deletedAt: null }, select: { id: true, ownerId: true, members: true }, take: 500 })
    if (tables.length !== resources.tableIds.length || tables.some(t => t.ownerId !== userId && !(t.members as unknown as CloudMember[]).some(m => m.userId === userId && Object.values(m.permissions).some(p => p !== "none")))) throw new BadRequestException("表资源不存在或未获授权。")
  }

  async updateTableResourcesForUser(userId: string, id: string, resources: CloudKeyResources, ipAddress = "system"): Promise<UserApiKeyDto> {
    return this.prisma.$transaction(async tx => {
      await this.assertTableResources(tx, userId, resources)
      const existing = await tx.userApiKey.findFirst({ where: { id, userId, revokedAt: null }, select: apiKeySelect })
      if (!existing) throw new NotFoundException("API key not found")
      const result = await tx.userApiKey.updateMany({ where: { id, userId, revokedAt: null }, data: { tableAccessMode: resources.mode, tableIds: resources.tableIds } })
      if (!result.count) throw new NotFoundException("API key not found")
      await this.auditLog.recordWithClient(tx, { adminEmail: userId, action: "api_key.table_resources.update", targetType: "api_key", targetId: id, detail: { previous: { mode: existing.tableAccessMode, tableIds: existing.tableIds }, resources }, ipAddress })
      return toUserApiKeyDto({ ...existing, tableAccessMode: resources.mode, tableIds: resources.tableIds })
    })
  }
}

function toUserApiKeyDto(apiKey: ApiKeyRecord): UserApiKeyDto {
  return {
    ...(apiKey.tableAccessMode ? { tableResources: { mode: apiKey.tableAccessMode as CloudKeyResources["mode"], tableIds: apiKey.tableIds ?? [] } } : {}),
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.keyPrefix,
    scopes: normalizeApiKeyScopes(apiKey.scopes),
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  }
}

function assertValidApiKeyScopes(scopes: readonly string[], allowEmpty: boolean): void {
  if (
    (!allowEmpty && scopes.length === 0)
    || new Set(scopes).size !== scopes.length
    || scopes.some((scope) => !isApiKeyScope(scope))
  ) {
    throw new BadRequestException("API key scopes are invalid.")
  }
}

function assertValidApiKeyName(name: string): string {
  const trimmedName = name.trim()
  if (!trimmedName || trimmedName.length > 80) {
    throw new BadRequestException("API key name is invalid.")
  }
  return trimmedName
}
