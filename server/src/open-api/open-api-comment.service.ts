import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common"
import { createHash } from "node:crypto"
import { isDriveCommentableMarkdownItem } from "@synapse/shared"
import type { OpenApiPrincipal } from "../api-keys/api-key.service"
import { PUBLIC_LINK_COMMENT_CREATE_SCOPE } from "../api-keys/api-key-capabilities"
import { DriveLinkIntakeService } from "../drive/drive-link-intake.service"
import { DriveMessageService, type DriveMessageAccess } from "../drive/drive-message.service"
import { DriveService } from "../drive/drive.service"
import type { CreateArticleCommentRequest } from "./open-api-contract"
import { OpenApiHttpError, requireOpenApiScope } from "./open-api.types"
import { OpenApiUsageLogService } from "./open-api-usage-log.service"

type ShareTarget = Extract<DriveMessageAccess, { kind: "share" }> & { readonly itemId: string }

@Injectable()
export class OpenApiCommentService {
  constructor(
    private readonly drive: DriveService,
    private readonly linkIntake: DriveLinkIntakeService,
    private readonly messages: DriveMessageService,
    private readonly usageLogs: OpenApiUsageLogService,
  ) {}

  async create(input: {
    readonly principal: OpenApiPrincipal
    readonly requestId: string
    readonly ipAddress: string
    readonly idempotencyKey?: string
    readonly body: CreateArticleCommentRequest
  }): Promise<{ readonly id: string; readonly createdAt: string }> {
    requireOpenApiScope(input.principal, PUBLIC_LINK_COMMENT_CREATE_SCOPE)
    const usage = await this.usageLogs.start({
      userId: input.principal.userId,
      apiKeyId: input.principal.apiKeyId,
      requestId: input.requestId,
      operation: "comment_create",
      scope: PUBLIC_LINK_COMMENT_CREATE_SCOPE,
      ipAddress: input.ipAddress,
    })
    try {
      const target = await this.resolveTarget(input.body, input.principal.userId)
      const idempotency = input.idempotencyKey ? {
        keyHash: hash([input.principal.apiKeyId, input.idempotencyKey]),
        requestHash: hash([target.shareId, target.itemId, input.body.body]),
      } : undefined
      const message = await this.messages.create(
        target, input.principal.userId, input.body.body, input.ipAddress, idempotency,
      )
      await this.usageLogs.finish({
        usageLogId: usage.id, requestId: input.requestId, startedAt: usage.startedAt,
        status: "succeeded", httpStatus: 201,
      })
      return { id: message.id, createdAt: message.createdAt }
    } catch (error) {
      const mapped = mapCommentError(error)
      await this.usageLogs.finish({
        usageLogId: usage.id, requestId: input.requestId, startedAt: usage.startedAt,
        status: "failed", httpStatus: mapped.statusCode, errorCode: mapped.code,
      })
      throw mapped
    }
  }

  private async resolveTarget(body: CreateArticleCommentRequest, actorUserId: string): Promise<ShareTarget> {
    let fromUrl: ShareTarget | undefined
    if (body.url) {
      const resolved = await this.linkIntake.resolveSharedMessageTarget({
        url: body.url, password: body.password,
      }, actorUserId)
      fromUrl = resolved
    }
    if (!body.shareId) {
      if (!fromUrl) throw new OpenApiHttpError(400, "TARGET_REQUIRED", "必须提供 url 或 shareId。")
      return fromUrl
    }
    if (fromUrl && fromUrl.shareId !== body.shareId) {
      throw new OpenApiHttpError(409, "TARGET_MISMATCH", "分享链接与分享 ID 不一致。")
    }
    const password = body.password ?? fromUrl?.password
    const access = await this.drive.resolvePublicShareAccess({ shareId: body.shareId, password })
    if (access.status === "password_required") {
      throw new OpenApiHttpError(403, "LINK_PASSWORD_REQUIRED_OR_INVALID", "分享密码缺失或错误。")
    }
    if (access.status !== "ok") throw new OpenApiHttpError(404, "LINK_NOT_FOUND", "分享链接不存在或已失效。")
    const accessTarget = await this.drive.resolveShareAnnotationAccess({
      shareId: body.shareId, password, actorUserId,
    })
    if (fromUrl && fromUrl.itemId !== accessTarget.item.id) {
      throw new OpenApiHttpError(409, "TARGET_MISMATCH", "分享链接与分享 ID 未指向同一篇文章。")
    }
    if (!isDriveCommentableMarkdownItem(accessTarget.item)) {
      throw new OpenApiHttpError(422, "TARGET_NOT_ARTICLE", "分享 ID 未指向 Markdown 文章。")
    }
    return { kind: "share", shareId: body.shareId, itemId: accessTarget.item.id, password }
  }
}

function hash(values: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex")
}

function mapCommentError(error: unknown): OpenApiHttpError {
  if (error instanceof OpenApiHttpError) return error
  if (error instanceof ConflictException) return new OpenApiHttpError(409, "IDEMPOTENCY_CONFLICT", "去重键对应不同请求。")
  if (error instanceof ForbiddenException) return new OpenApiHttpError(403, "COMMENT_FORBIDDEN", "没有该文章的评论权限。")
  if (error instanceof NotFoundException) return new OpenApiHttpError(404, "LINK_NOT_FOUND", "分享链接不存在或已失效。")
  if (error instanceof BadRequestException) {
    if (error.message.includes("需要密码")) {
      return new OpenApiHttpError(403, "LINK_PASSWORD_REQUIRED_OR_INVALID", "分享密码缺失或错误。")
    }
    return new OpenApiHttpError(422, "UNSUPPORTED_LINK", "链接不是可评论的 Markdown 文章。")
  }
  return new OpenApiHttpError(500, "INTERNAL_ERROR", "服务器内部错误。")
}
