import { BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException } from "@nestjs/common"
import { DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES } from "@synapse/shared"
import { Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { DriveDocumentImageService } from "./drive-document-image.service"
import type { DrivePublicAssetService } from "./drive-public-asset.service"
import type { DriveRemoteImageFetcher } from "./drive-remote-image-fetcher"
import type { DriveStoragePort } from "./drive-storage"
import type { DriveService } from "./drive.service"
import { DriveService as RealDriveService } from "./drive.service"
import { DRIVE_INLINE_TEXT_EDIT_MAX_BYTES } from "./drive-editable-preview"

const OWNER_ASSET_ID = "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ"
const COLLABORATOR_ASSET_ID = "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yua"
const UNKNOWN_ASSET_ID = "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5Yub"
const PUBLIC_APP_URL = "https://synapse.test"

describe("DriveDocumentImageService", () => {
  it("classifies owner asset, collaborator asset, external, relative, and data images", async () => {
    const service = createService({
      currentMarkdown: [
        `![mine](https://synapse.test/files/${OWNER_ASSET_ID})`,
        `![other](https://synapse.test/files/${COLLABORATOR_ASSET_ID})`,
        "![external](https://example.test/a.png)",
        "![relative](./a.png)",
        "![data](data:image/png;base64,aaaa)",
      ].join("\n"),
      assetOwners: new Map([
        [OWNER_ASSET_ID, "owner-1"],
        [COLLABORATOR_ASSET_ID, "user-2"],
      ]),
    })

    const result = await service.scanOwnerItemImages({ actorUserId: "owner-1", itemId: "item-1" })

    expect(result.canImport).toBe(true)
    expect(result.summary.external).toBe(1)
    expect(result.sources.map((source) => source.kind)).toEqual([
      "owner_asset",
      "collaborator_asset",
      "external",
      "relative",
      "data",
    ])
  })

  it("rejects collaborator import even when collaborator can edit", async () => {
    const service = createService({ currentMarkdown: "![external](https://example.test/a.png)", ownerId: "owner-1" })

    await expect(service.importOwnerItemImages({
      actorUserId: "user-2",
      itemId: "item-1",
      body: { baseVersionId: "ver-1", sources: [{ src: "https://example.test/a.png" }] },
      publicAppUrl: PUBLIC_APP_URL,
    })).rejects.toBeInstanceOf(ForbiddenException)
  })

  it("marks non-owner scan sources as not importable", async () => {
    const service = createService({
      currentMarkdown: [
        `![other](https://synapse.test/files/${COLLABORATOR_ASSET_ID})`,
        "![external](https://example.test/a.png)",
      ].join("\n"),
      ownerId: "owner-1",
      assetOwners: new Map([[COLLABORATOR_ASSET_ID, "user-3"]]),
    })

    const result = await service.scanOwnerItemImages({ actorUserId: "user-2", itemId: "item-1" })

    expect(result.canImport).toBe(false)
    expect(result.summary.importable).toBe(0)
    expect(result.sources.every((source) => !source.canImport)).toBe(true)
    expect(result.sources.map((source) => source.importDisabledReason)).toEqual(["not_owner", "not_owner"])
  })

  it("classifies unknown public asset URLs as unreachable instead of external importable", async () => {
    const service = createService({
      currentMarkdown: `![unknown](https://synapse.test/files/${UNKNOWN_ASSET_ID})`,
      assetOwners: new Map(),
    })

    const result = await service.scanOwnerItemImages({ actorUserId: "owner-1", itemId: "item-1" })

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toMatchObject({
      kind: "invalid",
      status: "unreachable",
      canImport: false,
      importDisabledReason: "unreachable",
    })
    expect(result.summary.external).toBe(0)
    expect(result.summary.invalid).toBe(1)
  })

  it("rejects imports with too many sources before loading the document", async () => {
    const drive = createDriveMock({
      currentMarkdown: "![external](https://example.test/a.png)",
    })
    const service = new DriveDocumentImageService(
      drive as unknown as DriveService,
      {} as DrivePublicAssetService,
      {} as DriveRemoteImageFetcher,
    )

    await expect(service.importOwnerItemImages({
      actorUserId: "owner-1",
      itemId: "item-1",
      body: {
        baseVersionId: "ver-1",
        sources: Array.from({ length: DRIVE_DOCUMENT_IMAGE_IMPORT_MAX_SOURCES + 1 }, (_, index) => ({
          src: `https://example.test/${index}.png`,
        })),
      },
      publicAppUrl: PUBLIC_APP_URL,
    })).rejects.toThrow("单次转存图片过多。")
    expect(drive.getOwnerMarkdownImageDocument).not.toHaveBeenCalled()
  })

  it("rejects import when the base version is stale", async () => {
    const service = createService({ currentMarkdown: "![external](https://example.test/a.png)", versionId: "ver-2" })

    await expect(service.importOwnerItemImages({
      actorUserId: "owner-1",
      itemId: "item-1",
      body: { baseVersionId: "ver-1", sources: [{ src: "https://example.test/a.png" }] },
      publicAppUrl: PUBLIC_APP_URL,
    })).rejects.toThrow("文档已更新。")
    await expect(service.importOwnerItemImages({
      actorUserId: "owner-1",
      itemId: "item-1",
      body: { baseVersionId: "ver-1", sources: [{ src: "https://example.test/a.png" }] },
      publicAppUrl: PUBLIC_APP_URL,
    })).rejects.toBeInstanceOf(BadRequestException)
  })

  it("marks non-owner share scan sources as not importable", async () => {
    const drive = createDriveMock({
      currentMarkdown: [
        `![other](https://synapse.test/files/${COLLABORATOR_ASSET_ID})`,
        "![external](https://example.test/a.png)",
      ].join("\n"),
      ownerId: "owner-1",
      assetOwners: new Map([[COLLABORATOR_ASSET_ID, "user-3"]]),
    })
    const service = new DriveDocumentImageService(
      drive as unknown as DriveService,
      {} as DrivePublicAssetService,
      {} as DriveRemoteImageFetcher,
    )

    const result = await service.scanShareItemImages({
      actorUserId: "user-2",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie-1",
    })

    expect(drive.getShareMarkdownImageDocument).toHaveBeenCalledWith({
      actorUserId: "user-2",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie-1",
    })
    expect(result.canImport).toBe(false)
    expect(result.summary.importable).toBe(0)
    expect(result.sources.map((source) => source.kind)).toEqual(["collaborator_asset", "external"])
    expect(result.sources.map((source) => source.importDisabledReason)).toEqual(["not_owner", "not_owner"])
  })

  it("rejects non-owner share import after resolving the share document", async () => {
    const drive = createDriveMock({
      currentMarkdown: "![external](https://example.test/a.png)",
      ownerId: "owner-1",
    })
    const service = new DriveDocumentImageService(
      drive as unknown as DriveService,
      {} as DrivePublicAssetService,
      {} as DriveRemoteImageFetcher,
    )

    await expect(service.importShareItemImages({
      actorUserId: "user-2",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie-1",
      body: { baseVersionId: "ver-1", sources: [{ src: "https://example.test/a.png" }] },
      publicAppUrl: PUBLIC_APP_URL,
    })).rejects.toThrow("只有所有者可以转存图片。")
    await expect(service.importShareItemImages({
      actorUserId: "user-2",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie-1",
      body: { baseVersionId: "ver-1", sources: [{ src: "https://example.test/a.png" }] },
      publicAppUrl: PUBLIC_APP_URL,
    })).rejects.toBeInstanceOf(ForbiddenException)
    expect(drive.getShareMarkdownImageDocument).toHaveBeenCalled()
  })

  it("imports owner-selected images and saves a new markdown version", async () => {
    const harness = createServiceHarness({
      currentMarkdown: [
        `![other](https://synapse.test/files/${COLLABORATOR_ASSET_ID})`,
        "![external](https://example.test/a.png)",
      ].join("\n"),
      ownerId: "owner-1",
      versionId: "ver-1",
      assetOwners: new Map([[COLLABORATOR_ASSET_ID, "user-2"]]),
      remoteImages: new Map([[
        "https://example.test/a.png",
        { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: "image/png", size: 4n },
      ]]),
    })

    const result = await harness.service.importShareItemImages({
      actorUserId: "owner-1",
      shareId: "share-1",
      itemId: "item-1",
      cookie: "cookie-1",
      body: {
        baseVersionId: "ver-1",
        sources: [
          { src: `https://synapse.test/files/${COLLABORATOR_ASSET_ID}` },
          { src: "https://example.test/a.png" },
        ],
      },
      publicAppUrl: PUBLIC_APP_URL,
    })

    expect(result).toMatchObject({
      itemId: "item-1",
      versionId: "ver-2",
      imported: [
        {
          previousSrc: `https://synapse.test/files/${COLLABORATOR_ASSET_ID}`,
          nextSrc: "https://synapse.test/files/asset_copied",
          assetId: "asset_copied",
          size: "10",
        },
        {
          previousSrc: "https://example.test/a.png",
          nextSrc: "https://synapse.test/files/asset_imported",
          assetId: "asset_imported",
          size: "4",
        },
      ],
      summary: {
        importedCount: 2,
        failedCount: 0,
        replacedOccurrenceCount: 2,
      },
    })
    expect(harness.drive.updateOwnerFileText).toHaveBeenCalledWith(
      "owner-1",
      "item-1",
      {
        contentType: "text",
        text: [
          "![other](https://synapse.test/files/asset_copied)",
          "![external](https://synapse.test/files/asset_imported)",
        ].join("\n"),
        baseVersionId: "ver-1",
      },
      undefined,
    )
  })

  it("keeps successful imports when another requested image cannot be fetched", async () => {
    const harness = createServiceHarness({
      currentMarkdown: [
        `![other](https://synapse.test/files/${COLLABORATOR_ASSET_ID})`,
        "![external](https://example.test/missing.png)",
      ].join("\n"),
      ownerId: "owner-1",
      versionId: "ver-1",
      assetOwners: new Map([[COLLABORATOR_ASSET_ID, "user-2"]]),
      fetchErrors: new Map([["https://example.test/missing.png", new BadRequestException("图片无法转存。")]]),
    })

    const result = await harness.service.importOwnerItemImages({
      actorUserId: "owner-1",
      itemId: "item-1",
      body: {
        baseVersionId: "ver-1",
        sources: [
          { src: `https://synapse.test/files/${COLLABORATOR_ASSET_ID}` },
          { src: "https://example.test/missing.png" },
        ],
      },
      publicAppUrl: PUBLIC_APP_URL,
    })

    expect(result.imported).toHaveLength(1)
    expect(result.failed).toEqual([{
      src: "https://example.test/missing.png",
      reason: "unreachable",
      message: "图片无法转存。",
    }])
    expect(result.summary.replacedOccurrenceCount).toBe(1)
  })

  it("keeps the real DriveService owner helper bound to actor-owned documents", async () => {
    const previousSecret = process.env.USER_ACCESS_JWT_SECRET
    process.env.USER_ACCESS_JWT_SECRET = "drive-document-image-service-test-secret"
    const item = createDriveItemRecord()
    const prisma = {
      driveItem: {
        findFirst: vi.fn(async ({ where }: { readonly where: Record<string, unknown> }) => {
          if (where.id !== item.id) return null
          if (!("userId" in where)) return item
          if (where.userId === item.userId) return item
          return null
        }),
      },
      driveFileVersion: {
        findFirst: vi.fn(async () => ({ id: "ver-1" })),
      },
    }
    const storage = {
      getObjectStream: vi.fn(async () => ({ stream: Readable.from("![external](https://example.test/a.png)") })),
    }
    try {
      const service = new RealDriveService(prisma as never, storage as unknown as DriveStoragePort)

      await expect(service.getOwnerMarkdownImageDocument({ actorUserId: "user-2", itemId: "item-1" }))
        .rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.driveItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ userId: "user-2" }),
      }))
      expect(storage.getObjectStream).not.toHaveBeenCalled()
    } finally {
      if (previousSecret === undefined) {
        delete process.env.USER_ACCESS_JWT_SECRET
      } else {
        process.env.USER_ACCESS_JWT_SECRET = previousSecret
      }
    }
  })

  it("rejects oversized markdown image documents before reading preview content", async () => {
    const previousSecret = process.env.USER_ACCESS_JWT_SECRET
    process.env.USER_ACCESS_JWT_SECRET = "drive-document-image-service-test-secret"
    const item = createDriveItemRecord({ size: BigInt(DRIVE_INLINE_TEXT_EDIT_MAX_BYTES + 1) })
    const prisma = {
      driveItem: {
        findFirst: vi.fn(async () => item),
      },
      driveFileVersion: {
        findFirst: vi.fn(async () => ({ id: "ver-1" })),
      },
    }
    const storage = {
      getObjectStream: vi.fn(async () => ({
        stream: Readable.from(`![external](https://example.test/a.png)\n${"x".repeat(DRIVE_INLINE_TEXT_EDIT_MAX_BYTES)}`),
      })),
    }
    try {
      const service = new RealDriveService(prisma as never, storage as unknown as DriveStoragePort)

      await expect(service.getOwnerMarkdownImageDocument({ actorUserId: "owner-1", itemId: "item-1" }))
        .rejects.toBeInstanceOf(PayloadTooLargeException)
      expect(storage.getObjectStream).not.toHaveBeenCalled()
    } finally {
      if (previousSecret === undefined) {
        delete process.env.USER_ACCESS_JWT_SECRET
      } else {
        process.env.USER_ACCESS_JWT_SECRET = previousSecret
      }
    }
  })
})

