import "reflect-metadata"
import { PATH_METADATA } from "@nestjs/common/constants"
import { describe, expect, it, vi } from "vitest"
import { OpenApiMessageController } from "./open-api-message.controller"

describe("OpenApiMessageController", () => {
  const principal = {
    userId: "user-1", apiKeyId: "key-1", scopes: ["drive.public_link.comment.create"],
  }
  const request = { openApiRequestId: "req-1", ip: "203.0.113.1", openApiPrincipal: principal }
  const response = { setHeader: vi.fn() }

  it("mounts the v1 route with API-key auth and no global throttle", () => {
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiMessageController)).toBe("/api/open/v1")
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiMessageController.prototype.create))
      .toBe("/drive/public-links/comments")
    expect(Reflect.getMetadata("THROTTLER:SKIPdefault", OpenApiMessageController.prototype.create)).toBe(true)
  })

  it("accepts either or both identifiers and returns a request envelope", async () => {
    const messages = { create: vi.fn().mockResolvedValue({ id: "message-1", createdAt: "2026-09-30T00:00:00.000Z" }) }
    const controller = new OpenApiMessageController(messages as never)
    const body = { shareId: "shr_example", url: "https://synapse.example/share/shr_example", body: " 评论 " }
    await expect(controller.create(body, request as never, response as never, "comment-001")).resolves.toEqual({
      requestId: "req-1", data: { id: "message-1", createdAt: "2026-09-30T00:00:00.000Z" },
    })
    expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({
      principal, idempotencyKey: "comment-001", body: { ...body, body: "评论" },
    }))
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
  })

  it("rejects a missing target, unknown fields, and invalid retry keys", async () => {
    const messages = { create: vi.fn() }
    const controller = new OpenApiMessageController(messages as never)
    await expect(controller.create({ body: "评论" }, request as never, response as never))
      .rejects.toMatchObject({ statusCode: 400, code: "TARGET_REQUIRED" })
    await expect(controller.create({ shareId: "shr_example", body: "评论", extra: true }, request as never, response as never))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_REQUEST", message: "留言请求参数无效。" })
    await expect(controller.create({ shareId: "shr_example", body: "评论" }, request as never, response as never, "short"))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_IDEMPOTENCY_KEY" })
    expect(messages.create).not.toHaveBeenCalled()
  })

  it("checks the scope before request validation", async () => {
    const messages = { create: vi.fn() }
    const controller = new OpenApiMessageController(messages as never)
    await expect(controller.create({ body: "评论" }, {
      ...request, openApiPrincipal: { ...principal, scopes: ["drive.public_link.download"] },
    } as never, response as never)).rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
    expect(messages.create).not.toHaveBeenCalled()
  })
})
