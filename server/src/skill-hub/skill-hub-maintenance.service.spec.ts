import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { SkillHubMaintenanceService, skillHubCollectableObject } from "./skill-hub-maintenance.service"
import type { SkillHubRepository } from "./skill-hub.repository"
import { LocalSkillHubStorage } from "./skill-hub-storage"

describe("Skill Hub object collection", () => {
  it("keeps object bytes referenced by deleted Skills and older versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-hub-gc-test-"))
    try {
      const storage = new LocalSkillHubStorage(root)
      const boundObjectKey = "skill-hub/retained/icon"
      const orphanKey = "skill-hub/orphan/icon"
      await storage.put(boundObjectKey, Buffer.of(1), "image/png")
      await storage.put(orphanKey, Buffer.of(2), "image/png")
      const findMany = vi.fn(async ({ where }) => [
        { id: "orphan", storageKey: orphanKey, cleanupAttempts: 0 },
        ...(!where.iconSkills?.none ? [{ id: "retained", storageKey: boundObjectKey, cleanupAttempts: 0 }] : []),
      ])
      const prisma = {
        skillHubUpload: { findMany: vi.fn().mockResolvedValue([]) },
        skillHubObject: { findMany, updateMany: vi.fn().mockResolvedValue({ count: 1 }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      }
      const gc = new SkillHubMaintenanceService({ prisma } as unknown as SkillHubRepository, storage)
      await expect(gc.pruneUnboundUploads(new Date())).resolves.toEqual({ processed: 1, retried: 0 })
      expect(await storage.head(boundObjectKey)).not.toBeNull()
      expect(await storage.head(orphanKey)).toBeNull()
      expect(findMany.mock.calls[0][0].where).toMatchObject({
        archiveVersions: { none: {} }, mainVersions: { none: {} }, iconSkills: { none: {} },
      })
      expect(skillHubCollectableObject.iconSkills.none).not.toHaveProperty("deletedAt")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("retains the object key and records retry timing if removal fails", async () => {
    const now = new Date()
    const storage = {
      put: vi.fn(), open: vi.fn(), head: vi.fn(),
      remove: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    }
    const prisma = {
      skillHubUpload: { findMany: vi.fn().mockResolvedValue([]) },
      skillHubObject: {
        findMany: vi.fn().mockResolvedValue([{ id: "orphan", storageKey: "skill-hub/orphan/icon", cleanupAttempts: 0 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn(),
      },
    }
    const gc = new SkillHubMaintenanceService({ prisma } as unknown as SkillHubRepository, storage)
    await expect(gc.pruneUnboundUploads(now)).resolves.toEqual({ processed: 0, retried: 1 })
    expect(prisma.skillHubObject.deleteMany).not.toHaveBeenCalled()
    expect(prisma.skillHubObject.updateMany).toHaveBeenLastCalledWith({
      where: { id: "orphan" },
      data: { cleanupAttempts: { increment: 1 }, nextCleanupAt: new Date(now.getTime() + 120_000) },
    })
  })
})
