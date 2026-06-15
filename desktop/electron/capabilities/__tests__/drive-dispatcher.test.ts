import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { createDriveCapabilityDispatcher } from "../drive-dispatcher"
import { mcpClientActorForSource } from "../../../synapse-capabilities/shared/types"
import { buildDriveTools } from "../../../synapse-capabilities/shared/drive-domain"

type DriveDispatcherDeps = Parameters<typeof createDriveCapabilityDispatcher>[0]
type DriveAccountService = DriveDispatcherDeps["accountService"]
type DriveAuditSink = NonNullable<DriveDispatcherDeps["auditSink"]>
type DriveItem = Awaited<ReturnType<DriveAccountService["listDriveItems"]>>[number]

describe("createDriveCapabilityDispatcher", () => {
  it("exposes access settings on share creation", () => {
    const shareCreateTool = buildDriveTools().find((tool) => tool.name === "drive_share_create")
    expect(shareCreateTool?.inputSchema.properties).toMatchObject({
      passwordEnabled: { type: "boolean" },
      expiresIn: { type: "string", enum: ["3d", "7d", "30d", "1y", "forever"] },
    })
  })

  it("exposes publication disable option on item deletion", () => {
    const deleteTool = buildDriveTools().find((tool) => tool.name === "drive_item_delete")
    expect(deleteTool?.inputSchema.properties).toMatchObject({
      itemId: { type: "string" },
      disablePublications: { type: "boolean" },
    })
  })

  it("exposes the full Drive MCP tool set without legacy gaps", () => {
    expect(buildDriveTools().map((tool) => tool.name)).toEqual([
      "drive_item_list",
      "drive_item_get",
      "drive_file_upload",
      "drive_folder_upload",
      "drive_folder_create",
      "drive_item_rename",
      "drive_item_move",
      "drive_delete_impact_get",
      "drive_item_delete",
      "drive_item_preview_get",
      "drive_file_content_read",
      "drive_file_download_create",
      "drive_folder_zip_create",
      "drive_share_list",
      "drive_share_create",
      "drive_share_disable",
      "drive_publication_list",
      "drive_page_publication_create",
      "drive_site_publication_create",
      "drive_publication_deployment_create",
      "drive_publication_disable",
      "drive_usage_get",
      "drive_stats_get",
      "drive_item_tree_list",
      "drive_folder_path_ensure",
      "drive_reorganization_preview",
      "drive_reorganization_apply",
    ])
  })

  it("lists Drive items under root by default", async () => {
    const accountService = createAccountService({
      listDriveItems: vi.fn(async () => [driveItem({ id: "item-1", name: "a.txt" })]),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.list", {}, { source: "mcp-stdio" })).resolves.toEqual({
      ok: true,
      data: [driveItem({ id: "item-1", name: "a.txt" })],
      total: 1,
    })
    expect(accountService.listDriveItems).toHaveBeenCalledWith(null)
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
    const applied = { ok: true as const, movedCount: 1, skippedCount: 0 }
    const accountService = createAccountService({
      previewDriveReorganization: vi.fn(async () => preview),
      applyDriveReorganization: vi.fn(async () => applied),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

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
  })

  it("authorizes and audits Drive item reads", async () => {
    const accountService = createAccountService({
      listDriveItems: vi.fn(async () => [driveItem({ id: "item-1", name: "a.txt" })]),
    })
    const auditSink = createAuditSink()
    const permissionGuard = {
      registerPolicy: vi.fn(),
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink, permissionGuard })

    await expect(dispatcher.dispatch("drive.item.list", {
      parentId: "folder-1",
    }, { source: "mcp-stdio", actor: mcpClientActorForSource("mcp-stdio") })).resolves.toMatchObject({
      ok: true,
      total: 1,
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

  it("routes publication and public link management tools", async () => {
    const publication = drivePublication({ id: "publication-1", type: "page" })
    const accountService = createAccountService({
      getDriveDeleteImpact: vi.fn(async () => ({ publications: [publication] })),
      listDriveShares: vi.fn(async () => ({ items: [driveShareListItem({ id: "share-1" })], page: drivePage() })),
      listDrivePublications: vi.fn(async () => ({ items: [publication], page: drivePage() })),
      publishDrivePage: vi.fn(async () => publication),
      publishDriveSite: vi.fn(async () => drivePublication({ id: "publication-2", type: "site" })),
      redeployDrivePublication: vi.fn(async () => publication),
      disableDrivePublication: vi.fn(async () => ({ ok: true as const })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.delete_impact.get", { itemId: "item-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { publications: [publication] } })
    await expect(dispatcher.dispatch("drive.share.list", { offset: 10, limit: 5 }, { source: "mcp-stdio" }))
      .resolves.toMatchObject({ ok: true, data: { items: [expect.objectContaining({ id: "share-1" })] } })
    await expect(dispatcher.dispatch("drive.publication.list", {}, { source: "mcp-stdio" }))
      .resolves.toMatchObject({ ok: true, data: { items: [publication] } })
    await expect(dispatcher.dispatch("drive.page_publication.create", {
      itemId: "item-1",
      passwordEnabled: false,
      expiresIn: "30d",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: publication })
    await expect(dispatcher.dispatch("drive.site_publication.create", { itemId: "folder-1" }, { source: "mcp-stdio" }))
      .resolves.toMatchObject({ ok: true, data: { type: "site" } })
    await expect(dispatcher.dispatch("drive.publication_deployment.create", { publicationId: "publication-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: publication })
    await expect(dispatcher.dispatch("drive.publication.disable", { publicationId: "publication-1" }, { source: "mcp-stdio" }))
      .resolves.toEqual({ ok: true, data: { ok: true } })

    expect(accountService.listDriveShares).toHaveBeenCalledWith({ offset: 10, limit: 5 })
    expect(accountService.publishDrivePage).toHaveBeenCalledWith("item-1", {
      passwordEnabled: false,
      expiresIn: "30d",
    })
    expect(accountService.publishDriveSite).toHaveBeenCalledWith("folder-1", {
      passwordEnabled: true,
      expiresIn: "3d",
    })
  })

  it("returns preview snapshots and text content without creating shares or publications", async () => {
    const snapshot = drivePreviewSnapshot({
      preview: { kind: "markdown", text: "# Note", html: "<h1>Note</h1>", truncated: false, imageUrl: null, visitUrl: null },
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

  it("checks fs.write before saving Drive file and folder downloads locally", async () => {
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
      action: "fs.write",
      resource: "/tmp/report.md",
      context: expect.objectContaining({ driveAction: "drive.file_download.create", itemId: "item-1" }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "/tmp/project.zip",
      context: expect.objectContaining({ driveAction: "drive.folder_zip.create", itemId: "folder-1" }),
    }))
    expect(accountService.downloadDriveFile).toHaveBeenCalledWith({ itemId: "item-1", outputPath: "/tmp/report.md" })
    expect(accountService.downloadDriveFolderZip).toHaveBeenCalledWith({ itemId: "folder-1", outputPath: "/tmp/project.zip" })
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

  it("creates shares with the default access settings when omitted", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      passwordEnabled: true,
      expiresIn: "3d",
    })
  })

  it("deletes Drive items without disabling publications by default", async () => {
    const accountService = createAccountService({
      deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.item.delete", {
      itemId: "item-1",
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })

    expect(accountService.deleteDriveItem).toHaveBeenCalledWith("item-1", {})
  })

  it("passes publication disable option when deleting Drive items", async () => {
    const accountService = createAccountService({
      deleteDriveItem: vi.fn(async () => ({ ok: true as const })),
    })
    const auditSink = createAuditSink()
    const dispatcher = createDriveCapabilityDispatcher({ accountService, auditSink })

    await expect(dispatcher.dispatch("drive.item.delete", {
      itemId: "item-1",
      disablePublications: true,
    }, { source: "mcp-stdio" })).resolves.toEqual({ ok: true, data: { ok: true } })

    expect(accountService.deleteDriveItem).toHaveBeenCalledWith("item-1", {
      disablePublications: true,
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "synapse-drive:item-1",
      metadata: expect.objectContaining({
        driveAction: "drive.item.delete",
        itemId: "item-1",
        disablePublications: true,
      }),
    }))
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

  it("creates shares with a non-default expiry", async () => {
    const accountService = createAccountService({
      shareDriveItem: vi.fn(async () => driveShare({ id: "share-1" })),
    })
    const dispatcher = createDriveCapabilityDispatcher({ accountService })

    await expect(dispatcher.dispatch("drive.share.create", {
      itemId: "item-1",
      expiresIn: "30d",
    }, { source: "mcp-stdio" })).resolves.toMatchObject({ ok: true })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      passwordEnabled: true,
      expiresIn: "30d",
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
        shareId: "shr_1",
        expiresIn: "30d",
      }),
    }))
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
})

function createAccountService(overrides: Partial<DriveAccountService> = {}): DriveAccountService {
  return {
    listDriveItems: vi.fn(async () => []),
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
    getDriveUsage: vi.fn(),
    getDriveDeleteImpact: vi.fn(),
    listDriveShares: vi.fn(),
    listDrivePublications: vi.fn(),
    publishDrivePage: vi.fn(),
    publishDriveSite: vi.fn(),
    redeployDrivePublication: vi.fn(),
    disableDrivePublication: vi.fn(),
    getDriveStats: vi.fn(),
    listDriveItemTree: vi.fn(),
    ensureDriveFolderPath: vi.fn(),
    previewDriveReorganization: vi.fn(),
    applyDriveReorganization: vi.fn(),
    getDriveItemPreview: vi.fn(),
    readDriveFileContent: vi.fn(),
    downloadDriveFile: vi.fn(),
    downloadDriveFolderZip: vi.fn(),
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

type DriveShare = Awaited<ReturnType<DriveAccountService["shareDriveItem"]>>

function driveShare(overrides: Partial<DriveShare>): DriveShare {
  return {
    id: "share-1",
    shareId: "shr_1",
    itemId: "item-1",
    enabled: true,
    url: "https://synapse.test/files/shr_1",
    urlWithPassword: "https://synapse.test/files/shr_1?password=secret",
    passwordEnabled: true,
    password: "secret",
    expiresAt: "2026-06-10T00:00:00.000Z",
    createdAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  }
}

type DrivePublication = Awaited<ReturnType<DriveAccountService["publishDrivePage"]>>

function drivePublication(overrides: Partial<DrivePublication>): DrivePublication {
  return {
    id: "publication-1",
    publishId: "pub_1",
    type: "page",
    name: "page.html",
    status: "active",
    sourceItemId: "item-1",
    sourceDeleted: false,
    url: "https://synapse.test/pages/pub_1",
    urlWithPassword: "https://synapse.test/pages/pub_1?password=secret",
    passwordEnabled: true,
    password: "secret",
    expiresAt: "2026-06-10T00:00:00.000Z",
    currentDeploymentId: "deployment-1",
    createdAt: "2026-06-07T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
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
    url: "https://synapse.test/files/shr_1",
    urlWithPassword: "https://synapse.test/files/shr_1?password=secret",
    passwordEnabled: true,
    password: "secret",
    expiresAt: "2026-06-10T00:00:00.000Z",
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
    canDownload: true,
    canZip: false,
    ...overrides,
  }
}
