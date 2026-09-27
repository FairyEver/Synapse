import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, PayloadTooLargeException, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { attachmentContentDisposition } from "../common/content-disposition"
import { badRequestFromZodError } from "../common/zod-validation"
import { MAIL_MAX_ATTACHMENT_BYTES, MailService } from "./mail.service"

const content = z.object({ recipientIds: z.array(z.string().min(1)).max(50), subject: z.string().max(120), body: z.string().max(100_000), attachmentIds: z.array(z.string().min(1)).max(10).default([]), replyToId: z.string().min(1).optional() }).strict()
const draft = content

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw badRequestFromZodError(result.error, "站内信请求无效。")
  return result.data
}

function userId(request: AuthenticatedUserRequest): string {
  return request.user!.id
}

@Controller("api/mail")
@UseGuards(UserAuthGuard)
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get("recipients")
  searchRecipients(@Req() request: AuthenticatedUserRequest, @Query("query") query?: string, @Query("cursor") cursor?: string) {
    return this.mail.searchRecipients(userId(request), query ?? "", cursor)
  }

  @Get("messages")
  listMessages(@Req() request: AuthenticatedUserRequest, @Query("box") box?: string, @Query("query") query?: string, @Query("cursor") cursor?: string) {
    if (box !== "inbox" && box !== "sent") throw new BadRequestException("无效的信箱。")
    return this.mail.listMessages(userId(request), box, query, cursor)
  }

  @Get("messages/:id")
  getMessage(@Req() request: AuthenticatedUserRequest, @Param("id") id: string) {
    return this.mail.getMessage(userId(request), id)
  }

  @Patch("messages/:id/read")
  setRead(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Body() body: unknown) {
    const { read } = parse(z.object({ read: z.boolean() }).strict(), body)
    return this.mail.setRead(userId(request), id, read)
  }

  @Delete("messages/:id")
  deleteMessage(@Req() request: AuthenticatedUserRequest, @Param("id") id: string) {
    return this.mail.deleteMessage(userId(request), id)
  }

  @Get("messages/:id/attachments/:attachmentId")
  async download(@Req() request: AuthenticatedUserRequest, @Res() response: Response, @Param("id") id: string, @Param("attachmentId") attachmentId: string) {
    const file = await this.mail.downloadAttachment(userId(request), id, attachmentId)
    response.setHeader("Content-Type", file.mimeType ?? "application/octet-stream")
    response.setHeader("Content-Length", String(file.size))
    response.setHeader("Content-Disposition", attachmentContentDisposition(file.fileName))
    response.setHeader("Cache-Control", "private, no-store")
    await pipeline(file.stream, response)
  }

  @Post("attachments/prepare")
  prepareDriveAttachment(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    const input = parse(z.object({ driveItemId: z.string().min(1), versionId: z.string().min(1).optional() }).strict(), body)
    return this.mail.prepareDriveAttachment(userId(request), input.driveItemId, input.versionId)
  }

  @Put("attachments/local")
  async prepareLocalAttachment(@Req() request: AuthenticatedUserRequest & Request, @Query("fileName") fileName?: string) {
    if (!fileName) throw new BadRequestException("缺少文件名。")
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > MAIL_MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException("附件不能超过 20 MB。")
      chunks.push(part)
    }
    const mimeType = request.headers["content-type"]?.split(";")[0] ?? null
    return this.mail.prepareLocalAttachment(userId(request), fileName, mimeType, Buffer.concat(chunks))
  }

  @Post("send-previews")
  createPreview(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.mail.createPreview(userId(request), parse(content, body))
  }

  @Post("messages")
  send(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    const input = parse(z.object({ previewId: z.string().min(1), clientRequestId: z.string().min(1).max(100) }).strict(), body)
    return this.mail.send(userId(request), input.previewId, input.clientRequestId)
  }

  @Get("drafts")
  listDrafts(@Req() request: AuthenticatedUserRequest) {
    return this.mail.listDrafts(userId(request))
  }

  @Post("drafts")
  createDraft(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    return this.mail.createDraft(userId(request), parse(draft, body))
  }

  @Patch("drafts/:id")
  updateDraft(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parse(draft.extend({ baseVersion: z.number().int().min(1) }), body)
    return this.mail.updateDraft(userId(request), id, input.baseVersion, input)
  }

  @Delete("drafts/:id")
  deleteDraft(@Req() request: AuthenticatedUserRequest, @Param("id") id: string) {
    return this.mail.deleteDraft(userId(request), id)
  }
}
