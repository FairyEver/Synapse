import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { badRequestFromZodError } from "../common/zod-validation"
import { SkillRepositoryService } from "./skill-repository.service"

const fileSchema = z.object({
  path: z.string().min(1).max(1024).refine((value) => value.trim().length > 0, "路径不能为空。"),
  contentBase64: z.string().refine(isStrictBase64, "必须是有效的 base64 内容"),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const importSchema = z.object({
  repositoryId: z.string().trim().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  files: z.array(fileSchema).min(1).max(200),
}).strict()

const updateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
}).strict()

const publicListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  query: z.string().trim().max(120).optional(),
}).strict()

const filePathQuerySchema = z.object({
  path: z.string().min(1).max(1024),
}).strict()

const textSaveSchema = z.object({
  path: z.string().min(1).max(1024),
  text: z.string(),
  expectedSha256: z.string().trim().length(64),
}).strict()

const uploadSchema = fileSchema.extend({
  expectedSha256: z.string().trim().length(64).nullable().optional(),
}).strict()

const renameSchema = z.object({
  fromPath: z.string().min(1).max(1024),
  toPath: z.string().min(1).max(1024),
}).strict()

const deleteFileSchema = z.object({
  path: z.string().min(1).max(1024),
  expectedSha256: z.string().trim().length(64).nullable().optional(),
}).strict()

const forkSchema = z.object({
  name: z.string().trim().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(1).max(160).nullable().optional(),
}).strict()

const installSessionSchema = z.object({
  deepLinkBase: z.string().trim().min(1).max(255).optional(),
}).strict()

const installCompleteSchema = z.object({
  clientInstanceId: z.string().trim().min(1).max(128),
}).strict()

@UseGuards(UserAuthGuard)
@Controller("/api/skill-repositories")
export class SkillRepositoryController {
  constructor(private readonly service: SkillRepositoryService) {}

  @Get()
  listPublic(@Query() query: unknown) {
    const parsed = parseBody(publicListSchema, query, "Skill 仓库查询无效。")
    return this.service.listPublic(parsed)
  }

  @Get("/mine")
  listMine(@Req() request: AuthenticatedUserRequest) {
    return this.service.listMine(request.user!.id)
  }

  @Get("/by-path/:ownerHandle/:repositoryName")
  getPublicByPath(
    @Param("ownerHandle") ownerHandle: string,
    @Param("repositoryName") repositoryName: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.service.getPublicByPath(request.user!.id, ownerHandle, repositoryName)
  }

  @Get("/by-path/:ownerHandle/:repositoryName/files/content")
  async getPublicFileContent(
    @Param("ownerHandle") ownerHandle: string,
    @Param("repositoryName") repositoryName: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(filePathQuerySchema, query, "Skill 文件内容请求无效。")
    const repository = await this.service.getPublicByPath(request.user!.id, ownerHandle, repositoryName)
    return this.service.getFileContent(request.user!.id, repository.repository.id, parsed.path)
  }

  @Get("/by-path/:ownerHandle/:repositoryName/files/download")
  async downloadPublicFile(
    @Param("ownerHandle") ownerHandle: string,
    @Param("repositoryName") repositoryName: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    const parsed = parseBody(filePathQuerySchema, query, "Skill 文件下载请求无效。")
    const repository = await this.service.getPublicByPath(request.user!.id, ownerHandle, repositoryName)
    await this.streamFileDownload(request.user!.id, repository.repository.id, parsed.path, response)
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
      response.setHeader("Content-Type", download.contentType)
      response.setHeader("Content-Length", download.packageSize.toString())
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

  @Get("/:id")
  getMine(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.getMine(request.user!.id, id)
  }

  @Patch("/:id")
  updateMine(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(updateSchema, body, "Skill 仓库更新请求无效。")
    return this.service.updateMine(request.user!.id, id, parsed)
  }

  @Delete("/:id")
  deleteMine(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.service.deleteMine(request.user!.id, id)
  }

  @Post("/:id/fork")
  forkRepository(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(forkSchema, body ?? {}, "Skill 仓库 Fork 请求无效。")
    return this.service.forkRepository(request.user!.id, id, {
      name: parsed.name ?? undefined,
      title: parsed.title ?? undefined,
    })
  }

  @Post("/:id/install-sessions")
  createInstallSession(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(installSessionSchema, body ?? {}, "安装请求无效。")
    return this.service.createInstallSession(request.user!.id, id, parsed.deepLinkBase)
  }

  @Get("/:id/files/content")
  getFileContent(@Param("id") id: string, @Query() query: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(filePathQuerySchema, query, "Skill 文件内容请求无效。")
    return this.service.getFileContent(request.user!.id, id, parsed.path)
  }

  @Get("/:id/files/download")
  async downloadFile(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    const parsed = parseBody(filePathQuerySchema, query, "Skill 文件下载请求无效。")
    await this.streamFileDownload(request.user!.id, id, parsed.path, response)
  }

  @Put("/:id/files/text")
  saveTextFile(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(textSaveSchema, body, "Skill 文件保存请求无效。")
    return this.service.saveTextFile(request.user!.id, id, parsed)
  }

  @Post("/:id/files")
  uploadFile(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(uploadSchema, body, "Skill 文件上传请求无效。")
    return this.service.uploadFile(request.user!.id, id, {
      path: parsed.path,
      contentBase64: parsed.contentBase64,
      mimeType: parsed.mimeType ?? undefined,
      expectedSha256: parsed.expectedSha256 ?? undefined,
    })
  }

  @Patch("/:id/files/rename")
  renameFile(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(renameSchema, body, "Skill 文件重命名请求无效。")
    return this.service.renameFile(request.user!.id, id, parsed)
  }

  @Delete("/:id/files")
  deleteFile(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(deleteFileSchema, body, "Skill 文件删除请求无效。")
    return this.service.deleteFile(request.user!.id, id, {
      path: parsed.path,
      expectedSha256: parsed.expectedSha256 ?? undefined,
    })
  }

  @Post("/import")
  importRepository(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(importSchema, body, "Skill 仓库导入请求无效。")
    return this.service.importRepository(request.user!.id, {
      repositoryId: parsed.repositoryId ?? undefined,
      name: parsed.name ?? undefined,
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      files: parsed.files,
    })
  }

  private async streamFileDownload(userId: string, repositoryId: string, path: string, response: Response) {
    try {
      const download = await this.service.openFileDownload(userId, repositoryId, path)
      response.setHeader("Content-Type", download.contentType)
      response.setHeader("Content-Length", download.size.toString())
      response.setHeader("Content-Disposition", `attachment; filename="${safeDownloadFilename(download.filename)}"`)
      await pipeline(download.stream, response)
    } catch (error: unknown) {
      if (!response.headersSent) throw error
      if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
    }
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
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
