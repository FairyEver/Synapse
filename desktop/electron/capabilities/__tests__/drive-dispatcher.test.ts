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
    moveDriveItem: vi.fn(),
    deleteDriveItem: vi.fn(),
    shareDriveItem: vi.fn(),
    disableDriveShare: vi.fn(),
    getDriveUsage: vi.fn(),
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
