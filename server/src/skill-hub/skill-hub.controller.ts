import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common"
import {
  skillHubCreateInputSchema, skillHubFilePreviewQuerySchema, skillHubIdSchema, skillHubListInputSchema, skillHubPublishInputSchema,
  skillHubReceiptInputSchema, skillHubRevisionInputSchema, skillHubUpdateInputSchema,
} from "@synapse/shared/skill-hub-contracts"
import type { Response } from "express"
import type { Readable } from "node:stream"
import { z } from "zod"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { assertHubWriteOrigin } from "./skill-hub-origin"
import { hubPageQuery, parseHubInput } from "./skill-hub-http"
import { SkillHubService } from "./skill-hub.service"

const versionQuery = z.strictObject({ expectedVersionId: z.string().optional() })
const idParam = (id: unknown) => parseHubInput(skillHubIdSchema, id)

function expectedVersion(query: unknown): string | undefined {
  const { expectedVersionId } = parseHubInput(versionQuery, query)
  return expectedVersionId === undefined ? undefined : idParam(expectedVersionId)
}

function sendHubStream(response: Response, stream: Readable, type: string, length: number, disposition: string) {
  const onClose = () => stream.destroy()
  response.once("close", onClose)
  stream.once("close", () => response.off("close", onClose))
  const file = new StreamableFile(stream, { type, length, disposition })
  file.setErrorHandler((_error, res) => {
    if (res.destroyed) return
    if (!res.headersSent) res.statusCode = 503
    res.end()
  })
  file.setErrorLogger(() => undefined)
  return file
}

@UseGuards(UserAuthGuard)
@Controller("/api/skill-hub")
export class SkillHubController {
  constructor(private readonly hub: SkillHubService) {}

  @Get("skills")
  @Header("Cache-Control", "private, no-store")
  list(@Req() request: AuthenticatedUserRequest, @Query() query: Record<string, unknown>) {
    return this.hub.list(request.user!.id, parseHubInput(skillHubListInputSchema, hubPageQuery(query, "createdByMe")))
  }

  @Get("skills/:id")
  @Header("Cache-Control", "private, no-store")
  get(@Req() request: AuthenticatedUserRequest, @Param("id") id: string) {
    return this.hub.get(request.user!.id, idParam(id))
  }

  @Post("skills")
  @Header("Cache-Control", "private, no-store")
  create(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    assertHubWriteOrigin(request, process.env.APP_PUBLIC_URL)
    return this.hub.create(request.user!.id, parseHubInput(skillHubCreateInputSchema, body))
  }

  @Post("skills/:id/versions")
  @Header("Cache-Control", "private, no-store")
  publish(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Body() body: unknown) {
    assertHubWriteOrigin(request, process.env.APP_PUBLIC_URL)
    return this.hub.publish(request.user!.id, idParam(id), parseHubInput(skillHubPublishInputSchema, body))
  }

  @Patch("skills/:id")
  @Header("Cache-Control", "private, no-store")
  update(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Body() body: unknown) {
    assertHubWriteOrigin(request, process.env.APP_PUBLIC_URL)
    return this.hub.update(request.user!.id, idParam(id), parseHubInput(skillHubUpdateInputSchema, body))
  }

  @Delete("skills/:id")
  @Header("Cache-Control", "private, no-store")
  softDelete(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Body() body: unknown) {
    assertHubWriteOrigin(request, process.env.APP_PUBLIC_URL)
    return this.hub.softDelete(request.user!.id, idParam(id), parseHubInput(skillHubRevisionInputSchema, body))
  }

  @Get("receipts/:requestId")
  @Header("Cache-Control", "private, no-store")
  getReceipt(@Req() request: AuthenticatedUserRequest, @Param("requestId") requestId: string, @Query() query: Record<string, unknown>) {
    return this.hub.getReceipt(request.user!.id, parseHubInput(skillHubReceiptInputSchema, { ...query, requestId }))
  }

  @Get("skills/:id/package")
  @Header("Cache-Control", "private, no-store")
  async openLatest(
    @Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.hub.openLatest(request.user!.id, idParam(id), expectedVersion(query))
    response.setHeader("X-Skill-Hub-Version-Id", file.versionId)
    response.setHeader("X-Skill-Hub-Archive-Sha256", file.sha256)
    return sendHubStream(response, file.stream, "application/zip", file.size, 'attachment; filename="skill.zip"')
  }

  @Get("skills/:id/main")
  @Header("Cache-Control", "private, no-store")
  openMain(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Query() query: unknown) {
    return this.hub.openMain(request.user!.id, idParam(id), expectedVersion(query))
  }

  @Get("skills/:id/file")
  @Header("Cache-Control", "private, no-store")
  openFile(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Query() query: unknown) {
    return this.hub.openFile(request.user!.id, idParam(id), parseHubInput(skillHubFilePreviewQuerySchema, query))
  }

  @Get("skills/:id/icon")
  @Header("Cache-Control", "private, no-store")
  async openIcon(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.hub.openIcon(request.user!.id, idParam(id))
    return sendHubStream(response, file.stream, file.contentType, file.size, "inline")
  }
}
