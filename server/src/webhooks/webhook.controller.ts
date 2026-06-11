import { All, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common"
import type { Request } from "express"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { parsePagination } from "../common/pagination"
import { badRequestFromZodError } from "../common/zod-validation"
import { WebhookService } from "./webhook.service"

const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict()

const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
}).strict().refine((value) => value.name !== undefined || value.enabled !== undefined, {
  message: "At least one field is required.",
})

const deliveryHistorySortFields = ["receivedAt", "status", "method"] as const

@UseGuards(UserAuthGuard)
@Controller(["/api/console", "/api/dashboard"])
export class WebhookDashboardController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get("/webhooks")
  list(@Req() request: AuthenticatedUserRequest) {
    return this.webhooks.listForUser(request.user!.id, resolveRequestPublicAppUrl(request))
  }

  @Post("/webhooks")
  create(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.createForUser(
      request.user!.id,
      parseBody(createWebhookSchema, body, "Webhook create request is invalid."),
      resolveRequestPublicAppUrl(request),
      request.ip,
    )
  }

  @Patch("/webhooks/:id")
  update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.updateForUser(
      request.user!.id,
      id,
      parseBody(updateWebhookSchema, body, "Webhook update request is invalid."),
      resolveRequestPublicAppUrl(request),
      request.ip,
    )
  }

  @Delete("/webhooks/:id")
  delete(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.deleteForUser(request.user!.id, id, request.ip)
  }

  @Post("/webhooks/:id/reset-secret")
  resetSecret(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.resetSecret(request.user!.id, id, resolveRequestPublicAppUrl(request), request.ip)
  }

  @Get("/webhooks/:id/deliveries")
  listDeliveries(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.listDeliveriesForUser(request.user!.id, id)
  }
}

@UseGuards(UserAuthGuard)
@Controller(["/api/console", "/api/dashboard"])
export class WebhookDeliveryDashboardController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get("/webhook-deliveries")
  list(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.listDeliveryHistoryForUser(request.user!.id, {
      pagination: parsePagination(query, { allowedSortFields: deliveryHistorySortFields }),
      filters: readDeliveryHistoryFilters(query),
    })
  }
}

@Controller()
export class WebhookPublicController {
  constructor(private readonly webhooks: WebhookService) {}

  @All("/webhooks/:publicId/:secret")
  @HttpCode(202)
  async receive(
    @Param("publicId") publicId: string,
    @Param("secret") secret: string,
    @Req() request: Request,
  ) {
    const result = await this.webhooks.receivePublicWebhook({
      publicId,
      secret,
      method: request.method,
      path: request.path,
      query: normalizeRequestQuery(request.query),
      headers: request.headers,
      body: toRequestBodyBuffer(request.body),
      contentType: request.headers["content-type"],
      remoteAddress: request.ip,
      publicAppUrl: resolvePublicAppUrl({
        configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
        request,
      }),
    })
    return result.response
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function resolveRequestPublicAppUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({
    configuredPublicAppUrl: process.env.APP_PUBLIC_URL,
    request,
  })
}

function readDeliveryHistoryFilters(query: Record<string, unknown>) {
  return {
    webhookId: typeof query.webhookId === "string" ? query.webhookId : undefined,
    status: typeof query.status === "string" ? query.status : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  }
}

function toRequestBodyBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body
  if (typeof body === "string") return Buffer.from(body, "utf8")
  if (body === undefined || body === null) return Buffer.alloc(0)
  return Buffer.from(JSON.stringify(body), "utf8")
}

function normalizeRequestQuery(query: Request["query"]): Record<string, string | readonly string[]> {
  const result: Record<string, string | readonly string[]> = {}
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      result[key] = value.map(String)
    } else if (value !== undefined && typeof value !== "object") {
      result[key] = String(value)
    }
  }
  return result
}