function createService(options: CreateServiceOptions): DriveDocumentImageService {
  return createServiceHarness(options).service
}

function createServiceHarness(options: CreateServiceOptions) {
  const drive = createDriveMock(options)
  const publicAssets = {
    copyPublicAssetToUser: vi.fn(async () => ({
      assetId: "asset_copied",
      url: `${PUBLIC_APP_URL}/files/asset_copied`,
      size: "10",
    })),
    importImageBuffer: vi.fn(async (_userId: string, _publicAppUrl: string, input: { readonly body: Buffer }) => ({
      assetId: "asset_imported",
      url: `${PUBLIC_APP_URL}/files/asset_imported`,
      size: input.body.byteLength.toString(),
    })),
  }
  const fetcher = {
    fetchImage: vi.fn(async (src: string) => {
      const error = options.fetchErrors?.get(src)
      if (error) throw error
      const image = options.remoteImages?.get(src)
      if (image) return image
      throw new BadRequestException("图片无法转存。")
    }),
  }
  return {
    service: new DriveDocumentImageService(
      drive as unknown as DriveService,
      publicAssets as unknown as DrivePublicAssetService,
      fetcher as unknown as DriveRemoteImageFetcher,
    ),
    drive,
    publicAssets,
    fetcher,
  }
}

function createDriveMock(options: CreateServiceOptions) {
  const ownerId = options.ownerId ?? "owner-1"
  const versionId = options.versionId ?? "ver-1"
  const assetOwners = options.assetOwners ?? new Map<string, string>()

  return {
    getOwnerMarkdownImageDocument: vi.fn(async (_input: { readonly actorUserId: string; readonly itemId: string }) => ({
      itemId: "item-1",
      ownerId,
      versionId,
      markdown: options.currentMarkdown,
    })),
    getShareMarkdownImageDocument: vi.fn(async (_input: {
      readonly actorUserId: string
      readonly shareId: string
      readonly itemId?: string | null
      readonly cookie?: string
      readonly accessCookie?: string
    }) => ({
      itemId: "item-1",
      ownerId,
      versionId,
      markdown: options.currentMarkdown,
    })),
    findPublicAssetOwner: vi.fn(async (assetId: string) => assetOwners.get(assetId) ?? null),
    updateOwnerFileText: vi.fn(async (_userId: string, _itemId: string, _input: unknown) => ({
      item: {},
      version: { id: "ver-2" },
    })),
  }
}

interface CreateServiceOptions {
  readonly currentMarkdown: string
  readonly ownerId?: string
  readonly versionId?: string | null
  readonly assetOwners?: ReadonlyMap<string, string>
  readonly remoteImages?: ReadonlyMap<string, { readonly body: Buffer; readonly mimeType: string; readonly size: bigint }>
  readonly fetchErrors?: ReadonlyMap<string, Error>
}

function createDriveItemRecord(input: Partial<ReturnType<typeof createDriveItemRecordBase>> = {}) {
  return {
    ...createDriveItemRecordBase(),
    ...input,
  }
}

function createDriveItemRecordBase() {
  const now = new Date("2026-06-27T00:00:00.000Z")
  return {
    id: "item-1",
    userId: "owner-1",
    parentId: null,
    type: "file",
    name: "doc.md",
    size: 42n,
    mimeType: "text/markdown",
    storageStatus: "active",
    lifecycleStatus: "active",
    uploadStatus: "completed",
    storageKey: "drive/item-1",
    deletedAt: null,
    objectMissing: false,
    shares: [],
    createdAt: now,
    updatedAt: now,
  }
}
