import { describe, expect, it, vi } from "vitest"
import { DriveDocumentHostedImageService, DOCUMENT_IMAGE_STATUS } from "./drive-document-hosted-image.service"

describe("DriveDocumentHostedImageService", () => {
  it("rejects images above 20 MB before creating a session", async () => {
    const prisma = createPrisma()
    const service = new DriveDocumentHostedImageService(prisma as never, createStorage() as never)

    await expect(service.prepareUpload({
      actorUserId: "user-1",
      sourceItemId: "item-1",
      name: "large.png",
      size: String(20 * 1024 * 1024 + 1),
      mimeType: "image/png",
    })).rejects.toThrow("20MB")
    expect(prisma.documentImageUploadSession.create).not.toHaveBeenCalled()
  })

  it("creates a platform upload session without user quota accounting", async () => {
    const prisma = createPrisma()
    const storage = createStorage()
    const service = new DriveDocumentHostedImageService(prisma as never, storage as never)

    const prepared = await service.prepareUpload({
      actorUserId: "user-1",
      sourceItemId: "item-1",
      name: "diagram.png",
      size: "8",
      mimeType: "image/png",
    })

    expect(prepared.imageId).toMatch(/^img_[A-Za-z0-9]{32}$/u)
    expect(prisma.documentImageUploadSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        actorUserId: "user-1",
        sourceItemId: "item-1",
        storageKey: expect.stringMatching(/^document-images\/img_/u),
      }),
    }))
    expect(storage.createUploadInstruction).toHaveBeenCalledWith(expect.objectContaining({ expectedSize: 8n }))
  })

  it("activates only hosted image URLs referenced by the same saved document", async () => {
    const previous = process.env.APP_PUBLIC_URL
    process.env.APP_PUBLIC_URL = "https://synapse.test"
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const service = new DriveDocumentHostedImageService(createPrisma() as never, createStorage() as never)
    const ownImage = `img_${"A".repeat(32)}`
    const externalImage = `img_${"B".repeat(32)}`
    try {
      await service.activateReferencedImages({ documentHostedImage: { updateMany } } as never, {
        sourceItemId: "item-1",
        markdown: [
          `![own](/object/${ownImage})`,
          `![same origin](https://synapse.test/object/${ownImage})`,
          `![external](https://example.test/object/${externalImage})`,
          "![relative](images/local.png)",
        ].join("\n"),
      })
    } finally {
      if (previous === undefined) delete process.env.APP_PUBLIC_URL
      else process.env.APP_PUBLIC_URL = previous
    }

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        imageId: { in: [ownImage] },
        sourceItemId: "item-1",
        status: DOCUMENT_IMAGE_STATUS.temporary,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { status: DOCUMENT_IMAGE_STATUS.active, expiresAt: null, activatedAt: expect.any(Date) },
    })
  })

  it("does not delete an upload object when expiry loses the pending-state race", async () => {
    const storage = createStorage()
    const prisma = {
      documentImageUploadSession: {
        findMany: vi.fn(async () => [{
          id: "session-1",
          imageId: `img_${"A".repeat(32)}`,
          storageKey: `document-images/img_${"A".repeat(32)}`,
        }]),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      documentHostedImage: {
        findMany: vi.fn(async () => []),
      },
    }
    const service = new DriveDocumentHostedImageService(prisma as never, storage as never)

    await service.cleanupExpired(new Date("2026-09-05T00:00:00.000Z"))

    expect(storage.deleteObject).not.toHaveBeenCalled()
  })
})

function createPrisma() {
  return {
    documentImageUploadSession: {
      create: vi.fn(async ({ data }: { readonly data: Record<string, unknown> }) => ({ id: "session-1", ...data })),
    },
  }
}

function createStorage() {
  return {
    createUploadInstruction: vi.fn(async () => ({
      method: "PUT" as const,
      url: "https://upload.test/object",
      expiresAt: new Date("2026-09-05T00:10:00.000Z"),
      headers: { "Content-Type": "image/png" },
    })),
    deleteObject: vi.fn(async () => undefined),
  }
}
