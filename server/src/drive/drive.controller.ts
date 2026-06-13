import { Body, Controller, Delete, Get, Inject, Logger, NotFoundException, Optional, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import archiver from "archiver"
import { Buffer } from "node:buffer"
import { Readable, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { AuditLogService } from "../common/audit-log.service"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveBrowserPasswordRequiredDto,
  type DriveBrowserSnapshotDto,
} from "@synapse/shared"
import { DriveService } from "./drive.service"
import { type DriveStoragePort, LocalDriveStorage } from "./drive-storage"

const driveAccessCookieNamePrefix = "synapse_drive_access"
const legacyDriveAccessCookieName = driveAccessCookieNamePrefix
type DriveAccessCookieKind = "share" | "page" | "site"

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
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]).optional(),
}).strict()
const adminSortFields = ["createdAt", "updatedAt", "name", "size", "storageStatus"] as const
type AuditRecordInput = Parameters<AuditLogService["record"]>[0]

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

  @Get("/browser/owner/root")
  getOwnerConsoleRootSnapshot(@Req() request: AuthenticatedUserRequest) {
    return this.drive.getOwnerConsoleRootBrowserSnapshot(request.user!.id)
  }

  @Get("/browser/owner/items/:rootItemId")
  getOwnerRootSnapshot(
    @Param("rootItemId") rootItemId: string,
    @Query("surface") surface: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.getOwnerBrowserSnapshot({
      userId: request.user!.id,
      rootItemId,
      surface: parseBrowserSurface(surface),
    })
  }

  @Get("/browser/owner/items/:rootItemId/items/:itemId")
  getOwnerChildSnapshot(
    @Param("rootItemId") rootItemId: string,
    @Param("itemId") itemId: string,
    @Query("surface") surface: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.getOwnerBrowserSnapshot({
      userId: request.user!.id,
      rootItemId,
      currentItemId: itemId,
      surface: parseBrowserSurface(surface),
    })
  }
}

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/drive")
export class DriveAdminController {
  private readonly logger = new Logger(DriveAdminController.name)

  constructor(
    private readonly drive: DriveService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  @Get("/items")
  async listItems(@Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: adminSortFields })
    const filters = {
      userId: typeof query.userId === "string" ? query.userId : undefined,
      type: typeof query.type === "string" ? query.type : undefined,
      storageStatus: typeof query.storageStatus === "string" ? query.storageStatus : undefined,
      shared: typeof query.shared === "string" ? query.shared : undefined,
      search: typeof query.search === "string" ? query.search : undefined,
    }
    const result = await this.drive.listAdminItems({
      pagination,
      filters,
    })
    await this.recordAuditSafely({
      adminEmail: request?.admin?.email ?? "system",
      action: "admin.drive.items.list",
      targetType: "drive_item",
      targetId: "list",
      detail: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        sortBy: pagination.sortBy,
        sortOrder: pagination.sortOrder,
        filters,
        count: result.data.length,
        total: result.total,
      },
      ipAddress: request?.ip ?? "system",
    })
    return result
  }

  @Delete("/items/:id")
  deleteItem(@Param("id") id: string, @Req() request: AdminRequest) {
    return this.drive.deleteItemAsAdmin(id, request.admin!.email, request.ip ?? "system")
  }

  private async recordAuditSafely(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditLog?.record(input)
    } catch (error) {
      this.logger.warn({
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Failed to record drive admin audit log")
    }
  }
}

@Controller()
export class DrivePublicController {
  constructor(
    private readonly drive: DriveService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
  ) {}

  @Get("/api/drive/browser/shares/:shareId")
  async getShareRootSnapshot(
    @Param("shareId") shareId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.getShareSnapshotResponse({ shareId, request, response })
  }

  @Get("/api/drive/browser/shares/:shareId/items/:itemId")
  async getShareItemSnapshot(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.getShareSnapshotResponse({ shareId, itemId, request, response })
  }

  @Post("/api/drive/browser/shares/:shareId/access")
  async unlockShareBrowser(
    @Param("shareId") shareId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.unlockShareBrowserResponse({ shareId, body, request, response })
  }

