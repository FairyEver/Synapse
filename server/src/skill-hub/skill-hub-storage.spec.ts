import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LocalSkillHubStorage } from "./skill-hub-storage"

describe("Skill Hub storage", () => {
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
