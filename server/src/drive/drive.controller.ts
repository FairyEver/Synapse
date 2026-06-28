import { BadRequestException, Body, Controller, Delete, Get, Head, Inject, Logger, NotFoundException, Optional, Param, Patch, PayloadTooLargeException, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common"
import type { Request, Response } from "express"
import archiver from "archiver"
import { Buffer } from "node:buffer"
import { Readable, Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { z } from "zod"
import { AdminAuthGuard, type AdminRequest } from "../admin-auth/admin-auth.guard"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { AuthenticatedUserRequest, UserAuthGuard } from "../auth/user-auth.guard"
import { formatAuditError } from "../common/audit-error"
import { AuditLogService } from "../common/audit-log.service"
import { attachmentContentDisposition, inlineContentDisposition } from "../common/content-disposition"
import { parsePagination } from "../common/pagination"
import { resolvePublicAppUrl } from "../common/public-app-url"
import { badRequestFromZodError } from "../common/zod-validation"
import {
  DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES,
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES,
  DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES,
  type DriveAccessSettingsInput,
  type DriveBrowserPasswordRequiredDto,
  type DriveBrowserSnapshotDto,
} from "@synapse/shared"
import { DriveService } from "./drive.service"
import { DriveAnnotationService } from "./drive-annotation.service"
import { DriveDocumentImageService } from "./drive-document-image.service"
import { DriveLinkIntakeService } from "./drive-link-intake.service"
import {
  parseDriveAnnotationCommentUpdateBody,
  parseDriveAnnotationCreateBody,
  parseDriveAnnotationReplyBody,
} from "./drive-annotation-target"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { driveSiteCacheControl, driveSiteContentType, renderDriveSiteNotFoundPage } from "./drive-site-public"
import { driveSiteAccessCookieValue, DriveSiteService } from "./drive-site.service"
import { isDriveSiteHtmlPath } from "./drive-site-path"
import { DriveUploadTooLargeError, type DriveStoragePort, LocalDriveStorage } from "./drive-storage"

const driveAccessCookieNamePrefix = "synapse_drive_access"
const legacyDriveAccessCookieName = driveAccessCookieNamePrefix
const DRIVE_HTML_RENDER_CSP = "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob: data:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; media-src 'self' data: blob: https:; connect-src 'self' https:; worker-src 'self' blob: data:; frame-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-pointer-lock;"
const PUBLIC_ASSET_CACHE_CONTROL = "no-cache, must-revalidate"
type DriveAccessCookieKind = "share" | "site"

const prepareUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
  size: z.string().regex(/^\d+$/u),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()

const prepareFolderUploadSchema = z.object({
  parentId: z.string().nullable().optional(),
  folderName: z.string().min(1).max(255),
  files: z.array(z.object({
    relativePath: z.string().min(1).max(1024),
    size: z.string().regex(/^\d+$/u),
    mimeType: z.string().trim().max(255).nullable().optional(),
  }).strict()).min(1).max(1000),
}).strict()

const folderSchema = z.object({
  parentId: z.string().nullable().optional(),
  name: z.string().min(1).max(255),
}).strict()

const folderPathEnsureSchema = z.object({
  parentId: z.string().nullable().optional(),
  segments: z.array(z.string().min(1).max(255)).min(1).max(20),
}).strict()

const reorganizationPreviewSchema = z.object({
  moves: z.array(z.object({
    itemId: z.string().min(1),
    targetParentId: z.string().nullable(),
  }).strict()).min(1).max(1000),
}).strict()

const reorganizationApplySchema = z.object({
  planId: z.string().min(1),
}).strict()

const renameSchema = z.object({ name: z.string().min(1).max(255) }).strict()
const publicAssetPrepareUploadSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.string().regex(/^\d+$/u),
  mimeType: z.string().trim().max(255).nullable().optional(),
}).strict()
const moveSchema = z.object({ parentId: z.string().nullable() }).strict()
const versionPinSchema = z.object({ isPinned: z.boolean() }).strict()
const driveFileTextUpdateSchema = z.object({
  contentType: z.literal("text"),
  text: z.string(),
  baseVersionId: z.string().min(1),
}).strict()
const driveDocumentImageImportSchema = z.object({
  baseVersionId: z.string().min(1),
  sources: z.array(z.object({ src: z.string().min(1) }).strict()).max(DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES),
}).strict()
const driveLinkResolveSchema = z.object({
  url: z.string().url(),
  password: z.string().min(1).max(256).optional(),
}).strict()
const driveLinkListSchema = driveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(200).optional(),
}).strict()
const driveLinkReadTextSchema = driveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
  maxBytes: z.number().int().positive().max(DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES).optional(),
}).strict()
const driveLinkMaterializeSchema = driveLinkResolveSchema.extend({
  scope: z.enum(["entry", "text", "all"]).optional(),
  maxFiles: z.number().int().positive().max(DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES).optional(),
  maxBytes: z.number().int().positive().max(DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES).optional(),
}).strict()
const driveLinkDownloadFileSchema = driveLinkResolveSchema.extend({
  path: z.string().min(1).max(1024).optional(),
  itemId: z.string().min(1).optional(),
}).strict()
const driveAccessSettingsSchema = z.object({
  passwordEnabled: z.boolean().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]).optional(),
  accessMode: z.enum(["link_read", "link_edit", "specified_users_edit"]).optional(),
  editorEmails: z.array(z.string().trim().min(1).max(320)).max(100).optional(),
}).strict()
const driveSiteCreateSchema = z.object({
  sourceFolderItemId: z.string().min(1),
  name: z.string().min(1).max(255),
  entryPath: z.string().min(1).max(1024).nullable().optional(),
  accessMode: z.enum(["public", "password"]),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
}).strict()
const driveSiteAccessUpdateSchema = z.object({
  accessMode: z.enum(["public", "password"]),
  password: z.string().min(1).max(256).nullable().optional(),
  expiresIn: z.enum(["3d", "7d", "30d", "1y", "forever"]),
}).strict()
const driveSiteRepublishSchema = z.object({
  entryPath: z.string().min(1).max(1024).nullable().optional(),
}).strict()
const adminSortFields = ["createdAt", "updatedAt", "name", "size", "storageStatus"] as const
const adminPublicAssetSortFields = ["createdAt", "updatedAt", "name", "size", "lifecycleStatus", "lastAccessedAt"] as const
const adminPublicAssetAccessLogSortFields = ["accessedAt", "statusCode", "method", "bytes"] as const
const adminPublicAssetRevisionSortFields = ["replacedAt", "createdAt", "name", "size"] as const
type AuditRecordInput = Parameters<AuditLogService["record"]>[0]

@UseGuards(UserAuthGuard)
@Controller("/api/drive")
export class DriveUserController {
  constructor(
    private readonly drive: DriveService,
    @Optional() private readonly publicAssets?: DrivePublicAssetService,
    @Optional() private readonly annotations?: DriveAnnotationService,
    @Optional() private readonly sites?: DriveSiteService,
    @Optional() private readonly documentImages?: DriveDocumentImageService,
  ) {}

  @Get("/public-assets")
  listPublicAssets(
    @Query("offset") offset: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("search") search: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requirePublicAssetService(this.publicAssets).listAssets(request.user!.id, resolveRequestPublicAppUrl(request), {
      offset: parseOptionalNonNegativeInteger(offset, "offset"),
      limit: parseOptionalNonNegativeInteger(limit, "limit"),
      search: parseOptionalSearch(search),
    })
  }

