import "reflect-metadata"
import { PATH_METADATA } from "@nestjs/common/constants"
import { describe, expect, it, vi } from "vitest"
import { ApiKeyController } from "./api-key.controller"
import type { ApiKeyService } from "./api-key.service"

const throttleLimitMetadata = "THROTTLER:LIMITdefault"
const throttleTtlMetadata = "THROTTLER:TTLdefault"

describe("ApiKeyController", () => {
  it("mounts current and legacy Console API key routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, ApiKeyController)).toEqual([
      "/api/console",
      "/api/dashboard",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, ApiKeyController.prototype.list)).toBe("/api-keys")
    expect(Reflect.getMetadata(PATH_METADATA, ApiKeyController.prototype.capabilities)).toBe("/api-key-capabilities")
  })

  it("limits API key creation", () => {
    expect(Reflect.getMetadata(throttleLimitMetadata, ApiKeyController.prototype.create)).toBe(10)
    expect(Reflect.getMetadata(throttleTtlMetadata, ApiKeyController.prototype.create)).toBe(60000)
  })

  it("lists, creates, and revokes keys for the current user", async () => {
    const service = {
      listForUser: vi.fn().mockResolvedValue([]),
      createForUser: vi.fn().mockResolvedValue({ apiKey: { id: "key-1" }, secret: "syn_sk_secret" }),
      revokeForUser: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new ApiKeyController(service as unknown as ApiKeyService)
    const request = { user: { id: "user-1" }, ip: "203.0.113.12" }

    await expect(controller.list(request as never)).resolves.toEqual([])
    expect(controller.capabilities()).toEqual([{
      scope: "drive.share_link.download",
      name: "获取分享链接文件",
    }])
    await expect(controller.create({ name: " CLI ", scopes: ["drive.share_link.download"] }, request as never)).resolves.toEqual({
      apiKey: { id: "key-1" },
      secret: "syn_sk_secret",
    })
    await expect(controller.revoke("key-1", request as never)).resolves.toEqual({ ok: true })

    expect(service.listForUser).toHaveBeenCalledWith("user-1")
    expect(service.createForUser).toHaveBeenCalledWith("user-1", {
      name: "CLI",
      scopes: ["drive.share_link.download"],
    }, "203.0.113.12")
    expect(service.revokeForUser).toHaveBeenCalledWith("user-1", "key-1", "203.0.113.12")
  })

  it("rejects invalid create bodies", () => {
    const service = { createForUser: vi.fn() }
    const controller = new ApiKeyController(service as unknown as ApiKeyService)

    expect(() => controller.create({ name: "", scopes: [], extra: true }, { user: { id: "user-1" } } as never))
      .toThrow("API key create request is invalid")
    expect(() => controller.create({ name: "CLI", scopes: ["unknown"] }, { user: { id: "user-1" } } as never))
      .toThrow("API key create request is invalid")
    expect(service.createForUser).not.toHaveBeenCalled()
  })
})
