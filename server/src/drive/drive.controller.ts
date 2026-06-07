import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import archiver from "archiver"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import type { DriveItemDto } from "@synapse/shared"
import { DriveService } from "./drive.service"
import { LocalDriveStorage } from "./drive-storage"

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
    response.type("html").send(renderPublicFolderPage(shareId, folder))
  }

  @Get("/files/:shareId/download")
  async downloadShare(@Param("shareId") shareId: string, @Res() response: Response) {
    const download = await this.drive.createDownloadUrlForShare(shareId)
    response.redirect(302, download.url)
  }

  @Get("/files/:shareId/:itemId/download")
  async downloadShareChild(@Param("shareId") shareId: string, @Param("itemId") itemId: string, @Res() response: Response) {
    const download = await this.drive.createDownloadUrlForShareChild(shareId, itemId)
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

@Controller("/api/drive")
export class DriveLocalStorageController {
  constructor(private readonly storage: LocalDriveStorage) {}

  @Put("/local-upload/:token")
  async upload(@Param("token") token: string, @Req() request: Request) {
    await this.storage.acceptUpload(token, request)
    return { ok: true }
  }

  @Get("/local-download/:token")
  download(@Param("token") token: string, @Res() response: Response) {
    const download = this.storage.resolveDownload(token)
    response.attachment(download.filename)
    download.stream.pipe(response)
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

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function renderPublicFolderPage(shareId: string, folder: { readonly item: DriveItemDto; readonly children: readonly DriveItemDto[] }): string {
  const folderName = escapeHtml(folder.item.name)
  const children = folder.children.map((item) => renderPublicFolderRow(shareId, item)).join("")
  const emptyState = folder.children.length === 0 ? `<div class="drive-share-empty">暂无文件</div>` : ""
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${folderName}</title>
<style>
* {
  box-sizing: border-box;
}
html,
body {
  min-height: 100%;
}
body {
  margin: 0;
  background: Canvas;
  color: CanvasText;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
a {
  color: inherit;
  text-decoration: none;
}
.drive-share-shell {
  min-height: 100vh;
  padding: 28px 40px 48px;
}
.drive-share-main {
  max-width: 980px;
  margin: 0 auto;
}
.drive-share-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  margin-bottom: 14px;
  overflow: hidden;
  font-size: 16px;
  line-height: 1.5;
}
.drive-share-crumb-muted {
  flex: 0 0 auto;
  color: GrayText;
  font-weight: 500;
}
.drive-share-crumb-separator {
  flex: 0 0 auto;
  color: GrayText;
}
.drive-share-crumb-current {
  min-width: 0;
  overflow: hidden;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drive-share-list {
  display: block;
  width: 100%;
  border-top: 1px solid ButtonBorder;
}
.drive-share-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px 160px 64px;
  gap: 16px;
  align-items: center;
  min-width: 0;
  min-height: 44px;
  border-bottom: 1px solid ButtonBorder;
  padding: 0 12px;
}
.drive-share-name {
  overflow: hidden;
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drive-share-meta {
  color: GrayText;
  font-size: 13px;
  text-align: right;
}
.drive-share-download {
  color: LinkText;
  font-size: 13px;
  text-align: right;
}
.drive-share-empty {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: GrayText;
  font-size: 14px;
  text-align: center;
}
@media (max-width: 720px) {
  .drive-share-shell {
    padding: 18px 18px 36px;
  }
  .drive-share-main {
    max-width: none;
  }
  .drive-share-row {
    grid-template-columns: minmax(0, 1fr) 72px 0 48px;
    gap: 10px;
  }
  .drive-share-time {
    display: none;
  }
}
</style>
</head>
<body>
<main class="drive-share-shell">
  <section class="drive-share-main" aria-label="分享文件列表">
    <nav class="drive-share-breadcrumb" aria-label="当前位置">
      <span class="drive-share-crumb-muted">全部文件</span>
      <span class="drive-share-crumb-separator">›</span>
      <span class="drive-share-crumb-current">${folderName}</span>
    </nav>
    ${emptyState || `<div class="drive-share-list">${children}</div>`}
  </section>
</main>
</body>
</html>`
}

function renderPublicFolderRow(shareId: string, item: DriveItemDto): string {
  const name = escapeHtml(item.name)
  const time = formatPublicDateTime(item.updatedAt)
  const href = `./${encodeURIComponent(shareId)}/${encodeURIComponent(item.id)}/download`
  const download = item.type === "file"
    ? `<a class="drive-share-download" href="${escapeAttribute(href)}" aria-label="下载 ${escapeAttribute(item.name)}">下载</a>`
    : ""
  return `<div class="drive-share-row">
  <span class="drive-share-name" title="${escapeAttribute(item.name)}">${name}</span>
  <span class="drive-share-meta">${item.type === "file" ? escapeHtml(formatPublicBytes(item.size)) : "-"}</span>
  <span class="drive-share-meta drive-share-time">${escapeHtml(time)}</span>
  ${download || "<span></span>"}
</div>`
}

function formatPublicDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  })
  return formatter.format(date).replace(/\//gu, "/")
}

function formatPublicBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
