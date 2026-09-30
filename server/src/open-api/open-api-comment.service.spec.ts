import { BadRequestException, NotFoundException } from "@nestjs/common"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OpenApiCommentService } from "./open-api-comment.service"

const principal = {
  userId: "user-1", apiKeyId: "key-1", scopes: ["drive.public_link.comment.create"],
}
const article = { id: "item-1", name: "article.md", type: "file", mimeType: "text/markdown" }
const base = {
  principal, requestId: "req-1", ipAddress: "203.0.113.1",
  body: { body: "评论" },
}

describe("OpenApiCommentService", () => {
  const drive = {
    resolvePublicShareAccess: vi.fn(),
    resolveShareAnnotationAccess: vi.fn(),
  }
  const linkIntake = { resolveSharedMessageTarget: vi.fn() }
  const messages = { create: vi.fn() }
  const usageLogs = { start: vi.fn(), finish: vi.fn() }
  const service = new OpenApiCommentService(drive as never, linkIntake as never, messages as never, usageLogs as never)

  beforeEach(() => {
    vi.clearAllMocks()
    drive.resolvePublicShareAccess.mockResolvedValue({ status: "ok" })
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item: article, canComment: true })
    linkIntake.resolveSharedMessageTarget.mockResolvedValue({ kind: "share", shareId: "shr_same", itemId: "item-1" })
    messages.create.mockResolvedValue({ id: "message-1", createdAt: "2026-09-30T00:00:00.000Z" })
    usageLogs.start.mockResolvedValue({ id: "usage-1", startedAt: new Date() })
    usageLogs.finish.mockResolvedValue(undefined)
  })

  it("uses a direct share ID as the root article and records the API-key owner as author", async () => {
    await expect(service.create({ ...base, body: { shareId: "shr_same", body: "评论" } })).resolves.toEqual({
      id: "message-1", createdAt: "2026-09-30T00:00:00.000Z",
    })
    expect(messages.create).toHaveBeenCalledWith(
      { kind: "share", shareId: "shr_same", itemId: "item-1", password: undefined },
      "user-1", "评论", "203.0.113.1", undefined,
    )
    expect(usageLogs.start).toHaveBeenCalledWith(expect.objectContaining({
      operation: "comment_create", scope: "drive.public_link.comment.create", apiKeyId: "key-1",
    }))
  })

  it("uses a file link without resolving the share root", async () => {
    await service.create({ ...base, body: { url: "https://synapse.example/share/shr_same/items/item-1", body: "评论" } })
    expect(linkIntake.resolveSharedMessageTarget).toHaveBeenCalled()
    expect(drive.resolveShareAnnotationAccess).not.toHaveBeenCalled()
  })

  it("requires both target fields to resolve to the same share and file", async () => {
    await service.create({ ...base, body: {
      url: "https://synapse.example/share/shr_same", shareId: "shr_same", body: "评论",
    } })
    expect(messages.create).toHaveBeenCalledTimes(1)

    linkIntake.resolveSharedMessageTarget.mockResolvedValue({ kind: "share", shareId: "shr_other", itemId: "item-1" })
    await expect(service.create({ ...base, body: {
      url: "https://synapse.example/share/shr_other", shareId: "shr_same", body: "评论",
    } })).rejects.toMatchObject({ statusCode: 409, code: "TARGET_MISMATCH" })

    linkIntake.resolveSharedMessageTarget.mockResolvedValue({ kind: "share", shareId: "shr_same", itemId: "child-1" })
    await expect(service.create({ ...base, body: {
      url: "https://synapse.example/share/shr_same/items/child-1", shareId: "shr_same", body: "评论",
    } })).rejects.toMatchObject({ statusCode: 409, code: "TARGET_MISMATCH" })
    expect(messages.create).toHaveBeenCalledTimes(1)
  })

  it("rejects a folder share ID and inaccessible or unsupported targets", async () => {
    drive.resolveShareAnnotationAccess.mockResolvedValue({ item: { ...article, type: "folder" }, canComment: false })
    await expect(service.create({ ...base, body: { shareId: "shr_same", body: "评论" } }))
      .rejects.toMatchObject({ statusCode: 422, code: "TARGET_NOT_ARTICLE" })

    drive.resolvePublicShareAccess.mockResolvedValue({ status: "password_required" })
    await expect(service.create({ ...base, body: { shareId: "shr_same", body: "评论" } }))
      .rejects.toMatchObject({ statusCode: 403, code: "LINK_PASSWORD_REQUIRED_OR_INVALID" })

    linkIntake.resolveSharedMessageTarget.mockRejectedValue(new BadRequestException("云盘链接无效。"))
    await expect(service.create({ ...base, body: { url: "https://elsewhere.example/share/shr_same", body: "评论" } }))
      .rejects.toMatchObject({ statusCode: 422, code: "UNSUPPORTED_LINK" })
    linkIntake.resolveSharedMessageTarget.mockRejectedValue(new NotFoundException("分享链接不存在。"))
    await expect(service.create({ ...base, body: { url: "https://synapse.example/share/shr_same", body: "评论" } }))
      .rejects.toMatchObject({ statusCode: 404, code: "LINK_NOT_FOUND" })
    expect(messages.create).not.toHaveBeenCalled()
  })

  it("enforces the dedicated scope before starting usage or writing comments", async () => {
    await expect(service.create({ ...base, principal: { ...principal, scopes: ["drive.public_link.download"] }, body: { shareId: "shr_same", body: "评论" } }))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
    expect(usageLogs.start).not.toHaveBeenCalled()
    expect(messages.create).not.toHaveBeenCalled()
  })

  it("passes stable hashes for retry protection without persisting the API key or request body in usage logs", async () => {
    await service.create({ ...base, idempotencyKey: "comment-001", body: { shareId: "shr_same", body: "评论" } })
    const idempotency = messages.create.mock.calls[0]?.[4]
    expect(idempotency).toMatchObject({ keyHash: expect.stringMatching(/^[a-f0-9]{64}$/u), requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    expect(JSON.stringify(usageLogs.start.mock.calls)).not.toContain("评论")
  })
})
