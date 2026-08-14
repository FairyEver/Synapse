import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import type { PrismaService } from "../prisma/prisma.service"
import { DriveChangeLogService } from "./drive-change-log"
import { LocalDriveCollaborationBus } from "./drive-collaboration-bus"
import {
  DriveCollaborationService,
  type DriveCollaborationAccess,
  type DriveCollaborationConnection,
} from "./drive-collaboration.service"
import type { DriveMarkdownProjectionService } from "./drive-markdown-projection.service"
import type { DriveStoragePort } from "./drive-storage"

const originalEnv = {
  databaseUrl: process.env.DATABASE_URL,
  adminAccessSecret: process.env.ADMIN_ACCESS_SECRET,
  userAccessJwtSecret: process.env.USER_ACCESS_JWT_SECRET,
  collaborationEnabled: process.env.DRIVE_COLLABORATION_ENABLED,
}

afterEach(() => {
  restoreEnv("DATABASE_URL", originalEnv.databaseUrl)
  restoreEnv("ADMIN_ACCESS_SECRET", originalEnv.adminAccessSecret)
  restoreEnv("USER_ACCESS_JWT_SECRET", originalEnv.userAccessJwtSecret)
  restoreEnv("DRIVE_COLLABORATION_ENABLED", originalEnv.collaborationEnabled)
})

