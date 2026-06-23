import { ConflictException, ForbiddenException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DriveAnnotationService } from "./drive-annotation.service"

describe("DriveAnnotationService", () => {
  const prisma = createPrismaMock()
  const drive = createDriveServiceMock()
  const service = new DriveAnnotationService(prisma as never, drive as never)

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.driveItem.findFirst.mockResolvedValue(markdownItem())
    prisma.driveFileVersion.findFirst.mockResolvedValue({ id: "version-1" })
    prisma.driveAnnotationThread.findMany.mockResolvedValue([threadRecord()])
    prisma.driveAnnotationThread.findFirst.mockResolvedValue(threadRecord())
    prisma.driveAnnotationThread.create.mockResolvedValue(threadRecord())
    prisma.driveAnnotationThread.update.mockResolvedValue({ ...threadRecord(), deletedAt: new Date("2026-06-21T00:00:00.000Z") })
    prisma.driveAnnotationComment.create.mockResolvedValue(commentRecord({ createdByUserId: "owner-1" }))
    prisma.driveAnnotationComment.findFirst.mockResolvedValue(commentRecord())
    prisma.driveAnnotationComment.update.mockResolvedValue(commentRecord({ body: "updated", createdByUserId: "owner-1" }))
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot())
  })

  it("lists visible owner annotations with author metadata and permissions", async () => {
    const result = await service.listOwnerAnnotations("owner-1", "item-1")

    expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "item-1", userId: "owner-1" }),
    }))
    expect(result[0]?.comments[0]?.author.email).toBe("reader-1@example.com")
    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: false })
    expect(result[0]?.permissions.canDelete).toBe(true)
  })

  it("creates a thread plus first comment for .md files", async () => {
    const result = await service.createOwnerAnnotation("owner-1", "item-1", createInput({ baseVersionId: "version-1" }))

    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        itemId: "item-1",
        baseVersionId: "version-1",
        createdByUserId: "owner-1",
        comments: { create: expect.objectContaining({ body: "Comment body" }) },
      }),
    }))
    expect(result.id).toBe("thread-1")
  })

  it("rejects owner annotation creation when the preview version is stale", async () => {
    prisma.driveFileVersion.findFirst.mockResolvedValueOnce({ id: "version-2" })

    await expect(service.createOwnerAnnotation("owner-1", "item-1", createInput({ baseVersionId: "version-1" })))
      .rejects.toBeInstanceOf(ConflictException)

    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("rejects comment creation for unsupported file names", async () => {
    prisma.driveItem.findFirst.mockResolvedValueOnce({ ...markdownItem(), name: "notes.mdx" })

    await expect(service.createOwnerAnnotation("owner-1", "item-1", createInput()))
      .rejects.toThrow("该文件暂不支持评论。")
  })

  it("allows authors to edit their own comments", async () => {
    const ownComment = commentRecord({ createdByUserId: "owner-1" })
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(ownComment)
    prisma.driveAnnotationComment.update.mockResolvedValueOnce({ ...ownComment, body: "updated" })

    const result = await service.updateOwnerComment("owner-1", "item-1", "comment-1", { body: "updated" })

    expect(result.body).toBe("updated")
    expect(prisma.driveAnnotationComment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "comment-1" },
      data: expect.objectContaining({ body: "updated", editedAt: expect.any(Date) }),
    }))
  })

  it("rejects editing another user's comment", async () => {
    await expect(service.updateOwnerComment("owner-1", "item-1", "comment-1", { body: "updated" }))
      .rejects.toBeInstanceOf(ForbiddenException)
  })

  it("allows authors to delete their own comments", async () => {
    const ownComment = commentRecord({ createdByUserId: "owner-1" })
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(ownComment)

    await service.deleteOwnerComment("owner-1", "item-1", "comment-1")

    expect(prisma.driveAnnotationComment.update).toHaveBeenCalledWith({
      where: { id: "comment-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("rejects file owners deleting another user's single comment", async () => {
    await expect(service.deleteOwnerComment("owner-1", "item-1", "comment-1"))
      .rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.driveAnnotationComment.update).not.toHaveBeenCalled()
  })

  it("lets the file owner delete any thread", async () => {
    await service.deleteOwnerThread("owner-1", "item-1", "thread-1")

    expect(prisma.driveAnnotationThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("uses writable share browser visibility for share annotations", async () => {
    prisma.driveFileVersion.findFirst.mockResolvedValueOnce({ id: "version-1" })

    await service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      body: createInput({ baseVersionId: "version-1" }),
    })

    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      actorUserId: "reader-1",
    }))
    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ createdByUserId: "reader-1" }),
    }))
  })

  it("rejects share annotation creation when the preview version is stale", async () => {
    prisma.driveFileVersion.findFirst.mockResolvedValueOnce({ id: "version-2" })

    await expect(service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      body: createInput({ baseVersionId: "version-1" }),
    })).rejects.toBeInstanceOf(ConflictException)

    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("rejects share annotation writes when the share cannot be edited", async () => {
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot({ canEdit: false }))

    await expect(service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      body: createInput(),
    })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.replyShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
      body: { body: "Reply body" },
    })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.updateShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
      body: { body: "updated" },
    })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.deleteShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
    })).rejects.toBeInstanceOf(ForbiddenException)
    await expect(service.deleteShareThread({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
    })).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
    expect(prisma.driveAnnotationComment.create).not.toHaveBeenCalled()
    expect(prisma.driveAnnotationComment.update).not.toHaveBeenCalled()
    expect(prisma.driveAnnotationThread.update).not.toHaveBeenCalled()
  })

  it("projects share annotation permissions for the logged-in viewer", async () => {
    const result = await service.listShareAnnotations({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
    })

    expect(drive.getShareBrowserSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "reader-1",
    }))
    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: true, canDelete: true })
  })

  it("redacts author emails for share annotation reads", async () => {
    const result = await service.listShareAnnotations({
      actorUserId: null,
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
    })

    expect(result[0]?.author.email).toBeNull()
    expect(result[0]?.comments[0]?.author.email).toBeNull()
    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: false })
    expect(result[0]?.permissions.canDelete).toBe(false)
  })

  it("does not project single-comment delete permission to the share file owner", async () => {
    const result = await service.listShareAnnotations({
      actorUserId: "owner-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
    })

    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: false })
    expect(result[0]?.permissions.canDelete).toBe(true)
  })

  it("rejects share file owners deleting another user's single comment", async () => {
    await expect(service.deleteShareComment({
      actorUserId: "owner-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
    })).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.driveAnnotationComment.update).not.toHaveBeenCalled()
  })
})

