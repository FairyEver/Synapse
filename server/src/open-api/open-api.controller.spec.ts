import "reflect-metadata"
import { PATH_METADATA } from "@nestjs/common/constants"
import { afterEach, describe, expect, it, vi } from "vitest"
import { OpenApiDownloadController } from "./open-api-download.controller"
import { OpenApiController } from "./open-api.controller"

describe("Open API controllers", () => {
  afterEach(() => vi.unstubAllEnvs())
  it("mounts the stable v1 routes and skips the global throttler", () => {
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiController)).toBe("/api/open/v1")
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiController.prototype.createDownload))
      .toBe("/drive/share-links/downloads")
    expect(Reflect.getMetadata("THROTTLER:SKIPdefault", OpenApiController.prototype.createDownload))
      .toBe(true)
    expect(Reflect.getMetadata(PATH_METADATA, OpenApiDownloadController)).toBe("/api/open/v1/downloads")
    expect(Reflect.getMetadata("THROTTLER:SKIPdefault", OpenApiDownloadController.prototype.download))
      .toBe(true)
  })

  it("validates a strict request and returns the request id envelope", async () => {
    const service = { create: vi.fn().mockResolvedValue({ sourceType: "share" }) }
    const controller = new OpenApiController(service as never)
    const response = { setHeader: vi.fn() }
    const request = {
      openApiRequestId: "req-1",
      ip: "203.0.113.1",
      headers: {},
      protocol: "https",
      get: vi.fn(),
      openApiPrincipal: {
        userId: "user-1",
        apiKeyId: "key-1",
        scopes: ["drive.share_link.download"],
      },
    }
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.example")

    await expect(controller.createDownload({
      url: "https://synapse.example/share/shr-1?password=share-secret",
    }, request as never, response as never)).resolves.toEqual({
      requestId: "req-1",
      data: { sourceType: "share" },
    })
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req-1",
      url: "https://synapse.example/share/shr-1?password=share-secret",
    }))
    await expect(controller.createDownload({
      url: "https://synapse.example/share/shr-1",
      password: "separate-secret",
    }, request as never, response as never)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
    await expect(controller.createDownload({
      url: "https://synapse.example/share/shr-1",
      extra: true,
    }, request as never, response as never)).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_REQUEST",
    })
  })
})
