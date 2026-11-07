import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common"
import {
  customAppCreateInputSchema,
  customAppBootstrapInputSchema,
  customAppDockOperationSchema,
  customAppIdSchema,
  customAppUpdateInputSchema,
  type CustomAppBootstrapInput,
  type CustomAppCreateInput,
  type CustomAppDockOperation,
  type CustomAppId,
  type CustomAppUpdateInput,
} from "@synapse/shared"
import type { Request, Response } from "express"
import { pipeline } from "node:stream/promises"
import { z } from "zod"

import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { CustomAppIconsService } from "./custom-app-icons.service"
import { CustomAppsService } from "./custom-apps.service"

const deleteInputSchema = z.object({
  operationId: z.string().trim().min(1).max(200),
}).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/custom-apps")
export class CustomAppsController {
  constructor(private readonly service: CustomAppsService) {}

  @Get("/snapshot")
  snapshot(@Req() request: AuthenticatedUserRequest) {
    return this.service.snapshot(requireUserId(request))
  }

  @Post("/apps")
  create(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.service.create(
      requireUserId(request),
      parseBody(customAppCreateInputSchema, body, "自定义应用参数无效。") as CustomAppCreateInput,
    )
  }

  @Post("/bootstrap")
  bootstrap(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.service.bootstrap(
      requireUserId(request),
      parseBody(customAppBootstrapInputSchema, body, "Dock 初始化请求无效。") as CustomAppBootstrapInput,
    )
  }

  @Post("/dock/operations")
  applyDockOperation(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.service.applyDockOperation(
      requireUserId(request),
      parseBody(customAppDockOperationSchema, body, "Dock 操作无效。") as CustomAppDockOperation,
    )
  }

  @Patch("/apps/:id")
  update(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.service.update(
      requireUserId(request),
      parseAppId(id),
      parseBody(customAppUpdateInputSchema, body, "自定义应用参数无效。") as CustomAppUpdateInput,
    )
  }

  @Delete("/apps/:id")
  delete(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(deleteInputSchema, body, "删除请求无效。")
    return this.service.delete(requireUserId(request), parseAppId(id), parsed)
  }
}

@Controller("/api/custom-apps/icons")
export class CustomAppIconsController {
  constructor(private readonly icons: CustomAppIconsService) {}

  @Get("/:iconId")
  get(
    @Param("iconId") iconId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendIcon(iconId, request, response, false)
  }

  @Head("/:iconId")
  head(
    @Param("iconId") iconId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendIcon(iconId, request, response, true)
  }

  private async sendIcon(
    iconId: string,
    request: Request,
    response: Response,
    headOnly: boolean,
  ): Promise<void> {
    if (!/^[0-9a-f-]{36}$/u.test(iconId)) throw new NotFoundException()
    const icon = await this.icons.resolve(iconId)
    if (!icon) throw new NotFoundException()

    response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
    response.setHeader("Content-Type", icon.mimeType)
    response.setHeader("Content-Length", icon.size.toString())
    response.setHeader("X-Content-Type-Options", "nosniff")
    response.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    response.setHeader("Content-Disposition", 'inline; filename="icon.png"')
    if (icon.etag) {
      response.setHeader("ETag", icon.etag)
      if (request.headers["if-none-match"] === icon.etag) {
        response.status(304).end()
        return
      }
    }
    if (headOnly) {
      response.status(200).end()
      return
    }
    await pipeline(icon.stream as NodeJS.ReadableStream, response)
  }
}

function requireUserId(request: AuthenticatedUserRequest): string {
  if (!request.user?.id) throw new BadRequestException("账号信息无效。")
  return request.user.id
}

function parseAppId(value: string): CustomAppId {
  const parsed = customAppIdSchema.safeParse(value)
  if (!parsed.success) throw new BadRequestException("自定义应用 ID 无效。")
  return parsed.data as CustomAppId
}

function parseBody<T>(
  schema: { parse: (value: unknown) => T },
  body: unknown,
  message: string,
): T {
  try {
    return schema.parse(body)
  } catch {
    throw new BadRequestException(message)
  }
}