  @Get("/public-assets/:assetId")
  getPublicAsset(@Param("assetId") assetId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).getAsset(request.user!.id, assetId, resolveRequestPublicAppUrl(request))
  }

  @Post("/public-assets/uploads/prepare")
  preparePublicAssetUpload(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(publicAssetPrepareUploadSchema, body, "上传请求无效。")
    return requirePublicAssetService(this.publicAssets).prepareUpload(request.user!.id, {
      name: parsed.name,
      size: parsed.size,
      mimeType: parsed.mimeType ?? null,
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/public-assets/uploads/:sessionId/complete")
  completePublicAssetUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).completeUpload(request.user!.id, sessionId, {
      ...driveAuditContext(request),
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/public-assets/uploads/:sessionId/cancel")
  cancelPublicAssetUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).cancelUpload(request.user!.id, sessionId, driveAuditContext(request))
  }

  @Post("/public-assets/:assetId/replace/prepare")
  preparePublicAssetReplace(@Param("assetId") assetId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(publicAssetPrepareUploadSchema, body, "上传请求无效。")
    return requirePublicAssetService(this.publicAssets).prepareReplace(request.user!.id, assetId, {
      name: parsed.name,
      size: parsed.size,
      mimeType: parsed.mimeType ?? null,
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/public-assets/:assetId/replace/:sessionId/complete")
  completePublicAssetReplace(@Param("assetId") assetId: string, @Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).completeReplace(request.user!.id, assetId, sessionId, {
      ...driveAuditContext(request),
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/public-assets/:assetId/replace/:sessionId/cancel")
  cancelPublicAssetReplace(@Param("assetId") assetId: string, @Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).cancelReplace(request.user!.id, assetId, sessionId, driveAuditContext(request))
  }

  @Patch("/public-assets/:assetId")
  renamePublicAsset(@Param("assetId") assetId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(renameSchema, body, "重命名请求无效。")
    return requirePublicAssetService(this.publicAssets).renameAsset(request.user!.id, assetId, parsed.name, {
      ...driveAuditContext(request),
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Delete("/public-assets/:assetId")
  trashPublicAsset(@Param("assetId") assetId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).trashAsset(request.user!.id, assetId, {
      ...driveAuditContext(request),
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Post("/public-assets/:assetId/restore")
  restorePublicAsset(@Param("assetId") assetId: string, @Req() request: AuthenticatedUserRequest) {
    return requirePublicAssetService(this.publicAssets).restoreAsset(request.user!.id, assetId, {
      ...driveAuditContext(request),
      publicAppUrl: resolveRequestPublicAppUrl(request),
    })
  }

  @Get("/public-assets/:assetId/download")
  async downloadPublicAsset(@Param("assetId") assetId: string, @Req() request: AuthenticatedUserRequest, @Res() response: Response) {
    const download = await requirePublicAssetService(this.publicAssets).openAssetDownload(request.user!.id, assetId)
    await sendDriveFileDownload(response, download)
  }

  @Get("/sites/preflight")
  preflightSite(@Query("sourceFolderItemId") sourceFolderItemId: string | undefined, @Req() request: AuthenticatedUserRequest) {
    if (!sourceFolderItemId) throw new BadRequestException("sourceFolderItemId 不能为空。")
    return requireDriveSiteService(this.sites).preflightSite(request.user!.id, sourceFolderItemId)
  }

  @Post("/sites")
  createSite(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(driveSiteCreateSchema, body, "站点发布请求无效。")
    return requireDriveSiteService(this.sites).createSite(request.user!.id, resolveRequestPublicAppUrl(request), parsed)
  }

  @Get("/sites")
  listSites(@Query() query: Record<string, unknown>, @Req() request: AuthenticatedUserRequest) {
    return requireDriveSiteService(this.sites).listSites(
      request.user!.id,
      resolveRequestPublicAppUrl(request),
      parseDriveSiteListQuery(query),
    )
  }

  @Patch("/sites/:siteId/access")
  updateSiteAccess(@Param("siteId") siteId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(driveSiteAccessUpdateSchema, body, "站点访问设置无效。")
    return requireDriveSiteService(this.sites).updateSiteAccess(request.user!.id, siteId, resolveRequestPublicAppUrl(request), parsed)
  }

  @Post("/sites/:siteId/disable")
  disableSite(@Param("siteId") siteId: string, @Req() request: AuthenticatedUserRequest) {
    return requireDriveSiteService(this.sites).disableSite(request.user!.id, siteId, resolveRequestPublicAppUrl(request))
  }

  @Post("/sites/:siteId/enable")
  enableSite(@Param("siteId") siteId: string, @Req() request: AuthenticatedUserRequest) {
    return requireDriveSiteService(this.sites).enableSite(request.user!.id, siteId, resolveRequestPublicAppUrl(request))
  }

  @Post("/sites/:siteId/republish")
  republishSite(@Param("siteId") siteId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(driveSiteRepublishSchema, body, "站点重新发布请求无效。")
    return requireDriveSiteService(this.sites).republishSite(request.user!.id, siteId, resolveRequestPublicAppUrl(request), parsed)
  }

  @Delete("/sites/:siteId")
  deleteSite(@Param("siteId") siteId: string, @Req() request: AuthenticatedUserRequest) {
    return requireDriveSiteService(this.sites).deleteSite(request.user!.id, siteId)
  }

  @Get("/items")
  listItems(@Query("parentId") parentId: string | undefined, @Req() request: AuthenticatedUserRequest) {
    return this.drive.listItems(request.user!.id, parentId ?? null)
  }

  @Get("/items/tree")
  listItemTree(
    @Query("parentId") parentId: string | undefined,
    @Query("offset") offset: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.listItemTree(request.user!.id, {
      parentId: parentId ?? null,
      offset: parseOptionalNonNegativeInteger(offset, "offset"),
      limit: parseOptionalNonNegativeInteger(limit, "limit"),
    })
  }

  @Get("/items/:id")
  getItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.getItem(request.user!.id, id)
  }

  @Get("/items/:itemId/image-sources")
  scanOwnerItemImages(@Param("itemId") itemId: string, @Req() request: AuthenticatedUserRequest) {
    return requireDriveDocumentImageService(this.documentImages).scanOwnerItemImages({
      actorUserId: request.user!.id,
      itemId,
    })
  }

  @Post("/items/:itemId/image-sources/import")
  importOwnerItemImages(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(driveDocumentImageImportSchema, body, "图片转存请求无效。")
    return requireDriveDocumentImageService(this.documentImages).importOwnerItemImages({
      actorUserId: request.user!.id,
      itemId,
      body: parsed,
      publicAppUrl: resolveRequestPublicAppUrl(request),
      auditContext: driveAuditContext(request),
    })
  }

  @Get("/items/:id/versions")
  listFileVersions(
    @Param("id") id: string,
    @Query("offset") offset: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.listFileVersions(request.user!.id, id, {
      offset: parseOptionalNonNegativeInteger(offset, "offset"),
      limit: parseOptionalNonNegativeInteger(limit, "limit"),
    })
  }

  @Get("/items/:id/versions/:versionId/download")
  async downloadFileVersion(
    @Param("id") id: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedUserRequest,
    @Res() response: Response,
  ) {
    const download = await this.drive.openFileVersionDownload(request.user!.id, id, versionId)
    await sendDriveFileDownload(response, download)
  }

  @Post("/items/:id/versions/:versionId/restore")
  restoreFileVersion(@Param("id") id: string, @Param("versionId") versionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.restoreFileVersion(request.user!.id, id, versionId, driveAuditContext(request))
  }

  @Patch("/items/:id/versions/:versionId")
  updateFileVersion(@Param("id") id: string, @Param("versionId") versionId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(versionPinSchema, body, "历史版本请求无效。")
    return this.drive.updateFileVersionPin(request.user!.id, id, versionId, parsed.isPinned, driveAuditContext(request))
  }

  @Delete("/items/:id/versions/:versionId")
  deleteFileVersion(@Param("id") id: string, @Param("versionId") versionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.deleteFileVersion(request.user!.id, id, versionId, driveAuditContext(request))
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
    }, driveAuditContext(request))
  }

  @Post("/uploads/:sessionId/complete")
  completeUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.completeUpload(request.user!.id, sessionId, driveAuditContext(request))
  }

  @Post("/uploads/:sessionId/cancel")
  cancelUpload(@Param("sessionId") sessionId: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.cancelUpload(request.user!.id, sessionId, driveAuditContext(request))
  }

  @Post("/folders")
  createFolder(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(folderSchema, body, "文件夹请求无效。")
    return this.drive.createFolder(request.user!.id, { parentId: parsed.parentId ?? null, name: parsed.name }, driveAuditContext(request))
  }

  @Patch("/items/:id")
  updateItem(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    if (isRecord(body) && "name" in body) {
      const parsed = parseBody(renameSchema, body, "重命名请求无效。")
      return this.drive.renameItem(request.user!.id, id, parsed.name, driveAuditContext(request))
    }
    const parsed = parseBody(moveSchema, body, "移动请求无效。")
    return this.drive.moveItem(request.user!.id, id, parsed.parentId, driveAuditContext(request))
  }

  @Delete("/items/:id")
  deleteItem(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.drive.deleteItem(request.user!.id, id, request.user!.id, request.ip)
  }

  @Get("/trash")
  listTrash(
    @Query("offset") offset: string | undefined,
    @Query("limit") limit: string | undefined,
    @Query("search") search: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.listTrash(request.user!.id, {
      offset: parseOptionalNonNegativeInteger(offset, "offset"),
      limit: parseOptionalNonNegativeInteger(limit, "limit"),
      search: parseOptionalSearch(search),
    })
  }

  @Post("/items/:id/restore")
  restoreItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.restoreItem(request.user!.id, id, request.user!.id, request.ip)
  }

  @Delete("/trash/:id")
  hideTrashItem(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.hideTrashedItem(request.user!.id, id, request.user!.id, request.ip)
  }

  @Post("/items/:id/share")
  createShare(@Param("id") id: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return this.drive.createShare(request.user!.id, id, resolveRequestPublicAppUrl(request), parseAccessSettings(body), driveAuditContext(request))
  }

  @Delete("/shares/:id")
  disableShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.disableShare(request.user!.id, id, driveAuditContext(request))
  }

  @Get("/shares/:id")
  getShare(@Param("id") id: string, @Req() request: AuthenticatedUserRequest) {
    return this.drive.getShare(request.user!.id, id, resolveRequestPublicAppUrl(request))
  }

  @Get("/shares")
  listShares(
    @Query("offset") offset: string | undefined,
    @Query("limit") limit: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.listShares(
      request.user!.id,
      resolveRequestPublicAppUrl(request),
      parseDrivePublicLinksPageQuery(offset, limit),
    )
  }

  @Get("/usage")
  getUsage(@Req() request: AuthenticatedUserRequest) {
    return this.drive.getUsage(request.user!.id)
  }

  @Get("/stats")
  getStats(@Req() request: AuthenticatedUserRequest) {
    return this.drive.getStats(request.user!.id)
  }

  @Post("/folders/ensure-path")
  ensureFolderPath(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(folderPathEnsureSchema, body, "文件夹路径无效。")
    return this.drive.ensureFolderPath(request.user!.id, {
      parentId: parsed.parentId ?? null,
      segments: parsed.segments,
    }, driveAuditContext(request))
  }

  @Post("/reorganizations/preview")
  previewReorganization(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(reorganizationPreviewSchema, body, "整理计划无效。")
    return this.drive.previewReorganization(request.user!.id, parsed)
  }

  @Post("/reorganizations/apply")
  applyReorganization(@Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    const parsed = parseBody(reorganizationApplySchema, body, "整理计划无效。")
    return this.drive.applyReorganization(request.user!.id, parsed, driveAuditContext(request))
  }

  @Get("/browser/owner/root")
  getOwnerConsoleRootSnapshot(
    @Query("childrenOffset") childrenOffset: string | undefined,
    @Query("childrenLimit") childrenLimit: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.getOwnerConsoleRootBrowserSnapshot(
      request.user!.id,
      parseDriveBrowserChildrenPageQuery(childrenOffset, childrenLimit),
    )
  }

  @Get("/browser/owner/items/:itemId")
  getOwnerItemSnapshot(
    @Param("itemId") itemId: string,
    @Query("surface") surface: string | undefined,
    @Query("childrenOffset") childrenOffset: string | undefined,
    @Query("childrenLimit") childrenLimit: string | undefined,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return this.drive.getOwnerBrowserSnapshot({
      userId: request.user!.id,
      itemId,
      surface: parseBrowserSurface(surface),
      childrenPage: parseDriveBrowserChildrenPageQuery(childrenOffset, childrenLimit),
    })
  }

  @Get("/browser/owner/items/:itemId/annotations")
  listOwnerAnnotations(@Param("itemId") itemId: string, @Req() request: AuthenticatedUserRequest) {
    return requireDriveAnnotationService(this.annotations).listOwnerAnnotations(request.user!.id, itemId)
  }

  @Post("/browser/owner/items/:itemId/annotations")
  createOwnerAnnotation(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).createOwnerAnnotation(
      request.user!.id,
      itemId,
      parseDriveAnnotationCreateBody(body),
    )
  }

  @Post("/browser/owner/items/:itemId/annotations/:threadId/comments")
  replyOwnerAnnotation(
    @Param("itemId") itemId: string,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).replyOwnerAnnotation(
      request.user!.id,
      itemId,
      threadId,
      parseDriveAnnotationReplyBody(body),
    )
  }

  @Patch("/browser/owner/items/:itemId/annotations/comments/:commentId")
  updateOwnerAnnotationComment(
    @Param("itemId") itemId: string,
    @Param("commentId") commentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).updateOwnerComment(
      request.user!.id,
      itemId,
      commentId,
      parseDriveAnnotationCommentUpdateBody(body),
    )
  }

  @Delete("/browser/owner/items/:itemId/annotations/comments/:commentId")
  deleteOwnerAnnotationComment(
    @Param("itemId") itemId: string,
    @Param("commentId") commentId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).deleteOwnerComment(request.user!.id, itemId, commentId)
  }

  @Delete("/browser/owner/items/:itemId/annotations/:threadId")
  deleteOwnerAnnotationThread(
    @Param("itemId") itemId: string,
    @Param("threadId") threadId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).deleteOwnerThread(request.user!.id, itemId, threadId)
  }

  @Patch("/browser/owner/items/:itemId/content")
  updateOwnerItemContent(
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(driveFileTextUpdateSchema, body, "保存请求无效。")
    return this.drive.updateOwnerFileText(request.user!.id, itemId, parsed, driveAuditContext(request))
  }
}

