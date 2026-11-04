import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { Prisma } from "@prisma/client"
import { SkillHubRepository } from "./skill-hub.repository"
import { SKILL_HUB_STORAGE, type SkillHubStoragePort } from "./skill-hub-storage"

const batch = 8

export const skillHubCollectableObject = {
  archiveVersions: { none: {} },
  mainVersions: { none: {} },
  iconSkills: { none: {} },
} satisfies Prisma.SkillHubObjectWhereInput

@Injectable()
export class SkillHubMaintenanceService {
  private readonly logger = new Logger(SkillHubMaintenanceService.name)
  private running = false

  constructor(
    private readonly repository: SkillHubRepository,
    @Inject(SKILL_HUB_STORAGE) private readonly storage: SkillHubStoragePort,
  ) {}

  @Cron("*/1 * * * *", { waitForCompletion: true })
  async tick(): Promise<void> {
    try {
      await this.pruneUnboundUploads(new Date())
    } catch {
      this.logger.warn("Skill Hub storage maintenance did not finish")
    }
  }

  async pruneUnboundUploads(now: Date): Promise<{ processed: number; retried: number }> {
    if (this.running) return { processed: 0, retried: 0 }
    this.running = true
    try {
      const db = this.repository.prisma
      const unboundExpired = { state: { in: ["staging", "ready"] }, expiresAt: { lte: now } } satisfies Prisma.SkillHubUploadWhereInput
      const expired = await db.skillHubUpload.findMany({
        where: unboundExpired, take: batch, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], select: { id: true },
      })
      if (expired.length) await db.skillHubUpload.updateMany({
        where: { ...unboundExpired, id: { in: expired.map(({ id }) => id) } }, data: { state: "cleanup" },
      })

      const collect = {
        ...skillHubCollectableObject,
        AND: [
          { OR: [{ upload: { state: "cleanup" } }, { kind: "icon", state: "deletePending" }] },
          { OR: [{ nextCleanupAt: null }, { nextCleanupAt: { lte: now } }] },
        ],
      } satisfies Prisma.SkillHubObjectWhereInput
      const objects = await db.skillHubObject.findMany({
        where: collect, take: batch, orderBy: [{ nextCleanupAt: "asc" }, { id: "asc" }],
        select: { id: true, storageKey: true, cleanupAttempts: true },
      })

      let processed = 0
      let retried = 0
      for (const object of objects) {
        // Claim the exact object with a recheck. A ready upload can be bound only
        // before expiry; an already-bound replacement icon cannot be rebound.
        const claimed = await db.skillHubObject.updateMany({
          where: { id: object.id, ...collect },
          data: { nextCleanupAt: new Date(now.getTime() + 5 * 60_000) },
        })
        if (claimed.count !== 1) continue
        try {
          await this.storage.remove(object.storageKey)
        } catch {
          await db.skillHubObject.updateMany({
            where: { id: object.id },
            data: {
              cleanupAttempts: { increment: 1 },
              nextCleanupAt: new Date(now.getTime() + Math.min(24 * 60, 2 ** Math.min(object.cleanupAttempts + 1, 10)) * 60_000),
            },
          })
          retried++
          continue
        }
        await db.skillHubObject.deleteMany({ where: { id: object.id, ...skillHubCollectableObject } })
        processed++
      }

      const empty = await db.skillHubUpload.findMany({
        where: { state: "cleanup", objects: { none: {} } },
        take: batch, orderBy: { id: "asc" }, select: { id: true },
      })
      if (empty.length) await db.skillHubUpload.deleteMany({
        where: { state: "cleanup", objects: { none: {} }, id: { in: empty.map(({ id }) => id) } },
      })
      return { processed, retried }
    } finally {
      this.running = false
    }
  }
}
