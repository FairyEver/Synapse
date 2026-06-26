import { describe, expect, it, vi } from "vitest"
import type { DrivePublicAssetDto } from "@synapse/shared"

import { createDriveMarkdownImageUploader, type DriveMarkdownImageUploaderBridge } from "./drive-markdown-image-uploader"

describe("createDriveMarkdownImageUploader", () => {
  it("uploads an image file and returns the public URL", async () => {
    const asset = createPublicAsset({ url: "https://synapse.test/files/asset_image" })
    const uploadDrivePublicAssetBinary = vi.fn().mockResolvedValue(asset)
    const uploader = createDriveMarkdownImageUploader(() => createBridge(uploadDrivePublicAssetBinary))
    const file = new File(["image-bytes"], "note.png", { type: "image/png" })

    await expect(uploader.upload(file)).resolves.toBe("https://synapse.test/files/asset_image")
  })

  it("uploads through the account bridge with name, MIME type, and ArrayBuffer data", async () => {
    const uploadDrivePublicAssetBinary = vi.fn().mockResolvedValue(createPublicAsset())
    const uploader = createDriveMarkdownImageUploader(() => createBridge(uploadDrivePublicAssetBinary))
    const file = new File(["image-bytes"], "note.webp", { type: "image/webp" })

    await uploader.upload(file)

    expect(uploadDrivePublicAssetBinary).toHaveBeenCalledTimes(1)
    const [input] = uploadDrivePublicAssetBinary.mock.calls[0]
    expect(input).toMatchObject({
      name: "note.webp",
      mimeType: "image/webp",
    })
    expect(input.data).toBeInstanceOf(ArrayBuffer)
    await expect(new Response(input.data).text()).resolves.toBe("image-bytes")
  })

  it("uses image.png when the file has no name", async () => {
    const uploadDrivePublicAssetBinary = vi.fn().mockResolvedValue(createPublicAsset())
    const uploader = createDriveMarkdownImageUploader(() => createBridge(uploadDrivePublicAssetBinary))
    const file = new File(["image-bytes"], "", { type: "image/png" })

    await uploader.upload(file)

    expect(uploadDrivePublicAssetBinary).toHaveBeenCalledWith(expect.objectContaining({
      name: "image.png",
    }))
  })

  it("rejects unsupported image formats before calling the bridge", async () => {
    const uploadDrivePublicAssetBinary = vi.fn().mockResolvedValue(createPublicAsset())
    const uploader = createDriveMarkdownImageUploader(() => createBridge(uploadDrivePublicAssetBinary))
    const file = new File(["<svg />"], "vector.svg", { type: "image/svg+xml" })

    await expect(uploader.upload(file)).rejects.toThrow("格式不支持")
    expect(uploadDrivePublicAssetBinary).not.toHaveBeenCalled()
  })
})

function createPublicAsset(overrides: Partial<DrivePublicAssetDto> = {}): DrivePublicAssetDto {
  return {
    assetId: "asset_image",
    itemId: "item_image",
    name: "note.png",
    size: "11",
    mimeType: "image/png",
    url: "https://synapse.test/files/asset_image",
    lifecycleStatus: "active",
    accessCount: "0",
    responseBytes: "0",
    lastAccessedAt: null,
    createdAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    ...overrides,
  }
}

function createBridge(uploadDrivePublicAssetBinary: DriveMarkdownImageUploaderBridge["account"]["uploadDrivePublicAssetBinary"]): DriveMarkdownImageUploaderBridge {
  return {
    account: { uploadDrivePublicAssetBinary },
  }
}
