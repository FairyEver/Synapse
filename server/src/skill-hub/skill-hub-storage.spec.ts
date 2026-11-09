import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { createSkillHubStorage, LocalSkillHubStorage } from "./skill-hub-storage"

describe("Skill Hub storage", () => {
  it("reopens locally published objects from the persistent server data directory by default", async () => {
    const serverDir = await mkdtemp(join(tmpdir(), "skill-hub-server-test-"))
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(serverDir)
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/synapse")
    vi.stubEnv("ADMIN_ACCESS_SECRET", "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A")
    vi.stubEnv("USER_ACCESS_JWT_SECRET", "skill-hub-test-token-secret-32-characters")
    for (const key of ["SECRET_ID", "SECRET_KEY", "BUCKET", "REGION"]) vi.stubEnv(`SKILL_HUB_COS_${key}`, undefined)
    vi.stubEnv("SYNAPSE_SKILL_HUB_LOCAL_ROOT", undefined)
    try {
      const data = new LocalSkillHubStorage(join(serverDir, "data", "skill-hub"))
      const key = "skill-hub/persisted/main"
      await data.put(key, Buffer.from("hello"), "text/plain")
      await expect(createSkillHubStorage().head(key)).resolves.toMatchObject({ size: 5 })
    } finally {
      cwd.mockRestore()
      vi.unstubAllEnvs()
      await rm(serverDir, { recursive: true, force: true })
    }
  })

  it("stores and streams exact bytes in its own namespace and refuses unsafe keys", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-hub-storage-test-"))
    try {
      const storage = new LocalSkillHubStorage(root)
      const key = "skill-hub/fixture/main"
      await storage.put(key, Buffer.from("hello"), "text/plain")
      const object = await storage.open(key)
      expect(object.size).toBe(5)
      const parts = []
      for await (const part of object.stream) parts.push(part)
      expect(Buffer.concat(parts).toString()).toBe("hello")
      await expect(storage.head(key)).resolves.toEqual({ size: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" })
      await expect(storage.remove("skill-hub/../outside")).rejects.toThrow()
      await expect(storage.head("skill-repositories/fixture/main")).rejects.toThrow()
      await storage.remove(key)
      await expect(storage.head(key)).resolves.toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
