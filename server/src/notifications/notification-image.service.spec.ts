import { describe, expect, it, vi } from "vitest"
import { NotificationImageInvalidTypeError, NotificationImageService } from "./notification-image.service"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function setup() {
  const created = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "img-1", mimeType: data.mimeType, byteSize: data.byteSize }))
  const prisma = {
    notificationImage: {
      create: created,
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  }
  const storage = { putObject: vi.fn(async () => undefined), getObjectStream: vi.fn(), deleteObject: vi.fn(async () => undefined) }
  return { service: new NotificationImageService(prisma as never, storage as never), created, storage }
}

describe("NotificationImageService", () => {
  it("stages a PNG under notification-images and records pending state", async () => {
    const { service, created, storage } = setup()
    await expect(service.stage("user-1", png)).resolves.toMatchObject({ id: "img-1", mimeType: "image/png", byteSize: png.length })
    expect(storage.putObject).toHaveBeenCalledWith(expect.stringMatching(/^notification-images\//u), png, "image/png")
    expect(created).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: "user-1", state: "pending", mimeType: "image/png" }),
    }))
  })

  it("rejects bytes whose magic is not an allowed image", async () => {
    const { service, storage } = setup()
    await expect(service.stage("user-1", Buffer.from("not an image"))).rejects.toBeInstanceOf(NotificationImageInvalidTypeError)
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it("deletes the staged object when the record insert fails", async () => {
    const failure = new Error("insert failed")
    const putObject = vi.fn(async (_key: string, _bytes: Buffer, _contentType: string) => undefined)
    const deleteObject = vi.fn(async (_key: string) => undefined)
    const prisma = {
      notificationImage: {
        create: vi.fn(async () => { throw failure }),
      },
    }
    const service = new NotificationImageService(prisma as never, { putObject, deleteObject } as never)
    await expect(service.stage("user-1", png)).rejects.toBe(failure)
    const [objectKey] = putObject.mock.calls[0]
    expect(objectKey).toMatch(/^notification-images\//u)
    expect(deleteObject).toHaveBeenCalledWith(objectKey)
  })

  it("claims only a pending image owned by the caller", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const service = new NotificationImageService({ notificationImage: { updateMany } } as never, {} as never)
    await service.claimInTransaction({ notificationImage: { updateMany } } as never, "user-1", "img-1")
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "img-1", userId: "user-1", state: "pending" }),
    }))
  })

  it("throws when the image is already attached or belongs to someone else", async () => {
    const service = new NotificationImageService({ notificationImage: { updateMany: vi.fn(async () => ({ count: 0 })) } } as never, {} as never)
    await expect(service.claimInTransaction({ notificationImage: { updateMany: vi.fn(async () => ({ count: 0 })) } } as never, "user-1", "img-1"))
      .rejects.toMatchObject({ name: "NotificationImageUnavailableError" })
  })
})
