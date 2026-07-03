import { ConflictException, ForbiddenException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DriveAnnotationService } from "./drive-annotation.service"

describe("DriveAnnotationService", () => {
  const prisma = createPrismaMock()
  const drive = createDriveServiceMock()
  const auditLog = { record: vi.fn() }
  const service = new DriveAnnotationService(prisma as never, drive as never, auditLog as never)

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.driveItem.findFirst.mockResolvedValue(markdownItem())
    prisma.driveShare.findFirst.mockResolvedValue({ id: "share-record-1" })
    prisma.driveFileVersion.findFirst.mockResolvedValue({ id: "version-1" })
    prisma.driveAnnotationThread.findMany.mockResolvedValue([threadRecord()])
    prisma.driveAnnotationThread.findFirst.mockResolvedValue(threadRecord())
    prisma.driveAnnotationThread.create.mockResolvedValue(threadRecord())
    prisma.driveAnnotationThread.update.mockResolvedValue({ ...threadRecord(), deletedAt: new Date("2026-06-21T00:00:00.000Z") })
    prisma.driveAnnotationComment.create.mockResolvedValue(commentRecord({ createdByUserId: "owner-1" }))
    prisma.driveAnnotationComment.findFirst.mockResolvedValue(commentRecord())
    prisma.driveAnnotationComment.update.mockResolvedValue(commentRecord({ body: "updated", createdByUserId: "owner-1" }))
    prisma.user.findUnique.mockImplementation(async ({ where }: { readonly where: { readonly id: string } }) => ({ email: `${where.id}@example.com` }))
    auditLog.record.mockResolvedValue(undefined)
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot())
  })

  it("lists visible owner annotations with author metadata and permissions", async () => {
    const result = await service.listOwnerAnnotations("owner-1", "item-1")

    expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deletedAt: null,
        id: "item-1",
        lifecycleStatus: "active",
        storageStatus: "active",
        userId: "owner-1",
      }),
    }))
    expect(result[0]?.comments[0]?.author.email).toBe("reader-1@example.com")
    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(result[0]?.permissions.canDelete).toBe(true)
  })

  it("rejects owner annotation writes when the item is no longer active", async () => {
    prisma.driveItem.findFirst.mockResolvedValueOnce(null)

    await expect(service.createOwnerAnnotation("owner-1", "item-1", createInput()))
      .rejects.toThrow("文件未找到")

    expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        lifecycleStatus: "active",
        storageStatus: "active",
      }),
    }))
    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("hides threads after every comment is deleted", async () => {
    const deletedAt = new Date("2026-06-22T00:00:00.000Z")
    prisma.driveAnnotationThread.findMany.mockResolvedValueOnce([
      threadRecord({
        comments: [
          commentRecord({ id: "comment-parent", deletedAt }),
          commentRecord({ id: "comment-reply", parentCommentId: "comment-parent", deletedAt }),
        ],
      }),
    ])

    await expect(service.listOwnerAnnotations("owner-1", "item-1")).resolves.toEqual([])
  })

  it("keeps deleted parent comments when visible replies remain", async () => {
    const deletedAt = new Date("2026-06-22T00:00:00.000Z")
    prisma.driveAnnotationThread.findMany.mockResolvedValueOnce([
      threadRecord({
        comments: [
          commentRecord({ id: "comment-parent", deletedAt }),
          commentRecord({ id: "comment-reply", parentCommentId: "comment-parent" }),
        ],
      }),
    ])

    const result = await service.listOwnerAnnotations("owner-1", "item-1")

    expect(result[0]?.comments.map((comment) => ({ id: comment.id, deleted: comment.deleted }))).toEqual([
      { id: "comment-parent", deleted: true },
      { id: "comment-reply", deleted: false },
    ])
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

  it("records owner annotation write audits without comment content", async () => {
    prisma.driveAnnotationComment.findFirst
      .mockResolvedValueOnce(commentRecord({ createdByUserId: "owner-1" }))
      .mockResolvedValueOnce(commentRecord())

    await service.createOwnerAnnotation("owner-1", "item-1", createInput(), { ipAddress: "127.0.0.1" })
    await service.replyOwnerAnnotation("owner-1", "item-1", "thread-1", { parentCommentId: null, body: "Reply body" }, { ipAddress: "127.0.0.1" })
    await service.updateOwnerComment("owner-1", "item-1", "comment-1", { body: "updated" }, { ipAddress: "127.0.0.1" })
    await service.deleteOwnerComment("owner-1", "item-1", "comment-1", { ipAddress: "127.0.0.1" })
    await service.deleteOwnerThread("owner-1", "item-1", "thread-1", { ipAddress: "127.0.0.1" })

    expect(auditLog.record.mock.calls.map(([input]) => input.action)).toEqual([
      "drive.annotation.create",
      "drive.annotation.reply",
      "drive.annotation.comment.edit",
      "drive.annotation.comment.delete",
      "drive.annotation.thread.delete",
    ])
    expect(auditLog.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      adminEmail: "owner-1@example.com",
      targetType: "drive.annotationThread",
      targetId: "thread-1",
      detail: expect.objectContaining({
        actorUserId: "owner-1",
        ownerId: "owner-1",
        itemId: "item-1",
        threadId: "thread-1",
        commentId: "comment-1",
      }),
      ipAddress: "127.0.0.1",
    }))
    const serialized = JSON.stringify(auditLog.record.mock.calls)
    expect(serialized).not.toContain("Comment body")
    expect(serialized).not.toContain("Reply body")
    expect(serialized).not.toContain("updated")
    expect(serialized).not.toContain("Note")
  })

  it("rejects owner annotation creation when the preview version is stale", async () => {
    prisma.driveFileVersion.findFirst.mockResolvedValueOnce({ id: "version-2" })

    await expect(service.createOwnerAnnotation("owner-1", "item-1", createInput({ baseVersionId: "version-1" })))
      .rejects.toBeInstanceOf(ConflictException)

    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("rejects comment creation for unsupported file names", async () => {
    prisma.driveItem.findFirst.mockResolvedValueOnce({ ...markdownItem(), name: "notes.txt", mimeType: "text/plain" })

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

  it("allows file owners to delete another user's single comment", async () => {
    await service.deleteOwnerComment("owner-1", "item-1", "comment-1")

    expect(prisma.driveAnnotationComment.update).toHaveBeenCalledWith({
      where: { id: "comment-1" },
      data: { deletedAt: expect.any(Date) },
    })
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

  it("allows share annotation writes when the share can be commented but cannot be edited", async () => {
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot({ canEdit: false, canComment: true }))
    const ownComment = commentRecord({ createdByUserId: "reader-1" })
    prisma.driveAnnotationComment.findFirst.mockResolvedValue(ownComment)
    prisma.driveAnnotationComment.update.mockResolvedValue({ ...ownComment, body: "updated" })

    await service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      body: createInput(),
    })
    await service.replyShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
      body: { body: "Reply body" },
    })
    await service.updateShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
      body: { body: "updated" },
    })
    await service.deleteShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
    })
    await service.deleteShareThread({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
    })
    expect(prisma.driveAnnotationThread.create).toHaveBeenCalled()
    expect(prisma.driveAnnotationComment.create).toHaveBeenCalled()
    expect(prisma.driveAnnotationComment.update).toHaveBeenCalled()
    expect(prisma.driveAnnotationThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("records share annotation write audits with share context redacted", async () => {
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot({ canEdit: false, canComment: true }))
    const ownComment = commentRecord({ createdByUserId: "reader-1" })
    prisma.driveAnnotationComment.findFirst.mockResolvedValue(ownComment)
    prisma.driveAnnotationComment.update.mockResolvedValue({ ...ownComment, body: "updated" })

    await service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "shr_file",
      itemId: "item-1",
      cookie: "cookie",
      body: createInput(),
      auditContext: { ipAddress: "203.0.113.7" },
    })
    await service.replyShareAnnotation({
      actorUserId: "reader-1",
      shareId: "shr_file",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
      body: { body: "Reply body" },
      auditContext: { ipAddress: "203.0.113.7" },
    })
    await service.updateShareComment({
      actorUserId: "reader-1",
      shareId: "shr_file",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
      body: { body: "updated" },
      auditContext: { ipAddress: "203.0.113.7" },
    })
    await service.deleteShareComment({
      actorUserId: "reader-1",
      shareId: "shr_file",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
      auditContext: { ipAddress: "203.0.113.7" },
    })
    await service.deleteShareThread({
      actorUserId: "owner-1",
      shareId: "shr_file",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
      auditContext: { ipAddress: "203.0.113.7" },
    })

    expect(auditLog.record.mock.calls.map(([input]) => input.action)).toEqual([
      "drive.share_annotation.create",
      "drive.share_annotation.reply",
      "drive.share_annotation.comment.edit",
      "drive.share_annotation.comment.delete",
      "drive.share_annotation.thread.delete",
    ])
    expect(auditLog.record).toHaveBeenNthCalledWith(1, expect.objectContaining({
      adminEmail: "reader-1@example.com",
      targetType: "drive.annotationThread",
      targetId: "thread-1",
      detail: expect.objectContaining({
        actorUserId: "reader-1",
        ownerId: "owner-1",
        itemId: "item-1",
        shareId: "[redacted-share-id]",
        shareRecordId: "share-record-1",
        threadId: "thread-1",
        commentId: "comment-1",
      }),
      ipAddress: "203.0.113.7",
    }))
    const serialized = JSON.stringify(auditLog.record.mock.calls)
    expect(serialized).not.toContain("shr_file")
    expect(serialized).not.toContain("Comment body")
    expect(serialized).not.toContain("Reply body")
    expect(serialized).not.toContain("updated")
    expect(serialized).not.toContain("Note")
  })

  it("rejects share annotation writes when the share cannot be commented", async () => {
    drive.getShareBrowserSnapshot.mockResolvedValue(shareSnapshot({ canEdit: true, canComment: false }))

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
    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
    expect(prisma.driveAnnotationComment.create).not.toHaveBeenCalled()
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
    expect(result[0]?.permissions.canDelete).toBe(true)
  })

  it("does not project thread delete permission when another visible share comment remains", async () => {
    prisma.driveAnnotationThread.findMany.mockResolvedValueOnce([
      threadRecord({
        comments: [
          commentRecord({ id: "comment-1", createdByUserId: "reader-1" }),
          commentRecord({ id: "comment-2", parentCommentId: "comment-1", createdByUserId: "reader-2" }),
        ],
      }),
    ])

    const result = await service.listShareAnnotations({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
    })

    expect(result[0]?.permissions.canDelete).toBe(false)
  })

  it("allows share thread creators to delete threads with only their visible comments", async () => {
    await service.deleteShareThread({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
    })

    expect(prisma.driveAnnotationThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("rejects share thread creators deleting threads with another visible comment", async () => {
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(threadRecord({
      comments: [
        commentRecord({ id: "comment-1", createdByUserId: "reader-1" }),
        commentRecord({ id: "comment-2", parentCommentId: "comment-1", createdByUserId: "reader-2" }),
      ],
    }))

    await expect(service.deleteShareThread({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
    })).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.driveAnnotationThread.update).not.toHaveBeenCalled()
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

  it("projects single-comment delete permission to the share file owner", async () => {
    const result = await service.listShareAnnotations({
      actorUserId: "owner-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
    })

    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(result[0]?.permissions.canDelete).toBe(true)
  })

  it("allows share file owners to delete another user's single comment", async () => {
    await service.deleteShareComment({
      actorUserId: "owner-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
    })

    expect(prisma.driveAnnotationComment.update).toHaveBeenCalledWith({
      where: { id: "comment-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("rejects share viewers deleting another user's single comment", async () => {
    await expect(service.deleteShareComment({
      actorUserId: "reader-2",
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

function shareSnapshot(input: { readonly canEdit?: boolean; readonly canComment?: boolean } = {}) {
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
    annotation: {
      canComment: input.canComment ?? true,
      reason: null,
    },
  }
}

function threadRecord(input: { readonly comments?: readonly ReturnType<typeof commentRecord>[] } = {}) {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  return {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: "version-1",
    targetKind: "textRange",
    target: createInput().target,
    anchorStatus: "attached",
    createdByUserId: "reader-1",
    createdByUser: { id: "reader-1", email: "reader@example.com", handle: "reader" },
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    comments: input.comments ?? [commentRecord()],
  }
}

function commentRecord(input: {
  readonly id?: string
  readonly parentCommentId?: string | null
  readonly body?: string
  readonly createdByUserId?: string
  readonly deletedAt?: Date | null
} = {}) {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  const createdByUserId = input.createdByUserId ?? "reader-1"
  return {
    id: input.id ?? "comment-1",
    threadId: "thread-1",
    parentCommentId: input.parentCommentId ?? null,
    body: input.body ?? "Comment body",
    createdByUserId,
    createdByUser: { id: createdByUserId, email: `${createdByUserId}@example.com`, handle: createdByUserId },
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    deletedAt: input.deletedAt ?? null,
  }
}

function createPrismaMock() {
  return {
    user: { findUnique: vi.fn() },
    driveItem: { findFirst: vi.fn() },
    driveShare: { findFirst: vi.fn() },
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
