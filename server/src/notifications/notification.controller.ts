import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, UseFilters, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request } from "express"
import { z } from "zod"
import { NOTIFICATION_SEND_SCOPE } from "../api-keys/api-key-capabilities"
import type { OpenApiPrincipal } from "../api-keys/api-key.service"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import {
  OPEN_API_NOTIFICATIONS_BASE_PATH,
  openApiNotificationKeyedMessageSchema,
  openApiNotificationMessageSchema,
  openApiNotificationPathSchema,
  openApiNotificationQuerySchema,
  type OpenApiNotificationMessage,
} from "../open-api/open-api-contract"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
import { OpenApiHttpError, requireOpenApiPrincipal, type OpenApiRequest } from "../open-api/open-api.types"
import { NotificationApiKeyGuard } from "./notification-api-key.guard"
import { NotificationService } from "./notification.service"

const idempotencyKeyPattern = /^[A-Za-z0-9_-]{8,120}$/u

/** 三种发送形状写入同一个账号的通知队列，共用同一档限流。 */
const notificationThrottle = { default: { ttl: 60_000, limit: 60 } } as const

const listSchema = z.object({
  cursor: z.string().min(1).max(120).optional(),
  filter: z.enum(["all", "unread", "pending"]).optional(),
})

const deleteAllSchema = z.object({ filter: z.enum(["all", "pending"]) })

const internalSchema = z.object({
  source: z.enum(["system-notifier", "terminal-complete"]),
  sourceKey: z.string().min(8).max(160).optional(),
  title: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(512),
  targetId: z.string().min(1).max(120).optional(),
  deviceId: z.string().min(1).max(120).optional(),
}).strict()

type AuthedRequest = Request & { readonly user: { readonly id: string } }

@Controller("/api/notifications")
@UseGuards(UserAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Post("internal")
  async createInternal(@Req() request: AuthedRequest, @Body() body: unknown) {
    const parsed = internalSchema.safeParse(body)
    if (!parsed.success) throw badRequestFromZodError(parsed.error, "通知参数无效。")
    const item = await this.notifications.create({ ...parsed.data, userId: request.user.id })
    return { id: item.id }
  }

  @Get()
  async list(@Req() request: AuthedRequest, @Query() query: unknown) {
    const parsed = listSchema.safeParse(query)
    if (!parsed.success) throw badRequestFromZodError(parsed.error, "查询参数无效。")
    return this.notifications.list(request.user.id, parsed.data)
  }

  @Get("count")
  async count(@Req() request: AuthedRequest) {
    return { unread: await this.notifications.unreadCount(request.user.id) }
  }

  @Get(":id")
  async get(@Req() request: AuthedRequest, @Param("id") id: string) {
    const item = await this.notifications.get(request.user.id, id)
    if (!item) throw new NotFoundException("消息不存在。")
    return item
  }

  @Patch("read-all")
  async markAllRead(@Req() request: AuthedRequest) {
    await this.notifications.markAllRead(request.user.id)
    return { ok: true }
  }

  @Patch(":id/read")
  async markRead(@Req() request: AuthedRequest, @Param("id") id: string) {
    await this.notifications.markRead(request.user.id, id)
    return { ok: true }
  }

  @Delete()
  async deleteAll(@Req() request: AuthedRequest, @Query() query: unknown) {
    const parsed = deleteAllSchema.safeParse(query)
    if (!parsed.success) throw badRequestFromZodError(parsed.error, "删除范围无效。")
    await this.notifications.deleteAll(request.user.id, parsed.data.filter)
    return { ok: true }
  }

  @Delete(":id")
  async delete(@Req() request: AuthedRequest, @Param("id") id: string) {
    await this.notifications.delete(request.user.id, id)
    return { ok: true }
  }
}

@Controller(OPEN_API_NOTIFICATIONS_BASE_PATH)
@UseGuards(NotificationApiKeyGuard)
@UseFilters(OpenApiExceptionFilter)
export class OpenNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /** 整体式：密钥和消息都放在请求体里。 */
  @Post()
  @HttpCode(201)
  @Throttle(notificationThrottle)
  async createWithKeyInBody(
    @Req() request: OpenApiRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const principal = authorizeNotificationRequest(request)
    const parsed = openApiNotificationKeyedMessageSchema.safeParse(body)
    if (!parsed.success) throw invalidNotificationRequest()
    const { key: _key, ...message } = parsed.data
    return this.persist(principal, message, idempotencyKey)
  }

  /** 表单式：密钥是 URL 段，消息来自 JSON 或表单编码的请求体。 */
  @Post(":key")
  @HttpCode(201)
  @Throttle(notificationThrottle)
  async createWithKeyInPath(
    @Req() request: OpenApiRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const principal = authorizeNotificationRequest(request)
    const parsed = openApiNotificationMessageSchema.safeParse(body)
    if (!parsed.success) throw invalidNotificationRequest()
    return this.persist(principal, parsed.data, idempotencyKey)
  }

  /** 路径式：密钥、标题和正文都在 URL 段里，其余字段走 query。 */
  @Get(":key/:title/:body")
  @HttpCode(201)
  @Throttle(notificationThrottle)
  async createFromPath(
    @Req() request: OpenApiRequest,
    @Param() params: unknown,
    @Query() query: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const principal = authorizeNotificationRequest(request)
    const path = openApiNotificationPathSchema.safeParse(params)
    const search = openApiNotificationQuerySchema.safeParse(query)
    if (!path.success || !search.success) throw invalidNotificationRequest()
    const { key: _key, ...pathMessage } = path.data
    return this.persist(principal, { ...pathMessage, ...search.data }, idempotencyKey)
  }

  private async persist(
    principal: OpenApiPrincipal,
    message: OpenApiNotificationMessage,
    idempotencyKey?: string,
  ): Promise<{ readonly id: string; readonly createdAt: string }> {
    if (idempotencyKey !== undefined && !idempotencyKeyPattern.test(idempotencyKey)) {
      throw new OpenApiHttpError(400, "INVALID_IDEMPOTENCY_KEY", "去重键无效。")
    }
    const item = await this.notifications.create({
      ...message,
      userId: principal.userId,
      source: "external",
      sourceKey: idempotencyKey ? `external:${principal.apiKeyId}:${idempotencyKey}` : undefined,
    })
    return { id: item.id, createdAt: item.createdAt.toISOString() }
  }
}

function invalidNotificationRequest(): OpenApiHttpError {
  return new OpenApiHttpError(400, "INVALID_REQUEST", "通知参数无效。")
}

/** 密钥校验之后才能判断权限，401 与 403 都必须先于 400 返回。 */
function authorizeNotificationRequest(request: OpenApiRequest): OpenApiPrincipal {
  const principal = requireOpenApiPrincipal(request)
  if (!principal.scopes.includes(NOTIFICATION_SEND_SCOPE)) {
    throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少发送通知权限。")
  }
  return principal
}
