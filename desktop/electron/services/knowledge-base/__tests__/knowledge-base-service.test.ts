import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { KnowledgeBaseService, KNOWLEDGE_BASE_TEMPLATE_VERSION } from "../knowledge-base-service"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseService", () => {
  it("initializes the vault structure without runnable agent files", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()

    const result = await service.initialize({ projectPath: targetPath, mode: "create" })

    expect(result.templateVersion).toBe(KNOWLEDGE_BASE_TEMPLATE_VERSION)
    await expect(readFile(path.join(targetPath, ".synapse-kb.json"), "utf8")).resolves.toContain("synapse.knowledgeBase")
    await expect(readFile(path.join(targetPath, ".raw", ".manifest.json"), "utf8")).resolves.toContain("\"sources\"")
    await expect(readFile(path.join(targetPath, "wiki", "hot.md"), "utf8")).resolves.toContain("# Hot Cache")
    await expect(readFile(path.join(targetPath, ".agents", "skills", "wiki", "SKILL.md"), "utf8")).rejects.toThrow()
  })

  it("repairs missing files without overwriting existing wiki content", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()
    await service.initialize({ projectPath: targetPath, mode: "create" })
    await writeFile(path.join(targetPath, "wiki", "hot.md"), "# Custom Hot\n")

    const result = await service.initialize({ projectPath: targetPath, mode: "repair" })

    expect(result.createdFiles).not.toContain("wiki/hot.md")
    await expect(readFile(path.join(targetPath, "wiki", "hot.md"), "utf8")).resolves.toBe("# Custom Hot\n")
  })

  it("detects existing knowledge base folders by metadata or folder shape", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()
    await service.initialize({ projectPath: targetPath, mode: "create" })

    await expect(service.inspect(targetPath)).resolves.toMatchObject({
      isKnowledgeBase: true,
      hasMetadata: true,
      hasRequiredShape: true,
    })
  })

  it("returns the raw directory after ensuring it exists", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()

    const result = await service.openRawDirectory(targetPath)

    expect(result.rawPath).toBe(path.join(targetPath, ".raw"))
    await expect(access(path.join(targetPath, ".raw"))).resolves.toBeUndefined()
  })
})
