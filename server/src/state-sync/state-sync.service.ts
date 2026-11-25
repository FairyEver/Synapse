import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common"
import type { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import {
  STATE_SYNC_OPEN_BASE,
  STATE_SYNC_TOKEN_ROLES,
  STATE_SYNC_WS_CLOSE_CODES,
  isPlainObject,
  parseStateSyncPath,
  readStateSyncPath,
  stateSyncDocCreateSchema,
  stateSyncMutateHttpSchema,
  stateSyncSpaceCreateSchema,
  stateSyncSpaceUpdateSchema,
  stateSyncTokenCreateSchema,
  type StateSyncPresenceMember,
  type StateSyncRole,
} from "@synapse/shared/state-sync-contracts"
import type { PinoLogger } from "nestjs-pino"
import {
  STATE_SYNC_MANAGE_SCOPE,
  STATE_SYNC_READ_SCOPE,
  STATE_SYNC_WRITE_SCOPE,
} from "../api-keys/api-key-capabilities"
import { ApiKeyChangeNotifier } from "../api-keys/api-key-change-notifier"
import { ApiKeyService } from "../api-keys/api-key.service"
import { OpenApiHttpError } from "../open-api/open-api.types"
import { PrismaService } from "../prisma/prisma.service"
import { StateSyncDebugTicketStore, isStateSyncDebugTicket } from "./state-sync-debug-ticket"
import {
  StateSyncHub,
  resolveApiKeyStateSyncWsRole,
  type LoadedDocSnapshot,
  type PersistDocInput,
  type StateSyncCredentialType,
} from "./state-sync-hub"
import {
  createStateSyncDocId,
  createStateSyncTokenSecret,
  getStateSyncTokenPrefix,
  hashStateSyncTokenSecret,
  isStateSyncTokenSecret,
} from "./state-sync-token"

export class StateSyncHttpError extends OpenApiHttpError {
  readonly currentRev?: number
  readonly retryAfterSec?: number

  constructor(
    statusCode: number,
    code: string,
    publicMessage: string,
    extra?: { readonly currentRev?: number; readonly retryAfterSec?: number },
  ) {
    super(statusCode, code, publicMessage)
    this.name = "StateSyncHttpError"
    this.currentRev = extra?.currentRev
    this.retryAfterSec = extra?.retryAfterSec
  }
}

export type StateSyncActor =
  | { readonly kind: "console"; readonly userId: string }
  | {
      readonly kind: "api_key"
      readonly userId: string
      readonly apiKeyId: string
      readonly scopes: readonly string[]
      readonly stateSyncAccessMode: "selected" | "all_owned"
      readonly stateSyncSpaceIds: readonly string[]
    }
  | {
      readonly kind: "space_token"
      readonly spaceId: string
      readonly ownerId: string
      readonly tokenId: string
      readonly role: StateSyncRole
    }

export type ResolvedStateSyncWsCredential = {
  readonly spaceId: string
  readonly docId: string
  readonly ownerId: string
  readonly credentialType: StateSyncCredentialType
  readonly credentialId: string
  readonly role: StateSyncRole
  readonly isObserver: boolean
}

export type StateSyncSpaceDto = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly defaultDocTtlSeconds: number | null
  readonly maxDocs: number
  readonly docCount: number
  readonly onlineCount: number
  readonly tokenCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type StateSyncTokenDto = {
  readonly id: string
  readonly spaceId: string
  readonly name: string
  readonly role: StateSyncRole
  readonly prefix: string
  readonly lastUsedAt: string | null
  readonly createdAt: string
}

export type StateSyncDocSummaryDto = {
  readonly spaceId: string
  readonly docId: string
  readonly rev: number
  readonly onlineCount: number
  readonly ttlSeconds: number | null
  readonly expiresAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type StateSyncDocCreateResult = {
  readonly spaceId: string
  readonly docId: string
  readonly rev: number
  readonly expiresAt: string | null
  readonly wsPath: string
}

export type StateSyncDocGetResult = {
  readonly spaceId: string
  readonly docId: string
  readonly path: string
  readonly exists: boolean
  readonly value: unknown
  readonly rev: number
  readonly expiresAt: string | null
}

export type StateSyncDocMutateResult = {
  readonly rev: number
  readonly changed: boolean
  readonly expiresAt: string | null
}

export type StateSyncPresenceResult = {
  readonly spaceId: string
  readonly docId: string
  readonly count: number
  readonly members: StateSyncPresenceMember[]
}

export type StateSyncPreflightDto = {
  readonly ready: true
  readonly accountId: string
  readonly publicAppUrl: string
  readonly publicHttpBaseUrl: string
  readonly publicWsBaseUrl: string
  readonly audience: "local_only" | "public"
  readonly sdkManifestUrl: string
  readonly stateSyncSdkManifestUrl: string
  readonly latestStateSyncSdkVersion: string
  readonly sdkUrls: {
    readonly browserGlobal: string
    readonly esm: string
    readonly cjs: string
    readonly types: string
  }
}

export type StateSyncSweepResult = {
  readonly deletedCount: number
  readonly skippedActiveCount: number
}

const TOKEN_LAST_USED_THROTTLE_MS = 60_000
const TOKEN_LAST_USED_CACHE_MAX = 5000
const DEFAULT_LIST_DOCS_LIMIT = 50
const MAX_LIST_DOCS_LIMIT = 200
const EXPIRY_SWEEP_BATCH_SIZE = 500

function apiKeyCanAccessSpace(
  mode: "selected" | "all_owned",
  spaceIds: readonly string[],
  spaceId: string,
): boolean {
  return mode === "all_owned" || spaceIds.includes(spaceId)
}

function parseBody<T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error?: { issues?: Array<{ message?: string }> } } },
  input: unknown,
  fallbackMessage: string,
): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error?.issues?.[0]?.message
    throw new OpenApiHttpError(400, "INVALID_REQUEST", detail || fallbackMessage)
  }
  return parsed.data
}