@UseGuards(AdminAuthGuard)
@Controller("/api/admin/drive")
export class DriveAdminController {
  private readonly logger = new Logger(DriveAdminController.name)

  constructor(
    private readonly drive: DriveService,
    @Optional() private readonly publicAssets?: DrivePublicAssetService,
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

  @Get("/items/:id/download")
  async downloadItem(@Param("id") id: string, @Req() request: AdminRequest, @Res() response: Response) {
    const download = await this.drive.openAdminItemDownload(id)
    await this.sendAdminDownloadWithAudit(response, download, {
      adminEmail: request.admin!.email,
      action: "admin.drive.item.download",
      targetType: "drive_item",
      targetId: id,
      detail: { itemId: id, name: download.fileName },
      ipAddress: request.ip ?? "system",
    })
  }

  @Post("/items/:id/restore")
  restoreItem(@Param("id") id: string, @Req() request: AdminRequest) {
    return this.drive.restoreItemAsAdmin(id, request.admin!.email, request.ip ?? "system")
  }

  @Get("/storage-summary")
  getStorageSummary(@Req() _request?: AdminRequest) {
    return this.drive.getAdminStorageSummary()
  }

  @Get("/public-assets")
  async listPublicAssets(@Query() query: Record<string, unknown>, @Req() request: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: adminPublicAssetSortFields })
    const filters = {
      search: typeof query.search === "string" ? query.search : undefined,
      userId: typeof query.userId === "string" ? query.userId : undefined,
      lifecycleStatus: typeof query.lifecycleStatus === "string" ? query.lifecycleStatus : undefined,
    }
    const result = await requirePublicAssetService(this.publicAssets).listAdminAssets(resolveAdminPublicAppUrl(request), {
      pagination,
      ...filters,
    })
    await this.recordAuditSafely({
      adminEmail: request.admin!.email,
      action: "admin.drive.public_assets.list",
      targetType: "drive_public_asset",
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
      ipAddress: request.ip ?? "system",
    })
    return result
  }

  @Get("/public-assets/:assetId")
  async getPublicAsset(@Param("assetId") assetId: string, @Req() request: AdminRequest) {
    const result = await requirePublicAssetService(this.publicAssets).getAdminAsset(
      assetId,
      resolveAdminPublicAppUrl(request),
    )
    await this.recordAuditSafely({
      adminEmail: request.admin!.email,
      action: "admin.drive.public_asset.get",
      targetType: "drive_public_asset",
      targetId: assetId,
      detail: { assetId },
      ipAddress: request.ip ?? "system",
    })
    return result
  }

  @Get("/public-assets/:assetId/access-logs")
  async listPublicAssetAccessLogs(@Param("assetId") assetId: string, @Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(
      { ...query, sortBy: typeof query.sortBy === "string" ? query.sortBy : "accessedAt" },
      { allowedSortFields: adminPublicAssetAccessLogSortFields },
    )
    const result = await requirePublicAssetService(this.publicAssets).listAdminAccessLogs(
      assetId,
      pagination,
    )
    await this.recordAuditSafely({
      adminEmail: request?.admin?.email ?? "system",
      action: "admin.drive.public_asset_access_logs.list",
      targetType: "drive_public_asset",
      targetId: assetId,
      detail: {
        assetId,
        page: pagination.page,
        pageSize: pagination.pageSize,
        sortBy: pagination.sortBy,
        sortOrder: pagination.sortOrder,
        count: result.data.length,
        total: result.total,
      },
      ipAddress: request?.ip ?? "system",
    })
    return result
  }

  @Get("/public-assets/:assetId/revisions")
  async listPublicAssetRevisions(@Param("assetId") assetId: string, @Query() query: Record<string, unknown>, @Req() request?: AdminRequest) {
    const pagination = parsePagination(query, { allowedSortFields: adminPublicAssetRevisionSortFields })
    const result = await requirePublicAssetService(this.publicAssets).listAdminRevisions(
      assetId,
      pagination,
    )
    await this.recordAuditSafely({
      adminEmail: request?.admin?.email ?? "system",
      action: "admin.drive.public_asset_revisions.list",
      targetType: "drive_public_asset",
      targetId: assetId,
      detail: {
        assetId,
        page: pagination.page,
        pageSize: pagination.pageSize,
        sortBy: pagination.sortBy,
        sortOrder: pagination.sortOrder,
        count: result.data.length,
        total: result.total,
      },
      ipAddress: request?.ip ?? "system",
    })
    return result
  }

  @Get("/public-assets/:assetId/revisions/:revisionId/download")
  async downloadPublicAssetRevision(
    @Param("assetId") assetId: string,
    @Param("revisionId") revisionId: string,
    @Req() request: AdminRequest,
    @Res() response: Response,
  ) {
    const download = await requirePublicAssetService(this.publicAssets).openAdminRevisionDownload(assetId, revisionId)
    await this.sendAdminDownloadWithAudit(response, download, {
      adminEmail: request.admin!.email,
      action: "admin.drive.public_asset_revision.download",
      targetType: "drive_public_asset_revision",
      targetId: revisionId,
      detail: { assetId, revisionId, name: download.fileName },
      ipAddress: request.ip ?? "system",
    })
  }

  private async sendAdminDownloadWithAudit(
    response: Response,
    download: Parameters<typeof sendDriveFileDownload>[1],
    audit: AuditRecordInput,
  ): Promise<void> {
    const detail = isRecord(audit.detail) ? audit.detail : {}
    try {
      await sendDriveFileDownload(response, download)
      await this.recordAuditSafely({
        ...audit,
        detail: { ...detail, status: "completed" },
      })
    } catch (error) {
      await this.recordAuditSafely({
        ...audit,
        detail: {
          ...detail,
          status: "failed",
          ...downloadTransferErrorMetadata(error),
        },
      })
      throw error
    }
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

function downloadTransferErrorMetadata(error: unknown): { readonly errorName: string; readonly errorLength: number } {
  const message = error instanceof Error ? error.message : String(error)
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorLength: message.length,
  }
}

