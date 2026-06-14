import { lstat, mkdir, readFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { knowledgeBaseLogger } from "../logging"
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-raw-manager-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseRawFileManager", () => {
  it("hides only root internal placeholder files from directory listings", async () => {
    const rawRoot = await tempDir()
    await mkdir(path.join(rawRoot, "子目录"), { recursive: true })
    await writeFile(path.join(rawRoot, ".gitkeep"), "", "utf8")
    await writeFile(path.join(rawRoot, ".manifest.json"), "{}\n", "utf8")
    await writeFile(path.join(rawRoot, "brief.md"), "brief\n", "utf8")
    await writeFile(path.join(rawRoot, "子目录", ".gitkeep"), "user file\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const rootEntries = await manager.list(rawRoot, "")
    const childEntries = await manager.list(rawRoot, "子目录")

    expect(rootEntries.map((entry) => entry.name)).toEqual(["子目录", "brief.md"])
    expect(childEntries.map((entry) => entry.name)).toEqual([".gitkeep"])
  })

  it("lists raw directory pages with total metadata", async () => {
    const rawRoot = await tempDir()
    await writeFile(path.join(rawRoot, "a.md"), "a\n", "utf8")
    await writeFile(path.join(rawRoot, "b.md"), "b\n", "utf8")
    await writeFile(path.join(rawRoot, "c.md"), "c\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.listPage(rawRoot, "", { offset: 1, limit: 1 })

    expect(result.entries.map((entry) => entry.name)).toEqual(["b.md"])
    expect(result.totalCount).toBe(3)
    expect(result.offset).toBe(1)
    expect(result.limit).toBe(1)
    expect(result.hasMore).toBe(true)
  })

  it("lists only raw child directories for tree refreshes", async () => {
    const rawRoot = await tempDir()
    await mkdir(path.join(rawRoot, "会议资料"), { recursive: true })
    await writeFile(path.join(rawRoot, "brief.md"), "brief\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.listPage(rawRoot, "", { entryKind: "directory" })

    expect(result.entries.map((entry) => entry.name)).toEqual(["会议资料"])
    expect(result.totalCount).toBe(1)
  })

  it("rejects Windows-incompatible folder names before creating raw directories", async () => {
    const rawRoot = await tempDir()
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    for (const name of ["CON", "con.txt", "AUX", "COM1", "LPT9", "bad:name", "bad?name", "tail.", "tail "]) {
      await expect(manager.createFolder(rawRoot, "", name)).rejects.toThrow("名称包含 Windows 不支持的字符或保留名。")
      await expect(lstat(path.join(rawRoot, name))).rejects.toMatchObject({ code: "ENOENT" })
    }
  })

  it("rejects Windows-incompatible rename targets without moving the raw entry", async () => {
    const rawRoot = await tempDir()
    await writeFile(path.join(rawRoot, "note.md"), "note\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    for (const name of ["NUL", "PRN.txt", "bad|name", "bad<name", "tail.", "tail "]) {
      await expect(manager.renameEntry(rawRoot, "note.md", name)).rejects.toThrow("名称包含 Windows 不支持的字符或保留名。")
      await expect(readFile(path.join(rawRoot, "note.md"), "utf8")).resolves.toBe("note\n")
      await expect(lstat(path.join(rawRoot, name))).rejects.toMatchObject({ code: "ENOENT" })
    }
  })

  it("logs skipped uploads without raw absolute paths", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const rawRoot = await tempDir()
    const inputDir = await tempDir()
    const missingPath = path.join(inputDir, "missing.md")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
    })

    const result = await manager.uploadFiles(rawRoot, "", [missingPath])

    expect(result).toEqual({
      entries: [],
      skipped: [{ path: missingPath, reason: "read-error" }],
    })
    expect(warn).toHaveBeenCalledWith("Knowledge Base raw file upload skipped.", expect.objectContaining({
      fileName: "missing.md",
      reason: "read-error",
    }))
    expect(String((warn.mock.calls[0]?.[1] as { error?: unknown } | undefined)?.error)).not.toContain(inputDir)
  })

  it("keeps concurrent uploads with the same basename as separate files", async () => {
    const rawRoot = await tempDir()
    const firstInputDir = await tempDir()
    const secondInputDir = await tempDir()
    const firstSource = path.join(firstInputDir, "brief.md")
    const secondSource = path.join(secondInputDir, "brief.md")
    await writeFile(firstSource, "alpha\n", "utf8")
    await writeFile(secondSource, "bravo\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
    })

    const [firstResult, secondResult] = await Promise.all([
      manager.uploadFiles(rawRoot, "", [firstSource]),
      manager.uploadFiles(rawRoot, "", [secondSource]),
    ])

    const uploaded = [...firstResult.entries, ...secondResult.entries]
    expect(uploaded.map((entry) => entry.name).sort()).toEqual(["brief-2.md", "brief.md"])
    await expect(Promise.all(uploaded.map((entry) =>
      readFile(path.join(rawRoot, entry.relativePath), "utf8")
    ))).resolves.toEqual(expect.arrayContaining(["alpha\n", "bravo\n"]))
  })

  it("uploads folders recursively while preserving structure and skipping system noise", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "会议资料")
    await mkdir(path.join(folder, "访谈"), { recursive: true })
    await writeFile(path.join(folder, "01.pdf"), "pdf\n", "utf8")
    await writeFile(path.join(folder, ".DS_Store"), "noise\n", "utf8")
    await writeFile(path.join(folder, "访谈", ".gitignore"), "keep\n", "utf8")
    await writeFile(path.join(folder, "访谈", "a.md"), "note\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.uploadItems(rawRoot, "项目A", [folder])

    expect(result.skipped).toEqual([{ path: path.join(folder, ".DS_Store"), reason: "system-noise" }])
    expect(warn).toHaveBeenCalledWith("Knowledge Base raw item upload skipped.", {
      itemName: ".DS_Store",
      reason: "system-noise",
    })
    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
      "项目A/会议资料",
      "项目A/会议资料/01.pdf",
      "项目A/会议资料/访谈",
      "项目A/会议资料/访谈/.gitignore",
      "项目A/会议资料/访谈/a.md",
    ])
    await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "访谈", ".gitignore"), "utf8"))
      .resolves.toBe("keep\n")
  })

  it("merges folder collisions and renames colliding files during recursive upload", async () => {
    const rawRoot = await tempDir()
    await mkdir(path.join(rawRoot, "项目A", "会议资料"), { recursive: true })
    await writeFile(path.join(rawRoot, "项目A", "会议资料", "01.pdf"), "old\n", "utf8")
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "会议资料")
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, "01.pdf"), "new\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.uploadItems(rawRoot, "项目A", [folder])

    expect(result.skipped).toEqual([])
    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
      "项目A/会议资料",
      "项目A/会议资料/01-2.pdf",
    ])
    await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "01.pdf"), "utf8"))
      .resolves.toBe("old\n")
    await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "01-2.pdf"), "utf8"))
      .resolves.toBe("new\n")
  })

  it("skips symlinks during recursive upload", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "资料")
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(sourceRoot, "real.md"), "real\n", "utf8")
    await symlink(path.join(sourceRoot, "real.md"), path.join(folder, "link.md"))
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.uploadItems(rawRoot, "", [folder])

    expect(result.entries.map((entry) => entry.relativePath)).toEqual(["资料"])
    expect(result.skipped).toEqual([{ path: path.join(folder, "link.md"), reason: "symlink" }])
  })

  it("exports a file to an external directory with collision-safe names", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await writeFile(path.join(rawRoot, "brief.md"), "new\n", "utf8")
    await writeFile(path.join(exportRoot, "brief.md"), "old\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.exportEntries(rawRoot, ["brief.md"], exportRoot)

    expect(result.skipped).toEqual([])
    expect(result.entries.map((entry) => entry.relativePath)).toEqual(["brief.md"])
    await expect(readFile(path.join(exportRoot, "brief.md"), "utf8")).resolves.toBe("old\n")
    await expect(readFile(path.join(exportRoot, "brief-2.md"), "utf8")).resolves.toBe("new\n")
  })

  it("exports a folder shell and merges destination folder collisions", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await mkdir(path.join(rawRoot, "会议资料", "访谈"), { recursive: true })
    await writeFile(path.join(rawRoot, "会议资料", "01.pdf"), "new\n", "utf8")
    await mkdir(path.join(exportRoot, "会议资料"), { recursive: true })
    await writeFile(path.join(exportRoot, "会议资料", "01.pdf"), "old\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.exportEntries(rawRoot, ["会议资料"], exportRoot)

    expect(result.skipped).toEqual([])
    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
      "会议资料",
      "会议资料/01.pdf",
      "会议资料/访谈",
    ])
    await expect(readFile(path.join(exportRoot, "会议资料", "01.pdf"), "utf8")).resolves.toBe("old\n")
    await expect(readFile(path.join(exportRoot, "会议资料", "01-2.pdf"), "utf8")).resolves.toBe("new\n")
  })

  it("does not export root internal files when exporting the raw root", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await writeFile(path.join(rawRoot, ".gitkeep"), "", "utf8")
    await writeFile(path.join(rawRoot, ".manifest.json"), "{}\n", "utf8")
    await writeFile(path.join(rawRoot, "brief.md"), "brief\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.exportEntries(rawRoot, [""], exportRoot)
    const exportedRoot = path.join(exportRoot, path.basename(rawRoot))

    expect(result.skipped).toEqual([])
    expect(result.entries.map((entry) => entry.relativePath)).not.toContain(".gitkeep")
    expect(result.entries.map((entry) => entry.relativePath)).not.toContain(".manifest.json")
    await expect(readFile(path.join(exportedRoot, "brief.md"), "utf8")).resolves.toBe("brief\n")
    await expect(readFile(path.join(exportedRoot, ".gitkeep"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(exportedRoot, ".manifest.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects raw path traversal during export", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.exportEntries(rawRoot, ["../secret.md"], exportRoot)

    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([{ path: "../secret.md", reason: "invalid-path" }])
  })

  it("does not report a raw entry as trashed when trashing fails", async () => {
    const rawRoot = await tempDir()
    await writeFile(path.join(rawRoot, "locked.md"), "locked\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: vi.fn(async () => {
        throw new Error("trash failed")
      }),
    })

    const result = await manager.trashEntries(rawRoot, ["locked.md"])

    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([{ path: "locked.md", reason: "trash-error" }])
    await expect(readFile(path.join(rawRoot, "locked.md"), "utf8")).resolves.toBe("locked\n")
  })
})