function isPrismaUniqueError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
}

function isExpiredAt(expiresAt: Date | null, nowMs: number): boolean {
  return expiresAt !== null && expiresAt.getTime() <= nowMs
}

@Injectable()
export class StateSyncService implements OnModuleInit, OnModuleDestroy {
  private unsubscribeNotifier: (() => void) | null = null
  private expirySweepTimer: ReturnType<typeof setInterval> | null = null
  private readonly tokenLastUsedCache = new Map<string, number>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly apiKeyNotifier: ApiKeyChangeNotifier,
    readonly hub: StateSyncHub,
    private readonly debugTickets: StateSyncDebugTicketStore,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.unsubscribeNotifier = this.apiKeyNotifier.onChange((event) => {
      this.hub.handleApiKeyChange(event)
    })
    this.hub.configurePersister(
      (docKey) => this.persistHubDoc(docKey),
      (error, spaceId, docId) => {
        this.logger?.warn({
          spaceId,
          docId,
          errorName: error instanceof Error ? error.name : typeof error,
        }, "State sync document persistence failed")
      },
    )

    const sweepIntervalMs = this.hub.getLimits().expirySweepIntervalMs
    this.expirySweepTimer = setInterval(() => {
      void this.sweepExpiredDocs().catch((error: unknown) => {
        this.logger?.warn({
          errorName: error instanceof Error ? error.name : typeof error,
        }, "State sync expiry sweep failed")
      })
    }, sweepIntervalMs)
    this.expirySweepTimer.unref?.()
  }

  onModuleDestroy(): void {
    this.unsubscribeNotifier?.()
    this.unsubscribeNotifier = null
    if (this.expirySweepTimer) {
      clearInterval(this.expirySweepTimer)
      this.expirySweepTimer = null
    }
  }

  /**
   * Open API authentication: strictly accepts `Authorization: Bearer <sys_... or syn_sk_...>`.
   * Cookies and standard SY login JWTs are never accepted.
   */
  async authenticateOpenCredential(
    authorizationHeader: string | undefined,
    targetSpaceId: string | null = null,
  ): Promise<StateSyncActor | null> {
    if (typeof authorizationHeader !== "string") return null
    const match = /^Bearer ([^\s]+)$/u.exec(authorizationHeader)
    const secret = match?.[1]
    if (!secret) return null
    return this.authenticateOpenSecret(secret, targetSpaceId)
  }

  async authenticateWsToken(
    spaceId: string,
    docId: string,
    token: string,
  ): Promise<ResolvedStateSyncWsCredential | null> {
    if (typeof token !== "string" || token.length === 0) return null

    if (isStateSyncDebugTicket(token)) {
      const consumed = this.debugTickets.consume(token, spaceId, docId)
      if (!consumed) return null
      const space = await this.prisma.stateSyncSpace.findUnique({
        where: { id: spaceId },
        include: { owner: { select: { status: true } } },
      })
      if (!space || space.ownerId !== consumed.ownerId || space.owner.status !== "active") {
        return null
      }
      const doc = await this.loadDocForGateway(spaceId, docId)
      if (!doc) return null
      return {
        spaceId,
        docId,
        ownerId: space.ownerId,
        credentialType: "console_ticket",
        credentialId: `dbg_${randomUUID().replaceAll("-", "")}`,
        role: "read",
        isObserver: true,
      }
    }

    const actor = await this.authenticateOpenSecret(token, spaceId)
    if (!actor) return null

    if (actor.kind === "space_token") {
      if (actor.spaceId !== spaceId) return null
      const doc = await this.loadDocForGateway(spaceId, docId)
      if (!doc) return null
      return {
        spaceId,
        docId,
        ownerId: actor.ownerId,
        credentialType: "space_token",
        credentialId: actor.tokenId,
        role: actor.role,
        isObserver: false,
      }
    }

    if (actor.kind === "api_key") {
      const role = resolveApiKeyStateSyncWsRole(actor.scopes)
      if (!role || !apiKeyCanAccessSpace(actor.stateSyncAccessMode, actor.stateSyncSpaceIds, spaceId)) {
        return null
      }
      const space = await this.prisma.stateSyncSpace.findUnique({
        where: { id: spaceId },
        include: { owner: { select: { status: true } } },
      })
      if (!space || space.ownerId !== actor.userId || space.owner.status !== "active") {
        return null
      }
      const doc = await this.loadDocForGateway(spaceId, docId)
      if (!doc) return null
      return {
        spaceId,
        docId,
        ownerId: space.ownerId,
        credentialType: "api_key",
        credentialId: actor.apiKeyId,
        role,
        isObserver: false,
      }
    }

    return null
  }

  async loadDocForGateway(spaceId: string, docId: string): Promise<LoadedDocSnapshot | null> {
    const nowMs = Date.now()
    const handle = this.hub.getDocHandle(spaceId, docId)
    if (handle) {
      if (!this.hub.hasActiveConnections(spaceId, docId) && isExpiredAt(handle.expiresAt, nowMs)) {
        return null
      }
      const rootRead = this.hub.readDocPath(spaceId, docId, "/")
      if (rootRead && isPlainObject(rootRead.value)) {
        const row = await this.prisma.stateSyncDoc.findUnique({
          where: { spaceId_id: { spaceId, id: docId } },
          select: { ttlSeconds: true },
        })
        if (!row) return null
        return {
          spaceId,
          docId,
          data: rootRead.value,
          rev: rootRead.rev,
          ttlSeconds: row.ttlSeconds,
          expiresAt: rootRead.expiresAt,
        }
      }
    }

    const row = await this.prisma.stateSyncDoc.findUnique({
      where: { spaceId_id: { spaceId, id: docId } },
    })
    if (!row || isExpiredAt(row.expiresAt, nowMs)) {
      return null
    }
    return {
      spaceId: row.spaceId,
      docId: row.id,
      data: isPlainObject(row.data) ? row.data : {},
      rev: row.rev,
      ttlSeconds: row.ttlSeconds,
      expiresAt: row.expiresAt,
    }
  }

  getPreflight(actor: StateSyncActor): StateSyncPreflightDto {
    if (actor.kind !== "console") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "仅登录控制台或桌面 MCP 可读取状态同步发布前检查。")
    }
    const configured = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/u, "")
    const publicHttpBaseUrl = `${configured}${STATE_SYNC_OPEN_BASE}`
    const publicWsBaseUrl = `${configured.replace(/^https:\/\//iu, "wss://").replace(/^http:\/\//iu, "ws://")}${STATE_SYNC_OPEN_BASE}`
    const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(configured)
    const latestVersion = (process.env.STATE_SYNC_SDK_VERSION || "1.0.0").trim() || "1.0.0"
    const major = `v${latestVersion.split(".")[0] || "1"}`
    return {
      ready: true,
      accountId: actor.userId,
      publicAppUrl: configured,
      publicHttpBaseUrl,
      publicWsBaseUrl,
      audience: isLocal ? "local_only" : "public",
      sdkManifestUrl: `${configured}/sdk/manifest.json`,
      stateSyncSdkManifestUrl: `${configured}/sdk/state-sync/manifest.json`,
      latestStateSyncSdkVersion: latestVersion,
      sdkUrls: {
        browserGlobal: `${configured}/sdk/state-sync/${major}/state-sync.global.min.js`,
        esm: `${configured}/sdk/state-sync/${major}/state-sync.esm.min.js`,
        cjs: `${configured}/sdk/state-sync/${major}/state-sync.cjs`,
        types: `${configured}/sdk/state-sync/${major}/index.d.ts`,
      },
    }
  }

  async listSpaces(actor: StateSyncActor): Promise<{ readonly data: StateSyncSpaceDto[] }> {
    if (actor.kind === "space_token") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "空间专属凭证不能列出同步空间目录。")
    }
    let idFilter: { in: string[] } | undefined
    if (actor.kind === "api_key") {
      if (!actor.scopes.includes(STATE_SYNC_MANAGE_SCOPE)) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 state_sync.manage 权限。")
      }
      if (actor.stateSyncAccessMode !== "all_owned") {
        if (actor.stateSyncSpaceIds.length === 0) return { data: [] }
        idFilter = { in: [...actor.stateSyncSpaceIds] }
      }
    }

    const now = new Date()
    const rows = await this.prisma.stateSyncSpace.findMany({
      where: {
        ownerId: actor.userId,
        ...(idFilter ? { id: idFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            tokens: { where: { revokedAt: null } },
            docs: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
      take: 200,
    })

    return {
      data: rows.map((row) => this.toSpaceDto(row, row._count.docs, row._count.tokens)),
    }
  }

  async createSpace(actor: StateSyncActor, body: unknown): Promise<StateSyncSpaceDto> {
    if (actor.kind === "space_token") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "空间专属凭证不能创建同步空间。")
    }
    if (actor.kind === "api_key") {
      if (!actor.scopes.includes(STATE_SYNC_MANAGE_SCOPE) || actor.stateSyncAccessMode !== "all_owned") {
        throw new OpenApiHttpError(
          403,
          "INSUFFICIENT_SCOPE",
          "仅具备 state_sync.manage 且范围为“全部自有空间”的密钥可创建同步空间。",
        )
      }
    }

    const parsed = parseBody(stateSyncSpaceCreateSchema, body, "同步空间创建参数无效。")
    const limits = this.hub.getLimits()
    if (parsed.maxDocs > limits.maxDocsPerSpaceCap) {
      throw new OpenApiHttpError(400, "INVALID_REQUEST", `空间最大房间数不能超过 ${limits.maxDocsPerSpaceCap}。`)
    }

    const created = await this.prisma.stateSyncSpace.create({
      data: {
        id: `ss_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        ownerId: actor.userId,
        name: parsed.name,
        description: parsed.description,
        defaultDocTtlSeconds: parsed.defaultDocTtlSeconds,
        maxDocs: parsed.maxDocs,
      },
    })
    return this.toSpaceDto(created, 0, 0)
  }

  async getSpace(actor: StateSyncActor, spaceId: string): Promise<StateSyncSpaceDto> {
    const space = await this.requireManagedSpace(actor, spaceId)
    return this.toSpaceDto(space, space._count.docs, space._count.tokens)
  }

  async updateSpace(actor: StateSyncActor, spaceId: string, body: unknown): Promise<StateSyncSpaceDto> {
    await this.requireManagedSpace(actor, spaceId)
    const parsed = parseBody(stateSyncSpaceUpdateSchema, body, "同步空间更新参数无效。")
    const limits = this.hub.getLimits()
    if (parsed.maxDocs !== undefined && parsed.maxDocs > limits.maxDocsPerSpaceCap) {
      throw new OpenApiHttpError(400, "INVALID_REQUEST", `空间最大房间数不能超过 ${limits.maxDocsPerSpaceCap}。`)
    }

    const now = new Date()
    const updated = await this.prisma.stateSyncSpace.update({
      where: { id: spaceId },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
        ...(parsed.defaultDocTtlSeconds !== undefined ? { defaultDocTtlSeconds: parsed.defaultDocTtlSeconds } : {}),
        ...(parsed.maxDocs !== undefined ? { maxDocs: parsed.maxDocs } : {}),
      },
      include: {
        _count: {
          select: {
            tokens: { where: { revokedAt: null } },
            docs: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    })
    return this.toSpaceDto(updated, updated._count.docs, updated._count.tokens)
  }

  async deleteSpace(actor: StateSyncActor, spaceId: string): Promise<{ readonly deleted: true }> {
    await this.requireManagedSpace(actor, spaceId)
    const result = await this.prisma.stateSyncSpace.deleteMany({ where: { id: spaceId } })
    if (result.count === 0) {
      throw new OpenApiHttpError(404, "SPACE_NOT_FOUND", "同步空间不存在。")
    }
    this.hub.disconnectBySpace(spaceId, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Space deleted")
    return { deleted: true }
  }

  async listTokens(actor: StateSyncActor, spaceId: string): Promise<{ readonly data: StateSyncTokenDto[] }> {
    await this.requireManagedSpace(actor, spaceId)
    const rows = await this.prisma.stateSyncToken.findMany({
      where: { spaceId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    })
    return { data: rows.map(toStateSyncTokenDto) }
  }

  async createToken(
    actor: StateSyncActor,
    spaceId: string,
    body: unknown,
  ): Promise<{ readonly token: StateSyncTokenDto; readonly secret: string }> {
    await this.requireManagedSpace(actor, spaceId)
    const parsed = parseBody(stateSyncTokenCreateSchema, body, "空间凭证参数无效。")
    const limits = this.hub.getLimits()
    const secret = createStateSyncTokenSecret()

    const created = await this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.stateSyncToken.count({ where: { spaceId, revokedAt: null } })
      if (activeCount >= limits.maxTokensPerSpace) {
        throw new OpenApiHttpError(422, "TOKEN_LIMIT_EXCEEDED", `单空间最多保留 ${limits.maxTokensPerSpace} 个有效凭证。`)
      }
      return tx.stateSyncToken.create({
        data: {
          id: `sst_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
          spaceId,
          name: parsed.name,
          role: parsed.role,
          tokenHash: hashStateSyncTokenSecret(secret),
          tokenPrefix: getStateSyncTokenPrefix(secret),
        },
      })
    })
    return { token: toStateSyncTokenDto(created), secret }
  }

  async revokeToken(actor: StateSyncActor, spaceId: string, tokenId: string): Promise<{ readonly revoked: true }> {
    await this.requireManagedSpace(actor, spaceId)
    const result = await this.prisma.stateSyncToken.updateMany({
      where: { id: tokenId, spaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count === 0) {
      throw new OpenApiHttpError(404, "TOKEN_NOT_FOUND", "空间凭证不存在或已撤销。")
    }
    this.hub.disconnectByToken(tokenId, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "State sync token revoked")
    return { revoked: true }
  }

  async listDocs(
    actor: StateSyncActor,
    spaceId: string,
    query: { readonly limit?: string | number; readonly cursor?: string } = {},
  ): Promise<{ readonly data: StateSyncDocSummaryDto[]; readonly nextCursor: string | null }> {
    await this.requireManagedSpace(actor, spaceId)

    let limit = DEFAULT_LIST_DOCS_LIMIT
    if (query.limit !== undefined && query.limit !== "") {
      const parsedLimit = typeof query.limit === "number" ? query.limit : Number(query.limit)
      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIST_DOCS_LIMIT) {
        throw new OpenApiHttpError(400, "INVALID_REQUEST", `limit 必须为 1 到 ${MAX_LIST_DOCS_LIMIT} 之间的整数。`)
      }
      limit = parsedLimit
    }

    const cursor = typeof query.cursor === "string" && query.cursor.trim().length > 0
      ? query.cursor.trim()
      : undefined

    const now = new Date()
    const rows = await this.prisma.stateSyncDoc.findMany({
      where: {
        spaceId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { spaceId_id: { spaceId, id: cursor } }, skip: 1 } : {}),
    })

    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const liveStats = this.hub.getLiveDocStats(spaceId)
    const liveByDocId = new Map(liveStats.docs.map((item) => [item.docId, item]))

    const data: StateSyncDocSummaryDto[] = pageRows.map((row) => {
      const live = liveByDocId.get(row.id)
      return {
        spaceId: row.spaceId,
        docId: row.id,
        rev: live ? Number(live.rev) : Number(row.rev),
        onlineCount: live?.onlineCount ?? 0,
        ttlSeconds: row.ttlSeconds,
        expiresAt: live
          ? (live.expiresAt?.toISOString() ?? null)
          : (row.expiresAt?.toISOString() ?? null),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    })

    return {
      data,
      nextCursor: hasMore ? pageRows[pageRows.length - 1]!.id : null,
    }
  }

  async createDoc(
    actor: StateSyncActor,
    spaceId: string,
    body: unknown,
    options: { readonly enforceHttpRateLimit?: boolean; readonly onRateLimited?: (retryAfterSec: number) => void } = {},
  ): Promise<StateSyncDocCreateResult> {
    const space = await this.requireRuntimeSpace(actor, spaceId, "create_doc")
    const parsed = parseBody(stateSyncDocCreateSchema, body ?? {}, "房间创建参数无效。")

    const isManager = actor.kind === "console"
      || (actor.kind === "api_key" && actor.scopes.includes(STATE_SYNC_MANAGE_SCOPE))

    if (parsed.docId !== undefined && !isManager) {
      throw new OpenApiHttpError(
        403,
        actor.kind === "space_token" ? "FORBIDDEN_ROLE" : "INSUFFICIENT_SCOPE",
        "当前凭证不支持自定义房间 ID，请留空由服务端生成随机 ID。",
      )
    }

    let ttlSeconds: number | null
    if (parsed.ttlSeconds === undefined) {
      ttlSeconds = space.defaultDocTtlSeconds
    } else if (parsed.ttlSeconds === null) {
      if (!isManager && space.defaultDocTtlSeconds !== null) {
        throw new OpenApiHttpError(
          403,
          "TTL_POLICY_VIOLATION",
          "当前空间已配置默认过期时间，运行态凭证不能创建永不过期的房间。",
        )
      }
      ttlSeconds = null
    } else {
      if (!isManager && space.defaultDocTtlSeconds !== null && parsed.ttlSeconds > space.defaultDocTtlSeconds) {
        throw new OpenApiHttpError(
          403,
          "TTL_POLICY_VIOLATION",
          `房间过期时间不能超过空间默认值（${space.defaultDocTtlSeconds} 秒）。`,
        )
      }
      ttlSeconds = parsed.ttlSeconds
    }

    if (options.enforceHttpRateLimit) {
      const rate = this.hub.consumeDocCreateRate(spaceId)
      if (!rate.allowed) {
        options.onRateLimited?.(rate.retryAfterSec)
        throw new StateSyncHttpError(429, "RATE_LIMITED", "创建房间过于频繁，请稍后重试。", {
          retryAfterSec: rate.retryAfterSec,
        })
      }
    }

    const docId = parsed.docId ?? createStateSyncDocId()
    const initialData = parsed.initialData ?? {}
    const now = new Date()
    const expiresAt = ttlSeconds !== null ? new Date(now.getTime() + ttlSeconds * 1000) : null

    let shouldEvictExpiredDoc = false

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (parsed.docId !== undefined) {
          const existing = await tx.stateSyncDoc.findUnique({
            where: { spaceId_id: { spaceId, id: docId } },
          })
          if (existing) {
            const handle = this.hub.getDocHandle(spaceId, docId)
            const hasActiveConn = this.hub.hasActiveConnections(spaceId, docId)
              || (handle !== null && (handle.onlineCount > 0 || handle.observerCount > 0))
            const isHubActiveOrRenewed = handle !== null
              && (handle.dirty || handle.expiresAt === null || handle.expiresAt.getTime() >= now.getTime())
            const existingExpired = isExpiredAt(existing.expiresAt, now.getTime())
              && !hasActiveConn
              && !isHubActiveOrRenewed
            if (!existingExpired) {
              throw new OpenApiHttpError(409, "DOC_ALREADY_EXISTS", "该房间 ID 已存在。")
            }
            await tx.stateSyncDoc.deleteMany({ where: { spaceId, id: docId } })
            shouldEvictExpiredDoc = true
          }
        }

        const activeCount = await tx.stateSyncDoc.count({
          where: {
            spaceId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        })
        if (activeCount >= space.maxDocs) {
          throw new OpenApiHttpError(422, "DOC_LIMIT_EXCEEDED", `当前空间最多保留 ${space.maxDocs} 个未过期房间。`)
        }

        return tx.stateSyncDoc.create({
          data: {
            id: docId,
            spaceId,
            data: initialData as Prisma.InputJsonValue,
            rev: BigInt(0),
            ttlSeconds,
            expiresAt,
          },
        })
      })

      if (shouldEvictExpiredDoc) {
        this.hub.disconnectByDoc(spaceId, docId, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Document expired")
      }

      return {
        spaceId: created.spaceId,
        docId: created.id,
        rev: Number(created.rev),
        expiresAt: created.expiresAt?.toISOString() ?? null,
        wsPath: `${STATE_SYNC_OPEN_BASE}/spaces/${created.spaceId}/docs/${created.id}/ws`,
      }
    } catch (error) {
      if (error instanceof OpenApiHttpError) throw error
      if (isPrismaUniqueError(error)) {
        throw new OpenApiHttpError(409, "DOC_ALREADY_EXISTS", "该房间 ID 已存在。")
      }
      throw error
    }
  }

  async getDoc(
    actor: StateSyncActor,
    spaceId: string,
    docId: string,
    pathParam?: string,
  ): Promise<StateSyncDocGetResult> {
    await this.requireRuntimeSpace(actor, spaceId, "read")

    const targetPath = pathParam === undefined || pathParam === "" ? "/" : pathParam
    const parsedPath = parseStateSyncPath(targetPath)
    if (!parsedPath.ok) {
      throw new OpenApiHttpError(400, "INVALID_REQUEST", parsedPath.message)
    }

    const nowMs = Date.now()
    const handle = this.hub.getDocHandle(spaceId, docId)
    if (handle) {
      if (!this.hub.hasActiveConnections(spaceId, docId) && isExpiredAt(handle.expiresAt, nowMs)) {
        throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
      }
      const read = this.hub.readDocPath(spaceId, docId, parsedPath.normalized)
      if (read) {
        return {
          spaceId,
          docId,
          path: parsedPath.normalized,
          exists: read.exists,
          value: read.value,
          rev: Number(read.rev),
          expiresAt: read.expiresAt?.toISOString() ?? null,
        }
      }
    }

    const row = await this.prisma.stateSyncDoc.findUnique({
      where: { spaceId_id: { spaceId, id: docId } },
    })
    if (!row || isExpiredAt(row.expiresAt, nowMs)) {
      throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
    }

    const root = isPlainObject(row.data) ? row.data : {}
    const read = readStateSyncPath(root, parsedPath.normalized)
    return {
      spaceId: row.spaceId,
      docId: row.id,
      path: parsedPath.normalized,
      exists: read.exists,
      value: read.value,
      rev: Number(row.rev),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    }
  }

  async mutateDoc(
    actor: StateSyncActor,
    spaceId: string,
    docId: string,
    body: unknown,
    options: { readonly enforceHttpRateLimit?: boolean; readonly onRateLimited?: (retryAfterSec: number) => void } = {},
  ): Promise<StateSyncDocMutateResult> {
    await this.requireRuntimeSpace(actor, spaceId, "write")
    const parsed = parseBody(stateSyncMutateHttpSchema, body, "状态写入参数无效。")

    const nowMs = Date.now()
    const handle = this.hub.getDocHandle(spaceId, docId)
    if (handle) {
      if (!this.hub.hasActiveConnections(spaceId, docId) && isExpiredAt(handle.expiresAt, nowMs)) {
        throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
      }
    } else {
      const snapshot = await this.loadDocForGateway(spaceId, docId)
      if (!snapshot) {
        throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
      }
      this.hub.loadOrAttachDoc(snapshot)
    }

    const result = await this.hub.mutate(spaceId, docId, {
      op: parsed.op,
      path: parsed.path,
      value: parsed.value,
      expectedRev: parsed.expectedRev,
      echo: true,
      actor: {
        connectionId: null,
        clientId: parsed.actorClientId ?? (actor.kind === "console" ? "console" : null),
        clientName: parsed.actorName ?? (actor.kind === "console" ? "Console" : null),
      },
      syncPersist: true,
      skipRateLimit: !options.enforceHttpRateLimit,
    })

    if (!result.ok) {
      switch (result.code) {
        case "REV_CONFLICT":
          throw new StateSyncHttpError(409, "REV_CONFLICT", result.message, {
            currentRev: result.currentRev !== undefined ? Number(result.currentRev) : undefined,
          })
        case "RATE_LIMITED": {
          const retryAfterSec = result.retryAfterSec ?? 1
          options.onRateLimited?.(retryAfterSec)
          throw new StateSyncHttpError(429, "RATE_LIMITED", result.message, { retryAfterSec })
        }
        case "DOC_NOT_FOUND":
          throw new OpenApiHttpError(404, "DOC_NOT_FOUND", result.message)
        case "PATH_CONFLICT":
          throw new OpenApiHttpError(409, "PATH_CONFLICT", result.message)
        case "DOC_TOO_LARGE":
          throw new OpenApiHttpError(413, "DOC_TOO_LARGE", result.message)
        case "PAYLOAD_TOO_LARGE":
          throw new OpenApiHttpError(413, "PAYLOAD_TOO_LARGE", result.message)
        case "SHUTTING_DOWN":
          throw new OpenApiHttpError(503, "SHUTTING_DOWN", result.message)
        case "PERSIST_FAILED":
          throw new OpenApiHttpError(500, "PERSIST_FAILED", result.message)
        case "INVALID_INPUT":
        default:
          throw new OpenApiHttpError(400, "INVALID_REQUEST", result.message)
      }
    }

    return {
      rev: Number(result.rev),
      changed: result.changed,
      expiresAt: result.expiresAt?.toISOString() ?? null,
    }
  }

  async deleteDoc(actor: StateSyncActor, spaceId: string, docId: string): Promise<{ readonly deleted: true }> {
    await this.requireManagedSpace(actor, spaceId)
    const result = await this.prisma.stateSyncDoc.deleteMany({
      where: { spaceId, id: docId },
    })
    if (result.count === 0) {
      throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在。")
    }
    this.hub.disconnectByDoc(spaceId, docId, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Document deleted")
    return { deleted: true }
  }

  async getPresence(actor: StateSyncActor, spaceId: string, docId: string): Promise<StateSyncPresenceResult> {
    await this.requireRuntimeSpace(actor, spaceId, "presence")
    const nowMs = Date.now()
    const handle = this.hub.getDocHandle(spaceId, docId)
    if (handle) {
      if (!this.hub.hasActiveConnections(spaceId, docId) && isExpiredAt(handle.expiresAt, nowMs)) {
        throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
      }
    } else {
      const row = await this.prisma.stateSyncDoc.findUnique({
        where: { spaceId_id: { spaceId, id: docId } },
        select: { expiresAt: true },
      })
      if (!row || isExpiredAt(row.expiresAt, nowMs)) {
        throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
      }
    }
    const members = this.hub.getPresence(spaceId, docId)
    return { spaceId, docId, count: members.length, members }
  }

  async issueDebugTicket(
    actor: StateSyncActor,
    spaceId: string,
    docId: string,
  ): Promise<{ readonly ticket: string; readonly expiresAt: string }> {
    if (actor.kind !== "console") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "仅控制台登录态可签发调试票据。")
    }
    await this.requireManagedSpace(actor, spaceId)
    const doc = await this.loadDocForGateway(spaceId, docId)
    if (!doc) {
      throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已过期。")
    }
    return this.debugTickets.issue(spaceId, docId, actor.userId)
  }

  async sweepExpiredDocs(now = new Date()): Promise<StateSyncSweepResult> {
    const expiredRows = await this.prisma.stateSyncDoc.findMany({
      where: {
        expiresAt: { not: null, lt: now },
      },
      select: { spaceId: true, id: true, expiresAt: true },
      take: EXPIRY_SWEEP_BATCH_SIZE,
    })

    let deletedCount = 0
    let skippedActiveCount = 0

    for (const row of expiredRows) {
      const handle = this.hub.getDocHandle(row.spaceId, row.id)
      const isActiveInHub = this.hub.hasActiveConnections(row.spaceId, row.id)
        || (handle !== null && (handle.onlineCount > 0 || handle.observerCount > 0))
      if (isActiveInHub) {
        skippedActiveCount += 1
        continue
      }
      if (handle !== null && (handle.dirty || handle.expiresAt === null || handle.expiresAt.getTime() >= now.getTime())) {
        skippedActiveCount += 1
        continue
      }

      const deleted = await this.prisma.stateSyncDoc.deleteMany({
        where: {
          spaceId: row.spaceId,
          id: row.id,
          expiresAt: { not: null, lt: now },
        },
      })
      if (deleted.count > 0) {
        deletedCount += deleted.count
        if (handle !== null) {
          this.hub.disconnectByDoc(row.spaceId, row.id, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Document expired")
        }
      }
    }

    return { deletedCount, skippedActiveCount }
  }

  private async authenticateOpenSecret(secret: string, targetSpaceId: string | null): Promise<StateSyncActor | null> {
    if (isStateSyncTokenSecret(secret)) {
      const tokenRow = await this.prisma.stateSyncToken.findUnique({
        where: { tokenHash: hashStateSyncTokenSecret(secret) },
        include: { space: { include: { owner: { select: { status: true } } } } },
      })
      if (!tokenRow || tokenRow.revokedAt || tokenRow.space.owner.status !== "active") {
        return null
      }
      if (targetSpaceId && tokenRow.spaceId !== targetSpaceId) {
        return null
      }
      if (!STATE_SYNC_TOKEN_ROLES.includes(tokenRow.role as StateSyncRole)) {
        return null
      }
      this.touchTokenLastUsed(tokenRow.id)
      return {
        kind: "space_token",
        spaceId: tokenRow.spaceId,
        ownerId: tokenRow.space.ownerId,
        tokenId: tokenRow.id,
        role: tokenRow.role as StateSyncRole,
      }
    }

    const principal = await this.apiKeys.verifyOpenApiSecret(secret)
    if (!principal) return null
    void this.apiKeys.touchLastUsed(principal.apiKeyId)
    return {
      kind: "api_key",
      userId: principal.userId,
      apiKeyId: principal.apiKeyId,
      scopes: principal.scopes,
      stateSyncAccessMode: principal.stateSyncAccessMode ?? "selected",
      stateSyncSpaceIds: principal.stateSyncSpaceIds ?? [],
    }
  }

  private async persistHubDoc(input: PersistDocInput): Promise<void> {
    const result = await this.prisma.stateSyncDoc.updateMany({
      where: {
        spaceId: input.spaceId,
        id: input.docId,
      },
      data: {
        data: input.data as Prisma.InputJsonValue,
        rev: input.rev,
        expiresAt: input.expiresAt,
      },
    })
    if (result.count === 0) {
      this.hub.disconnectByDoc(input.spaceId, input.docId, STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Document deleted")
      throw new OpenApiHttpError(404, "DOC_NOT_FOUND", "房间不存在或已删除。")
    }
  }

  private async requireManagedSpace(actor: StateSyncActor, spaceId: string) {
    if (actor.kind === "space_token") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "空间专属凭证不能执行管理操作。")
    }
    if (actor.kind === "api_key") {
      if (!actor.scopes.includes(STATE_SYNC_MANAGE_SCOPE)) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 state_sync.manage 权限。")
      }
      if (!apiKeyCanAccessSpace(actor.stateSyncAccessMode, actor.stateSyncSpaceIds, spaceId)) {
        throw new OpenApiHttpError(403, "SPACE_ACCESS_DENIED", "API 密钥未授权访问此同步空间。")
      }
    }

    const now = new Date()
    const space = await this.prisma.stateSyncSpace.findFirst({
      where: { id: spaceId, ownerId: actor.userId },
      include: {
        _count: {
          select: {
            tokens: { where: { revokedAt: null } },
            docs: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } },
          },
        },
      },
    })
    if (!space) {
      throw new OpenApiHttpError(404, "SPACE_NOT_FOUND", "同步空间不存在。")
    }
    return space
  }

  private async requireRuntimeSpace(
    actor: StateSyncActor,
    spaceId: string,
    action: "read" | "write" | "create_doc" | "presence",
  ) {
    if (actor.kind === "console") {
      return this.requireManagedSpace(actor, spaceId)
    }

    if (actor.kind === "space_token") {
      if (actor.spaceId !== spaceId) {
        throw new OpenApiHttpError(403, "SPACE_ACCESS_DENIED", "凭证不属于此同步空间。")
      }
      if (action === "write" && actor.role === "read") {
        throw new OpenApiHttpError(403, "FORBIDDEN_ROLE", "当前只读凭证不能写入房间状态。")
      }
      if (action === "create_doc" && actor.role !== "create_write") {
        throw new OpenApiHttpError(403, "FORBIDDEN_ROLE", "仅 create_write 空间凭证允许创建房间。")
      }
      const space = await this.prisma.stateSyncSpace.findUnique({ where: { id: spaceId } })
      if (!space) {
        throw new OpenApiHttpError(404, "SPACE_NOT_FOUND", "同步空间不存在。")
      }
      return space
    }

    // api_key
    if (!apiKeyCanAccessSpace(actor.stateSyncAccessMode, actor.stateSyncSpaceIds, spaceId)) {
      throw new OpenApiHttpError(403, "SPACE_ACCESS_DENIED", "API 密钥未授权访问此同步空间。")
    }
    if (action === "create_doc") {
      if (!actor.scopes.includes(STATE_SYNC_WRITE_SCOPE) && !actor.scopes.includes(STATE_SYNC_MANAGE_SCOPE)) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 state_sync.write 或 state_sync.manage 权限。")
      }
    } else if (action === "write") {
      if (!actor.scopes.includes(STATE_SYNC_WRITE_SCOPE)) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 state_sync.write 权限。")
      }
    } else if (action === "read" || action === "presence") {
      if (!actor.scopes.includes(STATE_SYNC_READ_SCOPE) && !actor.scopes.includes(STATE_SYNC_WRITE_SCOPE)) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少状态同步读取权限。")
      }
    }

    const space = await this.prisma.stateSyncSpace.findFirst({ where: { id: spaceId, ownerId: actor.userId } })
    if (!space) {
      throw new OpenApiHttpError(404, "SPACE_NOT_FOUND", "同步空间不存在。")
    }
    return space
  }

  private touchTokenLastUsed(tokenId: string): void {
    const now = Date.now()
    const prev = this.tokenLastUsedCache.get(tokenId) ?? 0
    if (now - prev < TOKEN_LAST_USED_THROTTLE_MS) return
    if (this.tokenLastUsedCache.size >= TOKEN_LAST_USED_CACHE_MAX) {
      const oldestKey = this.tokenLastUsedCache.keys().next().value
      if (oldestKey) this.tokenLastUsedCache.delete(oldestKey)
    }
    this.tokenLastUsedCache.set(tokenId, now)
    void this.prisma.stateSyncToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { lastUsedAt: new Date(now) },
    }).catch((error: unknown) => {
      this.logger?.warn({
        tokenId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "State sync token last-used update failed")
    })
  }

  private toSpaceDto(
    row: {
      readonly id: string
      readonly name: string
      readonly description: string
      readonly defaultDocTtlSeconds: number | null
      readonly maxDocs: number
      readonly createdAt: Date
      readonly updatedAt: Date
    },
    docCount: number,
    tokenCount: number,
  ): StateSyncSpaceDto {
    const liveStats = this.hub.getLiveDocStats(row.id)
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      defaultDocTtlSeconds: row.defaultDocTtlSeconds,
      maxDocs: row.maxDocs,
      docCount,
      onlineCount: liveStats.totalOnlineCount,
      tokenCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}

function toStateSyncTokenDto(row: {
  readonly id: string
  readonly spaceId: string
  readonly name: string
  readonly role: string
  readonly tokenPrefix: string
  readonly lastUsedAt: Date | null
  readonly createdAt: Date
}): StateSyncTokenDto {
  return {
    id: row.id,
    spaceId: row.spaceId,
    name: row.name,
    role: row.role as StateSyncRole,
    prefix: row.tokenPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}
