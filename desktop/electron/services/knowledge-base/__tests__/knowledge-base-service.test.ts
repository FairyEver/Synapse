import { access, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseService, KNOWLEDGE_BASE_TEMPLATE_VERSION } from "../knowledge-base-service"

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
}))

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
    await unlink(path.join(targetPath, "wiki", "log.md"))

    const result = await service.initialize({ projectPath: targetPath, mode: "repair" })

    expect(result.createdFiles).toContain("wiki/log.md")
    expect(result.createdFiles).not.toContain("wiki/hot.md")
    await expect(readFile(path.join(targetPath, "wiki", "log.md"), "utf8")).resolves.toContain("# Knowledge Log")
    await expect(readFile(path.join(targetPath, "wiki", "hot.md"), "utf8")).resolves.toBe("# Custom Hot\n")
  })

  it("rejects create mode when the target is already a knowledge base", async () => {
    const targetPath = await tempDir()
    const service = new KnowledgeBaseService()
    await service.initialize({ projectPath: targetPath, mode: "create" })

    await expect(service.initialize({ projectPath: targetPath, mode: "create" })).rejects.toThrow("知识库已存在")
  })

  it("rejects required writes through symlinked project directories", async () => {
    const targetPath = await tempDir()
    const outsidePath = await tempDir()
    const service = new KnowledgeBaseService()
    await symlink(outsidePath, path.join(targetPath, "wiki"), "dir")

    await expect(service.initialize({ projectPath: targetPath, mode: "repair" })).rejects.toThrow("符号链接")
    await expect(readFile(path.join(outsidePath, "log.md"), "utf8")).rejects.toThrow()
  })

  it("rejects required writes through dangling symlinked file paths", async () => {
    const targetPath = await tempDir()
    const outsidePath = await tempDir()
    const outsideLogPath = path.join(outsidePath, "log.md")
    const service = new KnowledgeBaseService()
    await service.initialize({ projectPath: targetPath, mode: "create" })
    await unlink(path.join(targetPath, "wiki", "log.md"))
    await symlink(outsideLogPath, path.join(targetPath, "wiki", "log.md"))

    await expect(service.initialize({ projectPath: targetPath, mode: "repair" })).rejects.toThrow("符号链接")
    await expect(readFile(outsideLogPath, "utf8")).rejects.toThrow()
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