@Controller()
export class DrivePublicController {
  constructor(
    private readonly drive: DriveService,
    @Inject("DriveStoragePort") private readonly storage: DriveStoragePort,
    @Optional() private readonly publicAssets?: DrivePublicAssetService,
    @Optional() private readonly dashboardAuth?: AdminAuthService,
    @Optional() private readonly annotations?: DriveAnnotationService,
    @Optional() private readonly sites?: DriveSiteService,
    @Optional() private readonly documentImages?: DriveDocumentImageService,
    @Optional() private readonly linkIntake?: DriveLinkIntakeService,
  ) {}

  @Post("/api/drive/link-intake/resolve")
  resolveDriveLink(@Body() body: unknown) {
    return requireDriveLinkIntakeService(this.linkIntake).resolve(parseBody(driveLinkResolveSchema, body, "云盘链接无效。"))
  }

  @Post("/api/drive/link-intake/list")
  listDriveLink(@Body() body: unknown) {
    return requireDriveLinkIntakeService(this.linkIntake).list(parseBody(driveLinkListSchema, body, "云盘链接目录请求无效。"))
  }

  @Post("/api/drive/link-intake/read-text")
  readDriveLinkText(@Body() body: unknown) {
    return requireDriveLinkIntakeService(this.linkIntake).readText(parseBody(driveLinkReadTextSchema, body, "云盘链接正文请求无效。"))
  }

  @Post("/api/drive/link-intake/materialize-plan")
  planDriveLinkMaterialize(@Body() body: unknown) {
    return requireDriveLinkIntakeService(this.linkIntake).list(parseBody(driveLinkMaterializeSchema, body, "云盘链接落盘请求无效。"))
  }

  @Post("/api/drive/link-intake/download-file-plan")
  planDriveLinkDownloadFile(@Body() body: unknown) {
    return requireDriveLinkIntakeService(this.linkIntake).resolve(parseBody(driveLinkDownloadFileSchema, body, "云盘链接下载请求无效。"))
  }

  @Get("/files/:assetId")
  @Head("/files/:assetId")
  async sendPublicAsset(@Param("assetId") assetId: string, @Req() request: Request, @Res() response: Response): Promise<void> {
    const publicAssets = requirePublicAssetService(this.publicAssets)
    const method = request.method.toUpperCase()
    const accessBase = {
      assetId,
      ip: request.ip ?? null,
      referer: readHeaderString(request.headers.referer),
      userAgent: readHeaderString(request.headers["user-agent"]),
      method,
    }
    const resolved = await publicAssets.resolvePublicAsset(assetId, request.headers)
    if (resolved.status === "not_found") {
      response.setHeader("Cache-Control", "no-store")
      response.status(404).send("Not Found")
      void publicAssets.recordAccessSafely({ ...accessBase, statusCode: 404, bytes: 0n })
      return
    }
    if (resolved.status === "not_modified") {
      response.setHeader("Cache-Control", PUBLIC_ASSET_CACHE_CONTROL)
      response.setHeader("ETag", resolved.etag)
      response.status(304).end()
      void publicAssets.recordAccessSafely({
        ...accessBase,
        publicAssetId: resolved.publicAssetId,
        userId: resolved.userId,
        statusCode: 304,
        bytes: 0n,
      })
      return
    }

    response.setHeader("Cache-Control", PUBLIC_ASSET_CACHE_CONTROL)
    response.setHeader("Content-Type", resolved.mimeType)
    response.setHeader("Content-Disposition", inlineContentDisposition(resolved.name))
    response.setHeader("Content-Length", resolved.size.toString())
    response.setHeader("X-Content-Type-Options", "nosniff")
    if (resolved.etag) response.setHeader("ETag", resolved.etag)
    if (method === "HEAD") {
      response.status(200).end()
      void publicAssets.recordAccessSafely({
        ...accessBase,
        publicAssetId: resolved.publicAssetId,
        userId: resolved.userId,
        statusCode: 200,
        bytes: 0n,
      })
      return
    }

    try {
      const object = await this.storage.getObjectStream({ key: resolved.storageKey })
      await pipeline(object.stream as Readable, response)
      void publicAssets.recordAccessSafely({
        ...accessBase,
        publicAssetId: resolved.publicAssetId,
        userId: resolved.userId,
        statusCode: 200,
        bytes: object.size ?? resolved.size,
      })
    } catch (error) {
      if (response.headersSent) {
        void publicAssets.recordAccessSafely({
          ...accessBase,
          publicAssetId: resolved.publicAssetId,
          userId: resolved.userId,
          statusCode: 500,
          bytes: 0n,
        })
        if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
        return
      }
      response.removeHeader("Cache-Control")
      response.removeHeader("Content-Type")
      response.removeHeader("Content-Disposition")
      response.removeHeader("Content-Length")
      response.removeHeader("ETag")
      response.setHeader("Cache-Control", "no-store")
      response.status(404).send("Not Found")
      void publicAssets.recordAccessSafely({ ...accessBase, statusCode: 404, bytes: 0n })
    }
  }

