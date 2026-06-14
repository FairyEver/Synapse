import { describe, expect, it } from "vitest"
import { vi } from "vitest"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
import { DRIVE_LOCAL_UPLOAD_MAX_FILES } from "../../../../src/lib/drive-local-upload-limits"

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
    shareDriveItem: vi.fn(async () => ({})),
    disableDriveShare: async () => ({ ok: true }),
    getDriveUsage: async () => ({}),
    listDrivePublications: async () => [],
    publishDrivePage: vi.fn(async () => ({})),
    publishDriveSite: vi.fn(async () => ({})),
    redeployDrivePublication: async () => ({}),
    disableDrivePublication: async () => ({ ok: true }),
    getDriveDeleteImpact: async () => ({ publications: [] }),
    listDriveShares: async () => [],
  },
}))

import { accountService } from "../../../services/account-service"
import { accountIpcModule } from "../ipc"

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
            user: { id: "u1", email: "u@example.com", displayName: "Ada", status: "active" },
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
              displayName: "Ada",
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
        { kind: "file", path: "/tmp/report.txt", name: "report.txt", mimeType: "text/plain" },
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
        { kind: "file", name: "report.txt" },
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

  it("preserves active drive share ids in item responses", () => {
    const responseSchema = accountIpcModule.methods.listDriveItems.response
    expect(responseSchema).toBeDefined()
    if (!responseSchema) throw new Error("expected drive item list response schema")

    expect(responseSchema.parse([{
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
    }])).toEqual([
      expect.objectContaining({
        activeShareId: "share-1",
        shared: true,
      }),
    ])
  })

  it("passes drive access settings through share and publication handlers", async () => {
    await accountIpcModule.methods.shareDriveItem.handler({} as IpcHandlerContext, {
      itemId: "item-1",
      passwordEnabled: false,
      expiresIn: "30d",
    })
    await accountIpcModule.methods.publishDrivePage.handler({} as IpcHandlerContext, {
      itemId: "page-1",
      passwordEnabled: true,
      expiresIn: "1y",
    })
    await accountIpcModule.methods.publishDriveSite.handler({} as IpcHandlerContext, {
      itemId: "site-1",
      passwordEnabled: true,
      expiresIn: "forever",
    })

    expect(accountService.shareDriveItem).toHaveBeenCalledWith("item-1", {
      passwordEnabled: false,
      expiresIn: "30d",
    })
    expect(accountService.publishDrivePage).toHaveBeenCalledWith("page-1", {
      passwordEnabled: true,
      expiresIn: "1y",
    })
    expect(accountService.publishDriveSite).toHaveBeenCalledWith("site-1", {
      passwordEnabled: true,
      expiresIn: "forever",
    })
  })

  it("validates drive publication and share bridge schemas", () => {
    expect(accountIpcModule.methods.shareDriveItem.request?.parse({
      itemId: "share-1",
      passwordEnabled: false,
      expiresIn: "3d",
    })).toEqual({
      itemId: "share-1",
      passwordEnabled: false,
      expiresIn: "3d",
    })
    expect(accountIpcModule.methods.publishDrivePage.request?.parse({
      itemId: "item-1",
      passwordEnabled: true,
      expiresIn: "1y",
    })).toEqual({
      itemId: "item-1",
      passwordEnabled: true,
      expiresIn: "1y",
    })
    expect(accountIpcModule.methods.publishDriveSite.request?.parse({
      itemId: "folder-1",
      passwordEnabled: true,
      expiresIn: "forever",
    })).toEqual({
      itemId: "folder-1",
      passwordEnabled: true,
      expiresIn: "forever",
    })
    expect(() => accountIpcModule.methods.shareDriveItem.request?.parse({
      itemId: "share-1",
      passwordEnabled: true,
      expiresIn: "14d",
    })).toThrow()
    expect(accountIpcModule.methods.redeployDrivePublication.request?.parse({ publicationId: "pub-row-1" }))
      .toEqual({ publicationId: "pub-row-1" })
    expect(accountIpcModule.methods.disableDrivePublication.request?.parse({ publicationId: "pub-row-1" }))
      .toEqual({ publicationId: "pub-row-1" })
    expect(accountIpcModule.methods.getDriveDeleteImpact.request?.parse({ itemId: "item-1" }))
      .toEqual({ itemId: "item-1" })
    expect(accountIpcModule.methods.deleteDriveItem.request?.parse({
      itemId: "item-1",
      disablePublications: true,
    })).toEqual({ itemId: "item-1", disablePublications: true })
    const listDrivePublicationsResponse = accountIpcModule.methods.listDrivePublications.response
    const getDriveDeleteImpactResponse = accountIpcModule.methods.getDriveDeleteImpact.response
    const listDriveSharesResponse = accountIpcModule.methods.listDriveShares.response
    if (!listDrivePublicationsResponse || !getDriveDeleteImpactResponse || !listDriveSharesResponse) {
      throw new Error("Expected drive IPC response schemas to be registered")
    }

    const publication = {
      id: "pub-row-1",
      publishId: "pub_public",
      type: "page",
      name: "report.html",
      status: "active",
      sourceItemId: "item-1",
      sourceDeleted: false,
      url: "https://synapse.test/pages/pub_public",
      urlWithPassword: "https://synapse.test/pages/pub_public?password=AbC234xy",
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-16T00:00:00.000Z",
      currentDeploymentId: "dep-1",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    }
    expect(listDrivePublicationsResponse.parse([publication]))
      .toEqual([publication])
    expect(getDriveDeleteImpactResponse.parse({ publications: [publication] }))
      .toEqual({ publications: [publication] })
    expect(listDriveSharesResponse.parse([{
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
      createdAt: "2026-06-09T00:00:00.000Z",
    }])).toEqual([
      expect.objectContaining({
        itemName: "report.html",
        itemType: "file",
        shareId: "share_public",
      }),
    ])
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
            user: { id: "u1", email: "u@example.com", displayName: "Ada", status: "active" },
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