  @Post("/api/drive/browser/shares/:shareId/items/:itemId/access")
  async unlockShareBrowserItem(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.unlockShareBrowserResponse({ shareId, itemId, body, request, response })
  }

  private async unlockShareBrowserResponse(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly body: unknown
    readonly request: Request
    readonly response: Response
  }): Promise<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto> {
    const password = readPasswordFromBody(input.body)
    const access = await this.drive.resolvePublicShareAccess({
      shareId: input.shareId,
      password,
      cookie: readDriveAccessCookie(input.request, { kind: "share", publicId: input.shareId }),
    })
    if (access.status !== "ok" || !access.cookie) return driveBrowserPasswordRequired()
    setDriveAccessCookie(input.response, access.cookie, { kind: "share", publicId: input.shareId })
    return this.drive.getShareBrowserSnapshot({
      shareId: input.shareId,
      itemId: input.itemId,
      password,
      cookie: access.cookie,
    })
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:rootItemId/download")
  async downloadOwnerItem(@Param("rootItemId") rootItemId: string, @Req() request: AuthenticatedUserRequest, @Res() response: Response) {
    const download = await this.drive.createDownloadUrlForOwnerBrowserItem({
      userId: request.user!.id,
      rootItemId,
    })
    response.redirect(302, download.url)
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:rootItemId/items/:itemId/download")
  async downloadOwnerChildItem(
    @Param("rootItemId") rootItemId: string,
    @Param("itemId") itemId: string,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    const download = await this.drive.createDownloadUrlForOwnerBrowserItem({
      userId: request.user!.id,
      rootItemId,
      currentItemId: itemId,
    })
    response.redirect(302, download.url)
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:rootItemId/zip")
  async downloadOwnerFolderZip(@Param("rootItemId") rootItemId: string, @Req() request: AuthenticatedUserRequest, @Res() response: Response) {
    const entries = await this.drive.createFolderZipEntriesForOwnerBrowserItem({
      userId: request.user!.id,
      rootItemId,
    })
    await sendDriveZip(response, `${rootItemId}.zip`, entries, this.storage)
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:rootItemId/items/:itemId/zip")
  async downloadOwnerChildFolderZip(
    @Param("rootItemId") rootItemId: string,
    @Param("itemId") itemId: string,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    const entries = await this.drive.createFolderZipEntriesForOwnerBrowserItem({
      userId: request.user!.id,
      rootItemId,
      currentItemId: itemId,
    })
    await sendDriveZip(response, `${itemId}.zip`, entries, this.storage)
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:rootItemId/render")
  async renderOwnerHtmlItem(@Param("rootItemId") rootItemId: string, @Req() request: AuthenticatedUserRequest, @Res() response: Response) {
    const asset = await this.drive.resolveOwnerRenderAccess({
      userId: request.user!.id,
      rootItemId,
    })
    await sendPublishedAsset(response, asset)
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:rootItemId/items/:itemId/render")
  async renderOwnerChildHtmlItem(
    @Param("rootItemId") rootItemId: string,
    @Param("itemId") itemId: string,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    const asset = await this.drive.resolveOwnerRenderAccess({
      userId: request.user!.id,
      rootItemId,
      currentItemId: itemId,
    })
    await sendPublishedAsset(response, asset)
  }

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
    if (readPasswordQuery(request)) {
      await this.sendPublishedAsset(response, {
        publishId,
        type: "site",
        relativePath: "index.html",
        request,
        cleanRedirectUrl: buildSiteRootCleanRedirect(request, publishId),
      })
      return
    }
    response.redirect(302, buildSiteRootRedirect(request, publishId))
  }

  @Get(["/sites/:publishId/", "/sites/:publishId/*path"])
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

  @Post(["/sites/:publishId", "/sites/:publishId/", "/sites/:publishId/*path"])
  async unlockPublishedSite(@Param("publishId") publishId: string, @Req() request: Request, @Res() response: Response) {
    const prefix = `/sites/${encodeURIComponent(publishId)}/`
    const relativePath = safeDecodeURIComponent(request.path.startsWith(prefix) ? request.path.slice(prefix.length) : "")
    await this.unlockPublishedAsset(request, response, {
      publishId,
      type: "site",
      relativePath: relativePath || "index.html",
    })
  }

  @Post("/files/:shareId")
  async unlockShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password: readBodyPassword(request),
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    if (access.status !== "ok" || !access.cookie) {
      response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
      return
    }
    setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: shareId })
    response.redirect(302, request.path)
  }

  private async getShareSnapshotResponse(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly request: Request
    readonly response: Response
  }): Promise<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto> {
    const access = await this.drive.resolvePublicShareAccess({
      shareId: input.shareId,
      password: undefined,
      cookie: readDriveAccessCookie(input.request, { kind: "share", publicId: input.shareId }),
    })
    if (access.status === "password_required") return driveBrowserPasswordRequired()
    if (access.status === "static_denied") throw new NotFoundException("文件未找到")
    if (access.cookie) setDriveAccessCookie(input.response, access.cookie, { kind: "share", publicId: input.shareId })
    return this.drive.getShareBrowserSnapshot({
      shareId: input.shareId,
      itemId: input.itemId,
      password: undefined,
      cookie: access.cookie ?? readDriveAccessCookie(input.request, { kind: "share", publicId: input.shareId }),
    })
  }

  @Get("/files/:shareId/download")
  async downloadShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const password = readPasswordQuery(request)
    if (password) {
      const access = await this.drive.resolvePublicShareAccess({
        shareId,
        password,
        cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      })
      if (access.status !== "ok") throw new NotFoundException("文件未找到")
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: shareId })
      }
      response.redirect(302, cleanPasswordUrl(request))
      return
    }
    const download = await this.drive.createDownloadUrlForShareBrowserItem({
      shareId,
      password,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    response.redirect(302, download.url)
  }

  @Get(["/files/:shareId/items/:itemId/download", "/files/:shareId/:itemId/download"])
  async downloadShareChild(@Param("shareId") shareId: string, @Param("itemId") itemId: string, @Req() request: Request, @Res() response: Response) {
    const password = readPasswordQuery(request)
    if (password) {
      const access = await this.drive.resolvePublicShareAccess({
        shareId,
        password,
        cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      })
      if (access.status !== "ok") throw new NotFoundException("文件未找到")
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: shareId })
      }
      response.redirect(302, cleanPasswordUrl(request))
      return
    }
    const download = await this.drive.createDownloadUrlForShareBrowserItem({
      shareId,
      itemId,
      password,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    response.redirect(302, download.url)
  }

  @Get("/files/:shareId/zip")
  async downloadFolderZip(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    const password = readPasswordQuery(request)
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    if (access.status !== "ok") throw new NotFoundException("文件未找到")
    if (access.cookie) {
      setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: shareId })
    }
    if (password) {
      response.redirect(302, cleanPasswordUrl(request))
      return
    }
    const entries = await this.drive.createFolderZipEntriesForShareBrowserItem({
      shareId,
      password,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    await sendDriveZip(response, `${access.value.item.name}.zip`, entries, this.storage)
  }

  @Get("/files/:shareId/items/:itemId/zip")
  async downloadShareChildFolderZip(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const password = readPasswordQuery(request)
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    if (access.status !== "ok") throw new NotFoundException("文件未找到")
    if (access.cookie) {
      setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: shareId })
    }
    if (password) {
      response.redirect(302, cleanPasswordUrl(request))
      return
    }
    const entries = await this.drive.createFolderZipEntriesForShareBrowserItem({
      shareId,
      itemId,
      password,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    await sendDriveZip(response, `${itemId}.zip`, entries, this.storage)
  }

  private async sendPublishedAsset(response: Response, input: {
    readonly publishId: string
    readonly type: "page" | "site"
    readonly relativePath: string
    readonly request: Request
    readonly cleanRedirectUrl?: string
  }): Promise<void> {
    try {
      const password = readPasswordQuery(input.request)
      const access = await this.drive.resolvePublishedAssetAccess({
        publishId: input.publishId,
        type: input.type,
        relativePath: input.relativePath,
        password,
        cookie: readDriveAccessCookie(input.request, { kind: input.type, publicId: input.publishId }),
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
        setDriveAccessCookie(response, access.cookie, { kind: input.type, publicId: input.publishId })
      }
      if (password) {
        response.redirect(302, input.cleanRedirectUrl ?? cleanPasswordUrl(input.request))
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
      cookie: readDriveAccessCookie(request, { kind: input.type, publicId: input.publishId }),
    })
    if (access.status !== "ok" || !access.cookie) {
      response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
      return
    }
    setDriveAccessCookie(response, access.cookie, { kind: input.type, publicId: input.publishId })
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

function parseBrowserSurface(value: string | undefined): "standalone" | "console" {
  return value === "console" ? "console" : "standalone"
}

function driveBrowserPasswordRequired(): DriveBrowserPasswordRequiredDto {
  return { passwordRequired: true, message: "请输入密码。" }
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
  return readPasswordFromBody(request.body)
}

function readPasswordFromBody(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const password = value.password
  return typeof password === "string" && password.length > 0 ? password : undefined
}

function driveAccessCookieName(scope: { readonly kind: DriveAccessCookieKind; readonly publicId: string }): string {
  const encodedPublicId = Buffer.from(scope.publicId, "utf8").toString("base64url")
  return `${driveAccessCookieNamePrefix}_${scope.kind}_${encodedPublicId}`
}

function readDriveAccessCookie(
  request: Request,
  scope: { readonly kind: DriveAccessCookieKind; readonly publicId: string },
): string | undefined {
  const cookieName = driveAccessCookieName(scope)
  const cookies = (request as Request & { readonly cookies?: Record<string, unknown> }).cookies
  for (const name of [cookieName, legacyDriveAccessCookieName]) {
    const parsed = cookies?.[name]
    if (typeof parsed === "string" && parsed.length > 0) return parsed
  }

  const header = request.headers.cookie
  if (!header) return undefined
  const acceptedNames = new Set([cookieName, legacyDriveAccessCookieName])
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (acceptedNames.has(rawName)) return decodeCookieValue(rawValue.join("="))
  }
  return undefined
}

function setDriveAccessCookie(
  response: Response,
  value: string,
  scope: { readonly kind: DriveAccessCookieKind; readonly publicId: string },
): void {
  response.cookie(driveAccessCookieName(scope), value, {
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

function buildSiteRootCleanRedirect(request: Request, publishId: string): string {
  const url = new URL(request.originalUrl || request.url, "http://synapse.local")
  url.searchParams.delete("password")
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

async function sendDriveZip(
  response: Response,
  filename: string,
  entries: readonly { readonly path: string; readonly storageKey: string }[],
  storage: DriveStoragePort,
): Promise<void> {
  response.setHeader("Content-Type", "application/zip")
  response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`)
  const archive = archiver("zip", { zlib: { level: 6 } })
  const archiveError = new Promise<never>((_, reject) => {
    archive.once("error", reject)
  })
  archive.pipe(response)
  try {
    for (const entry of entries) {
      const object = await storage.getObjectStream({ key: entry.storageKey })
      archive.append(object.stream as unknown as Readable, { name: entry.path })
    }
    await Promise.race([archive.finalize(), archiveError])
  } catch (error) {
    archive.destroy()
    if (!response.headersSent) {
      throw error
    }
    response.destroy(error instanceof Error ? error : new Error("Drive zip stream failed."))
    throw error
  }
}

async function sendPublishedAsset(response: Response, asset: {
  readonly stream: NodeJS.ReadableStream
  readonly contentType: string
  readonly size?: bigint
  readonly csp?: string
}) {
  response.setHeader("Content-Type", asset.contentType)
  response.setHeader("X-Content-Type-Options", "nosniff")
  response.setHeader("Referrer-Policy", "no-referrer")
  response.setHeader(
    "Content-Security-Policy",
    asset.csp ?? "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';",
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
