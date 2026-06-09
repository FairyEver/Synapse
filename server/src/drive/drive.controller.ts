import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import archiver from "archiver"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveItemDto,
} from "@synapse/shared"
import { DriveService } from "./drive.service"
import { LocalDriveStorage } from "./drive-storage"

const driveAccessCookieName = "synapse_drive_access"

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
const deleteItemSchema = z.object({ disablePublications: z.boolean().optional() }).strict()
const driveAccessSettingsSchema = z.object({
  passwordEnabled: z.boolean().optional(),
  expiresIn: z.enum(["7d", "30d", "1y", "forever"]).optional(),
}).strict()
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

  @Get("/items/:id/delete-impact")
  getDeleteImpact(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.getDeleteImpact(request.user!.id, id, resolveRequestPagesPublicUrl(request))
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
  deleteItem(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = body === undefined ? { disablePublications: false } : parseBody(deleteItemSchema, body, "删除请求无效。")
    return this.drive.deleteItem(request.user!.id, id, request.user!.id, request.ip, {
      disablePublications: parsed.disablePublications ?? false,
      publicAppUrl: resolveRequestPagesPublicUrl(request),
    })
  }

  @Post("/items/:id/share")
  createShare(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.drive.createShare(request.user!.id, id, resolveRequestPublicAppUrl(request), parseAccessSettings(body))
  }

  @Get("/publications")
  listPublications(@Req() request: AuthenticatedUserRequest) {
    return this.drive.listPublications(request.user!.id, resolveRequestPagesPublicUrl(request))
  }

  @Post("/items/:id/publications/page")
  publishPage(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.drive.publishPage(request.user!.id, id, resolveRequestPagesPublicUrl(request), parseAccessSettings(body))
  }

  @Post("/items/:id/publications/site")
  publishSite(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.drive.publishSite(request.user!.id, id, resolveRequestPagesPublicUrl(request), parseAccessSettings(body))
  }

  @Post("/publications/:id/redeploy")
  redeployPublication(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.redeployPublication(request.user!.id, id, resolveRequestPagesPublicUrl(request))
  }

  @Delete("/publications/:id")
  disablePublication(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.disablePublication(request.user!.id, id)
  }

  @Delete("/shares/:id")
  disableShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.disableShare(request.user!.id, id)
  }

  @Get("/shares")
  listShares(@Req() request: AuthenticatedUserRequest) {
    return this.drive.listShares(request.user!.id, resolveRequestPublicAppUrl(request))
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

  @Get("/pages/:publishId")
  async openPublishedPage(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
    await this.sendPublishedAsset(response, {
      publishId,
      type: "page",
      relativePath: "index.html",
      request,
    })
  }

  @Post("/pages/:publishId")
  async unlockPublishedPage(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockPublishedAsset(request, response, {
      publishId,
      type: "page",
      relativePath: "index.html",
    })
  }

  @Get("/sites/:publishId")
  async openPublishedSiteRoot(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
    if (request.path.endsWith("/")) {
      await this.sendPublishedAsset(response, {
        publishId,
        type: "site",
        relativePath: "index.html",
        request,
      })
      return
    }
    response.redirect(302, buildSiteRootRedirect(request, publishId))
  }

  @Get(["/sites/:publishId/", "/sites/:publishId/*"])
  async openPublishedSiteAsset(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
    const prefix = `/sites/${encodeURIComponent(publishId)}/`
    const relativePath = safeDecodeURIComponent(request.path.startsWith(prefix) ? request.path.slice(prefix.length) : "")
    await this.sendPublishedAsset(response, {
      publishId,
      type: "site",
      relativePath: relativePath || "index.html",
      request,
    })
  }

  @Post(["/sites/:publishId", "/sites/:publishId/", "/sites/:publishId/*"])
  async unlockPublishedSite(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
    const prefix = `/sites/${encodeURIComponent(publishId)}/`
    const relativePath = safeDecodeURIComponent(request.path.startsWith(prefix) ? request.path.slice(prefix.length) : "")
    await this.unlockPublishedAsset(request, response, {
      publishId,
      type: "site",
      relativePath: relativePath || "index.html",
    })
  }

  @Get("/files/:shareId")
  async openShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password: readPasswordQuery(request),
      cookie: readDriveAccessCookie(request),
    })
    if (access.status === "password_required") {
      response.type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
      return
    }
    if (access.status === "static_denied") {
      response.status(403).type("text/plain; charset=utf-8").send("访问受限")
      return
    }
    if (access.cookie) {
      setDriveAccessCookie(response, access.cookie)
      response.redirect(302, cleanPasswordUrl(request))
      return
    }
    if (access.value.type === "file") {
      response.type("html").send(renderPublicFilePage(shareId, access.value.item))
      return
    }
    const folder = await this.drive.listPublicFolderChildren({
      shareId,
      password: readPasswordQuery(request),
      cookie: readDriveAccessCookie(request),
    })
    response.type("html").send(renderPublicFolderPage(shareId, folder))
  }

  @Post("/files/:shareId")
  async unlockShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password: readBodyPassword(request),
      cookie: readDriveAccessCookie(request),
    })
    if (access.status !== "ok" || !access.cookie) {
      response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
      return
    }
    setDriveAccessCookie(response, access.cookie)
    response.redirect(302, request.path)
  }

  @Get("/files/:shareId/download")
  async downloadShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const password = readPasswordQuery(request)
    if (password) {
      const access = await this.drive.resolvePublicShareAccess({
        shareId,
        password,
        cookie: readDriveAccessCookie(request),
      })
      if (access.status !== "ok") throw new NotFoundException("文件未找到")
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie)
        response.redirect(302, cleanPasswordUrl(request))
        return
      }
    }
    const download = await this.drive.createDownloadUrlForShare({
      shareId,
      password,
      cookie: readDriveAccessCookie(request),
    })
    response.redirect(302, download.url)
  }

  @Get("/files/:shareId/:itemId/download")
  async downloadShareChild(@Param("shareId") shareId: string, @Param("itemId") itemId: string, @Req() request: Request, @Res() response: Response) {
    const password = readPasswordQuery(request)
    if (password) {
      const access = await this.drive.resolvePublicShareAccess({
        shareId,
        password,
        cookie: readDriveAccessCookie(request),
      })
      if (access.status !== "ok") throw new NotFoundException("文件未找到")
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie)
        response.redirect(302, cleanPasswordUrl(request))
        return
      }
    }
    const download = await this.drive.createDownloadUrlForShareChild({
      shareId,
      itemId,
      password,
      cookie: readDriveAccessCookie(request),
    })
    response.redirect(302, download.url)
  }

  @Get("/files/:shareId/zip")
  async downloadFolderZip(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password: readPasswordQuery(request),
      cookie: readDriveAccessCookie(request),
    })
    if (access.status !== "ok") throw new NotFoundException("文件未找到")
    if (access.cookie) {
      setDriveAccessCookie(response, access.cookie)
      response.redirect(302, cleanPasswordUrl(request))
      return
    }
    if (access.value.type !== "folder") {
      const download = await this.drive.createDownloadUrlForShare({
        shareId,
        password: readPasswordQuery(request),
        cookie: readDriveAccessCookie(request),
      })
      response.redirect(302, download.url)
      return
    }
    const entries = await this.drive.createFolderZipEntriesForShare({
      shareId,
      password: readPasswordQuery(request),
      cookie: readDriveAccessCookie(request),
    })
    response.setHeader("Content-Type", "application/zip")
    response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(access.value.item.name)}.zip"`)
    const archive = archiver("zip", { zlib: { level: 6 } })
    archive.pipe(response)
    for (const entry of entries) {
      const objectResponse = await fetch(entry.url)
      if (!objectResponse.ok) throw new NotFoundException("文件未找到")
      archive.append(Buffer.from(await objectResponse.arrayBuffer()), { name: entry.path })
    }
    await archive.finalize()
  }

  private async sendPublishedAsset(response: Response, input: {
    readonly publishId: string
    readonly type: "page" | "site"
    readonly relativePath: string
    readonly request: Request
  }): Promise<void> {
    try {
      const access = await this.drive.resolvePublishedAssetAccess({
        publishId: input.publishId,
        type: input.type,
        relativePath: input.relativePath,
        password: readPasswordQuery(input.request),
        cookie: readDriveAccessCookie(input.request),
      })
      if (access.status === "password_required") {
        response.type("html").send(renderDrivePasswordPage({ actionPath: input.request.path }))
        return
      }
      if (access.status === "static_denied") {
        response.status(403).type("text/plain; charset=utf-8").send("访问受限")
        return
      }
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie)
        response.redirect(302, cleanPasswordUrl(input.request))
        return
      }
      await sendPublishedAsset(response, access.value)
    } catch (error) {
      if (response.headersSent) {
        if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
        return
      }
      if (response.destroyed) return
      sendPublicNotFound(response)
    }
  }

  private async unlockPublishedAsset(request: Request, response: Response, input: {
    readonly publishId: string
    readonly type: "page" | "site"
    readonly relativePath: string
  }): Promise<void> {
    const access = await this.drive.resolvePublishedAssetAccess({
      ...input,
      password: readBodyPassword(request),
      cookie: readDriveAccessCookie(request),
    })
    if (access.status !== "ok" || !access.cookie) {
      response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
      return
    }
    setDriveAccessCookie(response, access.cookie)
    response.redirect(302, request.path)
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

function parseAccessSettings(body: unknown): DriveAccessSettingsInput {
  if (body === undefined || body === null || (isRecord(body) && Object.keys(body).length === 0)) {
    return DRIVE_DEFAULT_ACCESS_SETTINGS
  }
  const parsed = parseBody(driveAccessSettingsSchema, body, "访问设置无效。")
  return {
    passwordEnabled: parsed.passwordEnabled ?? DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled,
    expiresIn: parsed.expiresIn ?? DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn,
  }
}

function resolveRequestPublicAppUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })
}

function resolveRequestPagesPublicUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: firstConfiguredUrl(process.env.PAGES_PUBLIC_URL, process.env.APP_PUBLIC_URL), request })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function firstConfiguredUrl(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim().length > 0)
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return ""
  }
}

function readPasswordQuery(request: Request): string | undefined {
  const value = request.query.password
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readBodyPassword(request: Request): string | undefined {
  const body = request.body
  if (!isRecord(body)) return undefined
  const value = body.password
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readDriveAccessCookie(request: Request): string | undefined {
  const cookies = (request as Request & { readonly cookies?: Record<string, unknown> }).cookies
  const parsed = cookies?.[driveAccessCookieName]
  if (typeof parsed === "string" && parsed.length > 0) return parsed

  const header = request.headers.cookie
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (rawName === driveAccessCookieName) return decodeCookieValue(rawValue.join("="))
  }
  return undefined
}

function setDriveAccessCookie(response: Response, value: string): void {
  response.cookie(driveAccessCookieName, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  })
}

function cleanPasswordUrl(request: Request): string {
  const url = new URL(request.originalUrl || request.url, "http://synapse.local")
  url.searchParams.delete("password")
  return `${url.pathname}${url.search}`
}

function buildSiteRootRedirect(request: Request, publishId: string): string {
  const url = new URL(request.originalUrl || request.url, "http://synapse.local")
  return `/sites/${encodeURIComponent(publishId)}/${url.search}`
}

