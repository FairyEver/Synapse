import {
  Controller,
  Get,
  Head,
  Headers,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common"
import { Throttle } from "@nestjs/throttler"
import type { Request, Response } from "express"
import { pipeline } from "node:stream/promises"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"
import { RATE_LIMIT_TTL_MS } from "../common/rate-limits"
import { ProfileAvatarService, type ResolvedProfileAvatar } from "./profile-avatar.service"

const AVATAR_RANDOMIZE_RATE_LIMIT = 60
const AVATAR_UPLOAD_RATE_LIMIT = 10

@UseGuards(UserAuthGuard)
@Controller("/api/console/me/avatar")
export class ProfileAvatarController {
  constructor(
    private readonly avatars: ProfileAvatarService,
    private readonly auth: UserAuthService,
  ) {}

  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: AVATAR_RANDOMIZE_RATE_LIMIT } })
  @Post("/random")
  async random(@Req() request: AuthenticatedUserRequest) {
    await this.avatars.randomize(request.user!.id, request.ip)
    return this.auth.getMe(request.user!.id)
  }

  @Throttle({ default: { ttl: RATE_LIMIT_TTL_MS, limit: AVATAR_UPLOAD_RATE_LIMIT } })
  @Put()
  async upload(
    @Req() request: AuthenticatedUserRequest,
    @Headers("content-type") contentType: string | undefined,
  ) {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > 1024 * 1024) throw new PayloadTooLargeException("头像不能超过 1 MB。")
      chunks.push(part)
    }
    await this.avatars.uploadCustom(
      request.user!.id,
      { bytes: Buffer.concat(chunks), contentType: contentType ?? "" },
      request.ip,
    )
    return this.auth.getMe(request.user!.id)
  }
}

@Controller("/api/avatars")
export class PublicAvatarController {
  constructor(private readonly avatars: ProfileAvatarService) {}

  @Get("/system/:id")
  sendSystemAvatar(
    @Param("id") id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAvatar(id, request, response, "system")
  }

  @Head("/system/:id")
  headSystemAvatar(
    @Param("id") id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAvatar(id, request, response, "system")
  }

  @Get("/users/:id")
  sendUserAvatar(
    @Param("id") id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAvatar(id, request, response, "users")
  }

  @Head("/users/:id")
  headUserAvatar(
    @Param("id") id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    return this.sendAvatar(id, request, response, "users")
  }

  private async sendAvatar(
    id: string,
    request: Request,
    response: Response,
    kind: "system" | "users",
  ): Promise<void> {
    const avatar = kind === "system"
      ? await this.avatars.resolveSystemAvatar(id)
      : await this.avatars.resolveCustomAvatar(id)
    if (!avatar) {
      response.setHeader("Cache-Control", "no-store")
      response.status(404).send("Not Found")
      return
    }
    setAvatarHeaders(response, avatar)
    if (avatar.etag && request.headers["if-none-match"] === avatar.etag) {
      response.status(304).end()
      return
    }
    if (request.method.toUpperCase() === "HEAD") {
      response.status(200).end()
      return
    }
    try {
      const object = await this.avatars.openAvatar(avatar.storageKey)
      await pipeline(object.stream as NodeJS.ReadableStream, response)
    } catch (error) {
      if (response.headersSent) {
        if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
        return
      }
      for (const header of [
        "Content-Type",
        "Content-Length",
        "Content-Disposition",
        "ETag",
        "X-Content-Type-Options",
      ]) {
        response.removeHeader(header)
      }
      response.setHeader("Cache-Control", "no-store")
      response.status(404).send("Not Found")
    }
  }
}

function setAvatarHeaders(response: Response, avatar: ResolvedProfileAvatar): void {
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable")
  response.setHeader("Content-Type", avatar.mimeType)
  response.setHeader("Content-Length", avatar.size.toString())
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
  response.setHeader("Content-Disposition", 'inline; filename="avatar"')
  if (avatar.etag) response.setHeader("ETag", avatar.etag)
}
