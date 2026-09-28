import { BadRequestException, Body, Controller, Delete, Get, HttpException, Param, Patch, PayloadTooLargeException, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { attachmentContentDisposition } from "../common/content-disposition"
import { badRequestFromZodError } from "../common/zod-validation"
import { MAIL_MAX_ATTACHMENT_BYTES, MailService } from "./mail.service"

const content = z.object({ formatVersion: z.union([z.literal(2), z.literal(3)]), toIds: z.array(z.string().min(1)), ccIds: z.array(z.string().min(1)), toOrganizationIds: z.array(z.string().min(1)).optional(), ccOrganizationIds: z.array(z.string().min(1)).optional(), subject: z.string().max(120), body: z.string().max(100_000), attachmentIds: z.array(z.string().min(1)).max(10), forwardAttachmentIds: z.array(z.string().min(1)).max(10), relation: z.object({ kind: z.enum(["reply", "forward"]), messageId: z.string().min(1) }).strict().optional() }).strict()

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

  @Get("organizations")
  searchOrganizations(@Req() request: AuthenticatedUserRequest, @Query("query") query?: string) {
    return this.mail.searchOrganizations(userId(request), query ?? "")
  }

  @Get("organizations/:id/members")
  listOrganizationMembers(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Query("cursor") cursor?: string) {
    return this.mail.listOrganizationMembers(userId(request), id, cursor)
  }

  @Get("messages")
  listMessages(@Req() request: AuthenticatedUserRequest, @Query("box") box?: string, @Query("query") query?: string, @Query("cursor") cursor?: string, @Query("unreadOnly") unreadOnly?: string) {
    if (box !== "inbox" && box !== "sent") throw new BadRequestException("无效的信箱。")
    if (unreadOnly !== undefined && unreadOnly !== "true" && unreadOnly !== "false") throw new BadRequestException("无效的未读筛选。")
    if (box === "sent" && unreadOnly === "true") throw new BadRequestException("已发送信箱不能筛选未读。")
    return this.mail.listMessages(userId(request), box, query, cursor, unreadOnly === "true")
  }

  @Get("messages/count")
  countMessages(@Req() request: AuthenticatedUserRequest) {
    return this.mail.countMessages(userId(request))
  }

  @Patch("messages/read-all")
  readAllMessages(@Req() request: AuthenticatedUserRequest) {
    return this.mail.readAllMessages(userId(request))
  }

  @Post("messages/delete-batch")
  deleteMessages(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    const { messageIds } = parse(z.object({ messageIds: z.array(z.string().min(1)).min(1).max(100).refine((items) => new Set(items).size === items.length, "信件不能重复。") }).strict(), body)
    return this.mail.deleteMessages(userId(request), messageIds)
  }

  @Delete("messages")
  deleteAllMessages(@Req() request: AuthenticatedUserRequest, @Query("box") box?: string) {
    if (box !== "inbox" && box !== "sent") throw new BadRequestException("无效的信箱。")
    return this.mail.deleteAllMessages(userId(request), box)
  }

  @Get("messages/:id")
  getMessage(@Req() request: AuthenticatedUserRequest, @Param("id") id: string) {
    return this.mail.getMessage(userId(request), id)
  }

  @Get("messages/:id/context")
  listContext(@Req() request: AuthenticatedUserRequest, @Param("id") id: string, @Query("cursor") cursor?: string) {
    return this.mail.listContext(userId(request), id, cursor)
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
    if (!body || typeof body !== "object" || ![2, 3].includes((body as Record<string, unknown>).formatVersion as number)) throw new HttpException("请更新客户端后再发送站内信。", 426)
    return this.mail.createPreview(userId(request), parse(content, body))
  }

  @Post("messages")
  send(@Req() request: AuthenticatedUserRequest, @Body() body: unknown) {
    const input = parse(z.object({ previewId: z.string().min(1), clientRequestId: z.string().min(1).max(100) }).strict(), body)
    return this.mail.send(userId(request), input.previewId, input.clientRequestId)
  }
}