  @Get("/sites/:siteId")
  async serveSiteRoot(@Param("siteId") siteId: string, @Req() request: Request, @Res() response: Response) {
    await this.serveSiteAsset(siteId, "", request, response)
  }

  @Post("/sites/:siteId")
  async unlockSiteRoot(@Param("siteId") siteId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockSiteToPath(siteId, request, response)
  }

  @Post("/sites/:siteId/*path")
  async unlockSitePath(@Param("siteId") siteId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockSiteToPath(siteId, request, response)
  }

  @Get("/sites/:siteId/*path")
  async serveSitePath(
    @Param("siteId") siteId: string,
    @Param("path") pathSegments: string[] | string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const relativePath = Array.isArray(pathSegments) ? pathSegments.join("/") : pathSegments ?? ""
    await this.serveSiteAsset(siteId, relativePath, request, response)
  }

  private async unlockSiteToPath(siteId: string, request: Request, response: Response): Promise<void> {
    const password = readBodyPassword(request)
    const sites = requireDriveSiteService(this.sites)
    if (!password || !await sites.verifySitePassword(siteId, password)) {
      response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
      return
    }
    setDriveAccessCookie(response, driveSiteAccessCookieValue(siteId), { kind: "site", publicId: siteId })
    response.redirect(302, request.path)
  }

  private async serveSiteAsset(siteId: string, relativePath: string, request: Request, response: Response): Promise<void> {
    const sites = requireDriveSiteService(this.sites)
    const password = readPasswordQuery(request)
    if (password) {
      if (await sites.verifySitePassword(siteId, password)) {
        setDriveAccessCookie(response, driveSiteAccessCookieValue(siteId), { kind: "site", publicId: siteId })
        response.redirect(302, cleanPasswordUrl(request))
        return
      }
      if (relativePath === "" || isDriveSiteHtmlPath(relativePath)) {
        response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
        return
      }
      response.status(404).type("html").send(renderDriveSiteNotFoundPage())
      return
    }
    const access = await sites.resolvePublicSite(siteId, {
      cookie: readDriveAccessCookie(request, { kind: "site", publicId: siteId }) ?? null,
      relativePath,
    })
    if (access.status === "password_required") {
      if (relativePath === "" || isDriveSiteHtmlPath(relativePath)) {
        response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
        return
      }
      response.status(404).type("html").send(renderDriveSiteNotFoundPage())
      return
    }
    if (access.status !== "ok") {
      response.status(404).type("html").send(renderDriveSiteNotFoundPage())
      return
    }
    const object = await this.storage.getObjectStream({ key: access.asset.storageKey })
    response.setHeader("Content-Type", driveSiteContentType(access.asset.relativePath, object.contentType ?? access.asset.contentType))
    response.setHeader("Cache-Control", driveSiteCacheControl(access.asset.relativePath))
    response.setHeader("X-Content-Type-Options", "nosniff")
    if (object.size !== undefined) response.setHeader("Content-Length", object.size.toString())
    await pipeline(object.stream as Readable, response)
  }

  @Get("/api/drive/browser/shares/:shareId")
  async getShareRootSnapshot(
    @Param("shareId") shareId: string,
    @Query("childrenOffset") childrenOffset: string | undefined,
    @Query("childrenLimit") childrenLimit: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.getShareSnapshotResponse({
      shareId,
      childrenPage: parseDriveBrowserChildrenPageQuery(childrenOffset, childrenLimit),
      request,
      response,
    })
  }

  @Get("/api/drive/browser/shares/:shareId/items/:itemId")
  async getShareItemSnapshot(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Query("childrenOffset") childrenOffset: string | undefined,
    @Query("childrenLimit") childrenLimit: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.getShareSnapshotResponse({
      shareId,
      itemId,
      childrenPage: parseDriveBrowserChildrenPageQuery(childrenOffset, childrenLimit),
      request,
      response,
    })
  }

  @Get("/api/drive/browser/shares/:shareId/annotations")
  async listShareRootAnnotations(@Param("shareId") shareId: string, @Req() request: Request) {
    return requireDriveAnnotationService(this.annotations).listShareAnnotations({
      shareId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      actorUserId: await this.resolveOptionalUserId(request),
    })
  }

  @Get("/api/drive/browser/shares/:shareId/items/:itemId/annotations")
  async listShareItemAnnotations(@Param("shareId") shareId: string, @Param("itemId") itemId: string, @Req() request: Request) {
    return requireDriveAnnotationService(this.annotations).listShareAnnotations({
      shareId,
      itemId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      actorUserId: await this.resolveOptionalUserId(request),
    })
  }

  @UseGuards(UserAuthGuard)
  @Post("/api/drive/browser/shares/:shareId/annotations")
  createShareRootAnnotation(@Param("shareId") shareId: string, @Body() body: unknown, @Req() request: AuthenticatedUserRequest) {
    return requireDriveAnnotationService(this.annotations).createShareAnnotation({
      actorUserId: request.user!.id,
      shareId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parseDriveAnnotationCreateBody(body),
    })
  }

