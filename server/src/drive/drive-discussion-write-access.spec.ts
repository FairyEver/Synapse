import { describe, expect, it, vi } from "vitest"
import { DriveService } from "./drive.service"
import { createDrivePasswordMaterial } from "./drive-access-protection"
import { DriveDiscussionNotificationService } from "./drive-discussion-notification.service"
import { Prisma } from "@prisma/client"

function fixture() {
  const file = { id: "file", parentId: "root" as string | null, userId: "owner", name: "file.md", type: "file", mimeType: "text/markdown", storageStatus: "active", lifecycleStatus: "active", deletedAt: null }
  const root = { ...file, id: "root", parentId: null, type: "folder" }
  const share = { id: "original", shareId: "public", userId: "owner", itemId: "root", enabled: true, expiresAt: null as Date | null, passwordEnabled: false, passwordHash: null as string | null }
  const rows = new Map([[file.id, file], [root.id, root]])
  const tx = { $queryRaw: vi.fn(async (_query: Prisma.Sql) => [{ id: "locked" }]), user: { findFirst: vi.fn(async () => ({ id: "reader", status: "active" })) },
    driveItem: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null) },
    driveShare: { findFirst: vi.fn(async () => share) } }
  const drive = Object.create(DriveService.prototype) as DriveService
  Object.assign(drive, { accessSecret: "test-secret" })
  const input = { kind: "share" as const, itemId: file.id, actorUserId: "reader", shareId: "public", sourceShareId: "original" }
  return { drive, tx, input, file, share, rows }
}
describe("discussion permissions at the transaction write boundary", () => {
  it("checks current membership and holds share/ancestor rows until commit", async () => {
    const f = fixture()
    await f.drive.validateDiscussionWriteAccess(f.tx as never, f.input)
    expect(f.tx.driveShare.findFirst).toHaveBeenCalled()
    expect(f.tx.driveItem.findFirst).toHaveBeenCalledTimes(2)
    expect(f.tx.$queryRaw.mock.calls.some((args) => String((args[0] as { sql: string }).sql).includes("FOR SHARE"))).toBe(true)
  })
  it.each(["disabled", "expired", "moved-out", "root-deleted", "origin-replaced", "actor-disabled"])("rejects %s that committed while creation waited for the item lock", async (change) => {
    const f = fixture()
    if (change === "disabled") f.share.enabled = false
    if (change === "expired") f.share.expiresAt = new Date(0)
    if (change === "moved-out") f.file.parentId = "outside"
    if (change === "root-deleted") f.rows.delete("root")
    if (change === "origin-replaced") f.share.id = "different"
    if (change === "actor-disabled") f.tx.user.findFirst.mockResolvedValue(null as never)
    await expect(f.drive.validateDiscussionWriteAccess(f.tx as never, f.input)).rejects.toMatchObject({ status: expect.any(Number) })
  })
  it("revalidates password protection after rotation rather than accepting an earlier check", async () => {
    const f = fixture()
    const material = await createDrivePasswordMaterial({ passwordEnabled: true, expiresIn: "forever" }, "test-secret")
    Object.assign(f.share, material)
    await expect(f.drive.validateDiscussionWriteAccess(f.tx as never, f.input)).rejects.toMatchObject({ status: 404 })
    await f.drive.validateDiscussionWriteAccess(f.tx as never, { ...f.input, password: material.password! })
  })
  it("owner creation rechecks ownership in the same transaction", async () => {
    const f = fixture()
    await expect(f.drive.validateDiscussionWriteAccess(f.tx as never, { kind: "owned", itemId: "file", actorUserId: "reader" })).rejects.toMatchObject({ status: 404 })
  })
  it("retries an aborted lock transaction before rechecking access", async () => {
    const work = vi.fn(async () => "saved")
    const tx = { $queryRaw: vi.fn(async (_query: Prisma.Sql) => [{ id: "file" }]) }
    const prisma = { $transaction: vi.fn().mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("deadlock", { code: "P2034", clientVersion: "test" })).mockImplementation(async (callback) => callback(tx)) }
    const service = new DriveDiscussionNotificationService(prisma as never, {} as never)
    await expect(service.withItemLock("file", work)).resolves.toBe("saved")
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    expect(work).toHaveBeenCalledTimes(1)
  })
})
