import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../../../../src/constants/defaults"
import type { SynapseKnowledgeBaseStorageConfig, SynapseConfig } from "../../../../src/types/config"
import { KnowledgeBaseService } from "../knowledge-base-service"
import { KnowledgeBaseRawFileManager } from "../raw-file-manager"

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
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
const itSupportsPosixModeBits = process.platform === "win32" ? it.skip : it

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-"))
  roots.push(dir)
  return dir
}

type KnowledgeBaseServiceOptions = ConstructorParameters<typeof KnowledgeBaseService>[0]

function configWithKnowledgeBaseStorage(
  storage: SynapseKnowledgeBaseStorageConfig,
  projects = DEFAULT_GLOBAL_CONFIG.projects,
): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      ...DEFAULT_GLOBAL_CONFIG,
      knowledgeBaseStorage: storage,
      projects,
    },
    agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
  }
}

async function createMinimalTemplateRoot(): Promise<string> {
  const templateRoot = await tempDir()
  await mkdir(path.join(templateRoot, "wiki"), { recursive: true })
  await mkdir(path.join(templateRoot, ".raw"), { recursive: true })
  await mkdir(path.join(templateRoot, ".vault-meta"), { recursive: true })
  await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
  await writeFile(path.join(templateRoot, "CLAUDE.md"), "# Knowledge\n", "utf8")
  await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
  await writeFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"kb\"}\n", "utf8")
  return templateRoot
}

async function managedFixture(options: KnowledgeBaseServiceOptions = {}) {
  const projectId = "kb-1"
  const userDataPath = await tempDir()
  const projectPath = path.join(userDataPath, "knowledge-bases", projectId)
  await mkdir(projectPath, { recursive: true })
  const service = new KnowledgeBaseService({
    ...options,
    userDataPath,
    loadConfig: async () => configWithKnowledgeBaseStorage({ mode: "default" }, [{
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
        }]),
  })
  return { projectId, projectPath, service }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  vi.clearAllMocks()
})

