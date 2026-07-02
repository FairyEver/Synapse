import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import { contentStoreTextMaxBytes } from "./content-store.constants"
import { ContentStoreService, defaultContentStoreInstallDeepLinkBase, normalizeContentStoreInstallDeepLinkBase } from "./content-store.service"

const listSortFields = ["createdAt", "updatedAt", "installCount"] as const

const contentTypeSchema = z.enum(["skill", "rule", "prompt"])
const visibilityValueSchema = z.enum(["private", "public"])
const moderationStatusSchema = z.enum(["normal", "removed"])

const listQuerySchema = z.object({
  type: contentTypeSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
}).strict()

const adminListQuerySchema = listQuerySchema.extend({
  visibility: visibilityValueSchema.optional(),
  moderationStatus: moderationStatusSchema.optional(),
}).strict()

const fileSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  contentBase64: z.string().refine(isStrictBase64, "必须是有效的 base64 内容"),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const textBodySchema = z.string().min(1).refine(
  (body) => Buffer.byteLength(body, "utf8") <= contentStoreTextMaxBytes,
  "正文超过 1MB。",
)

const createDraftSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("skill"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    localSourceFingerprint: z.string().trim().max(128).nullable().optional(),
    files: z.array(fileSchema).min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal("rule"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    body: textBodySchema,
  }).strict(),
  z.object({
    type: z.literal("prompt"),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    body: textBodySchema,
  }).strict(),
])

const saveDraftSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("skill"),
    baseRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    files: z.array(fileSchema).min(1).max(200),
  }).strict(),
  z.object({
    type: z.literal("rule"),
    baseRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    body: textBodySchema,
  }).strict(),
  z.object({
    type: z.literal("prompt"),
    baseRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).nullable().optional(),
    body: textBodySchema,
  }).strict(),
])

const publishDraftSchema = z.object({ baseRevision: z.number().int().positive() }).strict()
const visibilitySchema = z.object({ visibility: visibilityValueSchema }).strict()
const installSessionSchema = z.object({
  deepLinkBase: z.string().trim().min(1).max(255)
    .refine((value) => normalizeContentStoreInstallDeepLinkBase(value) !== null, "安装入口无效。")
    .optional(),
}).strict()
const installCompleteSchema = z.object({ clientInstanceId: z.string().trim().min(1).max(120) }).strict()
const booleanValueSchema = z.object({ value: z.boolean() }).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/content-store")
export class ContentStoreUserController {
  constructor(private readonly service: ContentStoreService) {}

