import { describe, expect, it } from "vitest"
import { vi } from "vitest"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { DRIVE_LOCAL_UPLOAD_MAX_FILES } from "../../../../src/lib/drive-local-upload-limits"

function assertParseableSchema(schema: unknown): asserts schema is { parse: (value: unknown) => unknown } {
  if (
    typeof schema !== "object"
    || schema === null
    || !("parse" in schema)
    || typeof schema.parse !== "function"
  ) {
    throw new Error("expected parseable schema")
  }
}

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-account-${name}`),
    getAppPath: () => path.join(os.tmpdir(), "synapse-account-app"),
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../../services/account-service", () => ({
  accountService: {
    getState: () => ({ status: "unauthenticated" }),
    startLogin: async () => ({ state: { status: "unauthenticated" } }),
    refreshFromStorage: async () => ({ status: "unauthenticated" }),
    logout: async () => ({ status: "unauthenticated" }),
    listWebhooks: async () => [],
    listDriveItems: async () => [],
    listDriveItemsPage: vi.fn(async () => ({ items: [], page: { offset: 0, limit: 100, hasMore: false, nextOffset: null } })),
    prepareDriveUpload: async () => ({}),
    prepareDriveFolderUpload: async () => ({}),
    completeDriveUpload: async () => ({}),
    uploadDrivePreparedFile: vi.fn(async () => ({ ok: true })),
    uploadDriveLocalItems: vi.fn(async () => ({ completed: 0, failed: 0, skipped: 0 })),
    cancelDriveUpload: async () => ({ ok: true }),
    createDriveFolder: async () => ({}),
    getDriveItemPreviewUrl: vi.fn(async () => ({ url: "https://synapse.test/drive/items/file-1" })),
    renameDriveItem: async () => ({}),
    moveDriveItem: async () => ({}),
    deleteDriveItem: async () => ({ ok: true }),
    listDriveFileVersions: vi.fn(async () => ({ items: [], total: 0, page: { offset: 0, limit: 20, hasMore: false, nextOffset: null } })),
    downloadDriveFileVersion: vi.fn(async () => ({ ok: true, path: "/tmp/report.md" })),
    restoreDriveFileVersion: vi.fn(async () => ({})),
    deleteDriveFileVersion: vi.fn(async () => ({ ok: true })),
    updateDriveFileVersionPin: vi.fn(async () => ({})),
    shareDriveItem: vi.fn(async () => ({})),
    disableDriveShare: async () => ({ ok: true }),
    getDriveUsage: async () => ({}),
    getDriveShare: vi.fn(async () => ({})),
    materializeDriveLink: vi.fn(async () => ({
      localRootPath: "/tmp/intake",
      manifestPath: "/tmp/intake/manifest.json",
      entryPath: "/tmp/intake/content/index.html",
      files: [],
      skipped: [],
      warnings: [],
    })),
    downloadDriveLinkFile: vi.fn(async () => ({ localPath: "/tmp/intake/content/download", mimeType: "text/markdown", size: "12" })),
    listDriveShares: async () => [],
    listDrivePublicAssets: async () => ({ items: [], page: { offset: 0, limit: 20, hasMore: false, nextOffset: null }, total: 0 }),
    getDrivePublicAsset: async () => ({}),
    uploadDrivePublicAssets: vi.fn(async () => ({ results: [] })),
    uploadDrivePublicAssetBinary: vi.fn(async () => ({})),
    scanDriveDocumentImageSources: vi.fn(async () => ({})),
    importDriveDocumentImages: vi.fn(async () => ({})),
    replaceDrivePublicAssetFile: vi.fn(async () => ({})),
    renameDrivePublicAsset: vi.fn(async () => ({})),
    trashDrivePublicAsset: vi.fn(async () => ({})),
    restoreDrivePublicAsset: vi.fn(async () => ({})),
    preflightDriveSite: vi.fn(async () => ({})),
    createDriveSite: vi.fn(async () => ({})),
    listDriveSites: vi.fn(async () => ({ items: [], page: { offset: 0, limit: 50, hasMore: false, nextOffset: null }, total: 0 })),
    updateDriveSiteAccess: vi.fn(async () => ({})),
    disableDriveSite: vi.fn(async () => ({})),
    enableDriveSite: vi.fn(async () => ({})),
    deleteDriveSite: vi.fn(async () => ({ ok: true })),
    republishDriveSite: vi.fn(async () => ({})),
    listDriveTrash: vi.fn(async () => ({ items: [], page: { offset: 0, limit: 20, hasMore: false, nextOffset: null }, total: 0 })),
    restoreDriveTrashItem: vi.fn(async () => ({})),
    deleteDriveTrashItem: vi.fn(async () => ({ ok: true })),
  },
}))

import { accountService } from "../../../services/account-service"
import { accountIpcModule } from "../ipc"

type PermissionResultForTest =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly policyId?: string }

function createAccountSecurityContext(permissionResult: PermissionResultForTest = { allowed: true }) {
  const permissionGuard = { check: vi.fn(async () => permissionResult) }
  const auditSink = { record: vi.fn() }
  const ctx: IpcHandlerContext = {
    moduleId: "account",
    resolve: ((id: string) => {
      if (id === "core.permission-guard") return permissionGuard
      if (id === "core.audit-sink") return auditSink
      throw new Error(`unexpected service ${id}`)
    }) as IpcHandlerContext["resolve"],
  }
  return { auditSink, ctx, permissionGuard }
}

describe("accountIpcModule", () => {
  it("declares account invoke channels", () => {
    expect(accountIpcModule.id).toBe("account")
    expect(accountIpcModule.methods.getState.channel).toBe("synapse:account:get-state")
    expect(accountIpcModule.methods.startLogin.channel).toBe("synapse:account:start-login")
    expect(accountIpcModule.methods.refresh.channel).toBe("synapse:account:refresh")
    expect(accountIpcModule.methods.logout.channel).toBe("synapse:account:logout")
    expect(accountIpcModule.methods.listWebhooks.channel).toBe("synapse:account:webhooks:list")
  })

  it("validates account webhook responses", () => {
    const responseSchema = accountIpcModule.methods.listWebhooks.response
    expect(responseSchema).toBeDefined()
    if (!responseSchema) throw new Error("expected webhook list response schema")

    expect(responseSchema.parse([{
      id: "webhook-1",
      publicId: "wh_public",
      name: "GitHub",
      enabled: true,
      url: "https://synapse.test/webhooks/wh_public/whsec_secret",
      maskedUrl: "https://synapse.test/webhooks/wh_public/***",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      lastDeliveryAt: "2026-06-06T10:01:00.000Z",
      lastDeliveryStatus: "delivered",
    }])).toEqual([
      expect.objectContaining({
        publicId: "wh_public",
        url: "https://synapse.test/webhooks/wh_public/whsec_secret",
        maskedUrl: "https://synapse.test/webhooks/wh_public/***",
      }),
    ])
  })

  it("validates state changed domain events", () => {
    const parsed = accountIpcModule.events.stateChanged.payload.parse({
      domain: "account",
      type: "account.stateChanged",
      payload: {
        state: {
          status: "authenticated",
          connectivity: "online",
          profile: {
            user: { id: "u1", email: "u@example.com", handle: "ada", status: "active" },
            teams: [],
            syncedAt: "2026-05-28T00:00:00.000Z",
          },
        },
      },
      timestamp: "2026-05-28T00:00:00.000Z",
    })

    expect(parsed).toMatchObject({
      payload: {
        state: {
          status: "authenticated",
          profile: {
            user: {
              handle: "ada",
            },
          },
        },
      },
    })
  })

  it("accepts cross-realm ArrayBuffer upload payloads", () => {
    const requestSchema = accountIpcModule.methods.uploadDrivePreparedFile.request
    expect(requestSchema).toBeDefined()
    if (!requestSchema) throw new Error("expected upload request schema")

    const body = vm.runInNewContext("new ArrayBuffer(3)") as ArrayBuffer

    expect(requestSchema.parse({
      body,
      headers: {},
      method: "PUT",
      url: "https://upload.example.test/object",
    })).toMatchObject({
      body,
      method: "PUT",
    })
  })

  it("validates local drive upload requests", () => {
    const requestSchema = accountIpcModule.methods.uploadDriveLocalItems.request
    expect(requestSchema).toBeDefined()
    if (!requestSchema) throw new Error("expected local upload request schema")

    expect(requestSchema.parse({
      parentId: "folder-1",
      items: [
        { kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain", expectedItemId: "file-1" },
        {
          kind: "folder",
          folderName: "项目A",
          files: [
            { path: "/tmp/项目A/a.md", relativePath: "a.md", mimeType: "text/markdown" },
            { path: "/tmp/项目A/docs/b.md", relativePath: "docs/b.md", mimeType: null },
          ],
        },
      ],
    })).toMatchObject({
      parentId: "folder-1",
      items: [
        { kind: "file", name: "report.txt", expectedItemId: "file-1" },
        { kind: "folder", folderName: "项目A" },
      ],
    })

    expect(() => requestSchema.parse({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "bad",
        files: [{ path: "/tmp/bad.txt", relativePath: "../bad.txt" }],
      }],
    })).toThrow()

    expect(() => requestSchema.parse({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "bulk",
        files: Array.from({ length: DRIVE_LOCAL_UPLOAD_MAX_FILES + 1 }, (_, index) => ({
          path: `/tmp/bulk/file-${index}.txt`,
          relativePath: `file-${index}.txt`,
        })),
      }],
    })).toThrow()

    expect(() => requestSchema.parse({
      parentId: null,
      items: [
        { kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" },
        {
          kind: "folder",
          folderName: "bulk",
          files: Array.from({ length: DRIVE_LOCAL_UPLOAD_MAX_FILES }, (_, index) => ({
            path: `/tmp/bulk/file-${index}.txt`,
            relativePath: `file-${index}.txt`,
          })),
        },
      ],
    })).toThrow()
  })

  it("accepts public asset and trash list search filters", () => {
    const publicAssetsRequest = accountIpcModule.methods.listDrivePublicAssets.request
    const trashRequest = accountIpcModule.methods.listDriveTrash.request
    expect(publicAssetsRequest).toBeDefined()
    expect(trashRequest).toBeDefined()
    if (!publicAssetsRequest || !trashRequest) throw new Error("expected drive list request schemas")

    expect(publicAssetsRequest.parse({ offset: 0, limit: 50, search: "logo" })).toEqual({ offset: 0, limit: 50, search: "logo" })
    expect(trashRequest.parse({ offset: 0, limit: 50, search: "old" })).toEqual({ offset: 0, limit: 50, search: "old" })
  })

  it("accepts Drive site list filters and routes site handlers", async () => {
    const listRequest = accountIpcModule.methods.listDriveSites.request
    expect(listRequest).toBeDefined()
    if (!listRequest) throw new Error("expected drive site list request schema")

    expect(listRequest.parse({ offset: 0, limit: 50, search: "原型", status: "active" })).toEqual({
      offset: 0,
      limit: 50,
      search: "原型",
      status: "active",
    })
    expect(listRequest.safeParse({ offset: 0, limit: 50, status: "unknown" }).success).toBe(false)

    await accountIpcModule.methods.preflightDriveSite.handler({} as IpcHandlerContext, { sourceFolderItemId: "folder-1" })
    await accountIpcModule.methods.createDriveSite.handler({} as IpcHandlerContext, {
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      entryPath: null,
      accessMode: "password",
      expiresIn: "3d",
    })
    await accountIpcModule.methods.updateDriveSiteAccess.handler({} as IpcHandlerContext, {
      siteId: "site_abc",
      accessMode: "password",
      expiresIn: "7d",
    })
    await accountIpcModule.methods.disableDriveSite.handler({} as IpcHandlerContext, { siteId: "site_abc" })
    await accountIpcModule.methods.enableDriveSite.handler({} as IpcHandlerContext, { siteId: "site_abc" })
    await accountIpcModule.methods.deleteDriveSite.handler({} as IpcHandlerContext, { siteId: "site_abc" })
    await accountIpcModule.methods.republishDriveSite.handler({} as IpcHandlerContext, { siteId: "site_abc", entryPath: "index.html" })

    expect(accountService.preflightDriveSite).toHaveBeenCalledWith({ sourceFolderItemId: "folder-1" })
    expect(accountService.createDriveSite).toHaveBeenCalledWith({
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      entryPath: null,
      accessMode: "password",
      expiresIn: "3d",
    })
    expect(accountService.updateDriveSiteAccess).toHaveBeenCalledWith({
      siteId: "site_abc",
      accessMode: "password",
      expiresIn: "7d",
    })
    expect(accountService.disableDriveSite).toHaveBeenCalledWith("site_abc")
    expect(accountService.enableDriveSite).toHaveBeenCalledWith("site_abc")
    expect(accountService.deleteDriveSite).toHaveBeenCalledWith("site_abc")
    expect(accountService.republishDriveSite).toHaveBeenCalledWith({ siteId: "site_abc", entryPath: "index.html" })
  })

  it("validates drive site response password fields", () => {
    const response = accountIpcModule.methods.createDriveSite.response
    if (!response) throw new Error("Expected drive site response schema")

    expect(response.parse({
      id: "site-row-1",
      siteId: "site_abc",
      name: "产品原型",
      status: "active",
      accessMode: "password",
      url: "https://synapse.test/sites/site_abc/",
      urlWithPassword: "https://synapse.test/sites/site_abc/?password=AbC234xy",
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-26T00:00:00.000Z",
      sourceFolderItemId: "folder-1",
      sourceFolderName: "产品原型",
      entryPath: "index.html",
      fileCount: 3,
      totalBytes: "128",
      createdAt: "2026-06-23T00:00:00.000Z",
      updatedAt: "2026-06-23T00:00:00.000Z",
      lastPublishedAt: "2026-06-23T00:00:00.000Z",
    })).toMatchObject({
      passwordEnabled: true,
      password: "AbC234xy",
      urlWithPassword: "https://synapse.test/sites/site_abc/?password=AbC234xy",
    })
  })

  it("returns owner drive item preview URLs", async () => {
    const handler = accountIpcModule.methods.getDriveItemPreviewUrl.handler

    await expect(handler({} as IpcHandlerContext, { itemId: "file-1" }))
      .resolves.toEqual({ url: "https://synapse.test/drive/items/file-1" })

    expect(accountService.getDriveItemPreviewUrl).toHaveBeenCalledWith("file-1")
  })

  it("guards local drive upload file reads and cloud writes", async () => {
    const uploadDriveLocalItems = vi.fn().mockResolvedValue({
      completed: 1,
      failed: 0,
      skipped: 0,
    })
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    vi.mocked(accountService.uploadDriveLocalItems).mockImplementation(uploadDriveLocalItems)

    const handler = accountIpcModule.methods.uploadDriveLocalItems.handler
    await expect(handler(ctx, {
      parentId: null,
      items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
    })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/report.txt",
      context: { source: "account.driveLocalUpload.read" },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "synapse-drive:local-upload",
      context: { source: "account.driveLocalUpload.write" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
    }))
  })

  it("forwards local drive upload task ids and emits progress events", async () => {
    const uploadDriveLocalItems = vi.fn(async (_request, options?: {
      readonly onProgress?: (event: {
        readonly type: "item-started"
        readonly taskId: string
        readonly itemKey: string
      }) => void
    }) => {
      options?.onProgress?.({ type: "item-started", taskId: "upload-task-1", itemKey: "item:0" })
      return { completed: 1, failed: 0, skipped: 0 }
    })
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const emitted: unknown[] = []
    const eventBus = { emit: vi.fn((event: unknown) => { emitted.push(event) }) }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        if (id === "core.event-bus") return eventBus
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    vi.mocked(accountService.uploadDriveLocalItems).mockImplementation(uploadDriveLocalItems)

    await expect(accountIpcModule.methods.uploadDriveLocalItems.handler(ctx, {
      taskId: "upload-task-1",
      parentId: null,
      items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
    })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

    expect(uploadDriveLocalItems).toHaveBeenCalledWith(
      {
        taskId: "upload-task-1",
        parentId: null,
        items: [{ kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: null }],
      },
      { onProgress: expect.any(Function) },
    )
    expect(emitted).toContainEqual(expect.objectContaining({
      domain: "account",
      type: "account.driveLocalUploadProgress",
      payload: { type: "item-started", taskId: "upload-task-1", itemKey: "item:0" },
    }))
    expect(JSON.stringify(emitted)).not.toContain("/tmp/report.txt")
    expect(emitted).toContainEqual(expect.objectContaining({
      domain: "account",
      type: "account.driveLocalUploadProgress",
      payload: { type: "task-finished", taskId: "upload-task-1", result: { completed: 1, failed: 0, skipped: 0 } },
    }))
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "account.driveLocalUploadProgress",
        payload: expect.objectContaining({ type: "item-started" }),
      }),
      { backpressure: "block" },
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "account.driveLocalUploadProgress",
        payload: expect.objectContaining({ type: "task-finished" }),
      }),
      { backpressure: "block" },
    )
  })

  it("checks every nested file path before local folder drive uploads", async () => {
    const uploadDriveLocalItems = vi.fn().mockResolvedValue({
      completed: 2,
      failed: 0,
      skipped: 0,
    })
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    vi.mocked(accountService.uploadDriveLocalItems).mockImplementation(uploadDriveLocalItems)

    await accountIpcModule.methods.uploadDriveLocalItems.handler(ctx, {
      parentId: "folder-1",
      items: [{
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: "/tmp/项目A/a.md", relativePath: "a.md", mimeType: "text/markdown" },
          { path: "/tmp/项目A/docs/b.md", relativePath: "docs/b.md", mimeType: null },
        ],
      }],
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/项目A/a.md",
      context: { source: "account.driveLocalUpload.read" },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/项目A/docs/b.md",
      context: { source: "account.driveLocalUpload.read" },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      resource: "synapse-drive:local-upload",
      context: { source: "account.driveLocalUpload.write" },
    }))
    expect(uploadDriveLocalItems).toHaveBeenCalledTimes(1)
  })

  it("guards prepared drive upload network requests and audits failures", async () => {
    const body = new ArrayBuffer(3)
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    const uploadDrivePreparedFile = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("upload failed token=sk-secret"))
    vi.mocked(accountService.uploadDrivePreparedFile).mockImplementation(uploadDrivePreparedFile)

    const request = {
      body,
      headers: {},
      method: "PUT" as const,
      url: "https://upload.example.test/object?token=sk-secret",
    }
    await expect(accountIpcModule.methods.uploadDrivePreparedFile.handler(ctx, request)).resolves.toEqual({ ok: true })
    await expect(accountIpcModule.methods.uploadDrivePreparedFile.handler(ctx, request)).rejects.toThrow("upload failed")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      actor: { kind: "user" },
      resource: "https://upload.example.test/object?token=%5Bredacted%5D",
      context: { source: "account.drivePreparedUpload.put" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "allowed",
      resource: "https://upload.example.test/object?token=%5Bredacted%5D",
      metadata: { source: "account.drivePreparedUpload.put" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      outcome: "failed",
      resource: "https://upload.example.test/object?token=%5Bredacted%5D",
      metadata: expect.objectContaining({
        source: "account.drivePreparedUpload.put",
        error: "upload failed token=[redacted]",
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("sk-secret")
  })

  it("stops prepared drive uploads when network permission is denied", async () => {
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "denied by test-policy",
        policyId: "test-policy",
      })),
    }
    const auditSink = { record: vi.fn() }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    const uploadDrivePreparedFile = vi.fn().mockResolvedValue({ ok: true })
    vi.mocked(accountService.uploadDrivePreparedFile).mockImplementation(uploadDrivePreparedFile)

    await expect(accountIpcModule.methods.uploadDrivePreparedFile.handler(ctx, {
      body: new ArrayBuffer(1),
      headers: {},
      method: "PUT",
      url: "https://upload.example.test/object",
    })).rejects.toThrow("denied by test-policy")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "network.connect",
      resource: "https://upload.example.test/object",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "account.drivePreparedUpload.put",
        reason: "denied by test-policy",
        policyId: "test-policy",
      }),
    }))
    expect(uploadDrivePreparedFile).not.toHaveBeenCalled()
  })

  it("stops local drive upload when file read permission is denied", async () => {
    const uploadDriveLocalItems = vi.fn().mockResolvedValue({
      completed: 1,
      failed: 0,
      skipped: 0,
    })
    const permissionGuard = {
      check: vi.fn(async () => ({
        allowed: false,
        reason: "denied by test-policy",
        policyId: "test-policy",
      })),
    }
    const auditSink = { record: vi.fn() }
    const ctx: IpcHandlerContext = {
      moduleId: "account",
      resolve: ((id: string) => {
        if (id === "core.permission-guard") return permissionGuard
        if (id === "core.audit-sink") return auditSink
        throw new Error(`unexpected service ${id}`)
      }) as IpcHandlerContext["resolve"],
    }
    vi.mocked(accountService.uploadDriveLocalItems).mockImplementation(uploadDriveLocalItems)

    await expect(accountIpcModule.methods.uploadDriveLocalItems.handler(ctx, {
      parentId: null,
      items: [{ kind: "file", path: "/tmp/blocked.txt", name: "blocked.txt", mimeType: null }],
    })).rejects.toThrow("denied by test-policy")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      resource: "/tmp/blocked.txt",
      outcome: "denied",
      metadata: expect.objectContaining({
        source: "account.driveLocalUpload.read",
        reason: "denied by test-policy",
        policyId: "test-policy",
      }),
    }))
    expect(permissionGuard.check).toHaveBeenCalledTimes(1)
    expect(uploadDriveLocalItems).not.toHaveBeenCalled()
  })

  it("guards public asset upload file reads", async () => {
    const { auditSink, ctx, permissionGuard } = createAccountSecurityContext()
    const uploadDrivePublicAssets = vi.mocked(accountService.uploadDrivePublicAssets)
    uploadDrivePublicAssets.mockResolvedValueOnce({ results: [] })

    await expect(accountIpcModule.methods.uploadDrivePublicAssets.handler(ctx, {
      files: [
        { path: "/tmp/logo.png", name: "logo.png", mimeType: "image/png" },
        { path: "/tmp/banner.webp", name: "banner.webp", mimeType: "image/webp" },
      ],
    })).resolves.toEqual({ results: [] })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/logo.png",
      context: { source: "account.drivePublicAssetUpload.read" },
    }))
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/banner.webp",
      context: { source: "account.drivePublicAssetUpload.read" },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "allowed",
      resource: "/tmp/logo.png",
    }))
    expect(uploadDrivePublicAssets).toHaveBeenCalledWith({
      files: [
        { path: "/tmp/logo.png", name: "logo.png", mimeType: "image/png" },
        { path: "/tmp/banner.webp", name: "banner.webp", mimeType: "image/webp" },
      ],
    })
  })

  it("accepts binary public asset uploads without file-system permission checks", async () => {
    const body = vm.runInNewContext("new ArrayBuffer(3)") as ArrayBuffer
    const requestSchema = accountIpcModule.methods.uploadDrivePublicAssetBinary.request
    expect(requestSchema).toBeDefined()
    if (!requestSchema) throw new Error("expected binary public asset upload request schema")

    expect(requestSchema.parse({
      name: "logo.png",
      mimeType: "image/png",
      data: body,
    })).toMatchObject({
      name: "logo.png",
      mimeType: "image/png",
      data: body,
    })

    const { ctx, permissionGuard } = createAccountSecurityContext()
    const uploadDrivePublicAssetBinary = vi.mocked(accountService.uploadDrivePublicAssetBinary)
    const asset = {
      assetId: "asset_123",
      itemId: "item-1",
      name: "logo.png",
      size: "3",
      mimeType: "image/png",
      url: "https://synapse.test/files/asset_123",
      lifecycleStatus: "active" as const,
      accessCount: "0",
      responseBytes: "0",
      lastAccessedAt: null,
      createdAt: "2026-06-26T00:00:00.000Z",
      updatedAt: "2026-06-26T00:00:00.000Z",
    }
    uploadDrivePublicAssetBinary.mockResolvedValueOnce(asset)

    await expect(accountIpcModule.methods.uploadDrivePublicAssetBinary.handler(ctx, {
      name: "logo.png",
      mimeType: "image/png",
      data: body,
    })).resolves.toEqual(asset)

    expect(uploadDrivePublicAssetBinary).toHaveBeenCalledWith({
      name: "logo.png",
      mimeType: "image/png",
      data: body,
    })
    expect(permissionGuard.check).not.toHaveBeenCalled()
  })

  it("routes document image source scan and import requests", async () => {
    const scanDriveDocumentImageSources = vi.mocked(accountService.scanDriveDocumentImageSources)
    const importDriveDocumentImages = vi.mocked(accountService.importDriveDocumentImages)
    scanDriveDocumentImageSources.mockResolvedValueOnce({
      itemId: "item-1",
      versionId: "version-1",
      canImport: true,
      sources: [],
      summary: {
        total: 0,
        ownerAsset: 0,
        collaboratorAsset: 0,
        external: 0,
        invalid: 0,
        unsupported: 0,
        importable: 0,
      },
    })
    importDriveDocumentImages.mockResolvedValueOnce({
      itemId: "item-1",
      versionId: "version-2",
      imported: [],
      failed: [],
      summary: {
        importedCount: 0,
        failedCount: 0,
        replacedOccurrenceCount: 0,
      },
    })

    await accountIpcModule.methods.scanDriveDocumentImageSources.handler({} as IpcHandlerContext, {
      kind: "share",
      shareId: "share-1",
      itemId: "item-2",
    })
    await accountIpcModule.methods.importDriveDocumentImages.handler({} as IpcHandlerContext, {
      kind: "owner",
      itemId: "item-1",
      baseVersionId: "version-1",
      sources: [{ src: "https://example.test/logo.png" }],
    })

    expect(scanDriveDocumentImageSources).toHaveBeenCalledWith({
      kind: "share",
      shareId: "share-1",
      itemId: "item-2",
    })
    expect(importDriveDocumentImages).toHaveBeenCalledWith({
      kind: "owner",
      itemId: "item-1",
      baseVersionId: "version-1",
      sources: [{ src: "https://example.test/logo.png" }],
    })
  })

  it("rejects invalid document image source contexts", () => {
    expect(accountIpcModule.methods.scanDriveDocumentImageSources.request?.safeParse({
      kind: "workspace",
      itemId: "item-1",
    }).success).toBe(false)
    expect(accountIpcModule.methods.importDriveDocumentImages.request?.safeParse({
      kind: "workspace",
      itemId: "item-1",
      baseVersionId: "version-1",
      sources: [],
    }).success).toBe(false)
    expect(accountIpcModule.methods.importDriveDocumentImages.request?.safeParse({
      kind: "share",
      itemId: "item-1",
      baseVersionId: "version-1",
      sources: [],
    }).success).toBe(false)
  })

  it("stops public asset replacement when file read permission is denied", async () => {
    const { auditSink, ctx, permissionGuard } = createAccountSecurityContext({
      allowed: false,
      reason: "denied by test-policy",
      policyId: "test-policy",
    })
    const replaceDrivePublicAssetFile = vi.mocked(accountService.replaceDrivePublicAssetFile)
    replaceDrivePublicAssetFile.mockClear()

    await expect(accountIpcModule.methods.replaceDrivePublicAssetFile.handler(ctx, {
      assetId: "asset_123",
      path: "/tmp/replacement.png",
      name: "replacement.png",
      mimeType: "image/png",
    })).rejects.toThrow("denied by test-policy")

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      actor: { kind: "user" },
      resource: "/tmp/replacement.png",
      context: {
        source: "account.drivePublicAssetReplace.read",
        assetId: "asset_123",
      },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.read.outside-userdata",
      outcome: "denied",
      resource: "/tmp/replacement.png",
      metadata: expect.objectContaining({
        source: "account.drivePublicAssetReplace.read",
        assetId: "asset_123",
        reason: "denied by test-policy",
        policyId: "test-policy",
      }),
    }))
    expect(replaceDrivePublicAssetFile).not.toHaveBeenCalled()
  })

  it("preserves active drive share ids in item responses", () => {
    const responseSchema = accountIpcModule.methods.listDriveItems.response
    expect(responseSchema).toBeDefined()
    if (!responseSchema) throw new Error("expected drive item list response schema")
    assertParseableSchema(responseSchema)

    const parsed = responseSchema.parse({
      items: [{
        id: "item-1",
        parentId: null,
        type: "file",
        name: "shared.txt",
        size: "12",
        mimeType: "text/plain",
        storageStatus: "active",
        shared: true,
        activeShareId: "share-1",
        createdAt: "2026-06-07T12:00:00.000Z",
        updatedAt: "2026-06-07T12:00:00.000Z",
      }],
      page: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
    }) as { readonly items: readonly unknown[] }
    expect(parsed.items).toEqual([
      expect.objectContaining({
        activeShareId: "share-1",
        shared: true,
      }),
    ])
  })

  it("accepts drive item list pagination input", async () => {
    const requestSchema = accountIpcModule.methods.listDriveItems.request
    expect(requestSchema).toBeDefined()
    if (!requestSchema) throw new Error("expected drive item list request schema")

    expect(requestSchema.parse({ parentId: "folder-1", offset: 100, limit: 50 })).toEqual({
      parentId: "folder-1",
      offset: 100,
      limit: 50,
    })

    await accountIpcModule.methods.listDriveItems.handler({} as IpcHandlerContext, {
      parentId: "folder-1",
      offset: 100,
      limit: 50,
    })

    expect(accountService.listDriveItemsPage).toHaveBeenCalledWith({
      parentId: "folder-1",
      offset: 100,
      limit: 50,
    })
  })

  it("passes drive access settings through share handlers", async () => {
    await accountIpcModule.methods.shareDriveItem.handler({} as IpcHandlerContext, {
      itemId: "item-1",
      passwordEnabled: false,
      expiresIn: "30d",
      accessMode: "specified_users_edit",
      editorEmails: ["writer@example.com"],
    })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      passwordEnabled: false,
      expiresIn: "30d",
      accessMode: "specified_users_edit",
      editorEmails: ["writer@example.com"],
    })
  })

  it("passes drive share detail requests through handlers", async () => {
    await accountIpcModule.methods.getDriveShare.handler({} as IpcHandlerContext, {
      shareId: "share-row-1",
    })

    expect(accountService.getDriveShare).toHaveBeenCalledWith("share-row-1")
  })

  it("passes drive file version requests through handlers", async () => {
    const { ctx } = createAccountSecurityContext()

    await accountIpcModule.methods.listDriveFileVersions.handler({} as IpcHandlerContext, {
      itemId: "item-1",
      offset: 10,
      limit: 5,
    })
    await accountIpcModule.methods.downloadDriveFileVersion.handler(ctx, {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })
    await accountIpcModule.methods.restoreDriveFileVersion.handler({} as IpcHandlerContext, {
      itemId: "item-1",
      versionId: "version-1",
    })
    await accountIpcModule.methods.deleteDriveFileVersion.handler({} as IpcHandlerContext, {
      itemId: "item-1",
      versionId: "version-1",
    })
    await accountIpcModule.methods.updateDriveFileVersionPin.handler({} as IpcHandlerContext, {
      itemId: "item-1",
      versionId: "version-1",
      isPinned: true,
    })

    expect(accountService.listDriveFileVersions).toHaveBeenCalledWith("item-1", { offset: 10, limit: 5 })
    expect(accountService.downloadDriveFileVersion).toHaveBeenCalledWith({
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })
    expect(accountService.restoreDriveFileVersion).toHaveBeenCalledWith("item-1", "version-1")
    expect(accountService.deleteDriveFileVersion).toHaveBeenCalledWith("item-1", "version-1")
    expect(accountService.updateDriveFileVersionPin).toHaveBeenCalledWith("item-1", "version-1", true)
  })

  it("guards drive file version downloads with fs write permission and audit", async () => {
    const { auditSink, ctx, permissionGuard } = createAccountSecurityContext()

    await accountIpcModule.methods.downloadDriveFileVersion.handler(ctx, {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "/tmp/report-v1.md",
      context: {
        source: "account.driveFileVersionDownload.write",
        itemId: "item-1",
        versionId: "version-1",
      },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/tmp/report-v1.md",
      metadata: {
        source: "account.driveFileVersionDownload.write",
        itemId: "item-1",
        versionId: "version-1",
      },
    }))
    expect(accountService.downloadDriveFileVersion).toHaveBeenCalledWith({
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })
  })

  it("stops drive file version downloads when fs write permission is denied", async () => {
    const { auditSink, ctx } = createAccountSecurityContext({
      allowed: false,
      reason: "denied by test-policy",
      policyId: "test-policy",
    })
    vi.mocked(accountService.downloadDriveFileVersion).mockClear()

    await expect(accountIpcModule.methods.downloadDriveFileVersion.handler(ctx, {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })).rejects.toThrow("denied by test-policy")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "denied",
      resource: "/tmp/report-v1.md",
      metadata: expect.objectContaining({
        source: "account.driveFileVersionDownload.write",
        itemId: "item-1",
        versionId: "version-1",
        reason: "denied by test-policy",
        policyId: "test-policy",
      }),
    }))
    expect(accountService.downloadDriveFileVersion).not.toHaveBeenCalled()
  })

  it("audits failed drive file version downloads without leaking secrets", async () => {
    const { auditSink, ctx } = createAccountSecurityContext()
    vi.mocked(accountService.downloadDriveFileVersion).mockClear()
    vi.mocked(accountService.downloadDriveFileVersion).mockRejectedValueOnce(new Error("write failed token=sk-secret"))

    await expect(accountIpcModule.methods.downloadDriveFileVersion.handler(ctx, {
      itemId: "item-1",
      versionId: "version-1",
      outputPath: "/tmp/report-v1.md",
    })).rejects.toThrow("write failed")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "failed",
      resource: "/tmp/report-v1.md",
      metadata: expect.objectContaining({
        source: "account.driveFileVersionDownload.write",
        itemId: "item-1",
        versionId: "version-1",
        error: "write failed token=[redacted]",
      }),
    }))
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("sk-secret")
  })

  it("guards drive link materialize cache writes with fs write permission and audit", async () => {
    const { auditSink, ctx, permissionGuard } = createAccountSecurityContext()
    vi.mocked(accountService.materializeDriveLink).mockClear()
    vi.mocked(accountService.materializeDriveLink).mockResolvedValueOnce({
      localRootPath: "/tmp/intake",
      manifestPath: "/tmp/intake/manifest.json",
      entryPath: "/tmp/intake/content/index.html",
      files: [{ relativePath: "index.html", kind: "html", size: "12" }],
      skipped: [],
      warnings: [],
    })

    await accountIpcModule.methods.materializeDriveLink.handler(ctx, {
      url: "https://synapse.test/share/shr_123?password=secret-token",
      password: "secret-password",
      scope: "all",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "synapse-drive:link-intake-cache",
      context: {
        source: "account.driveLinkMaterialize.write",
        url: "https://synapse.test/share/shr_123?password=%5Bredacted%5D",
        scope: "all",
      },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/tmp/intake",
      metadata: expect.objectContaining({
        source: "account.driveLinkMaterialize.write",
        manifestPath: "/tmp/intake/manifest.json",
        entryPath: "/tmp/intake/content/index.html",
        fileCount: 1,
      }),
    }))
    expect(JSON.stringify(permissionGuard.check.mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(permissionGuard.check.mock.calls)).not.toContain("secret-password")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-password")
  })

  it("stops drive link materialize when cache write permission is denied", async () => {
    const { auditSink, ctx } = createAccountSecurityContext({
      allowed: false,
      reason: "denied by test-policy",
      policyId: "test-policy",
    })
    vi.mocked(accountService.materializeDriveLink).mockClear()

    await expect(accountIpcModule.methods.materializeDriveLink.handler(ctx, {
      url: "https://synapse.test/share/shr_123",
      scope: "text",
    })).rejects.toThrow("denied by test-policy")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "denied",
      resource: "synapse-drive:link-intake-cache",
      metadata: expect.objectContaining({
        source: "account.driveLinkMaterialize.write",
        reason: "denied by test-policy",
        policyId: "test-policy",
      }),
    }))
    expect(accountService.materializeDriveLink).not.toHaveBeenCalled()
  })

  it("guards default drive link downloads with cache write permission and audit", async () => {
    const { auditSink, ctx, permissionGuard } = createAccountSecurityContext()
    vi.mocked(accountService.downloadDriveLinkFile).mockClear()
    vi.mocked(accountService.downloadDriveLinkFile).mockResolvedValueOnce({
      localPath: "/tmp/intake/content/download",
      mimeType: "text/markdown",
      size: "12",
    })

    await accountIpcModule.methods.downloadDriveLinkFile.handler(ctx, {
      url: "https://synapse.test/share/shr_123?password=secret-token",
      password: "secret-password",
      path: "docs/report.md",
    })

    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      actor: { kind: "user" },
      resource: "synapse-drive:link-intake-cache",
      context: {
        source: "account.driveLinkDownload.write",
        url: "https://synapse.test/share/shr_123?password=%5Bredacted%5D",
        path: "docs/report.md",
        itemId: null,
      },
    }))
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "allowed",
      resource: "/tmp/intake/content/download",
      metadata: expect.objectContaining({
        source: "account.driveLinkDownload.write",
        localPath: "/tmp/intake/content/download",
        size: "12",
      }),
    }))
    expect(JSON.stringify(permissionGuard.check.mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(permissionGuard.check.mock.calls)).not.toContain("secret-password")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("secret-password")
  })

  it("stops default drive link downloads when cache write permission is denied", async () => {
    const { auditSink, ctx } = createAccountSecurityContext({
      allowed: false,
      reason: "denied by test-policy",
      policyId: "test-policy",
    })
    vi.mocked(accountService.downloadDriveLinkFile).mockClear()

    await expect(accountIpcModule.methods.downloadDriveLinkFile.handler(ctx, {
      url: "https://synapse.test/share/shr_123",
    })).rejects.toThrow("denied by test-policy")

    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "fs.write",
      outcome: "denied",
      resource: "synapse-drive:link-intake-cache",
      metadata: expect.objectContaining({
        source: "account.driveLinkDownload.write",
        reason: "denied by test-policy",
        policyId: "test-policy",
      }),
    }))
    expect(accountService.downloadDriveLinkFile).not.toHaveBeenCalled()
  })

  it("validates drive share bridge schemas", () => {
    expect(accountIpcModule.methods.shareDriveItem.request?.parse({
      itemId: "share-1",
      passwordEnabled: false,
      expiresIn: "3d",
      accessMode: "link_edit",
    })).toEqual({
      itemId: "share-1",
      passwordEnabled: false,
      expiresIn: "3d",
      accessMode: "link_edit",
    })
    expect(() => accountIpcModule.methods.shareDriveItem.request?.parse({
      itemId: "share-1",
      passwordEnabled: true,
      expiresIn: "14d",
    })).toThrow()
    expect(accountIpcModule.methods.deleteDriveItem.request?.parse({
      itemId: "item-1",
    })).toEqual({ itemId: "item-1" })
    const listDriveSharesResponse = accountIpcModule.methods.listDriveShares.response
    if (!listDriveSharesResponse) {
      throw new Error("Expected drive IPC response schemas to be registered")
    }

    expect(listDriveSharesResponse.parse({
      items: [{
      id: "share-row-1",
      shareId: "share_public",
      itemId: "item-1",
      itemName: "report.html",
      itemType: "file",
      sourceDeleted: false,
      url: "https://synapse.test/share/share_public",
      urlWithPassword: "https://synapse.test/share/share_public?password=AbC234xy",
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-16T00:00:00.000Z",
      accessMode: "link_read",
      editorEmails: [],
      createdAt: "2026-06-09T00:00:00.000Z",
      }],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })).toEqual({
      items: [
        expect.objectContaining({
          itemName: "report.html",
          itemType: "file",
          shareId: "share_public",
        }),
      ],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    const listDriveFileVersionsResponse = accountIpcModule.methods.listDriveFileVersions.response
    if (!listDriveFileVersionsResponse) {
      throw new Error("Expected drive file version IPC response schema to be registered")
    }
    expect(listDriveFileVersionsResponse.parse({
      items: [{
        id: "version-1",
        itemId: "item-1",
        versionNumber: 1,
        size: "4",
        mimeType: "text/plain",
        source: "upload",
        isCurrent: true,
        isPinned: false,
        deletePending: false,
        restoredFromVersionId: null,
        createdAt: "2026-06-09T00:00:00.000Z",
        createdBy: "user-1",
      }],
      total: 1,
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })).toEqual({
      items: [expect.objectContaining({ id: "version-1", versionNumber: 1 })],
      total: 1,
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
  })

  it("validates offline authenticated account events", () => {
    const parsed = accountIpcModule.events.stateChanged.payload.parse({
      domain: "account",
      type: "account.stateChanged",
      payload: {
        state: {
          status: "authenticated",
          connectivity: "offline",
          offlineReason: "server_unavailable",
          retry: { attempt: 1, nextRetryAt: "2026-06-06T00:00:10.000Z" },
          profile: {
            user: { id: "u1", email: "u@example.com", handle: "ada", status: "active" },
            teams: [],
            syncedAt: "2026-06-06T00:00:00.000Z",
          },
        },
      },
      timestamp: "2026-06-06T00:00:00.000Z",
    })

    expect(parsed).toMatchObject({
      payload: {
        state: {
          status: "authenticated",
          connectivity: "offline",
          offlineReason: "server_unavailable",
        },
      },
    })
  })
})
