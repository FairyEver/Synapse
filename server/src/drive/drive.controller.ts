import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Response } from "express"
import archiver from "archiver"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import { DriveService } from "./drive.service"

const prepareUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(255),
  size: z.string().regex(/^\d+$/u),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const prepareFolderUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  folderName: z.string().trim().min(1).max(255),
  files: z.array(z.object({
    relativePath: z.string().trim().min(1).max(1024),
    size: z.string().regex(/^\d+$/u),
    mimeType: z.string().trim().max(255).nullable().optional(),
  }).strict()).min(1).max(1000),
}).strict()

const folderSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(255),
}).strict()

const renameSchema = z.object({ name: z.string().trim().min(1).max(255) }).strict()
const moveSchema = z.object({ parentId: z.string().nullable() }).strict()
const adminSortFields = ["createdAt", "updatedAt", "name", "size", "storageStatus"] as const

@UseGuards(UserAuthGuard)
@Controller("/api/drive")
export class DriveUserController {
  constructor(private readonly drive: DriveService) {}

  @Get("/items")
  listItems(@Query("parentId") parentId: string | undefined, @Req() request: AuthenticatedUserRequest) {
    return this.drive.listItems(request.user!.id, parentId ?? null)
  }

  @Get("/items/:id")
  getItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.getItem(request.user!.id, id)
  }

  @Post("/uploads/prepare")
  prepareUpload(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(prepareUploadSchema, body, "上传请求无效。")
    return this.drive.prepareUpload(request.user!.id, {
      parentId: parsed.parentId ?? null,
      name: parsed.name,
      size: parsed.size,
      mimeType: parsed.mimeType ?? null,
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/uploads/folder/prepare")
  prepareFolderUpload(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(prepareFolderUploadSchema, body, "文件夹上传请求无效。")
    return this.drive.prepareFolderUpload(request.user!.id, {
      parentId: parsed.parentId ?? null,
      folderName: parsed.folderName,
      files: parsed.files.map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType ?? null,
      })),
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/uploads/:sessionId/complete")
  completeUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.completeUpload(request.user!.id, sessionId)
  }

  @Post("/uploads/:sessionId/cancel")
  cancelUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.cancelUpload(request.user!.id, sessionId)
  }

  @Post("/folders")
  createFolder(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(folderSchema, body, "文件夹请求无效。")
    return this.drive.createFolder(request.user!.id, { parentId: parsed.parentId ?? null, name: parsed.name })
  }

  @Patch("/items/:id")
  updateItem(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    if (isRecord(body) && "name" in body) {
      const parsed = parseBody(renameSchema, body, "重命名请求无效。")
      return this.drive.renameItem(request.user!.id, id, parsed.name)
    }
    const parsed = parseBody(moveSchema, body, "移动请求无效。")
    return this.drive.moveItem(request.user!.id, id, parsed.parentId)
  }

  @Delete("/items/:id")
  deleteItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.deleteItem(request.user!.id, id, request.user!.id, request.ip)
  }

  @Post("/items/:id/share")
  createShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.createShare(request.user!.id, id, resolveRequestPublicAppUrl(request))
  }

  @Delete("/shares/:id")
  disableShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.disableShare(request.user!.id, id)
  }

  @Get("/usage")
  getUsage(@Req() request: AuthenticatedUserRequest) {
    return this.drive.getUsage(request.user!.id)
  }
}

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/drive")
export class DriveAdminController {
  constructor(private readonly drive: DriveService) {}

  @Get("/items")
  listItems(@Query() query: Record<string, unknown>) {
    return this.drive.listAdminItems({
      pagination: parsePagination(query, { allowedSortFields: adminSortFields }),
      filters: {
        userId: typeof query.userId === "string" ? query.userId : undefined,
        type: typeof query.type === "string" ? query.type : undefined,
        storageStatus: typeof query.storageStatus === "string" ? query.storageStatus : undefined,
        shared: typeof query.shared === "string" ? query.shared : undefined,
        search: typeof query.search === "string" ? query.search : undefined,
      },
    })
  }

  @Delete("/items/:id")
  deleteItem(@Param("id") id: string, @Req() request: AdminRequest) {
    return this.drive.deleteItemAsAdmin(id, request.admin!.email, request.ip ?? "system")
  }
}

@Controller()
export class DrivePublicController {
  constructor(private readonly drive: DriveService) {}

  @Get("/files/:shareId")
  async openShare(@Param("shareId") shareId: string, @Res() response: Response) {
    const share = await this.drive.resolvePublicShare(shareId)
    if (share.type === "file") {
      const download = await this.drive.createDownloadUrlForShare(shareId)
      response.redirect(302, download.url)
      return
    }
    const folder = await this.drive.listPublicFolderChildren(shareId)
    response.type("html").send(renderPublicFolderPage(folder))
  }

  @Get("/files/:shareId/download")
  async downloadShare(@Param("shareId") shareId: string, @Res() response: Response) {
    const download = await this.drive.createDownloadUrlForShare(shareId)
    response.redirect(302, download.url)
  }

  @Get("/files/:shareId/zip")
  async downloadFolderZip(@Param("shareId") shareId: string, @Res() response: Response) {
    const share = await this.drive.resolvePublicShare(shareId)
    if (share.type !== "folder") {
      const download = await this.drive.createDownloadUrlForShare(shareId)
      response.redirect(302, download.url)
      return
    }
    const entries = await this.drive.createFolderZipEntriesForShare(shareId)
    response.setHeader("Content-Type", "application/zip")
    response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(share.item.name)}.zip"`)
    const archive = archiver("zip", { zlib: { level: 6 } })
    archive.pipe(response)
    for (const entry of entries) {
      const objectResponse = await fetch(entry.url)
      if (!objectResponse.ok) throw new NotFoundException("文件未找到")
      archive.append(Buffer.from(await objectResponse.arrayBuffer()), { name: entry.path })
    }
    await archive.finalize()
  }
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function resolveRequestPublicAppUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char))
}

function renderPublicFolderPage(folder: { readonly item: { readonly name: string }; readonly children: readonly { readonly id: string; readonly name: string; readonly type: string }[] }): string {
  const children = folder.children.map((item) => (
    `<li>${escapeHtml(item.name)}${item.type === "file" ? ` <a href="./${encodeURIComponent(item.id)}/download">下载</a>` : ""}</li>`
  )).join("")
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(folder.item.name)}</title></head><body><main><h1>${escapeHtml(folder.item.name)}</h1><ul>${children}</ul></main></body></html>`
}
