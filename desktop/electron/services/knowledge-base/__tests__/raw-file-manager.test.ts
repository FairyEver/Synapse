import { chmod, lstat, mkdir, readFile, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { knowledgeBaseLogger } from "../logging"
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"

const roots: string[] = []
const itSupportsPosixModeBits = process.platform === "win32" ? it.skip : it

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
    await writeFile(path.join(rawRoot, "子目录", ".manifest.json"), "user manifest\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const rootEntries = await manager.list(rawRoot, "")
    const childEntries = await manager.list(rawRoot, "子目录")

    expect(rootEntries.map((entry) => entry.name)).toEqual(["子目录", "brief.md"])
    expect(childEntries.map((entry) => entry.name)).toEqual([".gitkeep", ".manifest.json"])
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

  it("skips direct file uploads with Windows-incompatible basenames", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const reservedSource = path.join(sourceRoot, "CON.txt")
    const okSource = path.join(sourceRoot, "ok.md")
    await writeFile(reservedSource, "reserved\n", "utf8")
    await writeFile(okSource, "ok\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.uploadFiles(rawRoot, "", [reservedSource, okSource])

    expect(result.entries.map((entry) => entry.relativePath)).toEqual(["ok.md"])
    expect(result.skipped).toEqual([{ path: reservedSource, reason: "invalid-name" }])
    await expect(lstat(path.join(rawRoot, "CON.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(rawRoot, "ok.md"), "utf8")).resolves.toBe("ok\n")
  })

  it("stops direct file upload when the file count budget is reached", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const firstSource = path.join(sourceRoot, "a.md")
    const secondSource = path.join(sourceRoot, "b.md")
    await writeFile(firstSource, "a\n", "utf8")
    await writeFile(secondSource, "b\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxFiles: 1 },
    })

    const result = await manager.uploadFiles(rawRoot, "", [firstSource, secondSource])

    expect(result.entries.map((entry) => entry.relativePath)).toEqual(["a.md"])
    expect(result.skipped).toEqual([{ path: secondSource, reason: "too-many-files" }])
    await expect(lstat(path.join(rawRoot, "b.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("skips direct file uploads that exceed byte budgets", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const bigSource = path.join(sourceRoot, "big.md")
    const firstSource = path.join(sourceRoot, "first.md")
    const secondSource = path.join(sourceRoot, "second.md")
    await writeFile(bigSource, "12345", "utf8")
    await writeFile(firstSource, "1234", "utf8")
    await writeFile(secondSource, "1234", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxFileBytes: 4, maxTotalBytes: 6 },
    })

    const result = await manager.uploadFiles(rawRoot, "", [bigSource, firstSource, secondSource])

    expect(result.entries.map((entry) => entry.relativePath)).toEqual(["first.md"])
    expect(result.skipped).toEqual([
      { path: bigSource, reason: "file-too-large" },
      { path: secondSource, reason: "too-large" },
    ])
    await expect(lstat(path.join(rawRoot, "big.md"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(path.join(rawRoot, "second.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("does not spend direct upload budget when file copy fails", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const unreadableSource = path.join(sourceRoot, "unreadable.md")
    const okSource = path.join(sourceRoot, "ok.md")
    await writeFile(unreadableSource, "1234", "utf8")
    await writeFile(okSource, "5678", "utf8")
    await chmod(unreadableSource, 0o000)
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxTotalBytes: 4 },
    })

    const result = await manager.uploadFiles(rawRoot, "", [unreadableSource, okSource])

    await chmod(unreadableSource, 0o644).catch(() => undefined)
    expect(warn).toHaveBeenCalledWith("Knowledge Base raw file upload skipped.", expect.objectContaining({
      fileName: "unreadable.md",
      reason: "read-error",
    }))
    expect(result.entries.map((entry) => entry.relativePath)).toEqual(["ok.md"])
    expect(result.skipped).toEqual([{ path: unreadableSource, reason: "read-error" }])
    await expect(readFile(path.join(rawRoot, "ok.md"), "utf8")).resolves.toBe("5678")
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

  it("skips recursive uploads with Windows-incompatible basenames", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const unsafeFolder = path.join(sourceRoot, "AUX")
    const safeFolder = path.join(sourceRoot, "safe")
    await mkdir(unsafeFolder, { recursive: true })
    await writeFile(path.join(unsafeFolder, "ignored.md"), "ignored\n", "utf8")
    await mkdir(safeFolder, { recursive: true })
    await writeFile(path.join(safeFolder, "NUL.txt"), "reserved\n", "utf8")
    await writeFile(path.join(safeFolder, "ok.md"), "ok\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.uploadItems(rawRoot, "", [unsafeFolder, safeFolder])

    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
      "safe",
      "safe/ok.md",
    ])
    expect(result.skipped).toEqual([
      { path: unsafeFolder, reason: "invalid-name" },
      { path: path.join(safeFolder, "NUL.txt"), reason: "invalid-name" },
    ])
    await expect(lstat(path.join(rawRoot, "AUX"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(path.join(rawRoot, "safe", "NUL.txt"))).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(rawRoot, "safe", "ok.md"), "utf8")).resolves.toBe("ok\n")
  })

  it("keeps repeated top-level folder uploads separate", async () => {
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
      "项目A/会议资料-2",
      "项目A/会议资料-2/01.pdf",
    ])
    await expect(readFile(path.join(rawRoot, "项目A", "会议资料", "01.pdf"), "utf8"))
      .resolves.toBe("old\n")
    await expect(readFile(path.join(rawRoot, "项目A", "会议资料-2", "01.pdf"), "utf8"))
      .resolves.toBe("new\n")
  })

  itSupportsPosixModeBits("does not leave an empty raw folder when the source directory cannot be read", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "locked")
    await mkdir(folder, { recursive: true })
    await chmod(folder, 0)
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    try {
      const result = await manager.uploadItems(rawRoot, "", [folder])

      expect(result.entries).toEqual([])
      expect(result.skipped).toEqual([{ path: folder, reason: "read-error" }])
      await expect(lstat(path.join(rawRoot, "locked"))).rejects.toMatchObject({ code: "ENOENT" })
    } finally {
      await chmod(folder, 0o700)
    }
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

  it("stops recursive upload when the file count budget is reached", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "资料")
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, "a.md"), "a\n", "utf8")
    await writeFile(path.join(folder, "b.md"), "b\n", "utf8")
    await writeFile(path.join(folder, "c.md"), "c\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxFiles: 2 },
    })

    const result = await manager.uploadItems(rawRoot, "", [folder])

    expect(result.entries.filter((entry) => entry.kind === "file")).toHaveLength(2)
    expect(result.skipped).toEqual([{ path: path.join(folder, "c.md"), reason: "too-many-files" }])
  })

  it("skips files that exceed recursive upload byte budgets", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "资料")
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, "big.md"), "12345", "utf8")
    await writeFile(path.join(folder, "first.md"), "1234", "utf8")
    await writeFile(path.join(folder, "second.md"), "1234", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxFileBytes: 4, maxTotalBytes: 6 },
    })

    const result = await manager.uploadItems(rawRoot, "", [folder])

    expect(result.entries.map((entry) => entry.relativePath)).toEqual([
      "资料",
      "资料/first.md",
    ])
    expect(result.skipped).toEqual([
      { path: path.join(folder, "big.md"), reason: "file-too-large" },
      { path: path.join(folder, "second.md"), reason: "too-large" },
    ])
  })

  it("does not spend recursive upload budget when file copy fails", async () => {
    const warn = vi.spyOn(knowledgeBaseLogger, "warn").mockImplementation(() => undefined)
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "资料")
    await mkdir(folder, { recursive: true })
    const unreadableSource = path.join(folder, "a-unreadable.md")
    const okSource = path.join(folder, "b-ok.md")
    await writeFile(unreadableSource, "1234", "utf8")
    await writeFile(okSource, "5678", "utf8")
    await chmod(unreadableSource, 0o000)
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxTotalBytes: 4 },
    })

    const result = await manager.uploadItems(rawRoot, "", [folder])

    await chmod(unreadableSource, 0o644).catch(() => undefined)
    expect(warn).toHaveBeenCalledWith("Knowledge Base raw item upload skipped.", expect.objectContaining({
      itemName: "a-unreadable.md",
      reason: "read-error",
    }))
    expect(result.entries.map((entry) => entry.relativePath)).toEqual([
      "资料",
      "资料/b-ok.md",
    ])
    expect(result.skipped).toEqual([{ path: unreadableSource, reason: "read-error" }])
    await expect(readFile(path.join(rawRoot, "资料", "b-ok.md"), "utf8")).resolves.toBe("5678")
  })

  it("stops recursive upload when the directory depth budget is reached", async () => {
    const rawRoot = await tempDir()
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "资料")
    await mkdir(path.join(folder, "一级", "二级"), { recursive: true })
    await writeFile(path.join(folder, "一级", "二级", "note.md"), "note\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      uploadLimits: { maxDepth: 1 },
    })

    const result = await manager.uploadItems(rawRoot, "", [folder])

    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
      "资料",
      "资料/一级",
    ])
    expect(result.skipped).toEqual([{ path: path.join(folder, "一级", "二级"), reason: "too-deep" }])
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

  it("rejects export targets inside the raw directory before copying", async () => {
    const rawRoot = await tempDir()
    await writeFile(path.join(rawRoot, "brief.md"), "brief\n", "utf8")
    const unsafeTarget = path.join(rawRoot, "exported")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    await expect(manager.exportEntries(rawRoot, ["brief.md"], unsafeTarget))
      .rejects.toThrow("导出目标不能位于知识库资料目录内。")
    await expect(lstat(unsafeTarget)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects raw export targets whose existing parent symlink resolves inside the raw directory", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await writeFile(path.join(rawRoot, "brief.md"), "brief\n", "utf8")
    const linkTarget = path.join(exportRoot, "raw-link")
    await symlink(rawRoot, linkTarget, "dir")
    const unsafeTarget = path.join(linkTarget, "staging")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    await expect(manager.exportEntries(rawRoot, ["brief.md"], unsafeTarget))
      .rejects.toThrow("导出目标不能位于知识库资料目录内。")
    await expect(lstat(path.join(rawRoot, "staging"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rejects raw export targets with names that start with dot-dot", async () => {
    const rawRoot = await tempDir()
    await writeFile(path.join(rawRoot, "brief.md"), "brief\n", "utf8")
    const unsafeTarget = path.join(rawRoot, "..backup")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    await expect(manager.exportEntries(rawRoot, ["brief.md"], unsafeTarget))
      .rejects.toThrow("导出目标不能位于知识库资料目录内。")
    await expect(lstat(unsafeTarget)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("exports a folder shell with collision-safe destination names", async () => {
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
    await expect(readFile(path.join(exportRoot, "会议资料-2", "01.pdf"), "utf8")).resolves.toBe("new\n")
  })

  it("keeps exported same-name folders from different parents separate", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await mkdir(path.join(rawRoot, "客户A", "资料"), { recursive: true })
    await mkdir(path.join(rawRoot, "客户B", "资料"), { recursive: true })
    await writeFile(path.join(rawRoot, "客户A", "资料", "brief.md"), "alpha\n", "utf8")
    await writeFile(path.join(rawRoot, "客户B", "资料", "brief.md"), "bravo\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({ trashItem: async () => undefined })

    const result = await manager.exportEntries(rawRoot, ["客户A/资料", "客户B/资料"], exportRoot)

    expect(result.skipped).toEqual([])
    expect(result.entries.map((entry) => entry.relativePath).sort()).toEqual([
      "客户A/资料",
      "客户A/资料/brief.md",
      "客户B/资料",
      "客户B/资料/brief.md",
    ])
    await expect(readFile(path.join(exportRoot, "资料", "brief.md"), "utf8")).resolves.toBe("alpha\n")
    await expect(readFile(path.join(exportRoot, "资料-2", "brief.md"), "utf8")).resolves.toBe("bravo\n")
  })

  it("skips folder export without partial copies when the recursive file budget is exceeded", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await mkdir(path.join(rawRoot, "会议资料"), { recursive: true })
    await writeFile(path.join(rawRoot, "会议资料", "01.md"), "one\n", "utf8")
    await writeFile(path.join(rawRoot, "会议资料", "02.md"), "two\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      exportLimits: { maxFiles: 1 },
    })

    const result = await manager.exportEntries(rawRoot, ["会议资料"], exportRoot)

    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([{ path: "会议资料", reason: "too-many-files" }])
    await expect(readFile(path.join(exportRoot, "会议资料", "01.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(exportRoot, "会议资料", "02.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("skips folder export without partial copies when the recursive depth budget is exceeded", async () => {
    const rawRoot = await tempDir()
    const exportRoot = await tempDir()
    await mkdir(path.join(rawRoot, "资料", "一级", "二级"), { recursive: true })
    await writeFile(path.join(rawRoot, "资料", "一级", "二级", "note.md"), "note\n", "utf8")
    const manager = new KnowledgeBaseRawFileManager({
      trashItem: async () => undefined,
      exportLimits: { maxDepth: 1 },
    })

    const result = await manager.exportEntries(rawRoot, ["资料"], exportRoot)

    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([{ path: "资料", reason: "too-deep" }])
    await expect(readFile(path.join(exportRoot, "资料", "一级", "二级", "note.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
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
