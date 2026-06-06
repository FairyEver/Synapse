import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import { WebhookService } from "./webhook.service"

const createWebhookSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict()

const updateWebhookSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
}).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/dashboard/webhooks")
export class WebhookDashboardController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get()
  list(@Req() request: AuthenticatedUserRequest) {
    return this.webhooks.listForUser(request.user!.id, resolveRequestPublicAppUrl(request))
  }

  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.createForUser(
      request.user!.id,
      parseBody(createWebhookSchema, body, "Webhook create request is invalid."),
      resolveRequestPublicAppUrl(request),
    )
  }

  @Patch("/:id")
  update(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.updateForUser(
      request.user!.id,
      id,
      parseBody(updateWebhookSchema, body, "Webhook update request is invalid."),
      resolveRequestPublicAppUrl(request),
    )
  }

  @Delete("/:id")
  delete(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.deleteForUser(request.user!.id, id)
  }

  @Post("/:id/reset-secret")
  resetSecret(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.resetSecret(request.user!.id, id, resolveRequestPublicAppUrl(request))
  }

  @Get("/:id/deliveries")
  listDeliveries(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.webhooks.listDeliveriesForUser(request.user!.id, id)
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