  @UseGuards(UserAuthGuard)
  @Post("/api/drive/browser/shares/:shareId/items/:itemId/annotations")
  createShareItemAnnotation(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).createShareAnnotation({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parseDriveAnnotationCreateBody(body),
    })
  }

  @UseGuards(UserAuthGuard)
  @Post("/api/drive/browser/shares/:shareId/annotations/:threadId/comments")
  replyShareRootAnnotation(
    @Param("shareId") shareId: string,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).replyShareAnnotation({
      actorUserId: request.user!.id,
      shareId,
      threadId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parseDriveAnnotationReplyBody(body),
    })
  }

  @UseGuards(UserAuthGuard)
  @Post("/api/drive/browser/shares/:shareId/items/:itemId/annotations/:threadId/comments")
  replyShareItemAnnotation(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Param("threadId") threadId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).replyShareAnnotation({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      threadId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parseDriveAnnotationReplyBody(body),
    })
  }

  @UseGuards(UserAuthGuard)
  @Patch("/api/drive/browser/shares/:shareId/annotations/comments/:commentId")
  updateShareRootAnnotationComment(
    @Param("shareId") shareId: string,
    @Param("commentId") commentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).updateShareComment({
      actorUserId: request.user!.id,
      shareId,
      commentId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parseDriveAnnotationCommentUpdateBody(body),
    })
  }

  @UseGuards(UserAuthGuard)
  @Patch("/api/drive/browser/shares/:shareId/items/:itemId/annotations/comments/:commentId")
  updateShareItemAnnotationComment(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Param("commentId") commentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).updateShareComment({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      commentId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parseDriveAnnotationCommentUpdateBody(body),
    })
  }

  @UseGuards(UserAuthGuard)
  @Delete("/api/drive/browser/shares/:shareId/annotations/comments/:commentId")
  deleteShareRootAnnotationComment(
    @Param("shareId") shareId: string,
    @Param("commentId") commentId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).deleteShareComment({
      actorUserId: request.user!.id,
      shareId,
      commentId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
  }

  @UseGuards(UserAuthGuard)
  @Delete("/api/drive/browser/shares/:shareId/items/:itemId/annotations/comments/:commentId")
  deleteShareItemAnnotationComment(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Param("commentId") commentId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).deleteShareComment({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      commentId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
  }

  @UseGuards(UserAuthGuard)
  @Delete("/api/drive/browser/shares/:shareId/annotations/:threadId")
  deleteShareRootAnnotationThread(
    @Param("shareId") shareId: string,
    @Param("threadId") threadId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).deleteShareThread({
      actorUserId: request.user!.id,
      shareId,
      threadId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
  }

  @UseGuards(UserAuthGuard)
  @Delete("/api/drive/browser/shares/:shareId/items/:itemId/annotations/:threadId")
  deleteShareItemAnnotationThread(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Param("threadId") threadId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveAnnotationService(this.annotations).deleteShareThread({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      threadId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
  }

  @Post("/api/drive/browser/shares/:shareId/access")
  async unlockShareBrowser(
    @Param("shareId") shareId: string,
    @Query("childrenOffset") childrenOffset: string | undefined,
    @Query("childrenLimit") childrenLimit: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.unlockShareBrowserResponse({
      shareId,
      childrenPage: parseDriveBrowserChildrenPageQuery(childrenOffset, childrenLimit),
      body,
      request,
      response,
    })
  }

  @Post("/api/drive/browser/shares/:shareId/items/:itemId/access")
  async unlockShareBrowserItem(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Query("childrenOffset") childrenOffset: string | undefined,
    @Query("childrenLimit") childrenLimit: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.unlockShareBrowserResponse({
      shareId,
      itemId,
      childrenPage: parseDriveBrowserChildrenPageQuery(childrenOffset, childrenLimit),
      body,
      request,
      response,
    })
  }

  @UseGuards(UserAuthGuard)
  @Patch("/api/drive/browser/shares/:shareId/content")
  updateShareRootContent(
    @Param("shareId") shareId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(driveFileTextUpdateSchema, body, "保存请求无效。")
    return this.drive.updateShareFileText({
      actorUserId: request.user!.id,
      shareId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parsed,
      auditContext: driveAuditContext(request),
    })
  }

  @UseGuards(UserAuthGuard)
  @Patch("/api/drive/browser/shares/:shareId/items/:itemId/content")
  updateShareItemContent(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(driveFileTextUpdateSchema, body, "保存请求无效。")
    return this.drive.updateShareFileText({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parsed,
      auditContext: driveAuditContext(request),
    })
  }

  @UseGuards(UserAuthGuard)
  @Get("/api/drive/browser/shares/:shareId/image-sources")
  scanShareRootImages(@Param("shareId") shareId: string, @Req() request: AuthenticatedUserRequest) {
    return requireDriveDocumentImageService(this.documentImages).scanShareItemImages({
      actorUserId: request.user!.id,
      shareId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
  }

  @UseGuards(UserAuthGuard)
  @Get("/api/drive/browser/shares/:shareId/items/:itemId/image-sources")
  scanShareItemImages(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Req() request: AuthenticatedUserRequest,
  ) {
    return requireDriveDocumentImageService(this.documentImages).scanShareItemImages({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
  }

  @UseGuards(UserAuthGuard)
  @Post("/api/drive/browser/shares/:shareId/image-sources/import")
  importShareRootImages(
    @Param("shareId") shareId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(driveDocumentImageImportSchema, body, "图片转存请求无效。")
    return requireDriveDocumentImageService(this.documentImages).importShareItemImages({
      actorUserId: request.user!.id,
      shareId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parsed,
      publicAppUrl: resolveRequestPublicAppUrl(request),
      auditContext: driveAuditContext(request),
    })
  }

  @UseGuards(UserAuthGuard)
  @Post("/api/drive/browser/shares/:shareId/items/:itemId/image-sources/import")
  importShareItemImages(
    @Param("shareId") shareId: string,
    @Param("itemId") itemId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedUserRequest,
  ) {
    const parsed = parseBody(driveDocumentImageImportSchema, body, "图片转存请求无效。")
    return requireDriveDocumentImageService(this.documentImages).importShareItemImages({
      actorUserId: request.user!.id,
      shareId,
      itemId,
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
      body: parsed,
      publicAppUrl: resolveRequestPublicAppUrl(request),
      auditContext: driveAuditContext(request),
    })
  }

  private async unlockShareBrowserResponse(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly childrenPage?: { readonly offset?: number; readonly limit?: number }
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
    if (access.status !== "ok") return driveBrowserPasswordRequired()
    if (access.cookie) setDriveAccessCookie(input.response, access.cookie, { kind: "share", publicId: input.shareId })
    return this.drive.getShareBrowserSnapshot({
      shareId: input.shareId,
      itemId: input.itemId,
      password,
      cookie: access.cookie ?? readDriveAccessCookie(input.request, { kind: "share", publicId: input.shareId }),
      actorUserId: await this.resolveOptionalUserId(input.request),
      childrenPage: input.childrenPage,
    })
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:itemId/download")
  async downloadOwnerItem(@Param("itemId") itemId: string, @Req() request: AuthenticatedUserRequest, @Res() response: Response) {
    const transfer = await this.drive.openOwnerBrowserItemDownload({
      userId: request.user!.id,
      itemId,
    })
    await sendDriveTransfer(response, transfer, this.storage)
  }

  @UseGuards(UserAuthGuard)
  @Get("/drive/items/:itemId/render")
  async renderOwnerHtmlItem(@Param("itemId") itemId: string, @Req() request: AuthenticatedUserRequest, @Res() response: Response) {
    const asset = await this.drive.resolveOwnerRenderAccess({
      userId: request.user!.id,
      itemId,
    })
    await sendOwnerRenderedAsset(response, asset)
  }

  @Post("/share/:shareId")
  async unlockShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockShareToPath(shareId, request, response)
  }

  @Post("/share/:shareId/download")
  async unlockShareDownload(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockShareToPath(shareId, request, response)
  }

  @Post("/share/:shareId/items/:itemId/download")
  async unlockShareChildDownload(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockShareToPath(shareId, request, response)
  }

  @Post("/share/:shareId/render")
  async unlockShareRender(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockShareToPath(shareId, request, response)
  }

  @Post("/share/:shareId/items/:itemId/render")
  async unlockShareChildRender(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.unlockShareToPath(shareId, request, response)
  }

  private async unlockShareToPath(shareId: string, request: Request, response: Response): Promise<void> {
    const access = await this.drive.resolvePublicShareAccess({
      shareId,
      password: readBodyPassword(request),
      cookie: readDriveAccessCookie(request, { kind: "share", publicId: shareId }),
    })
    if (access.status !== "ok") {
      response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path, error: true }))
      return
    }
    if (access.cookie) setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: shareId })
    response.redirect(302, request.path)
  }

  private async getShareSnapshotResponse(input: {
    readonly shareId: string
    readonly itemId?: string
    readonly childrenPage?: { readonly offset?: number; readonly limit?: number }
    readonly request: Request
    readonly response: Response
  }): Promise<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto> {
    const access = await this.drive.resolvePublicShareAccess({
      shareId: input.shareId,
      password: undefined,
      cookie: readDriveAccessCookie(input.request, { kind: "share", publicId: input.shareId }),
    })
    if (access.status === "password_required") return driveBrowserPasswordRequired()
    if (access.cookie) setDriveAccessCookie(input.response, access.cookie, { kind: "share", publicId: input.shareId })
    return this.drive.getShareBrowserSnapshot({
      shareId: input.shareId,
      itemId: input.itemId,
      password: undefined,
      cookie: access.cookie ?? readDriveAccessCookie(input.request, { kind: "share", publicId: input.shareId }),
      actorUserId: await this.resolveOptionalUserId(input.request),
      childrenPage: input.childrenPage,
    })
  }

  private async resolveOptionalUserId(request: Request): Promise<string | null> {
    if (!this.dashboardAuth) return null
    const token = readRequestCookie(request, "synapse_admin")
    const session = token
      ? await this.dashboardAuth.verifyDashboardSession(token)
      : null
    return session?.role === "user" ? session.id : null
  }

  @Get("/share/:shareId/download")
  async downloadShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.sendShareDownload(response, request, { shareId })
  }

  @Get("/share/:shareId/items/:itemId/download")
  async downloadShareChild(@Param("shareId") shareId: string, @Param("itemId") itemId: string, @Req() request: Request, @Res() response: Response) {
    await this.sendShareDownload(response, request, { shareId, itemId })
  }

  @Get("/share/:shareId/render")
  async renderShare(@Param("shareId") shareId: string, @Req() request: Request, @Res() response: Response) {
    await this.sendShareRenderedAsset(response, request, { shareId })
  }

  @Get("/share/:shareId/items/:itemId/render")
  async renderShareChild(@Param("shareId") shareId: string, @Param("itemId") itemId: string, @Req() request: Request, @Res() response: Response) {
    await this.sendShareRenderedAsset(response, request, { shareId, itemId })
  }

  private async sendShareDownload(response: Response, request: Request, input: {
    readonly shareId: string
    readonly itemId?: string
  }): Promise<void> {
    try {
      const password = readPasswordQuery(request)
      const access = await this.drive.resolvePublicShareAccess({
        shareId: input.shareId,
        password,
        cookie: readDriveAccessCookie(request, { kind: "share", publicId: input.shareId }),
      })
      if (access.status !== "ok") {
        if (access.status === "password_required" && !password) {
          response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
          return
        }
        throw new NotFoundException("文件未找到")
      }
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: input.shareId })
      }
      if (password) {
        response.redirect(302, cleanPasswordUrl(request))
        return
      }
      const transfer = await this.drive.openShareBrowserItemDownload({
        shareId: input.shareId,
        itemId: input.itemId,
        cookie: readDriveAccessCookie(request, { kind: "share", publicId: input.shareId }),
      })
      await sendDriveTransfer(response, transfer, this.storage)
    } catch (error) {
      if (isNotFoundException(error)) {
        sendDriveInvalidSharePage(response)
        return
      }
      throw error
    }
  }

  private async sendShareRenderedAsset(response: Response, request: Request, input: {
    readonly shareId: string
    readonly itemId?: string
  }): Promise<void> {
    try {
      const password = readPasswordQuery(request)
      const cookie = readDriveAccessCookie(request, { kind: "share", publicId: input.shareId })
      if (password) {
        const shareAccess = await this.drive.resolvePublicShareAccess({
          shareId: input.shareId,
          password,
          cookie,
        })
        if (shareAccess.status !== "ok") throw new NotFoundException("文件未找到")
        if (shareAccess.cookie) {
          setDriveAccessCookie(response, shareAccess.cookie, { kind: "share", publicId: input.shareId })
        }
        response.redirect(302, cleanPasswordUrl(request))
        return
      }
      const access = await this.drive.resolveShareRenderAccess({
        shareId: input.shareId,
        itemId: input.itemId,
        cookie,
      })
      if (access.status !== "ok") {
        if (access.status === "password_required") {
          response.status(200).type("html").send(renderDrivePasswordPage({ actionPath: request.path }))
          return
        }
        throw new NotFoundException("文件未找到")
      }
      if (access.cookie) {
        setDriveAccessCookie(response, access.cookie, { kind: "share", publicId: input.shareId })
      }
      await sendDriveHtmlRenderedAsset(response, access.value)
    } catch (error) {
      if (isNotFoundException(error)) {
        sendDriveInvalidSharePage(response)
        return
      }
      throw error
    }
  }
}

