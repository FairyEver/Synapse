import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE, type DriveItemDto, type DrivePublicAssetDto, type DriveSiteDto, type DriveSiteListPageDto, type DriveTrashListPageDto } from "@synapse/shared"
import { createDriveCapabilityDispatcher } from "../drive-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { buildDriveTools } from "../../../synapse-capabilities/shared/drive-domain"
import {
  DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES,
  DRIVE_LOCAL_UPLOAD_MAX_FILES,
  DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH,
} from "../../../src/lib/drive-local-upload-limits"

type DriveDispatcherDeps = Parameters<typeof createDriveCapabilityDispatcher>[0]
type DriveAccountService = DriveDispatcherDeps["accountService"]
type DriveAuditSink = NonNullable<DriveDispatcherDeps["auditSink"]>
type DriveItem = DriveItemDto

describe("createDriveCapabilityDispatcher", () => {
  it("exposes access settings on share creation", () => {
    const shareCreateTool = buildDriveTools().find((tool) => tool.name === "app_drive_share_create")
    expect(shareCreateTool?.inputSchema.properties).toMatchObject({
      passwordEnabled: { type: "boolean" },
      expiresIn: { type: "string", enum: ["3d", "7d", "30d", "1y", "forever"] },
      accessMode: { type: "string", enum: ["link_read", "link_edit", "specified_users_edit"] },
      editorEmails: { type: "array" },
    })
  })

  it("exposes custom password fields on site access tools", () => {
    const siteCreateTool = buildDriveTools().find((tool) => tool.name === "app_drive_site_create")
    const siteUpdateTool = buildDriveTools().find((tool) => tool.name === "app_drive_site_update_access")
    expect(siteCreateTool?.inputSchema.properties).toMatchObject({
      password: { type: "string", description: expect.stringContaining("custom webpage-share password") },
    })
    expect(siteUpdateTool?.inputSchema.properties).toMatchObject({
      password: { type: "string", description: expect.stringContaining("custom webpage-share password") },
    })
  })

  it("exposes item id on item deletion", () => {
    const deleteTool = buildDriveTools().find((tool) => tool.name === "app_drive_item_delete")
    expect(deleteTool?.inputSchema.properties).toEqual({
      itemId: { type: "string", description: expect.any(String) },
    })
  })

  it("exposes pagination on item list", () => {
    const listTool = buildDriveTools().find((tool) => tool.name === "app_drive_item_list")
    expect(listTool?.inputSchema.properties).toMatchObject({
      parentId: expect.any(Object),
      offset: { type: "number" },
      limit: { type: "number" },
    })
  })

  it("documents empty directory preservation for folder uploads", () => {
    const uploadTool = buildDriveTools().find((tool) => tool.name === "app_drive_folder_upload")
    expect(uploadTool?.description).toContain("empty subdirectories")
    expect(uploadTool?.description).toContain("uploadedFiles")
    expect(uploadTool?.description).toContain("createdDirectories")
  })

  it("documents pinned version handling before version deletion", () => {
    const deleteTool = buildDriveTools().find((tool) => tool.name === "app_drive_file_version_delete")
    expect(deleteTool?.description).toContain("Current versions cannot be deleted")
    expect(deleteTool?.description).toContain("not pending cleanup")
    expect(deleteTool?.description).toContain("not pinned")
    expect(deleteTool?.description).toContain("app_drive_file_version_pin_update")
    expect(deleteTool?.description).toContain("deletePending")
  })

  it("requires an explicit parent id for item moves", () => {
    const moveTool = buildDriveTools().find((tool) => tool.name === "app_drive_item_move")
    expect(moveTool?.inputSchema.required).toContain("parentId")
    expect(moveTool?.inputSchema.properties).toMatchObject({
      parentId: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: expect.stringContaining("do not omit"),
      },
    })
  })

  it("exposes the full canonical Drive MCP tool set", () => {
    const primaryToolNames = [
      "app_drive_item_list",
      "app_drive_item_get",
      "app_drive_file_upload",
      "app_drive_folder_upload",
      "app_drive_folder_create",
      "app_drive_item_rename",
      "app_drive_item_move",
      "app_drive_item_delete",
      "app_drive_item_preview_get",
      "app_drive_file_content_read",
      "app_drive_file_download_create",
      "app_drive_file_version_list",
      "app_drive_file_version_download_create",
      "app_drive_file_version_restore",
      "app_drive_file_version_delete",
      "app_drive_file_version_pin_update",
      "app_drive_link_resolve",
      "app_drive_link_list",
      "app_drive_link_read_text",
      "app_drive_link_materialize",
      "app_drive_link_download_file",
      "app_drive_folder_zip_create",
      "app_drive_share_list",
      "app_drive_share_create",
      "app_drive_share_disable",
      "app_drive_site_create",
      "app_drive_site_list",
      "app_drive_site_update_access",
      "app_drive_site_disable",
      "app_drive_site_enable",
      "app_drive_site_delete",
      "app_drive_site_republish",
      "app_drive_usage_get",
      "app_drive_stats_get",
      "app_drive_item_tree_list",
      "app_drive_folder_path_ensure",
      "app_drive_reorganization_preview",
      "app_drive_reorganization_apply",
      "app_drive_sync_snapshot_get",
      "app_drive_sync_binding_preview",
      "app_drive_sync_binding_create",
      "app_drive_sync_binding_pause",
      "app_drive_sync_binding_resume",
      "app_drive_sync_binding_remove",
      "app_drive_sync_binding_exclude_rules_update",
      "app_drive_sync_binding_rescan",
      "app_drive_sync_conflict_resolve",
      "app_drive_direct_link_upload",
      "app_drive_direct_link_list",
      "app_drive_direct_link_get",
      "app_drive_direct_link_update",
      "app_drive_direct_link_rename",
      "app_drive_direct_link_delete",
      "app_drive_direct_link_restore",
      "app_drive_trash_list",
      "app_drive_trash_delete",
      "app_drive_item_restore",
    ]

    expect(buildDriveTools().map((tool) => tool.name)).toEqual(primaryToolNames)
    expect(buildDriveTools().some((tool) => tool.name.startsWith("drive_"))).toBe(false)
  })

  it("lists Drive items under root by default", async () => {
    const page = { items: [driveItem({ id: "item-1", name: "a.txt" })], page: drivePage() }
    const accountService = createAccountService({
      listDriveItemsPage: vi.fn(async () => page),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("app.drive.item.list", {}, { source: "mcp-stdio" })).resolves.toEqual({
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

    await expect(dispatcher.dispatch("app.drive.stats.get", {}, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: stats })
    await expect(dispatcher.dispatch("app.drive.item_tree.list", { parentId: null, offset: 5, limit: 10 }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: treePage, total: 1 })
    await expect(dispatcher.dispatch("app.drive.folder_path.ensure", { segments: ["Work"] }, { source: "mcp-stdio" }))
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

    await expect(dispatcher.dispatch("app.drive.reorganization.apply", {
      moves: [{ itemId: "file-1", targetParentId: "folder-work" }],
    }, { source: "mcp-stdio" })).rejects.toThrow("planId")
    await expect(dispatcher.dispatch("app.drive.reorganization.preview", {
      moves: [{ itemId: "file-1", targetParentId: "folder-work" }],
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: preview })
    await expect(dispatcher.dispatch("app.drive.reorganization.apply", {
      planId: "drive-reorg-plan-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: applied })

    expect(accountService.previewDriveReorganization).toHaveBeenCalledWith({
      moves: [{ itemId: "file-1", targetParentId: "folder-work" }],
    })
    expect(accountService.applyDriveReorganization).toHaveBeenCalledWith({ planId: "drive-reorg-plan-1" })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "synapse-drive:app.drive.reorganization.apply",
      outcome: "allowed",
      metadata: expect.objectContaining({
        driveAction: "app.drive.reorganization.apply",
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

    await expect(dispatcher.dispatch("app.drive.reorganization.preview", {
      moves: [{ itemId: "file-1" }],
    }, { source: "mcp-stdio" })).rejects.toThrow("targetParentId is required")

    expect(accountService.previewDriveReorganization).not.toHaveBeenCalled()
  })

  it("previews and creates a local file sync binding with root defaults", async () => {
    const preview = driveSyncPreview()
    const binding = driveSyncBinding()
    const driveSyncService = createDriveSyncService({
      previewBinding: vi.fn(async () => preview),
      createSafeBinding: vi.fn(async () => binding),
    })
    const fileSystem = regularFileSystemForTest()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService(),
      driveSyncService,
      fileSystem,
      permissionGuard,
    })
    const params = { localPath: "/workspace/spec.md", direction: "local_to_remote" }

    await expect(dispatcher.dispatch("app.drive.sync.binding.preview", params, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: preview })
    await expect(dispatcher.dispatch("app.drive.sync.binding.create", params, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: binding })

    expect(driveSyncService.previewBinding).toHaveBeenCalledWith(expect.objectContaining({
      localPath: "/workspace/spec.md",
      directionHint: "local_to_remote",
      targetParentId: null,
      driveItemName: "spec.md",
      kind: "file",
      remoteExists: false,
    }))
    expect(driveSyncService.createSafeBinding).toHaveBeenCalledWith(expect.objectContaining({
      localPath: "/workspace/spec.md",
      direction: "local_to_remote",
      targetParentId: null,
      driveItemName: "spec.md",
      kind: "file",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/workspace/spec.md",
      context: expect.objectContaining({ driveAction: "app.drive.sync.binding.create" }),
    }))
  })

  it("returns blocked sync preflight details without creating a binding", async () => {
    const preview = driveSyncPreview({ status: "blocked", direction: null, reason: "目标已存在" })
    const driveSyncService = createDriveSyncService({
      previewBinding: vi.fn(async () => preview),
    })
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService(),
      driveSyncService,
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("app.drive.sync.binding.create", {
      localPath: "/workspace/spec.md",
      direction: "local_to_remote",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: false,
      error: "目标已存在",
      data: preview,
    })
    expect(driveSyncService.createSafeBinding).not.toHaveBeenCalled()
  })

  it("routes Drive sync lifecycle and conflict actions", async () => {
    const binding = driveSyncBinding()
    const snapshot = driveSyncSnapshot({ bindings: [binding] })
    const driveSyncService = createDriveSyncService({
      getSnapshot: vi.fn(async () => snapshot),
      pauseBinding: vi.fn(async () => ({ ...binding, status: "paused" as const })),
      resumeBinding: vi.fn(async () => binding),
      updateExcludeRules: vi.fn(async () => binding),
      rescanBinding: vi.fn(async () => undefined),
      removeBinding: vi.fn(async () => undefined),
      resolveConflict: vi.fn(async () => undefined),
    })
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService(),
      driveSyncService,
    })
    const context = { source: "mcp-stdio" as const }

    await expect(dispatcher.dispatch("app.drive.sync.snapshot.get", {}, context))
      .resolves.toEqual({ ok: true, data: snapshot })
    await expect(dispatcher.dispatch("app.drive.sync.binding.pause", { bindingId: "binding-1" }, context))
      .resolves.toMatchObject({ ok: true, data: { status: "paused" } })
    await expect(dispatcher.dispatch("app.drive.sync.binding.resume", { bindingId: "binding-1" }, context))
      .resolves.toMatchObject({ ok: true, data: { status: "active" } })
    await expect(dispatcher.dispatch("app.drive.sync.binding.exclude_rules.update", {
      bindingId: "binding-1",
      defaults: [],
      importedGitignore: [],
      user: ["private/"],
    }, context)).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.drive.sync.binding.rescan", { bindingId: "binding-1" }, context))
      .resolves.toEqual({ ok: true, data: binding })
    await expect(dispatcher.dispatch("app.drive.sync.binding.remove", { bindingId: "binding-1" }, context))
      .resolves.toEqual({ ok: true, data: { removed: true } })
    await expect(dispatcher.dispatch("app.drive.sync.conflict.resolve", {
      conflictId: "conflict-1",
      action: "keep_local",
    }, context)).resolves.toEqual({ ok: true, data: { resolved: true } })

    expect(driveSyncService.updateExcludeRules).toHaveBeenCalledWith({
      id: "binding-1",
      defaults: [],
      importedGitignore: [],
      user: ["private/"],
    })
    expect(driveSyncService.resolveConflict).toHaveBeenCalledWith({
      conflictId: "conflict-1",
      action: "keep_local",
    })
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

    await expect(dispatcher.dispatch("app.drive.link.resolve", { url: "https://synapse.test/share/shr_123", password: "secret" }, { source: "mcp-stdio" }))
      .resolves.toMatchObject({ ok: true, data: { linkType: "share" } })

    expect(accountService.resolveDriveLink).toHaveBeenCalledWith({ url: "https://synapse.test/share/shr_123", password: "secret" })
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret")
  })

  it("authorizes Drive link materialize as a local write", async () => {
    const materialized = { localRootPath: "/tmp/intake", manifestPath: "/tmp/intake/manifest.json", entryPath: "/tmp/intake/content/req.md", files: [], skipped: [], warnings: [] }
    const accountService = createAccountService({
      materializeDriveLink: vi.fn(async () => materialized),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("app.drive.link.materialize", {
      url: "https://synapse.test/share/shr_123?password=secret-token",
      password: "secret-password",
      scope: "text",
    }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: materialized })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "synapse-drive:link-intake-cache",
      context: expect.objectContaining({
        driveAction: "app.drive.link.materialize",
        scope: "text",
      }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/tmp/intake",
      metadata: expect.objectContaining({
        driveAction: "app.drive.link.materialize",
        manifestPath: "/tmp/intake/manifest.json",
        entryPath: "/tmp/intake/content/req.md",
        fileCount: 0,
      }),
    }))
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("secret-password")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret-password")
  })

  it("authorizes default Drive link downloads as local cache writes", async () => {
    const downloaded = { localPath: "/tmp/intake/content/download", mimeType: "text/markdown", size: "12" }
    const accountService = createAccountService({
      downloadDriveLinkFile: vi.fn(async () => downloaded),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })
    const url = "https://synapse.test/share/shr_123?password=secret-token"

    await expect(dispatcher.dispatch("app.drive.link.download_file", {
      url,
      password: "secret-password",
      path: "docs/report.md",
    }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: downloaded })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "synapse-drive:link-intake-cache",
      context: expect.objectContaining({
        driveAction: "app.drive.link.download_file",
        path: "docs/report.md",
      }),
    }))
    expect(accountService.downloadDriveLinkFile).toHaveBeenCalledWith({
      url,
      password: "secret-password",
      path: "docs/report.md",
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/tmp/intake/content/download",
      metadata: expect.objectContaining({
        driveAction: "app.drive.link.download_file",
        localPath: "/tmp/intake/content/download",
        size: "12",
      }),
    }))
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(vi.mocked(permissionGuard.check).mock.calls)).not.toContain("secret-password")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("secret-password")
  })

  it("stops default Drive link downloads when cache write permission is denied", async () => {
    const accountService = createAccountService()
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async (request: { readonly action: string }) =>
        request.action === "fs.write"
          ? { allowed: false as const, reason: "denied by policy", policyId: "policy-1" }
          : { allowed: true as const },
      ),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("app.drive.link.download_file", {
      url: "https://synapse.test/share/shr_123",
    }, { source: "mcp-stdio" })).rejects.toThrow("denied by policy")

    expect(accountService.downloadDriveLinkFile).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "denied",
      resource: "synapse-drive:link-intake-cache",
      metadata: expect.objectContaining({
        driveAction: "app.drive.link.download_file",
        reason: "denied by policy",
        policyId: "policy-1",
      }),
    }))
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

    await expect(dispatcher.dispatch("app.drive.item.list", {
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
      context: expect.objectContaining({ source: "mcp-stdio", driveAction: "app.drive.item.list", parentId: "folder-1" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:app.drive.item.list",
      metadata: expect.objectContaining({ driveAction: "app.drive.item.list", parentId: "folder-1", total: 1 }),
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

    await expect(dispatcher.dispatch("app.drive.usage.get", {}, { source: "mcp-stdio" }))
      .rejects.toThrow("drive read denied")

    expect(accountService.getDriveUsage).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "denied",
      resource: "synapse-drive",
      metadata: expect.objectContaining({
        driveAction: "app.drive.usage.get",
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

    await expect(dispatcher.dispatch("app.drive.usage.get", {}, { source: "mcp-stdio" }))
      .rejects.toThrow("policy backend failed")

    expect(accountService.getDriveUsage).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive",
      metadata: expect.objectContaining({
        driveAction: "app.drive.usage.get",
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

    await expect(dispatcher.dispatch("app.drive.usage.get", {}, { source: "mcp-stdio" }))
      .rejects.toThrow("usage failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive:app.drive.usage.get",
      metadata: expect.objectContaining({ driveAction: "app.drive.usage.get", errorName: "Error" }),
    }))
  })

  it("gets and renames Drive items", async () => {
    const accountService = createAccountService({
      getDriveItem: vi.fn(async () => driveItem({ id: "item-1", name: "before.md" })),
      renameDriveItem: vi.fn(async () => driveItem({ id: "item-1", name: "after.md" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("app.drive.item.get", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: driveItem({ id: "item-1", name: "before.md" }) })
    await expect(dispatcher.dispatch("app.drive.item.rename", {
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

    await expect(dispatcher.dispatch("app.drive.item.move", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).rejects.toThrow("parentId is required")
    await expect(dispatcher.dispatch("app.drive.item.move", {
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

    await expect(dispatcher.dispatch("app.drive.share.list", { offset: 10, limit: 5 }, { source: "mcp-stdio" }))
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

    await expect(dispatcher.dispatch("app.drive.site.create", {
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

  it("allows Drive site creation to use server access defaults", async () => {
    const site = driveSite({ accessMode: "public", expiresIn: "forever", expiresAt: null })
    const createDriveSite = vi.fn(async () => site)
    const dispatcher = createDriveCapabilityDispatcher({ accountService: createAccountService({ createDriveSite }) })

    await expect(dispatcher.dispatch("app.drive.site.create", {
      sourceFolderItemId: "folder-1",
      name: "产品原型",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(createDriveSite).toHaveBeenCalledWith({
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      entryPath: null,
      password: null,
    })
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

    await expect(dispatcher.dispatch("app.drive.site.list", {
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
    await expect(dispatcher.dispatch("app.drive.site.update_access", {
      siteId: "site_public",
      accessMode: "password",
      password: "new-secret",
      expiresIn: "7d",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: sanitizedSite,
    })
    await expect(dispatcher.dispatch("app.drive.site.disable", {
      siteId: "site_public",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: { ...sanitizedSite, status: "disabled" },
    })
    await expect(dispatcher.dispatch("app.drive.site.enable", {
      siteId: "site_public",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: sanitizedSite,
    })
    await expect(dispatcher.dispatch("app.drive.site.delete", {
      siteId: "site_public",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(dispatcher.dispatch("app.drive.site.republish", {
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

    await expect(dispatcher.dispatch("app.drive.direct_link.upload", {
      filePath: "/tmp/logo.png",
      name: "logo",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/logo.png",
      context: expect.objectContaining({ driveAction: "app.drive.direct_link.upload" }),
    }))
    expect(uploadDrivePublicAssets).toHaveBeenCalledWith({
      files: [{ path: "/tmp/logo.png", name: "logo", mimeType: "image/png" }],
    })
  })

  it("uploads supported public documents through the account helper", async () => {
    const asset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", name: "report.pdf", mimeType: "application/pdf" })
    const uploadDrivePublicAssets = vi.fn(async () => ({
      results: [{ status: "fulfilled" as const, fileName: "report.pdf", asset }],
    }))
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ uploadDrivePublicAssets }),
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("app.drive.direct_link.upload", {
      filePath: "/tmp/report.pdf",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(uploadDrivePublicAssets).toHaveBeenCalledWith({
      files: [{ path: "/tmp/report.pdf", name: "report.pdf", mimeType: "application/pdf" }],
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

    await expect(dispatcher.dispatch("app.drive.direct_link.upload", {
      filePath: "/tmp/logo.png",
      name: "logo.txt",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: false,
      error: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
      data: { status: "rejected", fileName: "logo.txt", message: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE },
    })
  })

  it("rejects unsupported public asset formats before calling account helpers", async () => {
    const uploadDrivePublicAssets = vi.fn()
    const replaceDrivePublicAssetFile = vi.fn()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService: createAccountService({ uploadDrivePublicAssets, replaceDrivePublicAssetFile }),
      fileSystem: regularFileSystemForTest(),
    })

    await expect(dispatcher.dispatch("app.drive.direct_link.upload", {
      filePath: "/tmp/logo.svg",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: false,
      error: DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE,
    })

    await expect(dispatcher.dispatch("app.drive.direct_link.update", {
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

    await expect(dispatcher.dispatch("app.drive.direct_link.upload", {
      filePath: "/tmp/logo-link.png",
    }, { source: "mcp-stdio" })).rejects.toThrow("File upload does not support symbolic links.")
    await expect(dispatcher.dispatch("app.drive.direct_link.update", {
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

    await expect(dispatcher.dispatch("app.drive.direct_link.list", { offset: 3, limit: 7, search: "logo" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { items: [asset], total: 1, page: drivePage() }, total: 1 })
    await expect(dispatcher.dispatch("app.drive.direct_link.get", {
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

    await expect(dispatcher.dispatch("app.drive.direct_link.update", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      filePath: "/tmp/new-logo.png",
      name: "new-logo",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/new-logo.png",
      context: expect.objectContaining({ driveAction: "app.drive.direct_link.update" }),
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

    await expect(dispatcher.dispatch("app.drive.direct_link.rename", {
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

    await expect(dispatcher.dispatch("app.drive.direct_link.delete", {
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: asset })
    await expect(dispatcher.dispatch("app.drive.direct_link.restore", {
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

    await expect(dispatcher.dispatch("app.drive.trash.list", { offset: 1, limit: 20, search: "old" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: trashPage, total: 1 })
    await expect(dispatcher.dispatch("app.drive.trash.delete", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { ok: true } })
    await expect(dispatcher.dispatch("app.drive.item.restore", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: restored })
    await expect(dispatcher.dispatch("app.drive.item.restore", {
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
      preview: { kind: "markdown", text: "# Note", html: "<h1>Note</h1>", outline: null, truncated: false, imageUrl: null, visitUrl: null, relativeImages: [] },
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

    await expect(dispatcher.dispatch("app.drive.item_preview.get", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: snapshot })
    await expect(dispatcher.dispatch("app.drive.file_content.read", { itemId: "item-1", maxBytes: 4096 }, { source: "mcp-stdio" }))
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

    await expect(dispatcher.dispatch("app.drive.file_download.create", {
      itemId: "item-1",
      outputPath: "/tmp/report.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, path: "/tmp/report.md" } })
    await expect(dispatcher.dispatch("app.drive.folder_zip.create", {
      itemId: "folder-1",
      outputPath: "/tmp/project.zip",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, path: "/tmp/project.zip" } })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report.md",
      context: expect.objectContaining({ driveAction: "app.drive.file_download.create", itemId: "item-1" }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/project.zip",
      context: expect.objectContaining({ driveAction: "app.drive.folder_zip.create", itemId: "folder-1" }),
    }))
    expect(accountService.downloadDriveFile).toHaveBeenCalledWith({ itemId: "item-1", outputPath: "/tmp/report.md" })
    expect(accountService.downloadDriveFolderZip).toHaveBeenCalledWith({ itemId: "folder-1", outputPath: "/tmp/project.zip" })
  })

  it("preserves trailing whitespace in Drive download output paths", async () => {
    const accountService = createAccountService({
      downloadDriveFile: vi.fn(async () => ({ ok: true as const, path: "/tmp/report.md " })),
      downloadDriveFileVersion: vi.fn(async () => ({ ok: true as const, path: "/tmp/report-v1.md " })),
      downloadDriveLinkFile: vi.fn(async () => ({ localPath: "/tmp/shared.md ", mimeType: "text/markdown", size: "12" })),
      downloadDriveFolderZip: vi.fn(async () => ({ ok: true as const, path: "/tmp/project.zip " })),
    })
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, permissionGuard })

    await expect(dispatcher.dispatch("app.drive.file_download.create", {
      itemId: "item-1",
      outputPath: "/tmp/report.md ",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.drive.file_version_download.create", {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md ",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.drive.link.download_file", {
      url: "https://synapse.local/share/link-1",
      outputPath: "/tmp/shared.md ",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })
    await expect(dispatcher.dispatch("app.drive.folder_zip.create", {
      itemId: "folder-1",
      outputPath: "/tmp/project.zip ",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report.md ",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report-v1.md ",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/shared.md ",
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/project.zip ",
    }))
    expect(accountService.downloadDriveFile).toHaveBeenCalledWith({ itemId: "item-1", outputPath: "/tmp/report.md " })
    expect(accountService.downloadDriveFileVersion).toHaveBeenCalledWith({
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md ",
    })
    expect(accountService.downloadDriveLinkFile).toHaveBeenCalledWith({
      url: "https://synapse.local/share/link-1",
      outputPath: "/tmp/shared.md ",
    })
    expect(accountService.downloadDriveFolderZip).toHaveBeenCalledWith({ itemId: "folder-1", outputPath: "/tmp/project.zip " })
  })

  it("manages Drive file versions", async () => {
    const accountService = createAccountService({
      listDriveFileVersions: vi.fn(async () => ({
        items: [driveFileVersion({ id: "version-1" })],
        total: 1,
        page: drivePage(),
      })),
      restoreDriveFileVersion: vi.fn(async () => driveItem({ id: "item-1" })),
      deleteDriveFileVersion: vi.fn(async () => ({ ok: true as const, deletePending: true })),
      updateDriveFileVersionPin: vi.fn(async () => driveFileVersion({ id: "version-1", isPinned: true })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("app.drive.file_version.list", {
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
    await expect(dispatcher.dispatch("app.drive.file_version.restore", {
      itemId: "item-1",
      versionId: "version-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: driveItem({ id: "item-1" }) })
    await expect(dispatcher.dispatch("app.drive.file_version.delete", {
      itemId: "item-1",
      versionId: "version-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, deletePending: true } })
    await expect(dispatcher.dispatch("app.drive.file_version_pin.update", {
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

    await expect(dispatcher.dispatch("app.drive.file_version_download.create", {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true, path: "/tmp/report-v1.md" } })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write.outside-userdata",
      resource: "/tmp/report-v1.md",
      context: expect.objectContaining({ driveAction: "app.drive.file_version_download.create", itemId: "item-1" }),
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

    await expect(dispatcher.dispatch("app.drive.link.download_file", {
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
        driveAction: "app.drive.link.download_file",
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
        action: "app.drive.file_download.create",
        params: { itemId: "item-1", outputPath: "downloads/report.md" },
      },
      {
        action: "app.drive.file_version_download.create",
        params: { itemId: "item-1", versionId: "version-1", outputPath: "report-v1.md" },
      },
      {
        action: "app.drive.link.download_file",
        params: { url: "https://synapse.local/share/link-1", outputPath: "downloads/shared-report.md" },
      },
      {
        action: "app.drive.folder_zip.create",
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
    const filePath = "/tmp/report.md "
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

    const result = await dispatcher.dispatch("app.drive.file.upload", {
      filePath,
    }, { source: "mcp-stdio", actor: mcpClientActorForSource("mcp-stdio") })

    expect(result).toEqual({ ok: true, data: driveItem({ id: "item-1", name: "report.md" }) })
    expect(JSON.stringify(result)).not.toContain("X-Amz-Signature")
    expect(accountService.prepareDriveUpload).toHaveBeenCalledWith({
      parentId: null,
      name: "report.md ",
      size: "4",
      mimeType: null,
    })
    expect(readFile).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" },
      resource: "synapse-drive",
      context: { source: "mcp-stdio", driveAction: "app.drive.file.upload" },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user", id: "mcp-client:synapse-mcp/stdio", display: "Synapse MCP stdio" },
      resource: filePath,
      context: { source: "mcp-stdio", driveAction: "app.drive.file.upload" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: filePath,
      metadata: expect.objectContaining({ driveAction: "app.drive.file.upload" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:app.drive.file.upload",
      metadata: expect.objectContaining({ driveAction: "app.drive.file.upload", itemId: "item-1" }),
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

    await expect(dispatcher.dispatch("app.drive.file.upload", {
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

    await expect(dispatcher.dispatch("app.drive.file.upload", {
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

    await expect(dispatcher.dispatch("app.drive.file.upload", {
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

    await expect(dispatcher.dispatch("app.drive.file.upload", {
      filePath: "/tmp/report.md",
    }, { source: "mcp-stdio" })).rejects.toThrow("policy backend failed")

    expect(fileSystem.stat).not.toHaveBeenCalled()
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "failed",
      resource: "/tmp/report.md",
      metadata: expect.objectContaining({
        driveAction: "app.drive.file.upload",
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

    await expect(dispatcher.dispatch("app.drive.file.upload", {
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
      completeDriveUpload: vi.fn(async (sessionId: string) =>
        sessionId === "session-a"
          ? driveItem({ id: "file-a", name: "a.txt" })
          : driveItem({ id: "file-b", name: "b.txt" })
      ),
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

    const result = await dispatcher.dispatch("app.drive.folder.upload", {
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
        uploadedFiles: [{ relativePath: "a.txt", item: driveItem({ id: "file-a", name: "a.txt" }) }],
        createdDirectories: [],
        failures: [{ relativePath: "b.txt", error: "Drive upload failed." }],
      },
      errors: [{ relativePath: "b.txt", error: "Drive upload failed." }],
    })
    expect(accountService.completeDriveUpload).toHaveBeenCalledWith("session-a")
    expect(accountService.completeDriveUpload).not.toHaveBeenCalledWith("session-b")
    expect(accountService.cancelDriveUpload).toHaveBeenCalledWith("session-b")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "/tmp/project",
      metadata: expect.objectContaining({ driveAction: "app.drive.folder.upload" }),
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive:app.drive.folder.upload",
      metadata: expect.objectContaining({
        driveAction: "app.drive.folder.upload",
        completed: 1,
        failed: 1,
        rootItemId: "folder-root",
        error: "Folder upload completed with failed files.",
      }),
    }))
  })

  it("passes nested local directories to MCP folder uploads", async () => {
    const root = driveItem({ id: "folder-root", type: "folder", name: "project" })
    const accountService = createAccountService({
      prepareDriveFolderUpload: vi.fn(async () => ({
        root,
        rootCreated: true,
        entries: [{
          relativePath: "docs/keep.md",
          sessionId: "session-keep",
          item: driveItem({ id: "file-keep", name: "keep.md" }),
          upload: {
            method: "PUT" as const,
            url: "https://cos.example/upload/keep",
            expiresAt: "2026-06-07T00:00:00.000Z",
            headers: {},
          },
        }],
      })),
    })
    const fileSystem = {
      lstat: vi.fn(async (target: string) => statLikeForTest({
        isFile: target.endsWith("keep.md"),
        isDirectory: !target.endsWith("keep.md"),
        size: target.endsWith("keep.md") ? 4 : 0,
      })),
      stat: vi.fn(),
      createReadStream: vi.fn(() => Readable.from(["keep"])),
      readdir: vi.fn(async (directoryPath: string) => {
        if (directoryPath === "/tmp/project") {
          return [{ name: "docs", isDirectory: () => true, isFile: () => false }]
        }
        if (directoryPath === "/tmp/project/docs") {
          return [
            { name: "keep.md", isDirectory: () => false, isFile: () => true },
            { name: "empty", isDirectory: () => true, isFile: () => false },
          ]
        }
        return []
      }),
    } as unknown as DriveDispatcherDeps["fileSystem"]
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem,
      fetch: vi.fn(async () => ({ ok: true }) as Response),
    })

    const result = await dispatcher.dispatch("app.drive.folder.upload", {
      folderPath: "/tmp/project",
    }, { source: "mcp-stdio" })

    expect(result).toMatchObject({
      ok: true,
      data: {
        uploadedFiles: [{ relativePath: "docs/keep.md" }],
        createdDirectories: [{ relativePath: "docs" }, { relativePath: "docs/empty" }],
      },
    })

    expect(accountService.prepareDriveFolderUpload).toHaveBeenCalledWith({
      parentId: null,
      folderName: "project",
      directories: [{ relativePath: "docs" }, { relativePath: "docs/empty" }],
      files: [{ relativePath: "docs/keep.md", size: "4", mimeType: null }],
    })
  })

  it("uses folder upload merge semantics for an empty local directory", async () => {
    const root = driveItem({ id: "folder-root", type: "folder", name: "project" })
    const accountService = createAccountService({
      prepareDriveFolderUpload: vi.fn(async () => ({
        root,
        rootCreated: false,
        entries: [],
      })),
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

    await expect(dispatcher.dispatch("app.drive.folder.upload", {
      folderPath: "/tmp/project",
      parentId: "drive-root",
    }, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: {
        root,
        rootCreated: false,
        completed: 0,
        failed: 0,
        uploadedFiles: [],
        createdDirectories: [],
        failures: [],
        cleanupRootDeleted: false,
        cleanupRootDeleteFailed: false,
      },
    })
    expect(accountService.prepareDriveFolderUpload).toHaveBeenCalledWith({
      parentId: "drive-root",
      folderName: "project",
      files: [],
    })
    expect(accountService.createDriveFolder).not.toHaveBeenCalled()
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

    await expect(dispatcher.dispatch("app.drive.folder.upload", {
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

    const result = await dispatcher.dispatch("app.drive.folder.upload", {
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

    await expect(dispatcher.dispatch("app.drive.folder.upload", {
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

    await expect(dispatcher.dispatch("app.drive.folder.upload", {
      folderPath: "/tmp/large-folder",
    }, { source: "mcp-stdio" })).rejects.toThrow(`一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_FILES} 个文件`)

    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
  })

  it("rejects MCP folder uploads that exceed the local upload directory limit before preparing sessions", async () => {
    const accountService = createAccountService()
    const dispatcher = createDriveCapabilityDispatcher({
      accountService,
      fileSystem: {
        lstat: vi.fn(async (target: string) => statLikeForTest({
          isFile: false,
          isDirectory: target === "/tmp/many-directories" || target.startsWith("/tmp/many-directories/dir-"),
          size: 1,
        })),
        stat: vi.fn(async () => ({
          isFile: () => true,
          isDirectory: () => true,
          size: 1,
        })),
        createReadStream: vi.fn(),
        readdir: vi.fn(async (directoryPath: string) => {
          if (directoryPath !== "/tmp/many-directories") return []
          return Array.from(
            { length: DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES + 1 },
            (_, index) => ({
              name: `dir-${index}`,
              isDirectory: () => true,
              isFile: () => false,
            }),
          )
        }),
      } as unknown as DriveDispatcherDeps["fileSystem"],
      fetch: vi.fn(),
    })

    await expect(dispatcher.dispatch("app.drive.folder.upload", {
      folderPath: "/tmp/many-directories",
    }, { source: "mcp-stdio" })).rejects.toThrow(`一次最多上传 ${DRIVE_LOCAL_UPLOAD_MAX_DIRECTORIES} 个文件夹`)

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

    await expect(dispatcher.dispatch("app.drive.folder.upload", {
      folderPath: "/tmp/deep-folder",
    }, { source: "mcp-stdio" })).rejects.toThrow(`文件夹层级最多 ${DRIVE_LOCAL_UPLOAD_MAX_FOLDER_DEPTH} 层`)

    expect(accountService.prepareDriveFolderUpload).not.toHaveBeenCalled()
  })

  it("creates or reuses shares without changing access settings when omitted", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("app.drive.share.create", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", undefined)
  })

  it("deletes Drive items", async () => {
    const accountService = createAccountService({
      deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("app.drive.item.delete", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })

    expect(accountService.deleteDriveItem).toHaveBeenCalledWith("item-1")
  })

  it("creates shares with custom no-password access settings", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1", passwordEnabled: false, password: null })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("app.drive.share.create", {
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

    await expect(dispatcher.dispatch("app.drive.share.create", {
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

    await expect(dispatcher.dispatch("app.drive.share.create", {
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

    await expect(dispatcher.dispatch("app.drive.share.create", {
      itemId: "item-1",
      expiresIn: "30d",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:item-1",
      metadata: expect.objectContaining({
        driveAction: "app.drive.share.create",
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

    await expect(dispatcher.dispatch("app.drive.share.create", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).rejects.toThrow("share failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "synapse-drive:item-1",
      metadata: expect.objectContaining({
        driveAction: "app.drive.share.create",
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

    await expect(dispatcher.dispatch("app.drive.share.disable", {
      shareId: "shr_public_secret",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.disableDriveShare).toHaveBeenCalledWith("shr_public_secret")
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:public-share:[redacted]",
      metadata: expect.objectContaining({
        driveAction: "app.drive.share.disable",
        shareId: "public-share:[redacted]",
      }),
    }))
    expect(JSON.stringify(vi.mocked(auditSink.record).mock.calls)).not.toContain("shr_public_secret")
  })
})

type DriveSyncServicePort = NonNullable<DriveDispatcherDeps["driveSyncService"]>
type DriveSyncSnapshot = Awaited<ReturnType<DriveSyncServicePort["getSnapshot"]>>
type DriveSyncBinding = DriveSyncSnapshot["bindings"][number]
type DriveSyncPreview = Awaited<ReturnType<DriveSyncServicePort["previewBinding"]>>

function createDriveSyncService(overrides: Partial<DriveSyncServicePort> = {}): DriveSyncServicePort {
  const binding = driveSyncBinding()
  return {
    getSnapshot: vi.fn(async () => driveSyncSnapshot()),
    previewBinding: vi.fn(async () => driveSyncPreview()),
    createSafeBinding: vi.fn(async () => binding),
    pauseBinding: vi.fn(async () => ({ ...binding, status: "paused" })),
    resumeBinding: vi.fn(async () => binding),
    removeBinding: vi.fn(async () => undefined),
    updateExcludeRules: vi.fn(async () => binding),
    rescanBinding: vi.fn(async () => undefined),
    resolveConflict: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as DriveSyncServicePort
}

function driveSyncBinding(overrides: Partial<DriveSyncBinding> = {}): DriveSyncBinding {
  return {
    id: "binding-1",
    driveItemId: "drive-item-1",
    driveItemName: "spec.md",
    drivePathHint: "spec.md",
    kind: "file",
    localPath: "/workspace/spec.md",
    status: "active",
    remoteCursor: "1",
    excludeRules: { forced: [], defaults: [], importedGitignore: [], user: [] },
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    lastSyncedAt: "2026-08-05T00:00:00.000Z",
    lastError: null,
    ...overrides,
  }
}

function driveSyncPreview(overrides: Partial<DriveSyncPreview> = {}): DriveSyncPreview {
  return {
    status: "ready",
    direction: "local_to_remote",
    reason: null,
    localPath: "/workspace/spec.md",
    localKind: "file",
    localEmpty: false,
    forcedExcludeRules: [],
    defaultExcludeRules: [],
    importedGitignoreRules: [],
    detectedGitignoreRules: [],
    ...overrides,
  }
}

function driveSyncSnapshot(overrides: Partial<DriveSyncSnapshot> = {}): DriveSyncSnapshot {
  return {
    bindings: [],
    conflicts: [],
    operations: [],
    health: {
      status: "idle",
      connectivity: "online",
      readOnly: false,
      lastError: null,
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    summary: {
      activeBindingCount: 0,
      runningOperationCount: 0,
      retryWaitingOperationCount: 0,
      conflictCount: 0,
      errorCount: 0,
    },
    ...overrides,
  }
}

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