describe("DriveCollaborationService", () => {
  it("refuses an old epoch before registering the connection", async () => {
    const { service, connection } = createService()

    const joined = await service.join(access, connection, "epoch-old")

    expect(joined).toMatchObject({
      accepted: false,
      epoch: "epoch-current",
      checkpointVersionId: "version-1",
    })
    service.leave("item-1", connection)
    expect(connection.sendControl).not.toHaveBeenCalled()
  })

  it("restores writers when an external replacement is cancelled", async () => {
    const { service, connection } = createService()
    const joined = await service.join(access, connection, null)
    expect(joined.accepted).toBe(true)
    const internal = service as unknown as {
      readonly rooms: Map<string, { acceptingWrites: boolean }>
    }
    internal.rooms.get("item-1")!.acceptingWrites = false

    service.resumeExternalChange("item-1")

    expect(internal.rooms.get("item-1")?.acceptingWrites).toBe(true)
    expect(connection.sendControl).toHaveBeenCalledWith({
      type: "permission_changed",
      canWrite: true,
      reason: "external_change_cancelled",
    })
  })

  it("commits the replacement epoch through the caller transaction before closing the room", async () => {
    const { service, connection, transaction } = createService()
    await service.join(access, connection, null)

    const epoch = await service.replaceEpochInTransaction(
      transaction as never,
      "item-1",
      "version-2",
    )
    service.finalizeExternalChange("item-1", epoch, "version-2")

    expect(transaction.driveCollaborationDocument.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "item-1" },
      update: expect.objectContaining({ checkpointVersionId: "version-2", epoch }),
    }))
    expect(connection.sendControl).toHaveBeenCalledWith({ type: "epoch_replaced", epoch, checkpointVersionId: "version-2" })
    expect(connection.close).toHaveBeenCalledWith(1012, "epoch_replaced")
    expect(service.getRoomDocument("item-1")).toBeNull()
  })

  it("always discards the old room when a connection notification fails", async () => {
    const { service, connection } = createService()
    await service.join(access, connection, null)
    vi.mocked(connection.sendControl).mockImplementationOnce(() => {
      throw new Error("socket closed")
    })

    expect(() => service.finalizeExternalChange("item-1", "epoch-next", "version-2")).not.toThrow()
    expect(service.getRoomDocument("item-1")).toBeNull()
    expect(connection.close).toHaveBeenCalledWith(1012, "epoch_replaced")
  })

  it("does not count the server room document as an online collaborator", async () => {
    const { service, connection } = createService()

    await service.join(access, connection, null)

    expect(service.getRoomAwareness("item-1")?.getStates().size).toBe(0)
  })

  it("keeps a replacement connection when the superseded socket closes later", async () => {
    const { service, connection } = createService()
    const replacement = {
      ...connection,
      sendUpdate: vi.fn(),
      sendAwareness: vi.fn(),
      sendControl: vi.fn(),
      close: vi.fn(),
    }

    await service.join(access, connection, null)
    await service.join(access, replacement, null)
    service.leave("item-1", connection)

    const internal = service as unknown as {
      readonly rooms: Map<string, { connections: Map<string, DriveCollaborationConnection> }>
    }
    expect(connection.close).toHaveBeenCalledWith(1000, "superseded")
    expect(internal.rooms.get("item-1")?.connections.get(connection.clientId)).toBe(replacement)
  })

  it("renders standalone Markdown images safely when loading a collaboration room", async () => {
    const source = [
      "# Notes",
      "",
      String.raw`<img src="..\assets\图片.webp" alt="Preview" width="320" onerror="alert(1)" style="color:red" srcset="private">`,
      "",
      '<img src="javascript:alert(1)" alt="Unsafe">',
      "",
      String.raw`<div><img src="..\assets\nested.webp"></div>`,
      "",
      "<script>alert(1)</script>",
    ].join("\n")
    const { service, connection } = createService(source)

    await service.join(access, connection, null)

    const html = service.getRoomPreview("item-1")?.html ?? ""
    expect(html).toMatch(/<img(?=[^>]*alt="Preview")(?=[^>]*data-drive-markdown-relative-src=)(?![^>]*\ssrc=)[^>]*>/u)
    expect(html).toContain('width="320"')
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("style=")
    expect(html).not.toContain("srcset=")
    expect(html).toMatch(/<img alt="Unsafe">/u)
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("<div><img")
    expect(html).not.toContain("<script>")
  })

  it("keeps standalone Markdown images safe in realtime collaboration previews", async () => {
    vi.useFakeTimers()
    try {
      const { service, connection } = createService()
      const joined = await service.join(access, connection, null)
      const clientDocument = new Y.Doc()
      Y.applyUpdate(clientDocument, Y.encodeStateAsUpdate(joined.doc))
      const before = Y.encodeStateVector(clientDocument)
      const text = clientDocument.getText("content")
      text.insert(text.length, `\n\n${String.raw`<img src="..\assets\live.webp" alt="Live">`}`)

      await service.applyClientUpdate(
        "item-1",
        connection.clientId,
        Y.encodeStateAsUpdate(clientDocument, before),
      )
      await vi.advanceTimersByTimeAsync(600)

      expect(service.getRoomPreview("item-1")?.html).toMatch(
        /<img(?=[^>]*alt="Live")(?=[^>]*data-drive-markdown-relative-src=)(?![^>]*\ssrc=)[^>]*>/u,
      )
      clientDocument.destroy()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("retries an object-storage failure without dropping the pending update", async () => {
    vi.useFakeTimers()
    try {
      const { service, connection, storage } = createService()
      vi.mocked(storage.putObject)
        .mockRejectedValueOnce(new Error("temporary storage failure"))
        .mockResolvedValue(undefined)
      await service.join(access, connection, null)
      const clientDocument = new Y.Doc()
      clientDocument.getText("content").insert(0, "retry-safe")

      await service.applyClientUpdate("item-1", connection.clientId, Y.encodeStateAsUpdate(clientDocument))
      await vi.advanceTimersByTimeAsync(251)

      expect(storage.putObject).toHaveBeenCalledTimes(1)
      expect(connection.sendControl).not.toHaveBeenCalledWith(expect.objectContaining({ type: "durable_ack" }))

      await vi.advanceTimersByTimeAsync(1_001)

      expect(storage.putObject).toHaveBeenCalledTimes(2)
      expect(connection.sendControl).toHaveBeenCalledWith(expect.objectContaining({ type: "durable_ack" }))
      expect(connection.close).not.toHaveBeenCalled()
      clientDocument.destroy()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it("bounds shutdown persistence when object storage does not respond", async () => {
    vi.useFakeTimers()
    try {
      const { service, connection, storage } = createService()
      vi.mocked(storage.putObject).mockImplementation(async () => new Promise<void>(() => undefined))
      await service.join(access, connection, null)
      const clientDocument = new Y.Doc()
      clientDocument.getText("content").insert(0, "pending-shutdown")
      await service.applyClientUpdate("item-1", connection.clientId, Y.encodeStateAsUpdate(clientDocument))

      const shutdown = service.onApplicationShutdown()
      await vi.advanceTimersByTimeAsync(10_001)
      await shutdown

      expect(connection.close).toHaveBeenCalledWith(1012, "server_shutdown")
      clientDocument.destroy()
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })
})

const access: DriveCollaborationAccess = {
  itemId: "item-1",
  ownerId: "owner-1",
  itemName: "notes.md",
  mimeType: "text/markdown",
  canWrite: true,
  userId: "user-1",
}

function createService(source = "# Notes") {
  process.env.DATABASE_URL = "postgresql://synapse:synapse@localhost:5432/synapse"
  process.env.ADMIN_ACCESS_SECRET = "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A"
  process.env.USER_ACCESS_JWT_SECRET = "user-access-secret-with-enough-length-32chars"
  process.env.DRIVE_COLLABORATION_ENABLED = "true"
  const document = {
    itemId: "item-1",
    epoch: "epoch-current",
    checkpointVersionId: "version-1",
    snapshotStorageKey: null,
    snapshotSha256: null,
    durableSequence: 0n,
    checkpointSequence: 0n,
    reservedBytes: 0n,
  }
  const transaction = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 1),
    driveCollaborationDocument: {
      findUnique: vi.fn(async () => document),
      upsert: vi.fn(async () => document),
      update: vi.fn(async (input: { readonly data: { readonly durableSequence?: bigint; readonly reservedBytes?: bigint } }) => {
        if (input.data.durableSequence !== undefined) document.durableSequence = input.data.durableSequence
        if (input.data.reservedBytes !== undefined) document.reservedBytes = input.data.reservedBytes
        return document
      }),
    },
    driveCollaborationSegment: {
      create: vi.fn(async () => undefined),
    },
    driveUsage: {
      upsert: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
    },
  }
  const prisma = {
    $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
    driveItem: {
      findFirst: vi.fn(async () => ({
        id: "item-1",
        userId: "owner-1",
        name: "notes.md",
        mimeType: "text/markdown",
        storageKey: "drive/item-1/version-1",
      })),
    },
    driveFileVersion: {
      findFirst: vi.fn(async () => ({ id: "version-1", storageKey: "drive/item-1/version-1" })),
    },
    driveCollaborationDocument: {
      findUniqueOrThrow: vi.fn(async () => document),
      findUnique: vi.fn(async () => document),
    },
    driveCollaborationSegment: {
      findMany: vi.fn(async () => []),
    },
  }
  const storage: DriveStoragePort = {
    createUploadInstruction: vi.fn(),
    createDownloadUrl: vi.fn(),
    headObject: vi.fn(),
    putObject: vi.fn(),
    copyObject: vi.fn(),
    getObjectStream: vi.fn(async () => ({
      stream: Readable.from(source),
      size: BigInt(Buffer.byteLength(source, "utf8")),
      contentType: "text/markdown",
    })),
    deleteObject: vi.fn(),
  }
  const projections = {
    load: vi.fn(async () => null),
    persist: vi.fn(async () => undefined),
  }
  const connection: DriveCollaborationConnection = {
    clientId: "client-1",
    userId: "user-1",
    canWrite: true,
    sendUpdate: vi.fn(),
    sendAwareness: vi.fn(),
    sendControl: vi.fn(),
    close: vi.fn(),
    revalidate: vi.fn(async () => true),
  }
  const service = new DriveCollaborationService(
    prisma as unknown as PrismaService,
    storage,
    projections as unknown as DriveMarkdownProjectionService,
    new LocalDriveCollaborationBus(),
    { append: vi.fn() } as unknown as DriveChangeLogService,
  )
  return { service, connection, storage, transaction }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
