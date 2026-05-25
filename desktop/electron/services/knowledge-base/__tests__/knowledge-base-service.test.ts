import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { KnowledgeBaseService } from "../knowledge-base-service"
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"
import type { FileConversionResult } from "../../file-conversion"

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
        quickInputs: [],
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
    await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Index\n", "utf8")
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
    await expect(readFile(path.join(result.runtimePath, "wiki", "index.md"), "utf8")).resolves.toBe("# Index\n")
    await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8")).resolves.toContain("kb")
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

    const result = await service.listSources(projectId)

    expect(result.sources.map((source) => ({
      relativePath: source.relativePath,
      status: source.status,
      supported: source.supported,
    }))).toEqual([
      { relativePath: ".raw/deck.pdf", status: "unsupported", supported: false },
      { relativePath: ".raw/note.md", status: "imported", supported: true },
    ])
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
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{}}\n")

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
    expect(result.entries.some((entry) => entry.name === ".manifest.json")).toBe(false)
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

  it("renames and moves raw entries without changing manifest or wiki files", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw", "client-a"), { recursive: true })
    await mkdir(path.join(projectPath, ".raw", "archive"), { recursive: true })
    await mkdir(path.join(projectPath, "wiki"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "client-a", "brief.md"), "alpha\n")
    await writeFile(path.join(projectPath, ".raw", ".manifest.json"), "{\"version\":1,\"sources\":{\".raw/client-a/brief.md\":{}}}\n")
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
    await expect(readFile(path.join(projectPath, ".raw", ".manifest.json"), "utf8"))
      .resolves.toBe("{\"version\":1,\"sources\":{\".raw/client-a/brief.md\":{}}}\n")
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

    const result = await service.trashRawEntries({
      projectId,
      relativePaths: ["folder/brief.md"],
    })

    expect(result.entries).toEqual([expect.objectContaining({
      relativePath: "folder/brief.md",
      kind: "file",
    })])
    expect(trashItem).toHaveBeenCalledWith(path.join(projectPath, ".raw", "folder", "brief.md"))
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
