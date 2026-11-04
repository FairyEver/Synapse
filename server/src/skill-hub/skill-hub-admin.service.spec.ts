import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { verifySkillHubObject } from "./skill-hub-object-read"

describe("Skill Hub restore integrity", () => {
  it("checks bytes, not just object existence or a storage hash header", async () => {
    const object = { storageKey: "skill-hub/fixture/main", size: 1, sha256: createHash("sha256").update(Buffer.of(1)).digest("hex") }
    const storage = {
      put: vi.fn(), head: vi.fn().mockResolvedValue(object), remove: vi.fn(),
      open: vi.fn().mockResolvedValueOnce({ size: 1, stream: Readable.from([Buffer.of(2)]) })
        .mockResolvedValueOnce({ size: 1, stream: Readable.from([Buffer.of(1)]) }),
    }
    await expect(verifySkillHubObject(storage, object, 10)).rejects.toThrow()
    await expect(verifySkillHubObject(storage, object, 10)).resolves.toBeUndefined()
  })
})

it("leaves an existing deletion in place when restore cannot verify the current package", async () => {
  const { SkillHubAdminService } = await import("./skill-hub-admin.service")
  const update = vi.fn()
  const asset = {
    deletedAt: new Date(), revision: 4, currentVersion: {
      id: "v4",
      archiveObject: { storageKey: "skill-hub/fixture/archive", sha256: "0".repeat(64), size: 1, state: "ready" },
      mainObject: { storageKey: "skill-hub/fixture/main", sha256: "0".repeat(64), size: 1, state: "ready" },
    },
    iconObject: null,
  }
  const prisma = {
    skillHubSkill: { findUnique: vi.fn().mockResolvedValue(asset), update },
    skillHubWriteReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
  }
  const service = new SkillHubAdminService({ prisma } as never, {} as never, {
    put: vi.fn(), head: vi.fn(), remove: vi.fn(),
    open: vi.fn(async () => ({ size: 1, stream: Readable.from([Buffer.of(2)]) })),
  })
  await expect(service.restore({ sessionId: "admin", ip: "" }, "skill", { expectedRevision: 4, requestId: "stable" }))
    .rejects.toMatchObject({ response: { code: "HUB_RESTORE_INCOMPLETE" } })
  expect(update).not.toHaveBeenCalled()
  expect(asset.deletedAt).toBeInstanceOf(Date)
})
