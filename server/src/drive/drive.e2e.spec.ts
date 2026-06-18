import { type INestApplication } from "@nestjs/common"
import { Test } from "@nestjs/testing"
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { DrivePublicController } from "./drive.controller"
import { DrivePublicAssetService } from "./drive-public-asset.service"
import { DriveService } from "./drive.service"

type SupertestResponse = { readonly body?: Buffer; readonly text?: string; readonly headers: Record<string, string> }
type SupertestRequest = {
  readonly set: (field: string, value: string | readonly string[]) => SupertestRequest
  readonly expect: (status: number) => Promise<SupertestResponse>
}
const request = require("supertest") as (server: unknown) => {
  readonly get: (path: string) => SupertestRequest
  readonly head: (path: string) => SupertestRequest
}

describe("Drive public asset routes", () => {
  let app: INestApplication | null = null
  const publicAssets = {
    resolvePublicAsset: vi.fn(),
    recordAccessSafely: vi.fn(async () => undefined),
  }
  const storage = {
    getObjectStream: vi.fn(async () => ({
      stream: Readable.from(Buffer.from("png-data")),
      size: 8n,
      contentType: "image/png",
    })),
  }

  beforeEach(async () => {
    publicAssets.resolvePublicAsset.mockReset()
    publicAssets.recordAccessSafely.mockReset()
    publicAssets.recordAccessSafely.mockResolvedValue(undefined)
    storage.getObjectStream.mockReset()
    storage.getObjectStream.mockResolvedValue({
      stream: Readable.from(Buffer.from("png-data")),
      size: 8n,
      contentType: "image/png",
    })
    const moduleRef = await Test.createTestingModule({
      controllers: [DrivePublicController],
      providers: [
        { provide: DriveService, useValue: {} },
        { provide: DrivePublicAssetService, useValue: publicAssets },
        { provide: "DriveStoragePort", useValue: storage },
      ],
    })
      .overrideGuard(UserAuthGuard)
      .useValue({ canActivate: vi.fn(() => false) })
      .compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app?.close()
    app = null
  })

  it("serves public assets inline with short public cache", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "ok",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      storageKey: "drive/item-1",
      name: "logo.png",
      mimeType: "image/png",
      size: 8n,
      etag: "\"etag-1\"",
    })

    const response = await request(app!.getHttpServer()).get("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ").expect(200)

    expect((response.body ?? Buffer.from(response.text ?? "")).toString("utf8")).toBe("png-data")
    expect(response.headers["cache-control"]).toBe("public, max-age=300")
    expect(response.headers["content-disposition"]).toContain("inline;")
    expect(response.headers.etag).toBe("\"etag-1\"")
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      method: "GET",
      statusCode: 200,
      bytes: 8n,
    }))
  })

  it("supports HEAD and does not count response bytes", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "ok",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      storageKey: "drive/item-1",
      name: "logo.png",
      mimeType: "image/png",
      size: 8n,
      etag: "\"etag-1\"",
    })

    const response = await request(app!.getHttpServer()).head("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ").expect(200)

    expect(response.headers["content-length"]).toBe("8")
    expect(storage.getObjectStream).not.toHaveBeenCalled()
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      method: "HEAD",
      statusCode: 200,
      bytes: 0n,
    }))
  })

  it("returns 304 for matching ETags and records zero bytes", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "not_modified",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      publicAssetId: "public-asset-1",
      userId: "user-1",
      etag: "\"etag-1\"",
    })

    await request(app!.getHttpServer())
      .get("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ")
      .set("If-None-Match", "\"etag-1\"")
      .expect(304)

    expect(storage.getObjectStream).not.toHaveBeenCalled()
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET",
      statusCode: 304,
      bytes: 0n,
    }))
  })

  it("returns uncached 404 for missing public assets", async () => {
    publicAssets.resolvePublicAsset.mockResolvedValue({
      status: "not_found",
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    })

    const response = await request(app!.getHttpServer()).get("/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ").expect(404)

    expect(response.headers["cache-control"]).toBe("no-store")
    expect(storage.getObjectStream).not.toHaveBeenCalled()
    expect(publicAssets.recordAccessSafely).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      method: "GET",
      statusCode: 404,
      bytes: 0n,
    }))
  })
})