function decodeCookieValue(value: string): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function sendPublishedAsset(response: Response, asset: {
  readonly stream: NodeJS.ReadableStream
  readonly contentType: string
  readonly size?: bigint
}) {
  response.setHeader("Content-Type", asset.contentType)
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';",
  )
  if (asset.size !== undefined) response.setHeader("Content-Length", asset.size.toString())
  await pipeline(asset.stream, createResponseWritable(response))
}

function createResponseWritable(response: Response): Writable {
  let wroteBody = false
  return new Writable({
    write(chunk, encoding, callback) {
      wroteBody = true
      if (response.write(chunk, encoding)) {
        callback()
        return
      }
      let settled = false
      const cleanup = () => {
        response.off("close", onClose)
        response.off("drain", onDrain)
        response.off("error", onError)
      }
      const settle = (error?: Error | null) => {
        if (settled) return
        settled = true
        cleanup()
        callback(error ?? undefined)
      }
      const onClose = () => settle(new Error("Response closed before published asset finished streaming."))
      const onDrain = () => settle()
      const onError = (error: Error) => settle(error)
      response.once("close", onClose)
      response.once("drain", onDrain)
      response.once("error", onError)
    },
    final(callback) {
      response.end(callback)
    },
    destroy(error, callback) {
      if (error && wroteBody && !response.destroyed) {
        response.destroy(error instanceof Error ? error : undefined)
      }
      callback(error)
    },
  })
}

