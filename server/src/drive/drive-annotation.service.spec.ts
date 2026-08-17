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
    prisma.driveAnnotationAnchor.upsert.mockResolvedValue(anchorRecord())
    prisma.user.findUnique.mockImplementation(async ({ where }: { readonly where: { readonly id: string } }) => ({ email: `${where.id}@example.com` }))
    auditLog.record.mockResolvedValue(undefined)
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item: markdownItem(), canComment: true })
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("Note"))
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
    expect(prisma.driveAnnotationThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "item-1", deletedAt: null },
    }))
    expect(result[0]?.comments[0]?.author.email).toBe("reader-1@example.com")
    expect(result[0]?.comments[0]?.permissions).toEqual({ canEdit: false, canDelete: true })
    expect(result[0]?.permissions.canDelete).toBe(true)
  })

  it("keeps annotations from multiple document versions visible", async () => {
    prisma.driveFileVersion.findFirst.mockResolvedValue({ id: "version-3" })
    prisma.driveAnnotationThread.findMany.mockResolvedValue([
      threadRecord({ baseVersionId: "version-1" }),
      { ...threadRecord({ baseVersionId: "version-2" }), id: "thread-2" },
    ])

    const result = await service.listOwnerAnnotations("owner-1", "item-1")

    expect(result.map((thread) => thread.baseVersionId)).toEqual(["version-1", "version-2"])
    expect(prisma.driveFileVersion.findFirst).not.toHaveBeenCalled()
  })

  it("batches source diff mapping for threads from the same document version", async () => {
    const anchored = {
      ...threadRecord({ baseVersionId: "version-1" }),
      anchor: {
        ...anchorRecord(),
        selectors: {
          ...anchorRecord().selectors,
          semantic: { blockId: "old-block", start: 0, end: 4, blockType: "paragraph" },
        },
      },
    }
    prisma.driveAnnotationThread.findMany.mockResolvedValue([
      anchored,
      { ...anchored, id: "thread-2" },
    ])
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("Updated Note", "version-3"))
    drive.resolveAnnotationDiffRanges.mockResolvedValue([{ start: 8, end: 12 }, { start: 8, end: 12 }])

    await service.listOwnerAnnotations("owner-1", "item-1")

    expect(drive.resolveAnnotationDiffRanges).toHaveBeenCalledTimes(1)
    expect(drive.resolveAnnotationDiffRanges).toHaveBeenCalledWith(
      "item-1",
      "version-1",
      "Updated Note",
      [{ start: 0, end: 4 }, { start: 0, end: 4 }],
    )
  })

  it("keeps shared annotations from multiple document versions visible", async () => {
    prisma.driveFileVersion.findFirst.mockResolvedValue({ id: "version-3" })
    prisma.driveAnnotationThread.findMany.mockResolvedValue([
      threadRecord({ baseVersionId: "version-1" }),
      { ...threadRecord({ baseVersionId: "version-2" }), id: "thread-2" },
    ])

    const result = await service.listShareAnnotations({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
    })

    expect(result.map((thread) => thread.baseVersionId)).toEqual(["version-1", "version-2"])
    expect(prisma.driveAnnotationThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "item-1", deletedAt: null },
    }))
    expect(prisma.driveFileVersion.findFirst).not.toHaveBeenCalled()
  })

  it("returns share annotation permissions and forwards one-time passwords", async () => {
    await expect(service.getShareAnnotationSnapshot({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      password: "secret",
    })).resolves.toMatchObject({ itemId: "item-1", canComment: true, threads: [{ id: "thread-1" }] })

    expect(drive.resolveShareAnnotationAccess).toHaveBeenCalledWith({
      shareId: "share-1",
      itemId: "item-1",
      password: "secret",
      cookie: undefined,
      actorUserId: "reader-1",
    })
  })

  it("creates server-resolved anchors for unique visible Markdown text", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("Alpha Note Omega"))
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(null)

    await service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      password: "secret",
      target: { exact: "Note" },
      body: "Comment body",
      idempotencyKey: "thread-key-1",
    })

    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        baseVersionId: "version-1",
        target: expect.objectContaining({ range: { start: 6, end: 10 }, quote: { exact: "Note", prefix: "", suffix: "" } }),
        anchor: { create: expect.objectContaining({
          idempotencyKey: "thread-key-1",
          selectors: expect.objectContaining({
            position: { start: 6, end: 10 },
            renderedPosition: { start: 6, end: 10 },
            semantic: expect.objectContaining({ blockId: "block-1", start: 6, end: 10 }),
          }),
        }) },
      }),
    }))
  })

  it("uses quote context to disambiguate visible Markdown text", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("one Note and two Note done"))
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(null)

    await service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { exact: "Note", prefix: "two ", suffix: " done" },
      body: "Comment body",
      idempotencyKey: "thread-key-2",
    })

    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        anchor: { create: expect.objectContaining({ selectors: expect.objectContaining({ renderedPosition: { start: 17, end: 21 } }) }) },
      }),
    }))
  })

  it("keeps V2 selectors in code points while projecting the legacy target in UTF-16", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("😀 Note"))
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(null)

    await service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { exact: "Note" },
      body: "Comment body",
      idempotencyKey: "thread-key-unicode",
    })

    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        target: expect.objectContaining({ range: { start: 3, end: 7 } }),
        anchor: { create: expect.objectContaining({ selectors: expect.objectContaining({ renderedPosition: { start: 2, end: 6 } }) }) },
      }),
    }))
  })

  it("distinguishes ambiguous and missing quote targets", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("Note and Note"))
    const ambiguous = service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { exact: "Note" },
      body: "Comment body",
      idempotencyKey: "thread-key-3",
    })
    await expect(ambiguous).rejects.toMatchObject({ response: expect.objectContaining({ code: "DRIVE_ANNOTATION_TARGET_AMBIGUOUS" }) })

    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("Different text"))
    const missing = service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { exact: "Note" },
      body: "Comment body",
      idempotencyKey: "thread-key-4",
    })
    await expect(missing).rejects.toMatchObject({ response: expect.objectContaining({ code: "DRIVE_ANNOTATION_TARGET_NOT_FOUND" }) })
    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("rejects quote anchor creation when the document version changes before persistence", async () => {
    drive.resolveAnnotationDocument
      .mockResolvedValueOnce(annotationDocument("Note", "version-1"))
      .mockResolvedValueOnce(annotationDocument("Note", "version-2"))

    await expect(service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { exact: "Note" },
      body: "Comment body",
      idempotencyKey: "thread-key-5",
    })).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("creates an image annotation from a current projection image id", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("", "version-1", true))
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(null)

    await service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { kind: "image", imageId: "mdimg_1" },
      body: "图片评论",
      idempotencyKey: "image-thread-key-1",
    })

    expect(prisma.driveAnnotationThread.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        targetKind: "image",
        target: expect.objectContaining({ imageId: "mdimg_1", resourceKey: "file:asset_1" }),
        anchor: { create: expect.objectContaining({
          selectors: expect.objectContaining({ kind: "image", identity: { imageId: "mdimg_1", resourceKey: "file:asset_1" } }),
          resolvedRenderedStart: null,
          resolvedRenderedEnd: null,
        }) },
      }),
    }))
  })

  it("rejects an expired image id without guessing by position", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("", "version-1", true))

    await expect(service.createShareAnnotationByQuote({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      target: { kind: "image", imageId: "mdimg_stale" },
      body: "图片评论",
      idempotencyKey: "image-thread-key-2",
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: "DRIVE_ANNOTATION_TARGET_NOT_FOUND" }) })
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

  it("hides legacy replies whose first comment was already deleted", async () => {
    const deletedAt = new Date("2026-06-22T00:00:00.000Z")
    prisma.driveAnnotationThread.findMany.mockResolvedValueOnce([
      threadRecord({
        comments: [
          commentRecord({ id: "comment-parent", deletedAt }),
          commentRecord({ id: "comment-reply", parentCommentId: "comment-parent" }),
        ],
      }),
    ])

    await expect(service.listOwnerAnnotations("owner-1", "item-1")).resolves.toEqual([])
  })

  it("hides legacy descendants of a deleted reply while keeping sibling comments", async () => {
    const deletedAt = new Date("2026-06-22T00:00:00.000Z")
    prisma.driveAnnotationThread.findMany.mockResolvedValueOnce([
      threadRecord({
        comments: [
          commentRecord({ id: "comment-root" }),
          commentRecord({ id: "comment-parent", parentCommentId: "comment-root", deletedAt }),
          commentRecord({ id: "comment-child", parentCommentId: "comment-parent" }),
          commentRecord({ id: "comment-sibling", parentCommentId: "comment-root" }),
        ],
      }),
    ])

    const result = await service.listOwnerAnnotations("owner-1", "item-1")

    expect(result[0]?.comments.map((comment) => comment.id)).toEqual(["comment-root", "comment-sibling"])
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

  it("allows owner annotation writes after the document version changes", async () => {
    const staleThread = threadRecord({ baseVersionId: "version-0" })
    const ownComment = commentRecord({ createdByUserId: "owner-1" })
    prisma.driveAnnotationThread.findFirst.mockResolvedValue(staleThread)
    prisma.driveAnnotationComment.findFirst.mockResolvedValue(ownComment)

    await expect(service.replyOwnerAnnotation("owner-1", "item-1", "thread-1", { parentCommentId: null, body: "Reply" }))
      .resolves.toMatchObject({ threadId: "thread-1" })
    await expect(service.updateOwnerComment("owner-1", "item-1", "comment-1", { body: "updated" }))
      .resolves.toMatchObject({ id: "comment-1" })
    await expect(service.deleteOwnerComment("owner-1", "item-1", "comment-1"))
      .resolves.toEqual({ ok: true })
    await expect(service.deleteOwnerThread("owner-1", "item-1", "thread-1"))
      .resolves.toEqual({ ok: true })

    expect(prisma.driveAnnotationComment.create).toHaveBeenCalled()
    expect(prisma.driveAnnotationComment.update).toHaveBeenCalled()
    expect(prisma.driveAnnotationThread.update).toHaveBeenCalled()
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

  it("lets the file owner delete the first comment with the entire thread", async () => {
    const comments = [
      commentRecord({ id: "comment-root" }),
      commentRecord({ id: "comment-reply", parentCommentId: "comment-root", createdByUserId: "reader-2" }),
    ]
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(comments[0])
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(threadRecord({ comments }))

    await service.deleteOwnerComment("owner-1", "item-1", "comment-root")

    expect(prisma.driveAnnotationComment.updateMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(prisma.driveAnnotationThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("lets the file owner delete another user's reply and its descendants", async () => {
    const comments = [
      commentRecord({ id: "comment-root" }),
      commentRecord({ id: "comment-target", parentCommentId: "comment-root", createdByUserId: "reader-1" }),
      commentRecord({ id: "comment-child", parentCommentId: "comment-target", createdByUserId: "reader-2" }),
      commentRecord({ id: "comment-grandchild", parentCommentId: "comment-child", createdByUserId: "reader-3" }),
      commentRecord({ id: "comment-sibling", parentCommentId: "comment-root", createdByUserId: "reader-3" }),
    ]
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(comments[1])
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(threadRecord({ comments }))

    await service.deleteOwnerComment("owner-1", "item-1", "comment-target")

    expect(prisma.driveAnnotationComment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["comment-target", "comment-child", "comment-grandchild"] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(prisma.driveAnnotationThread.update).not.toHaveBeenCalled()
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

    expect(drive.resolveShareAnnotationAccess).toHaveBeenCalledWith(expect.objectContaining({
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      actorUserId: "reader-1",
    }))
    expect(drive.getShareBrowserSnapshot).not.toHaveBeenCalled()
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

  it("reports an ambiguous repeated target separately from a stale document position", async () => {
    drive.resolveAnnotationDocument.mockResolvedValue(annotationDocument("Note and Note"))
    const input = createInput({ baseVersionId: "version-1" })

    await expect(service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      body: {
        ...input,
        target: { ...input.target, range: { start: 5, end: 9 } },
      },
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "DRIVE_ANNOTATION_TARGET_AMBIGUOUS" }),
    })

    expect(prisma.driveAnnotationThread.create).not.toHaveBeenCalled()
  })

  it("allows share annotation replies after the document version changes", async () => {
    prisma.driveAnnotationThread.findFirst.mockResolvedValue(threadRecord({ baseVersionId: "version-0" }))

    await expect(service.replyShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
      body: { parentCommentId: null, body: "Reply" },
    })).resolves.toMatchObject({ threadId: "thread-1" })

    expect(prisma.driveAnnotationComment.create).toHaveBeenCalled()
  })

  it("allows share annotation writes when the share can be commented but cannot be edited", async () => {
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item: markdownItem(), canComment: true })
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
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item: markdownItem(), canComment: true })
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
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item: markdownItem(), canComment: false })

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

    expect(drive.resolveShareAnnotationAccess).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "reader-1",
    }))
    expect(drive.getShareBrowserSnapshot).not.toHaveBeenCalled()
    expect(prisma.driveAnnotationThread.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { itemId: "item-1", deletedAt: null },
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

  it("redacts author emails for share annotation mutation responses", async () => {
    const created = await service.createShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      body: createInput(),
    })
    const reply = await service.replyShareAnnotation({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      threadId: "thread-1",
      body: { body: "Reply body" },
    })
    const updated = await service.updateShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-1",
      body: { body: "updated" },
    })

    expect(created.author.email).toBeNull()
    expect(created.comments[0]?.author.email).toBeNull()
    expect(reply.author.email).toBeNull()
    expect(updated.author.email).toBeNull()
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

  it("allows comment authors to delete their own reply with descendants from other authors", async () => {
    const comments = [
      commentRecord({ id: "comment-root", createdByUserId: "reader-2" }),
      commentRecord({ id: "comment-target", parentCommentId: "comment-root", createdByUserId: "reader-1" }),
      commentRecord({ id: "comment-child", parentCommentId: "comment-target", createdByUserId: "reader-2" }),
      commentRecord({ id: "comment-sibling", parentCommentId: "comment-root", createdByUserId: "reader-3" }),
    ]
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(comments[1])
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(threadRecord({ comments }))

    await service.deleteShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-target",
    })

    expect(prisma.driveAnnotationComment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["comment-target", "comment-child"] }, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("allows comment authors to delete their own first comment with the entire thread", async () => {
    const comments = [
      commentRecord({ id: "comment-root", createdByUserId: "reader-1" }),
      commentRecord({ id: "comment-reply", parentCommentId: "comment-root", createdByUserId: "reader-2" }),
    ]
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(comments[0])
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(threadRecord({ comments }))

    await service.deleteShareComment({
      actorUserId: "reader-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-root",
    })

    expect(prisma.driveAnnotationComment.updateMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(prisma.driveAnnotationThread.update).toHaveBeenCalledWith({
      where: { id: "thread-1" },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it("allows share file owners to delete another user's comment with its descendants", async () => {
    const comments = [
      commentRecord({ id: "comment-root", createdByUserId: "reader-1" }),
      commentRecord({ id: "comment-target", parentCommentId: "comment-root", createdByUserId: "reader-2" }),
      commentRecord({ id: "comment-child", parentCommentId: "comment-target", createdByUserId: "reader-3" }),
    ]
    prisma.driveAnnotationComment.findFirst.mockResolvedValueOnce(comments[1])
    prisma.driveAnnotationThread.findFirst.mockResolvedValueOnce(threadRecord({ comments }))

    await service.deleteShareComment({
      actorUserId: "owner-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie",
      commentId: "comment-target",
    })

    expect(prisma.driveAnnotationComment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["comment-target", "comment-child"] }, deletedAt: null },
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

    expect(prisma.driveAnnotationComment.updateMany).not.toHaveBeenCalled()
    expect(prisma.driveAnnotationThread.update).not.toHaveBeenCalled()
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

function threadRecord(input: {
  readonly baseVersionId?: string | null
  readonly comments?: readonly ReturnType<typeof commentRecord>[]
} = {}) {
  const createdAt = new Date("2026-06-21T00:00:00.000Z")
  return {
    id: "thread-1",
    itemId: "item-1",
    baseVersionId: input.baseVersionId ?? "version-1",
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
    $transaction: vi.fn(async (operations: readonly Promise<unknown>[]) => Promise.all(operations)),
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
      updateMany: vi.fn(),
    },
    driveAnnotationAnchor: { upsert: vi.fn() },
  }
}

function createDriveServiceMock() {
  return {
    getShareBrowserSnapshot: vi.fn(),
    resolveShareAnnotationAccess: vi.fn(),
    resolveAnnotationDocument: vi.fn(),
    resolveAnnotationDiffRanges: vi.fn(async (
      _itemId: string,
      _baseVersionId: string | null,
      _currentSource: string,
      ranges: readonly { readonly start: number; readonly end: number }[],
    ): Promise<Array<{ readonly start: number; readonly end: number } | null>> => ranges.map(() => null)),
    resolveAnnotationCrdtRange: vi.fn(() => null),
  }
}

function annotationDocument(text: string, versionId = "version-1", withImage = false) {
  const length = Array.from(text).length
  return {
    versionId,
    epoch: "epoch-1",
    sourceText: text,
    renderedText: text,
    projection: {
      schemaVersion: 1 as const,
      parserVersion: "test",
      sourceSha256: "hash",
      blocks: [{
        blockId: "block-1",
        type: "paragraph",
        parentBlockId: null,
        headingPath: [],
        sourceStart: 0,
        sourceEnd: length,
        renderedStart: 0,
        renderedEnd: length,
        textFingerprint: "fingerprint",
      }],
      segments: [{
        segmentId: "segment-1",
        blockId: "block-1",
        sourceStart: 0,
        sourceEnd: length,
        renderedStart: 0,
        renderedEnd: length,
        mapping: "identity" as const,
      }],
      ...(withImage ? {
        imageAnchorsVersion: 1 as const,
        images: [{
          imageId: "mdimg_1",
          segmentId: "segment-image-1",
          blockId: "block-1",
          imageIndex: 0,
          documentIndex: 0,
          sourceStart: 0,
          sourceEnd: 18,
          renderedStart: 0,
          renderedEnd: 0,
          source: "/files/asset_1",
          resourceKey: "file:asset_1",
          alt: "",
          title: null,
        }],
      } : {}),
    },
  }
}

function anchorRecord() {
  return {
    schemaVersion: 2,
    baseVersionId: "version-1",
    selectors: {
      schemaVersion: 2,
      position: { start: 0, end: 4 },
      renderedPosition: { start: 0, end: 4 },
      quote: { exact: "Note", prefix: "", suffix: "" },
    },
    positionStatus: "attached",
    quoteStatus: "exact",
    lastResolvedVersionId: "version-1",
    resolvedSourceStart: 0,
    resolvedSourceEnd: 4,
    resolvedRenderedStart: 0,
    resolvedRenderedEnd: 4,
    confidence: 1,
  }
}