describe("KnowledgeBaseService", () => {
  it("keeps bundled knowledge base hook events aligned with the SDK contract", async () => {
    const hooksPath = path.join(
      process.cwd(),
      "resources",
      "knowledge-base",
      "synapse-knowledge-base-template",
      "hooks",
      "hooks.json",
    )
    const hooksConfig = JSON.parse(await readFile(hooksPath, "utf8")) as {
      readonly hooks?: Record<string, unknown>
    }
    const supportedHookEvents = new Set([
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "PostToolBatch",
      "Notification",
      "UserPromptSubmit",
      "SessionStart",
      "SessionEnd",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "PreCompact",
      "PermissionRequest",
      "Setup",
      "TeammateIdle",
      "TaskCompleted",
      "ConfigChange",
      "WorktreeCreate",
      "WorktreeRemove",
    ])

    expect(Object.keys(hooksConfig.hooks ?? {}).sort()).toEqual([
      "PostToolUse",
      "PreCompact",
      "SessionStart",
      "Stop",
    ])
    for (const eventName of Object.keys(hooksConfig.hooks ?? {})) {
      expect(supportedHookEvents.has(eventName)).toBe(true)
    }
  })

  it("keeps bundled skill frontmatter aligned with the Agent Skills contract", async () => {
    const skillsRoot = path.join(
      process.cwd(),
      "resources",
      "knowledge-base",
      "synapse-knowledge-base-template",
      "skills",
    )
    const skillDirectories = await readdir(skillsRoot, { withFileTypes: true })
    const skillFiles = skillDirectories
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(skillsRoot, entry.name, "SKILL.md"))
      .sort()
    const skills = await Promise.all(skillFiles.map(async (skillPath) => ({
      path: skillPath,
      content: await readFile(skillPath, "utf8"),
    })))
    const canvasSkill = skills.find((skill) => skill.path.endsWith(path.join("canvas", "SKILL.md")))

    expect(skills.length).toBeGreaterThan(0)
    expect(skills.filter((skill) => /^allowed-tools:\s*/m.test(skill.content)).map((skill) => skill.path)).toEqual([])
    expect(canvasSkill?.content).toMatch(/\b(curl|cp|python3|find)\b/)
  })

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
      templateName: "synapse-knowledge-base",
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
      templateVersion: "2026-05-21",
      templateSourceCommit: "75d3b6feb77b96c6bb16599c4550cc9703553d87",
    }))
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(result.runtimePath)
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

  it("creates managed knowledge base runtime under a custom storage root", async () => {
    const templateRoot = await createMinimalTemplateRoot()
    const userDataPath = await tempDir()
    const customRoot = await tempDir()
    await mkdir(path.join(customRoot, "knowledge-bases"), { recursive: true })
    const service = new KnowledgeBaseService({
      managedTemplateRoot: templateRoot,
      userDataPath,
      loadConfig: async () => configWithKnowledgeBaseStorage({
        mode: "custom",
        rootPath: customRoot,
      }),
    })

    const result = await service.createManaged({ projectId: "kb-custom", name: "Knowledge" })

    expect(result.runtimePath).toBe(path.join(customRoot, "knowledge-bases", "kb-custom"))
    await expect(readFile(path.join(result.runtimePath, "CLAUDE.md"), "utf8")).resolves.toBeDefined()
  })

  it("blocks managed creation when a custom storage root has lost its managed data directory", async () => {
    const templateRoot = await createMinimalTemplateRoot()
    const userDataPath = await tempDir()
    const customRoot = await tempDir()
    const service = new KnowledgeBaseService({
      managedTemplateRoot: templateRoot,
      userDataPath,
      loadConfig: async () => configWithKnowledgeBaseStorage({
        mode: "custom",
        rootPath: customRoot,
      }),
    })

    await expect(service.createManaged({ projectId: "kb-missing-data", name: "Knowledge" }))
      .rejects.toThrow("知识库存储位置不可用。")
    await expect(access(path.join(customRoot, "knowledge-bases"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("blocks managed operations when a custom storage root is unavailable", async () => {
    const templateRoot = await createMinimalTemplateRoot()
    const userDataPath = await tempDir()
    const missingRoot = path.join(userDataPath, "missing-disk")
    const service = new KnowledgeBaseService({
      managedTemplateRoot: templateRoot,
      userDataPath,
      loadConfig: async () => configWithKnowledgeBaseStorage({
        mode: "custom",
        rootPath: missingRoot,
      }),
    })

    await expect(service.createManaged({ projectId: "kb-missing", name: "Knowledge" }))
      .rejects.toThrow("知识库存储位置不可用。")
  })

  it("uses the Synapse Knowledge Base template path by default", async () => {
    const userDataPath = await tempDir()
    const appRoot = await tempDir()
    const templateRoot = path.join(appRoot, "resources", "knowledge-base", "synapse-knowledge-base-template")
    await mkdir(path.join(templateRoot, "wiki"), { recursive: true })
    await mkdir(path.join(templateRoot, ".raw"), { recursive: true })
    await mkdir(path.join(templateRoot, ".vault-meta"), { recursive: true })
    await mkdir(path.join(templateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(templateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
    await writeFile(path.join(templateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"synapse-knowledge-base\"}\n", "utf8")

    const service = new KnowledgeBaseService({
      userDataPath,
      getAppPathForTest: () => appRoot,
    })

    const result = await service.createManaged({ projectId: "kb-new-template", name: "Knowledge" })

    await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8"))
      .resolves.toContain("synapse-knowledge-base")
  })

  it("falls back to the legacy template path when the new template is absent", async () => {
    const userDataPath = await tempDir()
    const appRoot = await tempDir()
    const legacyTemplateRoot = path.join(appRoot, "resources", "knowledge-base", ["claude", "obsidian", "template"].join("-"))
    await mkdir(path.join(legacyTemplateRoot, "wiki"), { recursive: true })
    await mkdir(path.join(legacyTemplateRoot, ".raw"), { recursive: true })
    await mkdir(path.join(legacyTemplateRoot, ".vault-meta"), { recursive: true })
    await mkdir(path.join(legacyTemplateRoot, ".claude-plugin"), { recursive: true })
    await writeFile(path.join(legacyTemplateRoot, "wiki", "index.md"), "# Example Index\n", "utf8")
    await writeFile(path.join(legacyTemplateRoot, ".claude-plugin", "plugin.json"), "{\"name\":\"legacy\"}\n", "utf8")

    const service = new KnowledgeBaseService({
      userDataPath,
      getAppPathForTest: () => appRoot,
    })

    const result = await service.createManaged({ projectId: "kb-legacy-template", name: "Knowledge" })

    await expect(readFile(path.join(result.runtimePath, ".claude-plugin", "plugin.json"), "utf8"))
      .resolves.toContain("legacy")
    expect(mocks.logger.warn).toHaveBeenCalledWith("Managed Knowledge Base template fell back to legacy path.", {
      legacyTemplateRoot,
    })
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
    })
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(runtimePath)
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
    }))
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain(runtimePath)
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
    expect(mocks.logger.info).toHaveBeenCalledWith("Managed Knowledge Base runtime trashed.", {
      projectId,
    })
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(projectPath)
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
          ...DEFAULT_GLOBAL_CONFIG,
          projects: [],
        },
        agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
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

  it("rejects managed runtime deletion when runtime id differs from project id", async () => {
    const trashItem = vi.fn()
    const { projectId, projectPath, service } = await managedFixture({ trashItem })
    const victimPath = path.join(path.dirname(projectPath), "kb-victim")
    await mkdir(victimPath, { recursive: true })
    await writeFile(path.join(victimPath, "CLAUDE.md"), "# Victim\n", "utf8")

    await expect(service.deleteManaged({ projectId, runtimeId: "kb-victim" })).rejects.toThrow(
      "Managed Knowledge Base runtimeId must match projectId.",
    )

    expect(trashItem).not.toHaveBeenCalled()
    await expect(readFile(path.join(victimPath, "CLAUDE.md"), "utf8")).resolves.toBe("# Victim\n")
  })

  it("does not create missing raw directory while listing raw entries", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await rm(path.join(projectPath, ".raw"), { recursive: true, force: true })

    await expect(service.listRawDirectory({
      projectId,
      directoryPath: "",
    })).rejects.toThrow("知识库资料目录缺失")
    await expect(access(path.join(projectPath, ".raw"))).rejects.toMatchObject({ code: "ENOENT" })
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
      targetDirectoryPath: "client-a",
      url: "https://example.com/article",
    })

    expect(result.uploaded).toEqual([expect.objectContaining({
      originalPath: "https://example.com/article",
      relativePath: ".raw/client-a/article.md",
      sourceKind: "url",
      sourceUrl: "https://example.com/article",
    })])
    await expect(readFile(path.join(projectPath, ".raw", "client-a", "article.md"), "utf8"))
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
      entryKind: "all",
      entryCount: 2,
      totalCount: 2,
      directoryCount: 1,
      fileCount: 1,
      offset: 0,
      limit: undefined,
    })
  })

  it("lists raw directory entries with pagination options", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await mkdir(path.join(projectPath, ".raw"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "a.md"), "a\n")
    await writeFile(path.join(projectPath, ".raw", "b.md"), "b\n")
    await writeFile(path.join(projectPath, ".raw", "c.md"), "c\n")

    const result = await service.listRawDirectory({
      projectId,
      directoryPath: "",
      offset: 1,
      limit: 1,
    })

    expect(result.entries.map((entry) => entry.name)).toEqual(["b.md"])
    expect(result.totalCount).toBe(3)
    expect(result.offset).toBe(1)
    expect(result.limit).toBe(1)
    expect(result.hasMore).toBe(true)
  })

  it("does not create missing raw directory while listing raw entries", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    await rm(path.join(projectPath, ".raw"), { recursive: true, force: true })

    await expect(service.listRawDirectory({
      projectId,
      directoryPath: "",
    })).rejects.toThrow("知识库资料目录缺失")
    await expect(access(path.join(projectPath, ".raw"))).rejects.toMatchObject({ code: "ENOENT" })
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
    const { projectId, projectPath, service } = await managedFixture()

    const result = await service.uploadRawItems({
      projectId,
      targetDirectoryPath: "",
      itemPaths: [folder],
    })

    expect(result.projectId).toBe(projectId)
    expect(result.entries.map((entry) => entry.relativePath)).toContain("会议资料/01.pdf")
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

  it("keeps skipped same-name raw move sources in the manifest", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    const rawRoot = path.join(projectPath, ".raw")
    await mkdir(path.join(rawRoot, "a"), { recursive: true })
    await mkdir(path.join(rawRoot, "b"), { recursive: true })
    await mkdir(path.join(rawRoot, "archive"), { recursive: true })
    await writeFile(path.join(rawRoot, "a", "report.md"), "alpha\n")
    await writeFile(path.join(rawRoot, "b", "report.md"), "bravo\n")
    await writeFile(path.join(rawRoot, ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/a/report.md": { hash: "hash-a" },
        ".raw/b/report.md": { hash: "hash-b" },
      },
      address_map: {},
    }, null, 2) + "\n")

    const result = await service.moveRawEntries({
      projectId,
      relativePaths: ["a/report.md", "b/report.md"],
      targetDirectoryPath: "archive",
    })

    expect(result.entries).toEqual([expect.objectContaining({
      relativePath: "archive/report.md",
      kind: "file",
    })])
    expect(result.skipped).toEqual([{ path: "b/report.md", reason: "collision" }])
    await expect(readFile(path.join(rawRoot, "archive", "report.md"), "utf8")).resolves.toBe("alpha\n")
    await expect(readFile(path.join(rawRoot, "b", "report.md"), "utf8")).resolves.toBe("bravo\n")

    const manifest = JSON.parse(await readFile(path.join(rawRoot, ".manifest.json"), "utf8")) as {
      sources: Record<string, unknown>
    }
    expect(manifest.sources).toEqual({
      ".raw/archive/report.md": { hash: "hash-a" },
      ".raw/b/report.md": { hash: "hash-b" },
    })
  })

  it("serializes manifest-tracked raw moves per knowledge base", async () => {
    const firstMove = deferred<void>()
    const realRawFileManager = new KnowledgeBaseRawFileManager({ trashItem: vi.fn(async () => undefined) })
    const moveEntries = vi.fn(async (
      rawRoot: string,
      relativePaths: readonly string[],
      targetDirectoryPath: string,
    ) => {
      if (moveEntries.mock.calls.length === 1) {
        await firstMove.promise
      }
      return realRawFileManager.moveEntries(rawRoot, relativePaths, targetDirectoryPath)
    })
    const { projectId, projectPath, service } = await managedFixture({
      rawFileManager: {
        moveEntries,
      } as unknown as KnowledgeBaseRawFileManager,
    })
    const rawRoot = path.join(projectPath, ".raw")
    await mkdir(path.join(rawRoot, "dst"), { recursive: true })
    await writeFile(path.join(rawRoot, "a.md"), "a\n")
    await writeFile(path.join(rawRoot, "b.md"), "b\n")
    await writeFile(path.join(rawRoot, ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/a.md": { hash: "hash-a" },
        ".raw/b.md": { hash: "hash-b" },
      },
      address_map: {},
    }, null, 2) + "\n")

    const first = service.moveRawEntries({
      projectId,
      relativePaths: ["a.md"],
      targetDirectoryPath: "dst",
    })
    await waitUntil(() => moveEntries.mock.calls.length === 1)
    const second = service.moveRawEntries({
      projectId,
      relativePaths: ["b.md"],
      targetDirectoryPath: "dst",
    })
    await flushAsync()

    expect(moveEntries).toHaveBeenCalledTimes(1)

    firstMove.resolve()
    await Promise.all([first, second])
    const manifest = JSON.parse(await readFile(path.join(rawRoot, ".manifest.json"), "utf8")) as {
      sources: Record<string, unknown>
    }
    expect(manifest.sources).toEqual({
      ".raw/dst/a.md": { hash: "hash-a" },
      ".raw/dst/b.md": { hash: "hash-b" },
    })
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

  itSupportsPosixModeBits("rolls back moved raw entries when manifest sync fails", async () => {
    const { projectId, projectPath, service } = await managedFixture()
    const rawRoot = path.join(projectPath, ".raw")
    await mkdir(path.join(rawRoot, "client-a"), { recursive: true })
    await mkdir(path.join(rawRoot, "archive"), { recursive: true })
    await writeFile(path.join(rawRoot, "client-a", "brief.md"), "alpha\n")
    await writeFile(path.join(rawRoot, ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/client-a/brief.md": { hash: "hash-brief" },
      },
      address_map: {},
    }, null, 2) + "\n")

    await chmod(rawRoot, 0o555)
    try {
      await expect(service.moveRawEntries({
        projectId,
        relativePaths: ["client-a/brief.md"],
        targetDirectoryPath: "archive",
      })).rejects.toBeDefined()
    } finally {
      await chmod(rawRoot, 0o755)
    }

    await expect(readFile(path.join(rawRoot, "client-a", "brief.md"), "utf8")).resolves.toBe("alpha\n")
    await expect(readFile(path.join(rawRoot, "archive", "brief.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
    const manifest = JSON.parse(await readFile(path.join(rawRoot, ".manifest.json"), "utf8")) as {
      sources: Record<string, unknown>
    }
    expect(manifest.sources).toEqual({
      ".raw/client-a/brief.md": { hash: "hash-brief" },
    })
  })

  itSupportsPosixModeBits("blocks trashing manifest-tracked raw entries when manifest cannot be written", async () => {
    const trashItem = vi.fn(async () => undefined)
    const { projectId, projectPath, service } = await managedFixture({
      rawFileManager: new KnowledgeBaseRawFileManager({ trashItem }),
    })
    const rawRoot = path.join(projectPath, ".raw")
    await mkdir(path.join(rawRoot, "folder"), { recursive: true })
    await writeFile(path.join(rawRoot, "folder", "brief.md"), "alpha\n")
    await writeFile(path.join(rawRoot, ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/folder/brief.md": { hash: "hash-brief" },
      },
      address_map: {},
    }, null, 2) + "\n")

    await chmod(rawRoot, 0o555)
    try {
      await expect(service.trashRawEntries({
        projectId,
        relativePaths: ["folder/brief.md"],
      })).rejects.toBeDefined()
    } finally {
      await chmod(rawRoot, 0o755)
    }

    expect(trashItem).not.toHaveBeenCalled()
    await expect(readFile(path.join(rawRoot, "folder", "brief.md"), "utf8")).resolves.toBe("alpha\n")
    const manifest = JSON.parse(await readFile(path.join(rawRoot, ".manifest.json"), "utf8")) as {
      sources: Record<string, unknown>
    }
    expect(manifest.sources).toEqual({
      ".raw/folder/brief.md": { hash: "hash-brief" },
    })
  })

  itSupportsPosixModeBits("reports manifest sync failures after raw entries were trashed", async () => {
    let rawRoot = ""
    const trashItem = vi.fn(async () => {
      await chmod(rawRoot, 0o555)
    })
    const { projectId, projectPath, service } = await managedFixture({
      rawFileManager: new KnowledgeBaseRawFileManager({ trashItem }),
    })
    rawRoot = path.join(projectPath, ".raw")
    await mkdir(path.join(rawRoot, "folder"), { recursive: true })
    await writeFile(path.join(rawRoot, "folder", "brief.md"), "alpha\n")
    await writeFile(path.join(rawRoot, ".manifest.json"), JSON.stringify({
      version: 1,
      sources: {
        ".raw/folder/brief.md": { hash: "hash-brief" },
      },
      address_map: {},
    }, null, 2) + "\n")

    try {
      await expect(service.trashRawEntries({
        projectId,
        relativePaths: ["folder/brief.md"],
      })).rejects.toThrow("知识库资料已移入废纸篓，但资料清单同步失败。")
    } finally {
      await chmod(rawRoot, 0o755)
    }

    expect(trashItem).toHaveBeenCalledWith(path.join(rawRoot, "folder", "brief.md"))
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Knowledge Base raw trash manifest sync failed after entries were trashed.",
      expect.objectContaining({
        affectedRawPaths: ["folder/brief.md"],
        operation: "trashRawEntries",
        projectId,
      }),
    )
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

  it("logs skipped raw upload paths without full external paths", async () => {
    const sourcePath = path.join(await tempDir(), "secret-client-folder")
    await mkdir(sourcePath, { recursive: true })
    const { projectId, service } = await managedFixture()
    mocks.logger.info.mockClear()

    await service.uploadRawFiles({
      projectId,
      targetDirectoryPath: "",
      filePaths: [sourcePath],
    })

    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw mutation completed.", expect.objectContaining({
      operation: "uploadRawFiles",
      projectId,
      skippedCount: 1,
      skippedRawPaths: ["secret-client-folder"],
    }))
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain(sourcePath)
  })

  it("logs raw-relative paths for destructive raw mutations", async () => {
    const trashItem = vi.fn(async () => undefined)
    const { projectId, projectPath, service } = await managedFixture({
      rawFileManager: new KnowledgeBaseRawFileManager({ trashItem }),
    })
    await mkdir(path.join(projectPath, ".raw", "client-a"), { recursive: true })
    await mkdir(path.join(projectPath, ".raw", "archive"), { recursive: true })
    await writeFile(path.join(projectPath, ".raw", "client-a", "brief.md"), "alpha\n")
    mocks.logger.info.mockClear()

    await service.renameRawEntry({
      projectId,
      relativePath: "client-a/brief.md",
      newName: "brief-renamed.md",
    })
    await service.moveRawEntries({
      projectId,
      relativePaths: ["client-a/brief-renamed.md"],
      targetDirectoryPath: "archive",
    })
    await service.trashRawEntries({
      projectId,
      relativePaths: ["archive/brief-renamed.md"],
    })

    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw mutation completed.", expect.objectContaining({
      affectedRawPaths: ["client-a/brief-renamed.md"],
      operation: "renameRawEntry",
      rawNewName: "brief-renamed.md",
      rawRelativePaths: ["client-a/brief.md"],
    }))
    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw mutation completed.", expect.objectContaining({
      affectedRawPaths: ["archive/brief-renamed.md"],
      operation: "moveRawEntries",
      rawRelativePaths: ["client-a/brief-renamed.md"],
      rawTargetDirectoryPath: "archive",
    }))
    expect(mocks.logger.info).toHaveBeenCalledWith("Knowledge Base raw mutation completed.", expect.objectContaining({
      affectedRawPaths: ["archive/brief-renamed.md"],
      operation: "trashRawEntries",
      rawRelativePaths: ["archive/brief-renamed.md"],
    }))
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

    await expect(service.listRawDirectory({
      projectId,
      directoryPath: "",
    })).rejects.toThrow("知识库根目录不能是符号链接。")
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

})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await flushAsync()
  }
  throw new Error("Timed out waiting for condition.")
}