function sendPublicNotFound(response: Response) {
  response.status(404).type("text/plain; charset=utf-8").send("网页未找到")
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

function renderDrivePasswordPage(input: { readonly actionPath: string; readonly error?: boolean }): string {
  const actionPath = escapeAttribute(input.actionPath)
  const error = input.error ? `<p class="drive-password-error">密码错误</p>` : ""
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>输入密码</title>
<style>
* {
  box-sizing: border-box;
}
body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  background: Canvas;
  color: CanvasText;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.drive-password-shell {
  width: min(100% - 32px, 360px);
}
.drive-password-form {
  display: grid;
  gap: 12px;
}
.drive-password-label {
  font-size: 14px;
  font-weight: 600;
}
.drive-password-input {
  width: 100%;
  min-height: 40px;
  border: 1px solid ButtonBorder;
  border-radius: 6px;
  padding: 8px 10px;
  background: Field;
  color: FieldText;
  font: inherit;
}
.drive-password-button {
  min-height: 40px;
  border: 1px solid ButtonBorder;
  border-radius: 6px;
  background: ButtonFace;
  color: ButtonText;
  font: inherit;
  font-weight: 600;
}
.drive-password-error {
  margin: 0;
  color: Mark;
  font-size: 13px;
}
</style>
</head>
<body>
<main class="drive-password-shell">
  <form class="drive-password-form" method="post" action="${actionPath}">
    <label class="drive-password-label" for="drive-password">密码</label>
    <input class="drive-password-input" id="drive-password" name="password" type="password" autocomplete="current-password" required>
    ${error}
    <button class="drive-password-button" type="submit">确定</button>
  </form>
</main>
</body>
</html>`
}

function renderPublicFilePage(shareId: string, item: DriveItemDto): string {
  const fileName = escapeHtml(item.name)
  const downloadHref = `./${encodeURIComponent(shareId)}/download`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fileName}</title>
<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: Canvas;
  color: CanvasText;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
a {
  color: LinkText;
}
.drive-share-shell {
  min-height: 100vh;
  padding: 28px 40px 48px;
}
.drive-share-main {
  max-width: 720px;
  margin: 0 auto;
}
.drive-share-file {
  display: grid;
  gap: 12px;
  border-top: 1px solid ButtonBorder;
  padding-top: 16px;
}
.drive-share-name {
  overflow-wrap: anywhere;
  font-size: 16px;
  font-weight: 650;
}
.drive-share-meta {
  color: GrayText;
  font-size: 13px;
}
.drive-share-download {
  width: fit-content;
  font-size: 14px;
  font-weight: 600;
}
@media (max-width: 720px) {
  .drive-share-shell {
    padding: 18px 18px 36px;
  }
}
</style>
</head>
<body>
<main class="drive-share-shell">
  <section class="drive-share-main" aria-label="分享文件">
    <div class="drive-share-file">
      <div class="drive-share-name">${fileName}</div>
      <div class="drive-share-meta">${escapeHtml(formatPublicBytes(item.size))}</div>
      <a class="drive-share-download" href="${escapeAttribute(downloadHref)}">下载</a>
    </div>
  </section>
</main>
</body>
</html>`
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
