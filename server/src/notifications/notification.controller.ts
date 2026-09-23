import { Body, Controller, Delete, Get, Headers, HttpCode, NotFoundException, Param, Patch, Post, Query, Req, UseFilters, UseGuards } from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request } from "express"
import { z } from "zod"
import { NOTIFICATION_SEND_SCOPE } from "../api-keys/api-key-capabilities"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
import { OpenApiKeyGuard } from "../open-api/open-api-key.guard"
import { OpenApiHttpError, requireOpenApiPrincipal, type OpenApiRequest } from "../open-api/open-api.types"
import { NotificationService } from "./notification.service"

const messageSchema = z.object({
  title: z.string().trim().min(1).max(64),
  body: z.string().trim().min(1).max(512),
  group: z.string().trim().min(1).max(64).optional(),
  url: z.url().max(2048).refine((value) => new URL(value).protocol === "https:").optional(),
  level: z.enum(["active", "passive", "timeSensitive"]).default("active"),
}).strict()

const listSchema = z.object({
  cursor: z.string().min(1).max(120).optional(),
  filter: z.enum(["all", "unread", "pending"]).optional(),
})

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

  @Delete(":id")
  async delete(@Req() request: AuthedRequest, @Param("id") id: string) {
    await this.notifications.delete(request.user.id, id)
    return { ok: true }
  }
}

@Controller("/api/open/v1/notifications")
@UseGuards(OpenApiKeyGuard)
@UseFilters(OpenApiExceptionFilter)
export class OpenNotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async create(@Req() request: OpenApiRequest, @Body() body: unknown, @Headers("idempotency-key") idempotencyKey?: string) {
    const principal = requireOpenApiPrincipal(request)
    if (!principal.scopes.includes(NOTIFICATION_SEND_SCOPE)) {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少发送通知权限。")
    }
    const parsed = messageSchema.safeParse(body)
    if (!parsed.success) throw new OpenApiHttpError(400, "INVALID_REQUEST", "通知参数无效。")
    if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{8,120}$/u.test(idempotencyKey)) {
      throw new OpenApiHttpError(400, "INVALID_IDEMPOTENCY_KEY", "去重键无效。")
    }
    const item = await this.notifications.create({
      ...parsed.data,
      userId: principal.userId,
      source: "external",
      sourceKey: idempotencyKey ? `external:${principal.apiKeyId}:${idempotencyKey}` : undefined,
    })
    return { id: item.id, createdAt: item.createdAt.toISOString() }
  }
}