function createInput(input: { readonly baseVersionId?: string } = {}) {
  return {
    ...(input.baseVersionId ? { baseVersionId: input.baseVersionId } : {}),
    targetKind: "textRange" as const,
    target: {
      schemaVersion: 1 as const,
      kind: "textRange" as const,
      surface: "markdownRenderedText" as const,
      range: { start: 0, end: 4 },
      quote: { exact: "Note", prefix: "", suffix: "" },
    },
    body: "Comment body",
  }
}

function markdownItem() {
  return {
    id: "item-1",
    userId: "owner-1",
    name: "notes.md",
    type: "file",
    mimeType: "text/markdown",
    storageKey: "drive/user-1/item-1/current.md",
  }
}

function shareSnapshot(input: { readonly canEdit?: boolean } = {}) {
  return {
    context: "share",
    surface: "standalone",
    current: {
      id: "item-1",
      name: "notes.md",
      type: "file",
      mimeType: "text/markdown",
    },
    edit: {
      canEdit: input.canEdit ?? true,
      editorKind: "text",
      reason: null,
      currentVersionId: "version-1",
    },
  }
}

function threadRecord() {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  return {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: "version-1",
    targetKind: "textRange",
    target: createInput().target,
    anchorStatus: "attached",
    createdByUserId: "reader-1",
    createdByUser: { id: "reader-1", email: "reader@example.com", displayName: "Reader" },
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    comments: [commentRecord()],
  }
}

function commentRecord(input: { readonly body?: string; readonly createdByUserId?: string } = {}) {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  const createdByUserId = input.createdByUserId ?? "reader-1"
  return {
    id: "comment-1",
    threadId: "thread-1",
    parentCommentId: null,
    body: input.body ?? "Comment body",
    createdByUserId,
    createdByUser: { id: createdByUserId, email: `${createdByUserId}@example.com`, displayName: "Reader" },
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    deletedAt: null,
  }
}

function createPrismaMock() {
  return {
    driveItem: { findFirst: vi.fn() },
    driveFileVersion: { findFirst: vi.fn() },
    driveAnnotationThread: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    driveAnnotationComment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  }
}

function createDriveServiceMock() {
  return {
    getShareBrowserSnapshot: vi.fn(),
  }
}
