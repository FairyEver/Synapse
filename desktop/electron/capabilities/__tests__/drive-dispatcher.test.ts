import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE, type DriveItemDto, type DrivePublicAssetDto, type DriveSiteDto, type DriveSiteListPageDto, type DriveTrashListPageDto } from "@synapse/shared"
import { createDriveCapabilityDispatcher } from "../drive-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { buildDriveTools } from "../../../synapse-capabilities/shared/drive-domain"
import {
  DRIVE_LOCAL_UPLOAD_MAX_FILES,
  DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
} from "../../../src/lib/drive-local-upload-limits"

type DriveDispatcherDeps = Parameters<typeof createDriveCapabilityDispatcher>[0]
type DriveAccountService = DriveDispatcherDeps["accountService"]
type DriveAuditSink = NonNullable<DriveDispatcherDeps["auditSink"]>
type DriveItem = DriveItemDto

describe("createDriveCapabilityDispatcher", () => {
  it("exposes access settings on share creation", () => {
    const shareCreateTool = buildDriveTools().find((tool) => tool.name === "drive_share_create")
    expect(shareCreateTool?.inputSchema.properties).toMatchObject({
      passwordEnabled: { type: "boolean" },
      expiresIn: { type: "string", enum: ["3d", "7d", "30d", "1y", "forever"] },
      accessMode: { type: "string", enum: ["link_read", "link_edit", "specified_users_edit"] },
      editorEmails: { type: "array" },
    })
  })

  it("exposes custom password fields on site access tools", () => {
    const siteCreateTool = buildDriveTools().find((tool) => tool.name === "drive_site_create")
    const siteUpdateTool = buildDriveTools().find((tool) => tool.name === "drive_site_update_access")
    expect(siteCreateTool?.inputSchema.properties).toMatchObject({
      password: { type: "string", description: expect.stringContaining("custom site password") },
    })
    expect(siteUpdateTool?.inputSchema.properties).toMatchObject({
      password: { type: "string", description: expect.stringContaining("custom site password") },
    })
  })

  it("exposes item id on item deletion", () => {
    const deleteTool = buildDriveTools().find((tool) => tool.name === "drive_item_delete")
    expect(deleteTool?.inputSchema.properties).toEqual({
      itemId: { type: "string", description: expect.any(String) },
    })
  })

  it("exposes pagination on item list", () => {
    const listTool = buildDriveTools().find((tool) => tool.name === "drive_item_list")
    expect(listTool?.inputSchema.properties).toMatchObject({
      parentId: expect.any(Object),
      offset: { type: "number" },
      limit: { type: "number" },
    })
  })

  it("requires an explicit parent id for item moves", () => {
    const moveTool = buildDriveTools().find((tool) => tool.name === "drive_item_move")
    expect(moveTool?.inputSchema.required).toContain("parentId")
    expect(moveTool?.inputSchema.properties).toMatchObject({
      parentId: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: expect.stringContaining("do not omit"),
      },
    })
  })

  it("exposes the full Drive MCP tool set without legacy gaps", () => {
    const legacyToolNames = [
      "drive_item_list",
      "drive_item_get",
      "drive_file_upload",
      "drive_folder_upload",
      "drive_folder_create",
      "drive_item_rename",
      "drive_item_move",
      "drive_item_delete",
      "drive_item_preview_get",
      "drive_file_content_read",
      "drive_file_download_create",
      "drive_file_version_list",
      "drive_file_version_download_create",
      "drive_file_version_restore",
      "drive_file_version_delete",
      "drive_file_version_pin_update",
      "drive_link_resolve",
      "drive_link_list",
      "drive_link_read_text",
      "drive_link_materialize",
      "drive_link_download_file",
      "drive_folder_zip_create",
      "drive_share_list",
      "drive_share_create",
      "drive_share_disable",
      "drive_site_create",
      "drive_site_list",
      "drive_site_update_access",
      "drive_site_disable",
      "drive_site_enable",
      "drive_site_delete",
      "drive_site_republish",
      "drive_usage_get",
      "drive_stats_get",
      "drive_item_tree_list",
      "drive_folder_path_ensure",
      "drive_reorganization_preview",
      "drive_reorganization_apply",
      "drive_direct_link_upload",
      "drive_direct_link_list",
      "drive_direct_link_get",
      "drive_direct_link_update",
      "drive_direct_link_rename",
      "drive_direct_link_delete",
      "drive_direct_link_restore",
      "drive_trash_list",
      "drive_trash_delete",
      "drive_item_restore",
    ]

    expect(buildDriveTools().map((tool) => tool.name)).toEqual([
      ...legacyToolNames.map((name) => name.replace(/^drive_/, "app_drive_")),
      ...legacyToolNames,
    ])
  })

  it("lists Drive items under root by default", async () => {
    const page = { items: [driveItem({ id: "item-1", name: "a.txt" })], page: drivePage() }
    const accountService = createAccountService({
      listDriveItemsPage: vi.fn(async () => page),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.list", {}, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: page,
      total: 1,
    })
    expect(accountService.listDriveItemsPage).toHaveBeenCalledWith({
      parentId: null,
      offset: undefined,
      limit: undefined,
    })
  })

  it("routes Drive organization reads and path ensure without reading file contents in bulk", async () => {
    const treePage = {
      items: [driveTreeItem({ id: "file-1", path: "Inbox/report.md" })],
      total: 1,
      fileCount: 1,
      folderCount: 0,
      hasMore: false,
      nextOffset: null,
    }
    const stats = { itemCount: 3, fileCount: 2, folderCount: 1, usedBytes: "22", reservedBytes: "0", quotaBytes: "100" }
    const folder = driveItem({ id: "folder-work", type: "folder", name: "Work" })
    const accountService = createAccountService({
      getDriveStats: vi.fn(async () => stats),
      listDriveItemTree: vi.fn(async () => treePage),
      ensureDriveFolderPath: vi.fn(async () => ({ item: folder, created: [], reused: [folder] })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.stats.get", {}, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: stats })
    await expect(dispatcher.dispatch("drive.item_tree.list", { parentId: null, offset: 5, limit: 10 }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: treePage, total: 1 })
    await expect(dispatcher.dispatch("drive.folder_path.ensure", { segments: ["Work"] }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { item: folder, created: [], reused: [folder] } })

    expect(accountService.listDriveItemTree).toHaveBeenCalledWith({ parentId: null, offset: 5, limit: 10 })
    expect(accountService.ensureDriveFolderPath).toHaveBeenCalledWith({ parentId: null, segments: ["Work"] })
    expect(accountService.readDriveFileContent).not.toHaveBeenCalled()
  })

  it("previews and applies Drive reorganizations only through a generated plan id", async () => {
    const preview = {
      planId: "drive-reorg-plan-1",
      expiresAt: "2026-06-07T12:05:00.000Z",
      summary: { moveCount: 1, skippedCount: 0, conflictCount: 0 },
      moves: [{
        itemId: "file-1",
        name: "report.md",
        fromParentId: null,
        targetParentId: "folder-work",
        updatedAt: "2026-06-07T00:00:00.000Z",
      }],
      skipped: [],
      conflicts: [],
    }
    const applied = {
      ok: true as const,
      movedCount: 1,
      skippedCount: 0,
      moves: [{ itemId: "file-1", fromParentId: null, targetParentId: "folder-work" }],
    }
    const accountService = createAccountService({
      previewDriveReorganization: vi.fn(async () => preview),
      applyDriveReorganization: vi.fn(async () => applied),
    })
    const auditSink = createAuditSink()
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.reorganization.apply", {
      moves: [{ itemId: "file-1", targetParentId: "folder-work" }],
    }, { source: "mcp-stdio" })).rejects.toThrow("planId")
    await expect(dispatcher.dispatch("drive.reorganization.preview", {
      moves: [{ itemId: "file-1", targetParentId: "folder-work" }],
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: preview })
    await expect(dispatcher.dispatch("drive.reorganization.apply", {
      planId: "drive-reorg-plan-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: applied })

    expect(accountService.previewDriveReorganization).toHaveBeenCalledWith({
      moves: [{ itemId: "file-1", targetParentId: "folder-work" }],
    })
    expect(accountService.applyDriveReorganization).toHaveBeenCalledWith({ planId: "drive-reorg-plan-1" })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "synapse-drive:drive.reorganization.apply",
      outcome: "allowed",
      metadata: expect.objectContaining({
        driveAction: "drive.reorganization.apply",
        planId: "drive-reorg-plan-1",
        movedCount: 1,
        skippedCount: 0,
        moves: [{ itemId: "file-1", fromParentId: null, targetParentId: "folder-work" }],
      }),
    }))
  })

  it("rejects Drive reorganization moves without an explicit target parent", async () => {
    const accountService = createAccountService({
      previewDriveReorganization: vi.fn(),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.reorganization.preview", {
      moves: [{ itemId: "file-1" }],
    }, { source: "mcp-stdio" })).rejects.toThrow("targetParentId is required")

    expect(accountService.previewDriveReorganization).not.toHaveBeenCalled()
  })

  it("dispatches Drive link read tools without exposing passwords in audit metadata", async () => {
    const accountService = createAccountService({
      resolveDriveLink: vi.fn(async () => ({
        ok: true,
        linkType: "share",
        access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true },
        root: { name: "需求说明.md", type: "file", previewKind: "markdown" },
        ref: { kind: "share", shareId: "shr_123", itemId: null, siteId: null, path: null, assetId: null },
      } as const)),
    })
    const auditSink = createAuditSink()
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.link.resolve", { url: "https://synapse.test/share/shr_123", password: "secret" }, { source: "mcp-stdio" }))
      .resolves.toMatchObject({ ok: true, data: { linkType: "share" } })

    expect(accountService.resolveDriveLink).toHaveBeenCalledWith({ url: "https://synapse.test/share/shr_123", password: "secret" })
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret")
  })

  it("authorizes Drive link materialize as a local write", async () => {
    const materialized = { localRootPath: "/tmp/intake", manifestPath: "/tmp/intake/manifest.json", entryPath: "/tmp/intake/content/req.md", files: [], skipped: [], warnings: [] }
    const accountService = createAccountService({
      materializeDriveLink: vi.fn(async () => materialized),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.link.materialize", { url: "https://synapse.test/share/shr_123", scope: "text" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: materialized })
  })

  it("authorizes and audits Drive item reads", async () => {
    const page = { items: [driveItem({ id: "item-1", name: "a.txt" })], page: drivePage() }
    const accountService = createAccountService({
      listDriveItemsPage: vi.fn(async () => page),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("drive.item.list", {
      parentId: "folder-1",
      offset: 20,
      limit: 10,
    }, { source: "mcp-stdio", actor: mcpClientActorForSource("mcp-stdio") })).resolves.toMatchObject({
      ok: true,
      total: 1,
    })
    expect(accountService.listDriveItemsPage).toHaveBeenCalledWith({
      parentId: "folder-1",
      offset: 20,
      limit: 10,
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" },
      resource: "synapse-drive",
      context: expect.objectContaining({ source: "mcp-stdio", driveAction: "drive.item.list", parentId: "folder-1" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:drive.item.list",
      metadata: expect.objectContaining({ driveAction: "drive.item.list", parentId: "folder-1", total: 1 }),
    }))
  })

  it("denies Drive read tools before calling account services", async () => {
    const accountService = createAccountService({
      getDriveUsage: vi.fn(async () => ({ usedBytes: "4", reservedBytes: "0", quotaBytes: "100" })),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: false as const, reason: "drive read denied", policyId: "deny-drive-read" })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("drive.usage.get", {}, { source: "mcp-stdio" }))
      .rejects.toThrow("drive read denied")

    expect(accountService.getDriveUsage).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "denied",
      resource: "synapse-drive",
      metadata: expect.objectContaining({
        driveAction: "drive.usage.get",
        reason: "drive read denied",
        policyId: "deny-drive-read",
      }),
    }))
  })

  it("audits failed Drive permission checks without raw error text", async () => {
    const accountService = createAccountService({
      getDriveUsage: vi.fn(async () => ({ usedBytes: "4", reservedBytes: "0", quotaBytes: "100" })),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => {
        throw new Error("policy backend failed token=secret at /Users/example/config.json")
      }),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("drive.usage.get", {}, { source: "mcp-stdio" }))
      .rejects.toThrow("policy backend failed")

    expect(accountService.getDriveUsage).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive",
      metadata: expect.objectContaining({
        driveAction: "drive.usage.get",
        reason: "permission-check-error",
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("token=secret")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("/Users/example")
  })

  it("audits failed Drive read tools", async () => {
    const accountService = createAccountService({
      getDriveUsage: vi.fn(async () => {
        throw new Error("usage failed")
      }),
    })
    const auditSink = createAuditSink()
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.usage.get", {}, { source: "mcp-stdio" }))
      .rejects.toThrow("usage failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive:drive.usage.get",
      metadata: expect.objectContaining({ driveAction: "drive.usage.get", errorName: "Error" }),
    }))
  })

  it("gets and renames Drive items", async () => {
    const accountService = createAccountService({
      getDriveItem: vi.fn(async () => driveItem({ id: "item-1", name: "before.md" })),
      renameDriveItem: vi.fn(async () => driveItem({ id: "item-1", name: "after.md" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.get", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: driveItem({ id: "item-1", name: "before.md" }) })
    await expect(dispatcher.dispatch("drive.item.rename", {
      itemId: "item-1",
      name: "after.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: driveItem({ id: "item-1", name: "after.md" }),
    })

    expect(accountService.getDriveItem).toHaveBeenCalledWith("item-1")
    expect(accountService.renameDriveItem).toHaveBeenCalledWith("item-1", "after.md")
  })

  it("requires explicit item move targets while preserving null as root", async () => {
    const accountService = createAccountService({
      moveDriveItem: vi.fn(async () => driveItem({ id: "item-1", name: "report.md", parentId: null })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.move", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).rejects.toThrow("parentId is required")
    await expect(dispatcher.dispatch("drive.item.move", {
      itemId: "item-1",
      parentId: null,
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: driveItem({ id: "item-1", name: "report.md", parentId: null }),
    })

    expect(accountService.moveDriveItem).toHaveBeenCalledTimes(1)
    expect(accountService.moveDriveItem).toHaveBeenCalledWith("item-1", null)
  })

  it("routes public share link management tools", async () => {
    const accountService = createAccountService({
      listDriveShares: vi.fn(async () => ({ items: [driveShareListItem({ id: "share-1" })], page: drivePage() })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.list", { offset: 10, limit: 5 }, { source: "mcp-stdio" }))
      .resolves.toMatchObject({
        ok: true,
        data: {
          items: [expect.objectContaining({
            id: "share-1",
            url: "https://synapse.test/share/shr_1",
            urlWithPassword: "https://synapse.test/share/shr_1",
            passwordEnabled: true,
            password: null,
          })],
        },
      })

    expect(accountService.listDriveShares).toHaveBeenCalledWith({ offset: 10, limit: 5 })
  })

  it("dispatches Drive site creation separately from share creation", async () => {
    const site = driveSite({
      siteId: "site_public",
      accessMode: "password",
      urlWithPassword: "https://synapse.test/sites/site_public/?password=site-secret",
      passwordEnabled: true,
      password: "site-secret",
    })
    const createDriveSite = vi.fn(async () => site)
    const shareDriveItem = vi.fn()
    const accountService = createAccountService({ createDriveSite, shareDriveItem })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.site.create", {
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      accessMode: "password",
      password: "site-secret",
      expiresIn: "forever",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: {
        ...site,
        urlWithPassword: site.url,
        password: null,
      },
    })

    expect(createDriveSite).toHaveBeenCalledWith({
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      entryPath: null,
      accessMode: "password",
      password: "site-secret",
      expiresIn: "forever",
    })
    expect(shareDriveItem).not.toHaveBeenCalled()
  })

  it("routes Drive site management tools", async () => {
    const site = driveSite({
      siteId: "site_public",
      accessMode: "password",
      urlWithPassword: "https://synapse.test/sites/site_public/?password=secret",
      passwordEnabled: true,
      password: "secret",
    })
    const sanitizedSite = {
      ...site,
      urlWithPassword: site.url,
      password: null,
    }
    const listPage: DriveSiteListPageDto = { items: [site], total: 1, page: drivePage() }
    const listDriveSites = vi.fn(async () => listPage)
    const updateDriveSiteAccess = vi.fn(async () => site)
    const disableDriveSite = vi.fn(async () => ({ ...site, status: "disabled" as const }))
    const enableDriveSite = vi.fn(async () => site)
    const deleteDriveSite = vi.fn(async () => ({ ok: true as const }))
    const republishDriveSite = vi.fn(async () => ({ ...site, lastPublishedAt: "2026-06-23T00:00:00.000Z" }))
    const accountService = createAccountService({
      listDriveSites,
      updateDriveSiteAccess,
      disableDriveSite,
      enableDriveSite,
      deleteDriveSite,
      republishDriveSite,
    })
    const auditSink = createAuditSink()
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.site.list", {
      offset: 2,
      limit: 5,
      search: "原型",
      status: "active",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: {
        ...listPage,
        items: [sanitizedSite],
      },
      total: 1,
    })
    await expect(dispatcher.dispatch("drive.site.update_access", {
      siteId: "site_public",
      accessMode: "password",
      password: "new-secret",
      expiresIn: "7d",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: sanitizedSite,
    })
    await expect(dispatcher.dispatch("drive.site.disable", {
      siteId: "site_public",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: { ...sanitizedSite, status: "disabled" },
    })
    await expect(dispatcher.dispatch("drive.site.enable", {
      siteId: "site_public",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: sanitizedSite,
    })
    await expect(dispatcher.dispatch("drive.site.delete", {
      siteId: "site_public",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(dispatcher.dispatch("drive.site.republish", {
      siteId: "site_public",
      entryPath: "pages/home.html",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: { ...sanitizedSite, lastPublishedAt: "2026-06-23T00:00:00.000Z" },
    })

    expect(listDriveSites).toHaveBeenCalledWith({ offset: 2, limit: 5, search: "原型", status: "active" })
    expect(updateDriveSiteAccess).toHaveBeenCalledWith({
      siteId: "site_public",
      accessMode: "password",
      password: "new-secret",
      expiresIn: "7d",
    })
    expect(disableDriveSite).toHaveBeenCalledWith("site_public")
    expect(enableDriveSite).toHaveBeenCalledWith("site_public")
    expect(deleteDriveSite).toHaveBeenCalledWith("site_public")
    expect(republishDriveSite).toHaveBeenCalledWith({ siteId: "site_public", entryPath: "pages/home.html" })
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret")
  })

  it("uploads a public asset through the account helper after authorizing local file read", async () => {
    const asset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", name: "logo.png" })
    const uploadDrivePublicAssets = vi.fn(async () => ({
      results: [{ status: "fulfilled" as const, fileName: "logo.png", asset }],
    }))
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ uploadDrivePublicAssets }),
      permissionGuard,
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("drive.direct_link.upload", {
      filePath: "/tmp/logo.png",
      name: "logo",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/logo.png",
      context: expect.objectContaining({ driveAction: "drive.direct_link.upload" }),
    }))
    expect(uploadDrivePublicAssets).toHaveBeenCalledWith({
      files: [{ path: "/tmp/logo.png", name: "logo", mimeType: "image/png" }],
    })
  })

  it("returns a failed dispatch result when public asset upload is rejected", async () => {
    const uploadDrivePublicAssets = vi.fn(async () => ({
      results: [{ status: "rejected" as const, fileName: "logo.txt", message: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE }],
    }))
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ uploadDrivePublicAssets }),
      permissionGuard,
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("drive.direct_link.upload", {
      filePath: "/tmp/logo.png",
      name: "logo.txt",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: false,
      error: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
      data: { status: "rejected", fileName: "logo.txt", message: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE },
    })
  })

  it("rejects unsupported public asset image formats before calling account helpers", async () => {
    const uploadDrivePublicAssets = vi.fn()
    const replaceDrivePublicAssetFile = vi.fn()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ uploadDrivePublicAssets, replaceDrivePublicAssetFile }),
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("drive.direct_link.upload", {
      filePath: "/tmp/logo.pdf",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: false,
      error: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
    })

    await expect(dispatcher.dispatch("drive.direct_link.update", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      filePath: "/tmp/logo.svg",
      mimeType: "image/svg+xml",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: false,
      error: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
    })

    expect(uploadDrivePublicAssets).not.toHaveBeenCalled()
    expect(replaceDrivePublicAssetFile).not.toHaveBeenCalled()
  })

  it("rejects public asset upload and replacement when the local file is a symbolic link", async () => {
    const uploadDrivePublicAssets = vi.fn()
    const replaceDrivePublicAssetFile = vi.fn()
    const fileSystem = {
      lstat: vi.fn(async () => statLikeForTest({ isFile: true, isSymbolicLink: true, size: 4 })),
      stat: vi.fn(),
      createReadStream: vi.fn(),
      readdir: vi.fn(),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ uploadDrivePublicAssets, replaceDrivePublicAssetFile }),
      fileSystem,
    })

    await expect(dispatcher.dispatch("drive.direct_link.upload", {
      filePath: "/tmp/logo-link.png",
    }, { source: "mcp-stdio" })).rejects.toThrow("File upload does not support symbolic links.")
    await expect(dispatcher.dispatch("drive.direct_link.update", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      filePath: "/tmp/logo-link.png",
    }, { source: "mcp-stdio" })).rejects.toThrow("File upload does not support symbolic links.")

    expect(uploadDrivePublicAssets).not.toHaveBeenCalled()
    expect(replaceDrivePublicAssetFile).not.toHaveBeenCalled()
    expect(fileSystem?.stat).not.toHaveBeenCalled()
    expect(fileSystem?.createReadStream).not.toHaveBeenCalled()
  })

  it("routes public asset list and get tools", async () => {
    const asset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ" })
    const listDrivePublicAssets = vi.fn(async () => ({ items: [asset], total: 1, page: drivePage() }))
    const getDrivePublicAsset = vi.fn(async () => asset)
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ listDrivePublicAssets, getDrivePublicAsset }),
    })

    await expect(dispatcher.dispatch("drive.direct_link.list", { offset: 3, limit: 7, search: "logo" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { items: [asset], total: 1, page: drivePage() }, total: 1 })
    await expect(dispatcher.dispatch("drive.direct_link.get", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(listDrivePublicAssets).toHaveBeenCalledWith({ offset: 3, limit: 7, search: "logo" })
    expect(getDrivePublicAsset).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
  })

  it("replaces public asset files after authorizing local file read", async () => {
    const asset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", name: "new-logo.png" })
    const replaceDrivePublicAssetFile = vi.fn(async () => asset)
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ replaceDrivePublicAssetFile }),
      permissionGuard,
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("drive.direct_link.update", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      filePath: "/tmp/new-logo.png",
      name: "new-logo",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/new-logo.png",
      context: expect.objectContaining({ driveAction: "drive.direct_link.update" }),
    }))
    expect(replaceDrivePublicAssetFile).toHaveBeenCalledWith({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      path: "/tmp/new-logo.png",
      name: "new-logo",
      mimeType: "image/png",
    })
  })

  it("renames public assets", async () => {
    const asset = drivePublicAsset({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "brand.png",
    })
    const renameDrivePublicAsset = vi.fn(async () => asset)
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ renameDrivePublicAsset }),
    })

    await expect(dispatcher.dispatch("drive.direct_link.rename", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      name: "brand.png",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(renameDrivePublicAsset).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", "brand.png")
  })

  it("routes public asset delete and restore tools", async () => {
    const asset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ" })
    const trashDrivePublicAsset = vi.fn(async () => asset)
    const restoreDrivePublicAsset = vi.fn(async () => asset)
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ trashDrivePublicAsset, restoreDrivePublicAsset }),
    })

    await expect(dispatcher.dispatch("drive.direct_link.delete", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })
    await expect(dispatcher.dispatch("drive.direct_link.restore", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(trashDrivePublicAsset).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
    expect(restoreDrivePublicAsset).toHaveBeenCalledWith("asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
  })

  it("routes Drive trash list, trash delete, and item restore tools", async () => {
    const trashPage: DriveTrashListPageDto = {
      items: [{
        id: "item-1",
        kind: "normal",
        name: "old.png",
        type: "file",
        size: "4",
        mimeType: "image/png",
        originalPath: "/old.png",
        trashedAt: "2026-06-18T00:00:00.000Z",
      }],
      total: 1,
      page: drivePage(),
    }
    const restored = driveItem({ id: "item-1", name: "old.png" })
    const restoredAsset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", name: "logo.png" })
    const listDriveTrash = vi.fn(async () => trashPage)
    const deleteDriveTrashItem = vi.fn(async () => ({ ok: true as const }))
    const restoreDriveTrashItem = vi.fn(async (input: { readonly itemId: string }) => (
      input.itemId === "item-public" ? restoredAsset : restored
    ))
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ listDriveTrash, deleteDriveTrashItem, restoreDriveTrashItem }),
    })

    await expect(dispatcher.dispatch("drive.trash.list", { offset: 1, limit: 20, search: "old" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: trashPage, total: 1 })
    await expect(dispatcher.dispatch("drive.trash.delete", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(dispatcher.dispatch("drive.item.restore", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: restored })
    await expect(dispatcher.dispatch("drive.item.restore", {
      itemId: "item-public",
      kind: "public_asset",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: restoredAsset })

    expect(listDriveTrash).toHaveBeenCalledWith({ offset: 1, limit: 20, search: "old" })
    expect(deleteDriveTrashItem).toHaveBeenCalledWith("item-1")
    expect(restoreDriveTrashItem).toHaveBeenCalledWith({ itemId: "item-1" })
    expect(restoreDriveTrashItem).toHaveBeenCalledWith({
      itemId: "item-public",
      kind: "public_asset",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    })
  })

  it("returns preview snapshots and text content without creating shares", async () => {
    const snapshot = drivePreviewSnapshot({
      preview: { kind: "markdown", text: "# Note", html: "<h1>Note</h1>", outline: null, truncated: false, imageUrl: null, visitUrl: null },
    })
    const accountService = createAccountService({
      getDriveItemPreview: vi.fn(async () => snapshot),
      readDriveFileContent: vi.fn(async () => ({
        itemId: "item-1",
        name: "note.md",
        kind: "markdown",
        text: "# Note",
        html: "<h1>Note</h1>",
        truncated: false,
      })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item_preview.get", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: snapshot })
    await expect(dispatcher.dispatch("drive.file_content.read", { itemId: "item-1", maxBytes: 4096 }, { source: "mcp-stdio" }))
      .resolves.toMatchObject({ ok: true, data: { text: "# Note", truncated: false } })

    expect(accountService.getDriveItemPreview).toHaveBeenCalledWith({ itemId: "item-1", surface: "standalone" })
    expect(accountService.readDriveFileContent).toHaveBeenCalledWith({ itemId: "item-1", maxBytes: 4096 })
  })

  it("checks fs.write.outside-userdata before saving Drive file and folder downloads locally", async () => {
    const accountService = createAccountService({
      downloadDriveFile: vi.fn(async () => ({ ok: true as const, path: "/tmp/report.md" })),
      downloadDriveFolderZip: vi.fn(async () => ({ ok: true as const, path: "/tmp/project.zip" })),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("drive.file_download.create", {
      itemId: "item-1",
      outputPath: "/tmp/report.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, path: "/tmp/report.md" } })
    await expect(dispatcher.dispatch("drive.folder_zip.create", {
      itemId: "folder-1",
      outputPath: "/tmp/project.zip",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, path: "/tmp/project.zip" } })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report.md",
      context: expect.objectContaining({ driveAction: "drive.file_download.create", itemId: "item-1" }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/project.zip",
      context: expect.objectContaining({ driveAction: "drive.folder_zip.create", itemId: "folder-1" }),
    }))
    expect(accountService.downloadDriveFile).toHaveBeenCalledWith({ itemId: "item-1", outputPath: "/tmp/report.md" })
    expect(accountService.downloadDriveFolderZip).toHaveBeenCalledWith({ itemId: "folder-1", outputPath: "/tmp/project.zip" })
  })

  it("manages Drive file versions", async () => {
    const accountService = createAccountService({
      listDriveFileVersions: vi.fn(async () => ({
        items: [driveFileVersion({ id: "version-1" })],
        total: 1,
        page: drivePage(),
      })),
      restoreDriveFileVersion: vi.fn(async () => driveItem({ id: "item-1" })),
      deleteDriveFileVersion: vi.fn(async () => ({ ok: true as const })),
      updateDriveFileVersionPin: vi.fn(async () => driveFileVersion({ id: "version-1", isPinned: true })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.file_version.list", {
      itemId: "item-1",
      offset: 10,
      limit: 5,
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: {
        items: [driveFileVersion({ id: "version-1" })],
        total: 1,
        page: drivePage(),
      },
      total: 1,
    })
    await expect(dispatcher.dispatch("drive.file_version.restore", {
      itemId: "item-1",
      versionId: "version-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: driveItem({ id: "item-1" }) })
    await expect(dispatcher.dispatch("drive.file_version.delete", {
      itemId: "item-1",
      versionId: "version-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(dispatcher.dispatch("drive.file_version_pin.update", {
      itemId: "item-1",
      versionId: "version-1",
      isPinned: true,
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: driveFileVersion({ id: "version-1", isPinned: true }),
    })

    expect(accountService.listDriveFileVersions).toHaveBeenCalledWith("item-1", { offset: 10, limit: 5 })
    expect(accountService.restoreDriveFileVersion).toHaveBeenCalledWith("item-1", "version-1")
    expect(accountService.deleteDriveFileVersion).toHaveBeenCalledWith("item-1", "version-1")
    expect(accountService.updateDriveFileVersionPin).toHaveBeenCalledWith("item-1", "version-1", true)
  })

  it("checks fs.write.outside-userdata before saving a Drive file version locally", async () => {
    const accountService = createAccountService({
      downloadDriveFileVersion: vi.fn(async () => ({ ok: true as const, path: "/tmp/report-v1.md" })),
    })
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, permissionGuard })

    await expect(dispatcher.dispatch("drive.file_version_download.create", {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, path: "/tmp/report-v1.md" } })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report-v1.md",
      context: expect.objectContaining({ driveAction: "drive.file_version_download.create", itemId: "item-1" }),
    }))
    expect(accountService.downloadDriveFileVersion).toHaveBeenCalledWith({
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })
  })

  it("redacts Drive link download URLs in local write permission audit metadata", async () => {
    const accountService = createAccountService({
      downloadDriveLinkFile: vi.fn(async () => ({ localPath: "/tmp/report.md", mimeType: "text/markdown", size: "12" })),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })
    const url = "https://synapse.test/share/shr_secret?password=secret&token=raw-token"

    await expect(dispatcher.dispatch("drive.link.download_file", {
      url,
      outputPath: "/tmp/report.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: { localPath: "/tmp/report.md", mimeType: "text/markdown", size: "12" },
    })

    expect(accountService.downloadDriveLinkFile).toHaveBeenCalledWith({ url, outputPath: "/tmp/report.md" })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report.md",
      context: expect.objectContaining({
        driveAction: "drive.link.download_file",
        itemId: expect.stringContaining("password=***"),
      }),
    }))
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("secret")
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("raw-token")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("raw-token")
  })

  it("rejects relative Drive download output paths before fs.write.outside-userdata authorization", async () => {
    const accountService = createAccountService({
      downloadDriveFile: vi.fn(async () => ({ ok: true as const })),
      downloadDriveFileVersion: vi.fn(async () => ({ ok: true as const })),
      downloadDriveLinkFile: vi.fn(async () => ({ localPath: "/tmp/report.md", mimeType: "text/markdown", size: "12" })),
      downloadDriveFolderZip: vi.fn(async () => ({ ok: true as const })),
    })
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, permissionGuard })
    const cases = [
      {
        action: "drive.file_download.create",
        params: { itemId: "item-1", outputPath: "downloads/report.md" },
      },
      {
        action: "drive.file_version_download.create",
        params: { itemId: "item-1", versionId: "version-1", outputPath: "report-v1.md" },
      },
      {
        action: "drive.link.download_file",
        params: { url: "https://synapse.local/share/link-1", outputPath: "downloads/shared-report.md" },
      },
      {
        action: "drive.folder_zip.create",
        params: { itemId: "folder-1", outputPath: "project.zip" },
      },
    ] as const

    for (const item of cases) {
      await expect(dispatcher.dispatch(item.action, item.params, { source: "mcp-stdio" }))
        .rejects.toThrow("expected absolute local output path")
    }

    expect(permissionGuard.check).not.toHaveBeenCalledWith(expect.objectContaining({ action: "fs.write.outside-userdata" }))
    expect(accountService.downloadDriveFile).not.toHaveBeenCalled()
    expect(accountService.downloadDriveFileVersion).not.toHaveBeenCalled()
    expect(accountService.downloadDriveLinkFile).not.toHaveBeenCalled()
    expect(accountService.downloadDriveFolderZip).not.toHaveBeenCalled()
  })

  it("uploads a local file without returning the presigned URL", async () => {
    const accountService = createAccountService()
    const fileStream = Readable.from(["test"])
    const readFile = vi.fn(async () => Buffer.from("test"))
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      permissionGuard,
      auditSink,
      fileSystem: {
        lstat: vi.fn(async () => statLikeForTest({ isFile: true, size: 4 })),
        stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, size: 4 })),
        readFile,
        createReadStream: vi.fn(() => fileStream),
        readdir: vi.fn(),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: vi.fn(async () => ({ ok: true }) as Response),
    })

    const result = await dispatcher.dispatch("drive.file.upload", {
      filePath: "/tmp/report.md",
    }, { source: "mcp-stdio", actor: mcpClientActorForSource("mcp-stdio") })

    expect(result).toEqual({ ok: true, data: driveItem({ id: "item-1", name: "report.md" }) })
    expect(JSON.stringify(result)).not.toContain("X-Amz-Signature")
    expect(accountService.prepareDriveUpload).toHaveBeenCalledWith({
      parentId: null,
      name: "report.md",
      size: "4",
      mimeType: null,
    })
    expect(readFile).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" },
      resource: "synapse-drive",
      context: { source: "mcp-stdio", driveAction: "drive.file.upload" },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" },
      resource: "/tmp/report.md",
      context: { source: "mcp-stdio", driveAction: "drive.upload" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "/tmp/report.md",
      metadata: expect.objectContaining({ driveAction: "drive.upload" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:drive.file.upload",
      metadata: expect.objectContaining({ driveAction: "drive.file.upload", itemId: "item-1" }),
    }))
  })

  it("rejects MCP file uploads when the requested file is a symbolic link", async () => {
    const accountService = createAccountService()
    const fileSystem = {
      lstat: vi.fn(async () => statLikeForTest({ isFile: true, isSymbolicLink: true, size: 4 })),
      stat: vi.fn(),
      createReadStream: vi.fn(),
      readdir: vi.fn(),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem,
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.file.upload", {
      filePath: "/tmp/report-link.md",
    }, { source: "mcp-stdio" })).rejects.toThrow("File upload does not support symbolic links.")

    expect(accountService.prepareDriveUpload).not.toHaveBeenCalled()
    expect(fileSystem?.stat).not.toHaveBeenCalled()
    expect(fileSystem?.createReadStream).not.toHaveBeenCalled()
  })

  it("rejects relative MCP file upload paths before permission checks", async () => {
    const accountService = createAccountService()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(),
    }
    const fileSystem = {
      lstat: vi.fn(),
      stat: vi.fn(),
      createReadStream: vi.fn(),
      readdir: vi.fn(),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      permissionGuard,
      fileSystem,
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.file.upload", {
      filePath: "README.md",
    }, { source: "mcp-stdio" })).rejects.toThrow("Local upload path must be absolute.")

    expect(permissionGuard.check).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
    }))
    expect(fileSystem?.lstat).not.toHaveBeenCalled()
    expect(accountService.prepareDriveUpload).not.toHaveBeenCalled()
  })

  it("retries completed MCP file upload sessions before cancelling", async () => {
    const item = driveItem({ id: "item-1", name: "report.md" })
    const accountService = createAccountService({
      completeDriveUpload: vi.fn()
        .mockRejectedValueOnce(new Error("response lost"))
        .mockResolvedValueOnce(item),
    })
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem: {
        lstat: vi.fn(async () => statLikeForTest({ isFile: true, size: 4 })),
        stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, size: 4 })),
        createReadStream: vi.fn(() => Readable.from(["test"])),
        readdir: vi.fn(),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: vi.fn(async () => ({ ok: true }) as Response),
    })

    await expect(dispatcher.dispatch("drive.file.upload", {
      filePath: "/tmp/report.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: item })

    expect(accountService.completeDriveUpload).toHaveBeenCalledTimes(2)
    expect(accountService.completeDriveUpload).toHaveBeenNthCalledWith(1, "session-1")
    expect(accountService.completeDriveUpload).toHaveBeenNthCalledWith(2, "session-1")
    expect(accountService.cancelDriveUpload).not.toHaveBeenCalled()
  })

  it("audits failed Drive file read permission checks without raw error text", async () => {
    const accountService = createAccountService()
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn()
        .mockResolvedValueOnce({ allowed: true as const })
        .mockRejectedValueOnce(new Error("policy backend failed token=secret at /Users/example/report.md")),
    }
    const fileSystem: NonNullable<DriveDispatcherDeps["fileSystem"]> = {
      stat: vi.fn(),
      createReadStream: vi.fn(),
      readdir: vi.fn(),
    } as unknown as NonNullable<DriveDispatcherDeps["fileSystem"]>
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      permissionGuard,
      auditSink,
      fileSystem,
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.file.upload", {
      filePath: "/tmp/report.md",
    }, { source: "mcp-stdio" })).rejects.toThrow("policy backend failed")

    expect(fileSystem.stat).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "failed",
      resource: "/tmp/report.md",
      metadata: expect.objectContaining({
        driveAction: "drive.upload",
        reason: "permission-check-error",
        errorName: "Error",
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("token=secret")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("/Users/example")
  })

  it("streams MCP file uploads instead of reading the full file into memory", async () => {
    const accountService = createAccountService()
    const readFile = vi.fn(async () => Buffer.alloc(1024 * 1024))
    const uploadStream = Readable.from(["large"])
    const createReadStream = vi.fn(() => uploadStream)
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response)
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem: {
        lstat: vi.fn(async () => statLikeForTest({ isFile: true, size: 1024 * 1024 * 1024 })),
        stat: vi.fn(async () => ({ isFile: () => true, isDirectory: () => false, size: 1024 * 1024 * 1024 })),
        readFile,
        createReadStream,
        readdir: vi.fn(),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: fetchImpl,
    })

    await expect(dispatcher.dispatch("drive.file.upload", {
      filePath: "/tmp/large.bin",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(readFile).not.toHaveBeenCalled()
    expect(createReadStream).toHaveBeenCalledWith("/tmp/large.bin")
    expect(fetchImpl).toHaveBeenCalledWith("https://cos.example/upload?X-Amz-Signature=secret", expect.objectContaining({
      method: "PUT",
      body: uploadStream,
      duplex: "half",
      headers: expect.objectContaining({ "Content-Length": String(1024 * 1024 * 1024) }),
    }))
  })

  it("returns a failed result when folder uploads only partially complete", async () => {
    const root = driveItem({ id: "folder-root", type: "folder", name: "project" })
    const accountService = createAccountService({
      prepareDriveFolderUpload: vi.fn(async () => ({
        root,
        rootCreated: true,
        entries: [
          {
            relativePath: "a.txt",
            sessionId: "session-a",
            item: driveItem({ id: "file-a", name: "a.txt" }),
            upload: {
              method: "PUT" as const,
              url: "https://cos.example/upload/a",
              expiresAt: "2026-06-07T00:00:00.000Z",
              headers: {},
            },
          },
          {
            relativePath: "b.txt",
            sessionId: "session-b",
            item: driveItem({ id: "file-b", name: "b.txt" }),
            upload: {
              method: "PUT" as const,
              url: "https://cos.example/upload/b",
              expiresAt: "2026-06-07T00:00:00.000Z",
              headers: {},
            },
          },
        ],
      })),
    })
    const auditSink = createAuditSink()
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => ({ ok: !String(url).endsWith("/b") }) as Response)
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      auditSink,
      fileSystem: {
        lstat: vi.fn(async (target: string) => statLikeForTest({
          isFile: target !== "/tmp/project",
          isDirectory: target === "/tmp/project",
          size: target.endsWith("b.txt") ? 2 : 1,
        })),
        stat: vi.fn(async (target: string) => ({
          isFile: () => target !== "/tmp/project",
          isDirectory: () => target === "/tmp/project",
          size: target.endsWith("b.txt") ? 2 : 1,
        })),
        createReadStream: vi.fn((target: string) => Readable.from([pathBasenameForTest(target)])),
        readdir: vi.fn(async () => [
          { name: "a.txt", isDirectory: () => false, isFile: () => true },
          { name: "b.txt", isDirectory: () => false, isFile: () => true },
        ]),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: fetchImpl,
    })

    const result = await dispatcher.dispatch("drive.folder.upload", {
      folderPath: "/tmp/project",
    }, { source: "mcp-stdio" })

    expect(result).toMatchObject({
      ok: false,
      error: "Folder upload completed with failed files.",
      code: "DRIVE_FOLDER_UPLOAD_PARTIAL_FAILURE",
      data: {
        root,
        completed: 1,
        failed: 1,
        failures: [{ relativePath: "b.txt", error: "Drive upload failed." }],
      },
      errors: [{ relativePath: "b.txt", error: "Drive upload failed." }],
    })
    expect(accountService.completeDriveUpload).toHaveBeenCalledWith("session-a")
    expect(accountService.completeDriveUpload).not.toHaveBeenCalledWith("session-b")
    expect(accountService.cancelDriveUpload).toHaveBeenCalledWith("session-b")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive:drive.folder.upload",
      metadata: expect.objectContaining({
        driveAction: "drive.folder.upload",
        completed: 1,
        failed: 1,
        rootItemId: "folder-root",
        error: "Folder upload completed with failed files.",
      }),
    }))
  })

  it("creates a Drive folder when an MCP folder upload points to an empty local directory", async () => {
    const root = driveItem({ id: "folder-root", type: "folder", name: "project" })
    const accountService = createAccountService({
      createDriveFolder: vi.fn(async () => root),
    })
    const fetchImpl = vi.fn()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem: {
        lstat: vi.fn(async () => statLikeForTest({
          isFile: false,
          isDirectory: true,
          size: 0,
        })),
        stat: vi.fn(),
        createReadStream: vi.fn(),
        readdir: vi.fn(async () => []),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: fetchImpl,
    })

    await expect(dispatcher.dispatch("drive.folder.upload", {
      folderPath: "/tmp/project",
      parentId: "drive-root",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: {
        root,
        rootCreated: true,
        completed: 0,
        failed: 0,
        failures: [],
        cleanupRootDeleted: false,
        cleanupRootDeleteFailed: false,
      },
    })
    expect(accountService.createDriveFolder).toHaveBeenCalledWith({
      parentId: "drive-root",
      name: "project",
    })
    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects relative MCP folder upload paths before permission checks", async () => {
    const accountService = createAccountService()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(),
    }
    const fileSystem = {
      lstat: vi.fn(),
      stat: vi.fn(),
      createReadStream: vi.fn(),
      readdir: vi.fn(),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      permissionGuard,
      fileSystem,
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.folder.upload", {
      folderPath: "docs",
    }, { source: "mcp-stdio" })).rejects.toThrow("Local upload path must be absolute.")

    expect(permissionGuard.check).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
    }))
    expect(fileSystem?.lstat).not.toHaveBeenCalled()
    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
  })

  it("deletes a newly created MCP folder upload root when every file upload fails", async () => {
    const root = driveItem({ id: "folder-root", type: "folder", name: "project" })
    const accountService = createAccountService({
      prepareDriveFolderUpload: vi.fn(async () => ({
        root,
        rootCreated: true,
        entries: [{
          relativePath: "a.txt",
          sessionId: "session-a",
          item: driveItem({ id: "file-a", name: "a.txt" }),
          upload: {
            method: "PUT" as const,
            url: "https://cos.example/upload/a",
            expiresAt: "2026-06-07T00:00:00.000Z",
            headers: {},
          },
        }],
      })),
      deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    })
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response)
    const auditSink = createAuditSink()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      auditSink,
      fileSystem: {
        lstat: vi.fn(async (target: string) => statLikeForTest({
          isFile: target !== "/tmp/project",
          isDirectory: target === "/tmp/project",
          size: 1,
        })),
        stat: vi.fn(async (target: string) => ({
          isFile: () => target !== "/tmp/project",
          isDirectory: () => target === "/tmp/project",
          size: 1,
        })),
        createReadStream: vi.fn((target: string) => Readable.from([pathBasenameForTest(target)])),
        readdir: vi.fn(async () => [
          { name: "a.txt", isDirectory: () => false, isFile: () => true },
        ]),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: fetchImpl,
    })

    const result = await dispatcher.dispatch("drive.folder.upload", {
      folderPath: "/tmp/project",
    }, { source: "mcp-stdio" })

    expect(result).toMatchObject({
      ok: false,
      data: {
        root,
        completed: 0,
        failed: 1,
        cleanupRootDeleted: true,
        cleanupRootDeleteFailed: false,
      },
    })
    expect(accountService.cancelDriveUpload).toHaveBeenCalledWith("session-a")
    expect(accountService.deleteDriveItem).toHaveBeenCalledWith("folder-root")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      metadata: expect.objectContaining({
        rootCreated: true,
        rootItemId: "folder-root",
        cleanupRootDeleted: true,
        cleanupRootDeleteFailed: false,
      }),
    }))
  })

  it("rejects MCP folder uploads when the requested folder is a symbolic link", async () => {
    const accountService = createAccountService()
    const fileSystem = {
      lstat: vi.fn(async () => statLikeForTest({ isDirectory: true, isSymbolicLink: true })),
      stat: vi.fn(),
      createReadStream: vi.fn(),
      readdir: vi.fn(),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem,
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.folder.upload", {
      folderPath: "/tmp/project-link",
    }, { source: "mcp-stdio" })).rejects.toThrow("Folder upload does not support symbolic links.")

    expect(fileSystem?.stat).not.toHaveBeenCalled()
    expect(fileSystem?.readdir).not.toHaveBeenCalled()
    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
  })

  it("rejects MCP folder uploads that exceed the local upload file limit before preparing sessions", async () => {
    const accountService = createAccountService()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem: {
        lstat: vi.fn(async (target: string) => statLikeForTest({
          isFile: target !== "/tmp/large-folder",
          isDirectory: target === "/tmp/large-folder",
          size: 1,
        })),
        stat: vi.fn(async () => ({
          isFile: () => true,
          isDirectory: () => true,
          size: 1,
        })),
        createReadStream: vi.fn(),
        readdir: vi.fn(async () => Array.from(
          { length: DRIVE_LOCAL_UPLOAD_MAX_FILES + 1 },
          (_, index) => ({
            name: `file-${index}.txt`,
            isDirectory: () => false,
            isFile: () => true,
          }),
        )),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.folder.upload", {
      folderPath: "/tmp/large-folder",
    }, { source: "mcp-stdio" })).rejects.toThrow(`一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_FILES} 个文件`)

    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
  })

  it("rejects MCP folder uploads that exceed the local upload depth limit before preparing sessions", async () => {
    const accountService = createAccountService()
    const nestedNames = Array.from(
      { length: DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH + 1 },
      (_, index) => `level-${index}`,
    )
    const fileSystem = {
      lstat: vi.fn(async (target: string) => statLikeForTest({
        isFile: target.endsWith("too-deep.txt"),
        isDirectory: !target.endsWith("too-deep.txt"),
        size: 1,
      })),
      stat: vi.fn(async () => ({
        isFile: () => true,
        isDirectory: () => true,
        size: 1,
      })),
      createReadStream: vi.fn(),
      readdir: vi.fn(async (directoryPath: string) => {
        const depth = directoryPath.split("/").filter((part) => part.startsWith("level-")).length
        if (depth < nestedNames.length) {
          return [{
            name: nestedNames[depth],
            isDirectory: () => true,
            isFile: () => false,
          }]
        }
        return [{
          name: "too-deep.txt",
          isDirectory: () => false,
          isFile: () => true,
        }]
      }),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem,
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("drive.folder.upload", {
      folderPath: "/tmp/deep-folder",
    }, { source: "mcp-stdio" })).rejects.toThrow(`文件夹层级最多 ${DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH} 层`)

    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
  })

  it("creates or reuses shares without changing access settings when omitted", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", undefined)
  })

  it("deletes Drive items", async () => {
    const accountService = createAccountService({
      deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.delete", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })

    expect(accountService.deleteDriveItem).toHaveBeenCalledWith("item-1")
  })

  it("creates shares with custom no-password access settings", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1", passwordEnabled: false, password: null })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
      passwordEnabled: false,
      expiresIn: "forever",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      passwordEnabled: false,
      expiresIn: "forever",
    })
  })

  it("passes only explicit share access settings", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
      expiresIn: "30d",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      expiresIn: "30d",
    })
  })

  it("creates shares with specified editor emails", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({
        id: "share-1",
        accessMode: "specified_users_edit",
        editorEmails: ["writer@example.com"],
      })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
      accessMode: "specified_users_edit",
      editorEmails: ["Writer@Example.com"],
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      accessMode: "specified_users_edit",
      editorEmails: ["writer@example.com"],
    })
  })

  it("audits successful share creation", async () => {
    const auditSink = createAuditSink()
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1", shareId: "shr_1" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
      expiresIn: "30d",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:item-1",
      metadata: expect.objectContaining({
        driveAction: "drive.share.create",
        itemId: "item-1",
        shareRecordId: "share-1",
        expiresIn: "30d",
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("shr_1")
  })

  it("audits failed share creation", async () => {
    const auditSink = createAuditSink()
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => {
        throw new Error("share failed")
      }),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).rejects.toThrow("share failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive:item-1",
      metadata: expect.objectContaining({
        driveAction: "drive.share.create",
        itemId: "item-1",
        errorName: "Error",
      }),
    }))
  })

  it("redacts public share ids in share disable audit events", async () => {
    const auditSink = createAuditSink()
    const accountService = createAccountService({
      disableDriveShare: vi.fn(async () => ({ ok: true as const })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.share.disable", {
      shareId: "shr_public_secret",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.disableDriveShare).toHaveBeenCalledWith("shr_public_secret")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:public-share:[redacted]",
      metadata: expect.objectContaining({
        driveAction: "drive.share.disable",
        shareId: "public-share:[redacted]",
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("shr_public_secret")
  })
})

function createAccountService(overrides: Partial<DriveAccountService> & Record<string, unknown> = {}): DriveAccountService {
  return {
    listDriveItems: vi.fn(async () => []),
    listDriveItemsPage: vi.fn(async () => ({ items: [], page: drivePage() })),
    prepareDriveUpload: vi.fn(async () => ({
      sessionId: "session-1",
      item: { id: "item-1", name: "report.md" },
      upload: {
        method: "PUT",
        url: "https://cos.example/upload?X-Amz-Signature=secret",
        expiresAt: "2026-06-07T00:00:00.000Z",
        headers: {},
      },
    })),
    prepareDriveFolderUpload: vi.fn(),
    completeDriveUpload: vi.fn(async () => driveItem({ id: "item-1", name: "report.md" })),
    cancelDriveUpload: vi.fn(async () => ({ ok: true })),
    createDriveFolder: vi.fn(),
    getDriveItem: vi.fn(),
    renameDriveItem: vi.fn(),
    moveDriveItem: vi.fn(),
    deleteDriveItem: vi.fn(),
    shareDriveItem: vi.fn(),
    disableDriveShare: vi.fn(),
    createDriveSite: vi.fn(),
    listDriveSites: vi.fn(),
    updateDriveSiteAccess: vi.fn(),
    disableDriveSite: vi.fn(),
    enableDriveSite: vi.fn(),
    deleteDriveSite: vi.fn(),
    republishDriveSite: vi.fn(),
    getDriveUsage: vi.fn(),
    listDriveShares: vi.fn(),
    getDriveStats: vi.fn(),
    listDriveItemTree: vi.fn(),
    ensureDriveFolderPath: vi.fn(),
    previewDriveReorganization: vi.fn(),
    applyDriveReorganization: vi.fn(),
    getDriveItemPreview: vi.fn(),
    readDriveFileContent: vi.fn(),
    downloadDriveFile: vi.fn(),
    listDriveFileVersions: vi.fn(),
    downloadDriveFileVersion: vi.fn(),
    restoreDriveFileVersion: vi.fn(),
    deleteDriveFileVersion: vi.fn(),
    updateDriveFileVersionPin: vi.fn(),
    resolveDriveLink: vi.fn(),
    listDriveLink: vi.fn(),
    readDriveLinkText: vi.fn(),
    materializeDriveLink: vi.fn(),
    downloadDriveLinkFile: vi.fn(),
    downloadDriveFolderZip: vi.fn(),
    listDrivePublicAssets: vi.fn(),
    getDrivePublicAsset: vi.fn(),
    uploadDrivePublicAssets: vi.fn(),
    replaceDrivePublicAssetFile: vi.fn(),
    renameDrivePublicAsset: vi.fn(),
    trashDrivePublicAsset: vi.fn(),
    restoreDrivePublicAsset: vi.fn(),
    listDriveTrash: vi.fn(),
    deleteDriveTrashItem: vi.fn(),
    restoreDriveTrashItem: vi.fn(),
    ...overrides,
  } as unknown as DriveAccountService
}

function createAuditSink(): DriveAuditSink {
  return {
    record: vi.fn(),
    list: vi.fn(() => []),
    clearForTests: vi.fn(),
  }
}

function statLikeForTest(input: {
  readonly isFile?: boolean
  readonly isDirectory?: boolean
  readonly isSymbolicLink?: boolean
  readonly size?: number
}) {
  return {
    isFile: () => input.isFile ?? false,
    isDirectory: () => input.isDirectory ?? false,
    isSymbolicLink: () => input.isSymbolicLink ?? false,
    size: input.size ?? 0,
  }
}

function regularFileSystemForTest(): NonNullable<DriveDispatcherDeps["fileSystem"]> {
  return {
    lstat: vi.fn(async () => statLikeForTest({ isFile: true, size: 4 })),
    stat: vi.fn(async () => statLikeForTest({ isFile: true, size: 4 })),
    createReadStream: vi.fn(() => Readable.from(["test"])),
    readdir: vi.fn(),
  } as unknown as NonNullable<DriveDispatcherDeps["fileSystem"]>
}

function pathBasenameForTest(value: string): string {
  const index = value.lastIndexOf("/")
  return index >= 0 ? value.slice(index + 1) : value
}

function driveItem(overrides: Partial<DriveItem>): DriveItem {
  return {
    id: "item-1",
    parentId: null,
    type: "file",
    name: "report.md",
    size: "4",
    mimeType: null,
    storageStatus: "active",
    shared: false,
    activeShareId: null,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}

function drivePublicAsset(overrides: Partial<DrivePublicAssetDto> = {}): DrivePublicAssetDto {
  return {
    assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    itemId: "item-1",
    name: "logo.png",
    size: "4",
    mimeType: "image/png",
    url: "https://synapse.test/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    lifecycleStatus: "active",
    accessCount: "0",
    responseBytes: "0",
    lastAccessedAt: null,
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  }
}

function driveSite(overrides: Partial<DriveSiteDto> = {}): DriveSiteDto {
  return {
    id: "site-row-1",
    siteId: "site_public",
    name: "产品原型",
    status: "active",
    accessMode: "public",
    url: "https://synapse.test/sites/site_public/",
    urlWithPassword: "https://synapse.test/sites/site_public/",
    passwordEnabled: false,
    password: null,
    expiresIn: "forever",
    expiresAt: null,
    sourceFolderItemId: "folder-1",
    sourceFolderName: "产品原型",
    entryPath: "index.html",
    fileCount: 4,
    totalBytes: "1024",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    lastPublishedAt: "2026-06-23T00:00:00.000Z",
    ...overrides,
  }
}

type DriveFileVersion = Awaited<ReturnType<DriveAccountService["listDriveFileVersions"]>>["items"][number]

function driveFileVersion(overrides: Partial<DriveFileVersion>): DriveFileVersion {
  return {
    id: "version-1",
    itemId: "item-1",
    versionNumber: 1,
    size: "4",
    mimeType: "text/markdown",
    source: "upload",
    isCurrent: false,
    isPinned: false,
    deletePending: false,
    restoredFromVersionId: null,
    createdAt: "2026-06-07T00:00:00.000Z",
    createdBy: "user-1",
    ...overrides,
  }
}

type DriveShare = Awaited<ReturnType<DriveAccountService["shareDriveItem"]>>

function driveShare(overrides: Partial<DriveShare>): DriveShare {
  return {
    id: "share-1",
    shareId: "shr_1",
    itemId: "item-1",
    enabled: true,
    url: "https://synapse.test/share/shr_1",
    urlWithPassword: "https://synapse.test/share/shr_1?password=secret",
    passwordEnabled: true,
    password: "secret",
    expiresAt: "2026-06-10T00:00:00.000Z",
    accessMode: "link_read",
    editorEmails: [],
    createdAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}

type DriveShareListItem = Awaited<ReturnType<DriveAccountService["listDriveShares"]>>["items"][number]

function driveShareListItem(overrides: Partial<DriveShareListItem>): DriveShareListItem {
  return {
    id: "share-row-1",
    shareId: "shr_1",
    itemId: "item-1",
    itemName: "report.md",
    itemType: "file",
    sourceDeleted: false,
    url: "https://synapse.test/share/shr_1",
    urlWithPassword: "https://synapse.test/share/shr_1?password=secret",
    passwordEnabled: true,
    password: "secret",
    expiresAt: "2026-06-10T00:00:00.000Z",
    accessMode: "link_read",
    editorEmails: [],
    createdAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}

function drivePage() {
  return {
    offset: 0,
    limit: 20,
    hasMore: false,
    nextOffset: null,
  }
}

type DriveTreeItem = Awaited<ReturnType<DriveAccountService["listDriveItemTree"]>>["items"][number]

function driveTreeItem(overrides: Partial<DriveTreeItem>): DriveTreeItem {
  return {
    id: "file-1",
    parentId: null,
    type: "file",
    name: "report.md",
    path: "report.md",
    depth: 0,
    size: "11",
    mimeType: "text/markdown",
    storageStatus: "active",
    shared: false,
    activeShareId: null,
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}

type DrivePreviewSnapshot = Awaited<ReturnType<DriveAccountService["getDriveItemPreview"]>>

function drivePreviewSnapshot(overrides: Partial<DrivePreviewSnapshot>): DrivePreviewSnapshot {
  return {
    context: "owner",
    surface: "standalone",
    current: {
      id: "item-1",
      name: "note.md",
      type: "file",
      size: "6",
      mimeType: "text/markdown",
      updatedAt: "2026-06-07T00:00:00.000Z",
      previewKind: "markdown",
      browserUrl: "https://synapse.test/drive/items/item-1",
      downloadUrl: "https://synapse.test/drive/items/item-1/download",
    },
    breadcrumbs: [],
    children: [],
    childrenPage: drivePage(),
    preview: null,
    edit: null,
    annotation: null,
    canDownload: true,
    canZip: false,
    ...overrides,
  }
}
