import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { SkillHubBackupService } from "./skill-hub-backup.service"
import { LocalSkillHubStorage } from "./skill-hub-storage"

const { restoreSkillHubObjects } = require("../../scripts/restore-skill-hub-objects.cjs") as {
  restoreSkillHubObjects(input: { directory: string; storage?: LocalSkillHubStorage; dryRun?: boolean }): Promise<unknown>
}

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

describe("Skill Hub object backup", () => {
  it("copies actual retained object bytes including an icon replaced after dump", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-hub-backup-"))
    try {
      const storage = new LocalSkillHubStorage(join(root, "source"))
      const originalIconBytes = Buffer.of(1, 2, 3)
      const archiveBytes = Buffer.of(4, 5)
      const rows = [
        { id: "1", kind: "icon", storageKey: "skill-hub/original/icon", size: originalIconBytes.length, sha256: digest(originalIconBytes) },
        { id: "2", kind: "archive", storageKey: "skill-hub/deleted/archive", size: archiveBytes.length, sha256: digest(archiveBytes) },
      ]
      await storage.put(rows[0].storageKey, originalIconBytes, "image/png")
      await storage.put(rows[1].storageKey, archiveBytes, "application/zip")
      const prisma = { skillHubObject: { findMany: vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]) } }
      const fence = { run: vi.fn(async (job) => job(new AbortController().signal)) }
      const service = new SkillHubBackupService({ prisma } as never, storage, fence as never)
      const output = await service.withObjectRetention(async (signal) => {
        // The dump references the old icon. Replacement can advance while the fence
        // prevents physical GC, and the old object still appears in the export.
        await storage.put("skill-hub/replacement/icon", Buffer.of(9), "image/png")
        return service.exportObjects(join(root, "export"), signal)
      })
      const manifestBytes = await readFile(output.manifestPath)
      const exportDir = join(root, "export")
      const descriptor = { path: "skill-hub-objects.json", sha256: digest(manifestBytes), size: manifestBytes.length }
      const writeBackupManifest = async () => writeFile(join(exportDir, "backup-manifest.json"),
        JSON.stringify({ schemaVersion: 2, skillHubObjectsIncluded: true, contents: [descriptor] }))
      await writeBackupManifest()
      const target = new LocalSkillHubStorage(join(root, "restored"))
      await expect(restoreSkillHubObjects({ directory: exportDir })).resolves.toEqual({ verified: 2, restored: 0 })
      await expect(restoreSkillHubObjects({ directory: exportDir, storage: target, dryRun: false })).resolves.toEqual({ verified: 2, restored: 2 })
      expect(await readFile(join(root, "restored", rows[0].storageKey))).toEqual(originalIconBytes)
      const manifest = JSON.parse(await readFile(output.manifestPath, "utf8"))
      const restoredIconPath = join(root, "export", manifest.objects[0].path)
      expect(await readFile(restoredIconPath)).toEqual(originalIconBytes)
      expect(await readFile(join(root, "export", manifest.objects[1].path))).toEqual(archiveBytes)
      await writeFile(restoredIconPath, Buffer.of(1, 2, 4))
      await expect(restoreSkillHubObjects({ directory: exportDir, storage: target, dryRun: false })).rejects.toThrow("checksum")
      await rm(restoredIconPath)
      await expect(restoreSkillHubObjects({ directory: exportDir })).rejects.toThrow()

      manifest.objects[0].path = "../outside"
      const tampered = Buffer.from(JSON.stringify(manifest))
      await writeFile(output.manifestPath, tampered)
      descriptor.size = tampered.length
      descriptor.sha256 = digest(tampered)
      await writeBackupManifest()
      await expect(restoreSkillHubObjects({ directory: exportDir })).rejects.toThrow("object entry")

      await writeFile(join(exportDir, "backup-manifest.json"), JSON.stringify({ schemaVersion: 1 }))
      await expect(restoreSkillHubObjects({ directory: exportDir })).resolves.toEqual({ restored: 0, skipped: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