@Controller("/api/drive")
export class DriveLocalStorageController {
  private readonly logger = new Logger(DriveLocalStorageController.name)

  constructor(private readonly storage: LocalDriveStorage) {}

  @Put("/local-upload/:token")
  async upload(@Param("token") token: string, @Req() request: Request) {
    try {
      await this.storage.acceptUpload(token, request)
    } catch (error) {
      if (error instanceof DriveUploadTooLargeError) throw new PayloadTooLargeException("上传文件超过声明大小。")
      throw error
    }
    return { ok: true }
  }

  @Get("/local-download/:token")
  async download(@Param("token") token: string, @Res() response: Response): Promise<void> {
    let storageKey: string | undefined
    try {
      const download = this.storage.resolveDownload(token)
      storageKey = download.key
      response.attachment(download.filename)
      await pipeline(download.stream, response)
    } catch (error) {
      storageKey = readLocalDriveStorageKey(error) ?? storageKey
      this.logger.warn({
        message: "drive local download stream failed",
        storageKeyLength: storageKey?.length ?? 0,
        tokenLength: token.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: formatAuditError(error),
      })
      if (response.headersSent) {
        if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined)
        return
      }
      if (response.destroyed) return
      response.removeHeader("Content-Disposition")
      const missing = isMissingLocalDriveObjectError(error)
      response.status(missing ? 404 : 500).json({
        error: missing ? "文件不存在或已被删除。" : "文件下载失败。",
      })
    }
  }
}

function isMissingLocalDriveObjectError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as { readonly code?: unknown }).code === "ENOENT"
}

function readLocalDriveStorageKey(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("storageKey" in error)) return undefined
  const storageKey = (error as { readonly storageKey?: unknown }).storageKey
  return typeof storageKey === "string" ? storageKey : undefined
}

function parseBody<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const result = schema.safeParse(body)
  if (!result.success) throw badRequestFromZodError(result.error, message)
  return result.data
}

function requirePublicAssetService(publicAssets: DrivePublicAssetService | undefined): DrivePublicAssetService {
  if (!publicAssets) throw new Error("DrivePublicAssetService is not available.")
  return publicAssets
}

function requireDriveAnnotationService(annotations: DriveAnnotationService | undefined): DriveAnnotationService {
  if (!annotations) throw new Error("DriveAnnotationService is not available.")
  return annotations
}

function requireDriveSiteService(sites: DriveSiteService | undefined): DriveSiteService {
  if (!sites) throw new Error("DriveSiteService is not available.")
  return sites
}

function requireDriveLinkIntakeService(linkIntake: DriveLinkIntakeService | undefined): DriveLinkIntakeService {
  if (!linkIntake) throw new Error("DriveLinkIntakeService is not available.")
  return linkIntake
}

function requireDriveDocumentImageService(documentImages: DriveDocumentImageService | undefined): DriveDocumentImageService {
  if (!documentImages) throw new Error("DriveDocumentImageService is not available.")
  return documentImages
}

function parseAccessSettings(body: unknown): DriveAccessSettingsInput | undefined {
  if (body === undefined || body === null || (isRecord(body) && Object.keys(body).length === 0)) {
    return undefined
  }
  const parsed = parseBody(driveAccessSettingsSchema, body, "访问设置无效。")
  return {
    passwordEnabled: parsed.passwordEnabled ?? DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled,
    expiresIn: parsed.expiresIn ?? DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn,
    accessMode: parsed.accessMode ?? DRIVE_DEFAULT_ACCESS_SETTINGS.accessMode,
    editorEmails: parsed.editorEmails ?? DRIVE_DEFAULT_ACCESS_SETTINGS.editorEmails,
  }
}

function driveAuditContext(request: AuthenticatedUserRequest) {
  return { ipAddress: request.ip ?? "system" }
}

function parseBrowserSurface(value: string | undefined): "standalone" | "console" {
  return value === "console" ? "console" : "standalone"
}

function parseDriveBrowserChildrenPageQuery(
  offset: string | undefined,
  limit: string | undefined,
): { readonly offset?: number; readonly limit?: number } | undefined {
  const parsedOffset = parseOptionalNonNegativeInteger(offset, "childrenOffset")
  const parsedLimit = parseOptionalNonNegativeInteger(limit, "childrenLimit")
  if (parsedOffset === undefined && parsedLimit === undefined) return undefined
  return {
    ...(parsedOffset === undefined ? {} : { offset: parsedOffset }),
    ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
  }
}

function parseDrivePublicLinksPageQuery(
  offset: string | undefined,
  limit: string | undefined,
): { readonly offset?: number; readonly limit?: number } | undefined {
  const parsedOffset = parseOptionalNonNegativeInteger(offset, "offset")
  const parsedLimit = parseOptionalNonNegativeInteger(limit, "limit")
  if (parsedOffset === undefined && parsedLimit === undefined) return undefined
  return {
    ...(parsedOffset === undefined ? {} : { offset: parsedOffset }),
    ...(parsedLimit === undefined ? {} : { limit: parsedLimit }),
  }
}

function parseDriveSiteListQuery(query: Record<string, unknown>): {
  readonly offset?: number
  readonly limit?: number
  readonly search?: string
  readonly status?: "active" | "disabled" | "expired" | "deleted" | "failed" | "all"
} {
  const offset = typeof query.offset === "string" ? parseOptionalNonNegativeInteger(query.offset, "offset") : undefined
  const limit = typeof query.limit === "string" ? parseOptionalNonNegativeInteger(query.limit, "limit") : undefined
  const search = typeof query.search === "string" ? parseOptionalSearch(query.search) : undefined
  const status = typeof query.status === "string" && ["active", "disabled", "expired", "deleted", "failed", "all"].includes(query.status)
    ? query.status as "active" | "disabled" | "expired" | "deleted" | "failed" | "all"
    : undefined
  return { offset, limit, search, status }
}

function parseOptionalNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined
  if (!/^\d+$/u.test(value)) throw new BadRequestException(`${name} 必须是非负整数。`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new BadRequestException(`${name} 必须是安全整数。`)
  return parsed
}

function parseOptionalSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function driveBrowserPasswordRequired(): DriveBrowserPasswordRequiredDto {
  return { passwordRequired: true, message: "请输入密码。" }
}

function resolveRequestPublicAppUrl(request: AuthenticatedUserRequest): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })
}