  @Get("/items")
  listStore(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {
    return this.service.listStore(request.user!.id, parseListOptions(query))
  }

  @Get("/mine")
  listMine(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {
    return this.service.listMine(request.user!.id, parseListOptions(query))
  }

  @Post("/drafts")
  createDraft(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(createDraftSchema, body, "草稿请求无效。")
    return this.service.createDraft(request.user!.id, {
      type: parsed.type,
      title: parsed.title,
      description: parsed.description ?? null,
      localSourceFingerprint: "localSourceFingerprint" in parsed ? parsed.localSourceFingerprint : null,
      body: "body" in parsed ? parsed.body : null,
      files: "files" in parsed ? parsed.files : undefined,
    })
  }

  @Put("/items/:id/draft")
  saveDraft(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(saveDraftSchema, body, "草稿请求无效。")
    return this.service.saveDraft(request.user!.id, id, parsed.baseRevision, {
      title: parsed.title,
      description: parsed.description ?? null,
      body: "body" in parsed ? parsed.body : undefined,
      files: "files" in parsed ? parsed.files : undefined,
    })
  }

  @Post("/items/:id/publish")
  publishDraft(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(publishDraftSchema, body, "发布请求无效。")
    return this.service.publishDraft(request.user!.id, id, parsed.baseRevision)
  }

  @Get("/items/:id/draft")
  getDraft(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.getDraft(request.user!.id, id)
  }

  @Get("/items/:id/legacy-route")
  resolveLegacyRoute(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.resolveLegacySkillRepositoryRoute(
      request.user!.id,
      id,
      resolveRequestPublicAppUrl(request),
    )
  }

  @Get("/items/:id")
  getDetail(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.getDetail(request.user!.id, id)
  }

  @Post("/items/:id/copy")
  copyToMine(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.copyToMine(request.user!.id, id)
  }

  @Post("/items/:id/visibility")
  setVisibility(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(visibilitySchema, body, "可见性请求无效。")
    return this.service.setVisibility(request.user!.id, id, parsed.visibility)
  }

  @Delete("/items/:id")
  deletePrivateItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.deletePrivateItem(request.user!.id, id)
  }

  @Post("/items/:id/install-sessions")
  createInstallSession(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(installSessionSchema, body ?? {}, "安装请求无效。")
    return this.service.createInstallSession(
      request.user!.id,
      id,
      parsed.deepLinkBase ? normalizeContentStoreInstallDeepLinkBase(parsed.deepLinkBase)! : defaultContentStoreInstallDeepLinkBase,
    )
  }

  @Get("/install-sessions/:id")
  resolveInstallSession(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.resolveInstallSession(request.user!.id, id)
  }

  @Get("/install-sessions/:id/package")
  async downloadInstallPackage(
    @Param("id") id: string,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    try {
      const download = await this.service.openInstallPackage(request.user!.id, id)
      response.setHeader("Content-Type", "application/zip")
      if (download.size !== undefined) response.setHeader("Content-Length", download.size.toString())
      response.setHeader("Content-Disposition", `attachment; filename="${safeDownloadFilename(id)}.zip"`)
      await pipeline(download.stream, response)
    } catch (error: unknown) {
      if (!response.headersSent) throw error
      if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
    }
  }

  @Post("/install-sessions/:id/complete")
  recordInstall(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(installCompleteSchema, body, "安装完成请求无效。")
    return this.service.recordInstall(request.user!.id, id, parsed.clientInstanceId)
  }
}

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/content-store")
export class ContentStoreAdminController {
  constructor(private readonly service: ContentStoreService) {}

  @Get("/items")
  listAdmin(@Query() query: Record<string, unknown>) {
    const pagination = parseContentStorePagination(query)
    const filters = parseQuery(adminListQuerySchema, pickQuery(query, "type", "query", "visibility", "moderationStatus"), "查询参数无效。")
    return this.service.listAdmin({ ...pagination, ...filters })
  }

  @Get("/items/:id")
  getAdminDetail(@Param("id") id: string) {
    return this.service.getAdminDetail(id)
  }

  @Post("/items/:id/featured")
  setFeatured(@Param("id") id: string, @Body() body: unknown, @Req() request: AdminRequest) {
    const parsed = parseBody(booleanValueSchema, body, "推荐请求无效。")
    return this.service.setFeaturedAsAdmin(request.admin!.email, request.ip ?? "system", id, parsed.value)
  }

  @Post("/items/:id/removed")
  setRemoved(@Param("id") id: string, @Body() body: unknown, @Req() request: AdminRequest) {
    const parsed = parseBody(booleanValueSchema, body, "移除请求无效。")
    return this.service.setRemovedAsAdmin(request.admin!.email, request.ip ?? "system", id, parsed.value)
  }
}

function parseListOptions(query: Record<string, unknown>) {
  const pagination = parseContentStorePagination(query)
  const filters = parseQuery(listQuerySchema, pickQuery(query, "type", "query"), "查询参数无效。")
  return { ...pagination, ...filters }
}

function parseContentStorePagination(query: Record<string, unknown>) {
  const paginationQuery = "sortBy" in query ? query : { ...query, sortBy: "updatedAt" }
  return parsePagination(paginationQuery, { allowedSortFields: listSortFields })
}

function pickQuery(query: Record<string, unknown>, ...keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in query) result[key] = query[key]
  }
  return result
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function parseQuery<T extends z.ZodType>(schema: T, query: Record<string, unknown>, message: string): z.infer<T> {
  const result = schema.safeParse(query)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function isStrictBase64(value: string): boolean {
  if (value.length % 4 !== 0) return false
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
}

function safeDownloadFilename(value: string): string {
  return value.replace(/[^\x20-\x7E]|["\\;,\r\n]/gu, "_")
}

function resolveRequestPublicAppUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })
}
