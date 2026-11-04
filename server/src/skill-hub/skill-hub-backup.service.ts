import { Inject, Injectable } from "@nestjs/common"
import { mkdir, open } from "node:fs/promises"
import { dirname, join } from "node:path"
import { SKILL_HUB_LIMITS as limits } from "@synapse/shared/skill-hub-contracts"
import { SkillHubGcFence } from "./skill-hub-gc-fence"
import { consumeVerifiedHubObject } from "./skill-hub-object-read"
import { assertSkillHubObjectKey, SKILL_HUB_STORAGE, type SkillHubStoragePort } from "./skill-hub-storage"
import { SkillHubRepository } from "./skill-hub.repository"

export const hubBackupManifest = "skill-hub-objects.json"
export const hubBackupDirectory = "skill-hub-objects"
const manifestBytes = 32 * 1024 * 1024
const objectLimits = { archive: limits.uploadBytes, main: limits.mainBytes, icon: limits.iconBytes }

@Injectable()
export class SkillHubBackupService {
  constructor(
    private readonly repository: SkillHubRepository,
    @Inject(SKILL_HUB_STORAGE) private readonly storage: SkillHubStoragePort,
    private readonly fence: SkillHubGcFence,
  ) {}

  async withObjectRetention<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const result = await this.fence.run(async (signal) => ({ value: await job(signal) }), { waitMs: 180_000 })
    if (!result) throw new Error("Skill Hub object retention lock was unavailable")
    return result.value
  }

  async exportObjects(directory: string, signal: AbortSignal): Promise<{ manifestPath: string; objectDirectory: string }> {
    const manifestPath = join(directory, hubBackupManifest)
    const objectDirectory = join(directory, hubBackupDirectory)
    await mkdir(objectDirectory, { recursive: true, mode: 0o700 })
    const manifest = await open(manifestPath, "wx", 0o600)
    try {
      let lastId: string | undefined
      let count = 0
      let size = 0
      const append = async (text: string) => {
        size += Buffer.byteLength(text)
        if (size > manifestBytes) throw new Error("Skill Hub backup manifest exceeds its size limit")
        await manifest.writeFile(text)
      }
      await append('{"schemaVersion":1,"objects":[\n')
      for (;;) {
        signal.throwIfAborted()
        const rows = await this.repository.prisma.skillHubObject.findMany({
          where: {
            ...(lastId ? { id: { gt: lastId } } : {}),
            OR: [
              { archiveVersions: { some: {} } }, { mainVersions: { some: {} } }, { iconSkills: { some: {} } },
              { state: { in: ["ready", "deletePending"] }, nextCleanupAt: null, upload: { state: { in: ["ready", "bound"] } } },
            ],
          },
          orderBy: { id: "asc" }, take: 100,
          select: { id: true, kind: true, storageKey: true, sha256: true, size: true },
        })
        if (!rows.length) break
        for (const row of rows) {
          signal.throwIfAborted()
          assertSkillHubObjectKey(row.storageKey)
          const path = `${hubBackupDirectory}/${row.storageKey.slice("skill-hub/".length)}`
          const target = join(directory, path)
          await mkdir(dirname(target), { recursive: true, mode: 0o700 })
          const file = await open(target, "wx", 0o600)
          try {
            await consumeVerifiedHubObject(this.storage, row, objectLimits[row.kind], (chunk) => file.writeFile(chunk), signal)
          } finally {
            await file.close()
          }
          await append(`${count++ ? ",\n" : ""}${JSON.stringify({ key: row.storageKey, path, size: row.size, sha256: row.sha256 })}`)
          lastId = row.id
        }
        if (rows.length < 100) break
      }
      await append("\n]}\n")
      return { manifestPath, objectDirectory }
    } finally {
      await manifest.close()
    }
  }
}
