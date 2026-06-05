import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseService } from "../knowledge-base-service"
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"
import type { FileConversionResult } from "../../file-conversion"

const mocks = vi.hoisted(() => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => path.join(os.tmpdir(), "synapse-kb-userdata"),
  },
  shell: {
    trashItem: vi.fn(),
  },
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => mocks.logger,
}))

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-"))
  roots.push(dir)
  return dir
}

type KnowledgeBaseServiceOptions = ConstructorParameters<typeof KnowledgeBaseService>[0]

async function managedFixture(options: KnowledgeBaseServiceOptions = {}) {
  const projectId = "kb-1"
  const userDataPath = await tempDir()
  const projectPath = path.join(userDataPath, "knowledge-bases", projectId)
  await mkdir(projectPath, { recursive: true })
  const service = new KnowledgeBaseService({
    ...options,
    userDataPath,
    loadConfig: async () => ({
      activeRepoUuid: null,
      repositories: [],
      global: {
        themeMode: "system",
        favorites: { rule: [], skill: [], prompt: [] },
        recentlyViewed: { rule: [], skill: [], prompt: [] },
        contentSortOrder: "modified-desc",
        variables: [],
        quickInputs: [],
        defaultQuickInputsSeededVersion: null,
        projects: [{
          id: projectId,
          name: "Knowledge",
          path: `synapse-kb://${projectId}`,
          capabilities: {
            knowledgeBase: {
              enabled: true,
              schemaVersion: 1,
              templateVersion: "2026-05-24",
              managed: true,
              runtimeId: projectId,
            },
          },
        }],
      },
      agent: { defaultPermissionMode: "default", defaultProviderModel: null },
    }),
  })
  return { projectId, projectPath, service }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseService", () => {
  it("creates managed knowledge base runtime from template", async () => {
    const templateRoot = await tempDir()
    await mkdir(path.join(templateRoot, "wiki"), { recursive: true })
    await mkdir(path.join(templateRoot, ".raw"), { recursive: true })
    await mkdir(path.join(templateRoot, ".vault-meta"), { recursive: true })
    await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
    await writeFile(path.join(templateRoot, "wiki", "example.md"), "# Example\n", "utf8")
    await writeFile(path.join(templateRoot, ".raw", "example.md"), "# Raw Example\n", "utf8")
    await writeFile(path.join(templateRoot, ".raw", ".manifest.json"), "{\"sources\":{\".raw/example.md\":{}}}\n", "utf8")
    await writeFile(path.join(templateRoot, ".vault-meta", "address-counter.txt"), "3\n", "utf8")
    await writeFile(path.join(templateRoot, ".vault-meta", "tiling-thresholds.json"), "{\"version\":1}\n", "utf8")
    await writeFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"kb\"}\n", "utf8")
    await writeFile(path.join(templateRoot, "SOURCE.json"), JSON.stringify({
      repo: "https://github.com/AgriciDaniel/claude-obsidian",
      commit: "75d3b6feb77b96c6bb16599c4550cc9703553d87",
      syncedAt: "2026-05-24",
    }), "utf8")

    const userDataPath = await tempDir()
    const service = new KnowledgeBaseService({ managedTemplateRoot: templateRoot, userDataPath })
    const result = await service.createManaged({ projectId: "kb-1", name: "Knowledge" })

    expect(result.projectId).toBe("kb-1")
    expect(result.projectPath).toBe("synapse-kb://kb-1")
    expect(result.runtimePath).toBe(path.join(userDataPath, "knowledge-bases", "kb-1"))
    expect(result.templateSource?.commit).toBe("75d3b6feb77b96c6bb16599c4550cc9703553d87")
    expect(mocks.logger.info).toHaveBeenCalledWith("Managed Knowledge Base runtime created.", expect.objectContaining({
      projectId: "kb-1",
      runtimePath: result.runtimePath,
      templateVersion: "2026-05-21",
      templateSourceCommit: "75d3b6feb77b96c6bb16599c4550cc9703553d87",
    }))
    await expect(readFile(path.join(result.runtimePath, "wiki", "index.md"), "utf8")).resolves.toBe("# Index\n\nNo entries yet.\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "log.md"), "utf8")).resolves.toBe("# Log\n\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "hot.md"), "utf8")).resolves.toBe("# Hot\n\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "overview.md"), "utf8")).resolves.toBe("# Overview\n\nNo entries yet.\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "sources", "_index.md"), "utf8")).resolves.toBe("# Sources\n\nNo entries yet.\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "concepts", "_index.md"), "utf8")).resolves.toBe("# Concepts\n\nNo entries yet.\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "entities", "_index.md"), "utf8")).resolves.toBe("# Entities\n\nNo entries yet.\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "questions", "_index.md"), "utf8")).resolves.toBe("# Questions\n\nNo entries yet.\n")
    await expect(readFile(path.join(result.runtimePath, "wiki", "example.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(result.runtimePath, ".raw", "example.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(path.join(result.runtimePath, ".raw", ".gitkeep"), "utf8")).resolves.toBe("")
    await expect(readFile(path.join(result.runtimePath, ".raw", ".manifest.json"), "utf8"))
      .resolves.toBe(`${JSON.stringify({ version: 1, sources: {}, address_map: {} }, null, 2)}\n`)
    await expect(readFile(path.join(result.runtimePath, ".vault-meta", "address-counter.txt"), "utf8")).resolves.toBe("1\n")
    await expect(readFile(path.join(result.runtimePath, ".vault-meta", "tiling-thresholds.json"), "utf8")).resolves.toBe("{\"version\":1}\n")
    await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8")).resolves.toContain("kb")
    await expect(readFile(path.join(templateRoot, ".vault-meta", "address-counter.txt"), "utf8")).resolves.toBe("3\n")
  })

  it("rejects concurrent managed knowledge base creation for the same project", async () => {
    const templateRoot = await tempDir()
    await mkdir(path.join(templateRoot, "wiki"), { recursive: true })
    await mkdir(path.join(templateRoot, ".raw"), { recursive: true })
    await mkdir(path.join(templateRoot, ".vault-meta"), { recursive: true })
    await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
    await writeFile(path.join(templateRoot, ".vault-meta", "address-counter.txt"), "3\n", "utf8")
    await writeFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"kb\"}\n", "utf8")

    const userDataPath = await tempDir()
    const service = new KnowledgeBaseService({ managedTemplateRoot: templateRoot, userDataPath })

    const results = await Promise.allSettled([
      service.createManaged({ projectId: "kb-1", name: "Knowledge" }),
      service.createManaged({ projectId: "kb-1", name: "Knowledge" }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = results.find((result) => result.status === "rejected")
    expect(rejected).toBeDefined()
    expect(rejected?.reason).toEqual(expect.objectContaining({
      message: "知识库正在创建，请稍后重试。",
    }))
    expect(mocks.logger.warn).toHaveBeenCalledWith("Managed Knowledge Base create rejected because project creation is already active.", {
      projectId: "kb-1",
    })
  })

  it("logs when a managed knowledge base runtime already exists", async () => {
    const userDataPath = await tempDir()
    const runtimePath = path.join(userDataPath, "knowledge-bases", "kb-1")
    await mkdir(runtimePath, { recursive: true })
    const service = new KnowledgeBaseService({ userDataPath })

    await expect(service.createManaged({ projectId: "kb-1", name: "Knowledge" })).rejects.toThrow("知识库已存在。")

    expect(mocks.logger.warn).toHaveBeenCalledWith("Managed Knowledge Base runtime already exists.", {
      projectId: "kb-1",
      runtimePath,
    })
  })

  it("removes a partially created managed runtime when initialization fails", async () => {
    const userDataPath = await tempDir()
    const templateRoot = path.join(userDataPath, "missing-template")
    const service = new KnowledgeBaseService({ managedTemplateRoot: templateRoot, userDataPath })
    const runtimePath = path.join(userDataPath, "knowledge-bases", "kb-1")

    await expect(service.createManaged({ projectId: "kb-1", name: "Knowledge" })).rejects.toThrow()

    await expect(readFile(path.join(runtimePath, "wiki", "example.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
    expect(mocks.logger.warn).toHaveBeenCalledWith("Managed Knowledge Base runtime creation failed.", expect.objectContaining({
      errorName: "Error",
      projectId: "kb-1",
      runtimePath,
    }))
  })

  it("trashes managed knowledge base runtime", async () => {
    const { projectId, projectPath, service } = await managedFixture({
      trashItem: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })
    await writeFile(path.join(projectPath, "CLAUDE.md"), "# Knowledge\n", "utf8")

    const result = await service.deleteManaged({ projectId })

    expect(result).toEqual({
      projectId,
      runtimePath: projectPath,
      deleted: true,
    })
    await expect(readFile(path.join(projectPath, "CLAUDE.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("reports managed knowledge base runtime as already absent", async () => {
    const { projectId, projectPath, service } = await managedFixture({
      trashItem: vi.fn(),
    })
    await rm(projectPath, { recursive: true, force: true })

    await expect(service.deleteManaged({ projectId })).resolves.toEqual({
      projectId,
      runtimePath: projectPath,
      deleted: false,
    })
  })

  it("trashes managed knowledge base runtime by runtime id after project config is removed", async () => {
    const projectId = "kb-removed"
    const userDataPath = await tempDir()
    const projectPath = path.join(userDataPath, "knowledge-bases", projectId)
    await mkdir(projectPath, { recursive: true })
    await writeFile(path.join(projectPath, "CLAUDE.md"), "# Knowledge\n", "utf8")
    const service = new KnowledgeBaseService({
      userDataPath,
      loadConfig: async () => ({
        activeRepoUuid: null,
        repositories: [],
        global: {
          themeMode: "system",
          favorites: { rule: [], skill: [], prompt: [] },
          recentlyViewed: { rule: [], skill: [], prompt: [] },
          contentSortOrder: "modified-desc",
          variables: [],
          quickInputs: [],
          defaultQuickInputsSeededVersion: null,
          projects: [],
        },
        agent: { defaultPermissionMode: "default", defaultProviderModel: null },
      }),
      trashItem: (targetPath) => rm(targetPath, { recursive: true, force: true }),
    })

    const result = await service.deleteManaged({ projectId, runtimeId: projectId })

    expect(result).toEqual({
      projectId,
      runtimePath: projectPath,
      deleted: true,
    })
    await expect(readFile(path.join(projectPath, "CLAUDE.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("lists raw source files with user-facing import statuses", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "note.md"), "alpha\n")
    await writeFile(path.join(projectPath, ".raw", "deck.pdf"), "binary")
    const initial = await service.listSources(projectId)
    const note = initial.sources.find((source) => source.relativePath === ".raw/note.md")
    if (!note) throw new Error("expected note source")
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), `${JSON.stringify({
      version: 1,
      sources: {
        ".raw/note.md": {
          hash: note.hash,
          ingested_at: "2026-05-23T00:00:00.000Z",
          pages_created: [],
          pages_updated: [],
        },
      },
    })}\n`)
    mocks.logger.info.mockClear()

    const result = await service.listSources(projectId)

    expect(result.sources.map((source) => ({
      relativePath: source.relativePath,
      status: source.status,
      supported: source.supported,
    }))).toEqual([
      { relativePath: ".raw/deck.pdf", status: "unsupported", supported: false },
      { relativePath: ".raw/note.md", status: "imported", supported: true },
    ])
    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base sources listed.", {
      projectId,
      sourceCount: 2,
      statusCounts: {
        imported: 1,
        unsupported: 1,
      },
    })
  })

  it("uploads source files into a date folder with collision-safe names", async () => {
    const sourcePath = path.join(await tempDir(), "note.md")
    await writeFile(sourcePath, "alpha\n")
    const { projectId, projectPath, service } = await managedFixture({
      now: () => new Date("2026-05-23T10:20:30.000Z"),
    })

    const first = await service.uploadSources({ projectId, filePaths: [sourcePath] })
    const second = await service.uploadSources({ projectId, filePaths: [sourcePath] })

    expect(first.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/2026/05/23/note.md",
    })])
    expect(second.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/2026/05/23/note-2.md",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "2026", "05", "23", "note.md"), "utf8"))
      .resolves.toBe("alpha\n")
    await expect(readFile(path.join(projectPath, ".raw", "2026", "05", "23", "note-2.md"), "utf8"))
      .resolves.toBe("alpha\n")
  })

  it("adds a URL source through the injected fetch boundary", async () => {
    const { projectId, projectPath, service } = await managedFixture({
      now: () => new Date("2026-05-24T10:20:30.000Z"),
      fetchUrl: async () => ({
        url: "https://example.com/article",
        status: 200,
        headers: { get: (name: string) => name.toLowerCase() === "content-type" ? "text/html" : null },
        text: async () => "<html><body><h1>Article</h1><p>Body</p></body></html>",
      }),
    })

    const result = await service.addUrlSource({
      projectId,
      url: "https://example.com/article",
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: "https://example.com/article",
      relativePath: ".raw/web/2026/05/24/article.md",
      sourceKind: "url",
      sourceUrl: "https://example.com/article",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "web", "2026", "05", "24", "article.md"), "utf8"))
      .resolves.toContain('source_url: "https://example.com/article"')
  })

  it("lists raw directory entries without source import statuses", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw", "projects"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "brief.md"), "alpha\n")
    await writeFile(path.join(projectPath, ".raw", ".gitkeep"), "")
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{}}\n")
    mocks.logger.info.mockClear()

    const result = await service.listRawDirectory({
      projectId,
      directoryPath: "",
    })

    expect(result).toMatchObject({
      projectId,
      directoryPath: "",
    })
    expect(result.entries.map((entry) => ({
      name: entry.name,
      relativePath: entry.relativePath,
      kind: entry.kind,
      size: entry.size,
    }))).toEqual([
      { name: "projects", relativePath: "projects", kind: "directory", size: null },
      { name: "brief.md", relativePath: "brief.md", kind: "file", size: 6 },
    ])
    expect(result.entries.some((entry) => entry.name === ".gitkeep")).toBe(false)
    expect(result.entries.some((entry) => entry.name === ".manifest.json")).toBe(false)
    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw directory listed.", {
      projectId,
      directoryPath: "",
      entryCount: 2,
      directoryCount: 1,
      fileCount: 1,
    })
  })

  it("uploads raw files into the selected raw folder without conversion", async () => {
    const sourcePath = path.join(await tempDir(), "report.docx")
    await writeFile(sourcePath, "binary")
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw", "client-a"), { recursive: true })

    const result = await service.uploadRawFiles({
      projectId,
      targetDirectoryPath: "client-a",
      filePaths: [sourcePath],
    })

    expect(result.entries).toEqual([expect.objectContaining({
      name: "report.docx",
      relativePath: "client-a/report.docx",
      kind: "file",
      size: 6,
    })])
    await expect(readFile(path.join(projectPath, ".raw", "client-a", "report.docx"), "utf8"))
      .resolves.toBe("binary")
  })

  it("uploads raw items without invoking source conversion", async () => {
    const sourceRoot = await tempDir()
    const folder = path.join(sourceRoot, "会议资料")
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, "01.pdf"), "pdf\n", "utf8")
    const convert = vi.fn(async (): Promise<FileConversionResult> => ({
      sourcePath: path.join(folder, "01.pdf"),
      format: "pdf",
      kind: "document",
      title: "01.pdf",
      markdown: "# 01\n",
      text: "01",
      metadata: {},
      warnings: [],
    }))
    const { projectId, projectPath, service } = await managedFixture({
      fileConversionService: { convert },
    })

    const result = await service.uploadRawItems({
      projectId,
      targetDirectoryPath: "",
      itemPaths: [folder],
    })

    expect(result.projectId).toBe(projectId)
    expect(result.entries.map((entry) => entry.relativePath)).toContain("会议资料/01.pdf")
    expect(convert).not.toHaveBeenCalled()
    await expect(readFile(path.join(projectPath, ".raw", "会议资料", "01.pdf"), "utf8"))
      .resolves.toBe("pdf\n")
  })

  it("exports raw entries through the raw file manager", async () => {
    const exportRoot = await tempDir()
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "brief.md"), "brief\n", "utf8")

    const result = await service.exportRawEntries({
      projectId,
      relativePaths: ["brief.md"],
      targetDirectoryPath: exportRoot,
    })

    expect(result).toEqual(expect.objectContaining({
      projectId,
      skipped: [],
    }))
    await expect(readFile(path.join(exportRoot, "brief.md"), "utf8")).resolves.toBe("brief\n")
  })

  it("renames and moves manifest-tracked raw entries without changing wiki files", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw", "client-a"), { recursive: true })
    await mkdir(path.join(projectPath, ".raw", "archive"), { recursive: true })
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "client-a", "brief.md"), "alpha\n")
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/client-a/brief.md": {
          hash: "hash-brief",
          ingested_at: "2026-05-24T00:00:00.000Z",
          pages_created: ["wiki/brief.md"],
        },
      },
      address_map: {
        "wiki/brief.md": "c-000001",
      },
    }, null, 2) + "\n")
    await writeFile(path.join(projectPath, "wiki", "brief.md"), "# Brief\n")

    const renamed = await service.renameRawEntry({
      projectId,
      relativePath: "client-a/brief.md",
      newName: "brief-renamed.md",
    })
    const moved = await service.moveRawEntries({
      projectId,
      relativePaths: ["client-a/brief-renamed.md"],
      targetDirectoryPath: "archive",
    })

    expect(renamed.entries).toEqual([expect.objectContaining({
      relativePath: "client-a/brief-renamed.md",
      kind: "file",
    })])
    expect(moved.entries).toEqual([expect.objectContaining({
      relativePath: "archive/brief-renamed.md",
      kind: "file",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "archive", "brief-renamed.md"), "utf8"))
      .resolves.toBe("alpha\n")
    const manifest = JSON.parse(await readFile(path.join(projectPath, ".raw", ".manifest.json"), "utf8")) as {
      sources: Record<string, unknown>
      address_map: Record<string, string>
    }
    expect(manifest.sources).not.toHaveProperty(".raw/client-a/brief.md")
    expect(manifest.sources).toHaveProperty(".raw/archive/brief-renamed.md", {
      hash: "hash-brief",
      ingested_at: "2026-05-24T00:00:00.000Z",
      pages_created: ["wiki/brief.md"],
    })
    expect(manifest.address_map).toEqual({ "wiki/brief.md": "c-000001" })
    await expect(readFile(path.join(projectPath, "wiki", "brief.md"), "utf8"))
      .resolves.toBe("# Brief\n")
  })

  it("trashes selected raw entries through the injected trash boundary", async () => {
    const trashItem = vi.fn(async () => undefined)
    const { projectId, projectPath, service } = await managedFixture({
      rawFileManager: new KnowledgeBaseRawFileManager({ trashItem }),
    })
    await mkdir(path.join(projectPath, ".raw", "folder"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "folder", "brief.md"), "alpha\n")
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/folder/brief.md": { hash: "hash-brief" },
        ".raw/keep.md": { hash: "hash-keep" },
      },
      address_map: {},
    }, null, 2) + "\n")

    const result = await service.trashRawEntries({
      projectId,
      relativePaths: ["folder/brief.md"],
    })

    expect(result.entries).toEqual([expect.objectContaining({
      relativePath: "folder/brief.md",
      kind: "file",
    })])
    expect(trashItem).toHaveBeenCalledWith(path.join(projectPath, ".raw", "folder", "brief.md"))
    const manifest = JSON.parse(await readFile(path.join(projectPath, ".raw", ".manifest.json"), "utf8")) as {
      sources: Record<string, unknown>
    }
    expect(manifest.sources).toEqual({
      ".raw/keep.md": { hash: "hash-keep" },
    })
  })

  it("logs raw mutation summaries without full external upload paths", async () => {
    const sourcePath = path.join(await tempDir(), "secret-client-name.md")
    await writeFile(sourcePath, "alpha\n")
    const { projectId, service } = await managedFixture()

    await service.uploadRawFiles({
      projectId,
      targetDirectoryPath: "",
      filePaths: [sourcePath],
    })

    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw mutation completed.", expect.objectContaining({
      affectedCount: 1,
      operation: "uploadRawFiles",
      projectId,
      skippedCount: 0,
    }))
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(sourcePath)
  })

  it("skips raw moves that target a directory inside itself", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw", "folder", "child"), { recursive: true })

    const result = await service.moveRawEntries({
      projectId,
      relativePaths: ["folder"],
      targetDirectoryPath: "folder/child",
    })

    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([{ path: "folder", reason: "invalid-path" }])
  })

  it("rejects raw rename through a symlink path", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    const outsidePath = await tempDir()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await symlink(outsidePath, path.join(projectPath, ".raw", "linked"))

    await expect(service.renameRawEntry({
      projectId,
      relativePath: "linked/file.md",
      newName: "renamed.md",
    })).rejects.toThrow("符号链接")
  })

  it("rejects managed knowledge base runtime roots that are symlinks", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    const outsidePath = await tempDir()
    await rm(projectPath, { recursive: true, force: true })
    await symlink(outsidePath, projectPath)

    await expect(service.listSources(projectId)).rejects.toThrow("知识库根目录不能是符号链接。")
  })

  it("rejects raw paths outside the raw directory", async () => {
    const { projectId, service } = await managedFixture()

    await expect(service.listRawDirectory({
      projectId,
      directoryPath: "../wiki",
    })).rejects.toThrow("目标路径不在资料目录中。")
    await expect(service.renameRawEntry({
      projectId,
      relativePath: "../wiki/index.md",
      newName: "index.md",
    })).rejects.toThrow("目标路径不在资料目录中。")
  })

  it("uploads convertible files as generated markdown sources", async () => {
    const sourcePath = path.join(await tempDir(), "report.docx")
    await writeFile(sourcePath, "binary")
    const { projectId, projectPath, service } = await managedFixture({
      now: () => new Date("2026-05-23T10:20:30.000Z"),
      fileConversionService: {
        convert: async (): Promise<FileConversionResult> => ({
          sourcePath,
          format: "docx",
          kind: "document",
          title: "report.docx",
          markdown: "# report.docx\n\nBody\n",
          text: "Body",
          metadata: {},
          warnings: [],
        }),
      },
    })

    const result = await service.uploadSources({ projectId, filePaths: [sourcePath] })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: sourcePath,
      relativePath: ".raw/documents/2026/05/23/report.md",
      originalRelativePath: "_attachments/originals/2026/05/23/report.docx",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "documents", "2026", "05", "23", "report.md"), "utf8"))
      .resolves.toContain('source_format: "docx"')
  })
})