function resolveAdminPublicAppUrl(request: Request): string {
  return resolvePublicAppUrl({ configuredPublicAppUrl: process.env.APP_PUBLIC_URL, request })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readPasswordQuery(request: Request): string | undefined {
  const value = request.query.password
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readHeaderString(value: string | readonly string[] | undefined): string | null {
  if (typeof value === "string") return value
  return value?.join(", ") ?? null
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
  for (const name of [cookieName, legacyDriveAccessCookieName]) {
    const parsed = readRequestCookie(request, name)
    if (parsed) return parsed
  }
  return undefined
}

function readRequestCookie(request: Request, name: string): string | undefined {
  const cookies = (request as Request & { readonly cookies?: Record<string, unknown> }).cookies
  const parsed = cookies?.[name]
  if (typeof parsed === "string" && parsed.length > 0) return parsed
  const header = request.headers.cookie
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (rawName === name) return decodeCookieValue(rawValue.join("="))
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
  entries: AsyncIterable<{ readonly path: string; readonly storageKey: string }>,
  storage: DriveStoragePort,
): Promise<void> {
  response.setHeader("Content-Type", "application/zip")
  response.setHeader("Content-Disposition", attachmentContentDisposition(filename))
  const archive = archiver("zip", { zlib: { level: 6 } })
  const archiveError = new Promise<never>((_, reject) => {
    archive.once("error", reject)
  })
  archive.pipe(response)
  try {
    for await (const entry of entries) {
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

async function sendDriveFileDownload(response: Response, download: {
  readonly stream: NodeJS.ReadableStream
  readonly fileName: string
  readonly size?: bigint
  readonly contentType?: string | null
}): Promise<void> {
  response.attachment(download.fileName)
  response.setHeader("Content-Type", download.contentType || "application/octet-stream")
  if (download.size !== undefined) response.setHeader("Content-Length", download.size.toString())
  await pipeline(download.stream, response)
}

async function sendDriveTransfer(
  response: Response,
  transfer:
    | ({ readonly kind: "file" } & Parameters<typeof sendDriveFileDownload>[1])
    | { readonly kind: "zip"; readonly filename: string; readonly entries: AsyncIterable<{ readonly path: string; readonly storageKey: string }> },
  storage: DriveStoragePort,
): Promise<void> {
  if (transfer.kind === "zip") {
    await sendDriveZip(response, transfer.filename, transfer.entries, storage)
    return
  }
  await sendDriveFileDownload(response, transfer)
}

async function sendDriveRenderedAsset(response: Response, asset: {
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

async function sendDriveHtmlRenderedAsset(response: Response, asset: {
  readonly stream: NodeJS.ReadableStream
  readonly contentType: string
  readonly size?: bigint
  readonly csp?: string
}) {
  await sendDriveRenderedAsset(response, {
    ...asset,
    csp: asset.csp ?? DRIVE_HTML_RENDER_CSP,
  })
}

async function sendOwnerRenderedAsset(response: Response, asset: {
  readonly stream: NodeJS.ReadableStream
  readonly contentType: string
  readonly size?: bigint
  readonly csp?: string
}) {
  await sendDriveHtmlRenderedAsset(response, asset)
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
      const onClose = () => settle(new Error("Response closed before drive asset finished streaming."))
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

function renderDrivePublicStatusPage(input: { readonly title: string; readonly message: string }): string {
  const title = escapeHtml(input.title)
  const message = escapeHtml(input.message)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${renderDrivePublicPageCss()}
</style>
</head>
<body>
<main class="drive-public-page">
  <section class="drive-public-shell drive-public-status-shell" aria-labelledby="drive-public-status-title">
    <div class="drive-public-panel">
      <p class="drive-public-meta">404</p>
      <h1 class="drive-public-title" id="drive-public-status-title">${title}</h1>
      <p class="drive-public-description">${message}</p>
    </div>
  </section>
</main>
</body>
</html>`
}

function sendDriveInvalidSharePage(response: Response): void {
  response.status(404).type("html").send(renderDrivePublicStatusPage({
    title: "链接已失效",
    message: "请向文件所有者确认最新链接。",
  }))
}

function isNotFoundException(error: unknown): error is NotFoundException {
  return error instanceof NotFoundException
}

function renderDrivePasswordPage(input: { readonly actionPath: string; readonly error?: boolean }): string {
  const actionPath = escapeAttribute(input.actionPath)
  const error = input.error ? `<p class="drive-password-error" id="drive-password-error">密码错误</p>` : ""
  const inputErrorAttributes = input.error ? ` aria-invalid="true" aria-describedby="drive-password-error"` : ""
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>输入密码</title>
<style>
${renderDrivePublicPageCss()}
</style>
</head>
<body>
<main class="drive-public-page">
  <section class="drive-public-shell drive-password-shell" aria-labelledby="drive-password-title">
    <form class="drive-public-panel drive-password-form" method="post" action="${actionPath}">
      <div class="drive-public-header">
        <h1 class="drive-public-title" id="drive-password-title">输入密码</h1>
      </div>
      <div class="drive-password-field">
        <label class="drive-password-label" for="drive-password">访问密码</label>
        <input class="drive-password-input" id="drive-password" name="password" type="password" autocomplete="current-password" required${inputErrorAttributes}>
        ${error}
      </div>
      <button class="drive-password-button" type="submit">打开</button>
    </form>
  </section>
</main>
</body>
</html>`
}

function renderDrivePublicPageCss(): string {
  return `
:root {
  color-scheme: light dark;
  --background: Canvas;
  --foreground: CanvasText;
  --card: Canvas;
  --card-foreground: CanvasText;
  --primary: CanvasText;
  --primary-foreground: Canvas;
  --muted: Field;
  --muted-foreground: GrayText;
  --destructive: CanvasText;
  --border: ButtonBorder;
  --input: ButtonBorder;
  --ring: Highlight;
  --radius: 0.625rem;
}
* {
  box-sizing: border-box;
}
html {
  font-family: "Geist Variable", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
}
.drive-public-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.drive-public-shell {
  width: min(100%, 24rem);
}
.drive-public-panel {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  color: var(--card-foreground);
}
.drive-public-header {
  display: grid;
  gap: 0.25rem;
}
.drive-public-meta {
  margin: 0;
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  line-height: 1.25rem;
  font-variant-numeric: tabular-nums;
}
.drive-public-title {
  margin: 0;
  color: var(--foreground);
  font-size: 1.25rem;
  line-height: 1.75rem;
  font-weight: 600;
  letter-spacing: 0;
}
.drive-public-description {
  margin: 0;
  max-width: 30rem;
  color: var(--muted-foreground);
  font-size: 0.875rem;
  line-height: 1.5rem;
}
.drive-password-form {
  gap: 1rem;
}
.drive-password-field {
  display: grid;
  gap: 0.5rem;
}
.drive-password-label {
  color: var(--foreground);
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
}
.drive-password-input {
  width: 100%;
  min-height: 2rem;
  border: 1px solid var(--input);
  border-radius: var(--radius);
  padding: 0.25rem 0.625rem;
  background: transparent;
  color: var(--foreground);
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.25rem;
  outline: none;
}
.drive-password-input:focus-visible {
  border-color: var(--ring);
  outline: 3px solid var(--ring);
  outline-offset: 2px;
}
.drive-password-input[aria-invalid="true"] {
  border-color: var(--destructive);
}
.drive-password-input[aria-invalid="true"]:focus-visible {
  outline-color: var(--destructive);
}
.drive-password-button {
  min-height: 2rem;
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  padding: 0.25rem 0.625rem;
  background: var(--primary);
  color: var(--primary-foreground);
  font: inherit;
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
}
.drive-password-button:hover {
  opacity: 0.9;
}
.drive-password-button:focus-visible {
  outline: 3px solid var(--ring);
  outline-offset: 2px;
}
.drive-password-button:active {
  opacity: 0.85;
}
.drive-password-button:disabled,
.drive-password-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.drive-password-error {
  margin: 0;
  color: var(--destructive);
  font-size: 0.8125rem;
  line-height: 1.25rem;
}
@media (max-width: 480px) {
  .drive-public-page {
    align-items: flex-start;
    padding: 1rem;
  }
  .drive-public-panel {
    padding: 0.875rem;
  }
}
`
}
