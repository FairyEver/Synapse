import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../../../../src/constants/defaults"
import type { SynapseConfig, SynapseConfigPatch } from "../../../../src/types/config"
import { EXPORT_METADATA_FILE, KnowledgeBaseTransferService } from "../transfer-service"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("KnowledgeBaseTransferService", () => {
  it("previews and imports one legacy managed runtime without modifying the source", async () => {
    const harness = await createHarness()
    const source = path.join(harness.root, "legacy-runtime")
    await seedRuntime(source, "legacy source")

    const preview = await harness.service.inspectImportFolder(source)
    expect(preview).toMatchObject({
      folderName: "legacy-runtime",
      suggestedName: "恢复的知识库",
      warnings: ["legacy-export-metadata-missing"],
    })

    const result = await harness.service.importManagedFolder({
      token: preview.token,
      name: "旧知识库",
      trusted: true,
    })

    expect(result.project.name).toBe("旧知识库")
    expect(result.project.path).toBe(`synapse-kb://${result.project.id}`)
    expect(harness.config.global.projects).toContainEqual(result.project)
    await expect(readFile(path.join(source, "CLAUDE.md"), "utf8")).resolves.toBe("legacy source")
    await expect(readFile(path.join(harness.userDataPath, "knowledge-bases", result.project.id, "CLAUDE.md"), "utf8"))
      .resolves.toBe("legacy source")
  })

  it("rejects a knowledge-bases parent directory instead of importing multiple runtimes", async () => {
    const harness = await createHarness()
    const parent = path.join(harness.root, "knowledge-bases")
    await seedRuntime(path.join(parent, "runtime-a"), "a")
    await seedRuntime(path.join(parent, "runtime-b"), "b")

    await expect(harness.service.inspectImportFolder(parent))
      .rejects.toThrow("所选文件夹不是完整的 Synapse 知识库")
  })

  it("exports a full runtime with metadata and restores its name on preview", async () => {
    const harness = await createHarness()
    const projectId = "project-1"
    const runtimePath = path.join(harness.userDataPath, "knowledge-bases", projectId)
    await seedRuntime(runtimePath, "exported source")
    harness.config.global.projects = [managedProject(projectId, "产品资料")]
    const outputRoot = path.join(harness.root, "exports")
    await mkdir(outputRoot, { recursive: true })

    const exported = await harness.service.exportManagedFolder(projectId, outputRoot)
    const metadata = JSON.parse(await readFile(path.join(exported.folderPath, EXPORT_METADATA_FILE), "utf8")) as {
      knowledgeBase: { name: string }
    }
    expect(metadata.knowledgeBase.name).toBe("产品资料")
    await expect(readFile(path.join(exported.folderPath, "CLAUDE.md"), "utf8")).resolves.toBe("exported source")

    const preview = await harness.service.inspectImportFolder(exported.folderPath)
    expect(preview.suggestedName).toBe("产品资料")
    expect(preview.warnings).toEqual([])
  })

  it("imports into the configured custom storage root", async () => {
    const harness = await createHarness({ customStorage: true })
    const source = path.join(harness.root, "source-runtime")
    await seedRuntime(source, "custom target")
    const preview = await harness.service.inspectImportFolder(source)

    const result = await harness.service.importManagedFolder({
      token: preview.token,
      name: "自定义位置",
      trusted: true,
    })

    await expect(readFile(path.join(harness.customRoot, "knowledge-bases", result.project.id, "CLAUDE.md"), "utf8"))
      .resolves.toBe("custom target")
  })

  it("rejects symbolic links during read-only preview", async () => {
    const harness = await createHarness()
    const source = path.join(harness.root, "linked-runtime")
    await seedRuntime(source, "linked")
    const outside = path.join(harness.root, "outside.txt")
    await writeFile(outside, "outside", "utf8")
    await symlink(outside, path.join(source, "wiki", "linked.md"))

    await expect(harness.service.inspectImportFolder(source))
      .rejects.toThrow("知识库不能包含符号链接或目录联接")
  })

  it("requires explicit trust confirmation", async () => {
    const harness = await createHarness()
    const source = path.join(harness.root, "runtime")
    await seedRuntime(source, "source")
    const preview = await harness.service.inspectImportFolder(source)

    await expect(harness.service.importManagedFolder({
      token: preview.token,
      name: "知识库",
      trusted: false,
    })).rejects.toThrow("请确认知识库文件夹来自可信来源")
  })

  it("rejects an exported folder whose contents no longer match its hashes", async () => {
    const harness = await createHarness()
    const projectId = "project-1"
    const runtimePath = path.join(harness.userDataPath, "knowledge-bases", projectId)
    await seedRuntime(runtimePath, "original")
    harness.config.global.projects = [managedProject(projectId, "Knowledge")]
    const outputRoot = path.join(harness.root, "exports")
    await mkdir(outputRoot, { recursive: true })
    const exported = await harness.service.exportManagedFolder(projectId, outputRoot)
    await writeFile(path.join(exported.folderPath, "CLAUDE.md"), "changed", "utf8")

    await expect(harness.service.inspectImportFolder(exported.folderPath))
      .rejects.toThrow("知识库导出文件校验失败")
  })

  it("rejects import when the current storage root lacks the safety margin", async () => {
    const harness = await createHarness({ availableBytes: 1 })
    const source = path.join(harness.root, "runtime")
    await seedRuntime(source, "source")
    const preview = await harness.service.inspectImportFolder(source)

    await expect(harness.service.importManagedFolder({
      token: preview.token,
      name: "Knowledge",
      trusted: true,
    })).rejects.toThrow("知识库存储空间不足")
  })

  it("rejects a source that changed after preflight", async () => {
    const harness = await createHarness()
    const source = path.join(harness.root, "runtime")
    await seedRuntime(source, "before")
    const preview = await harness.service.inspectImportFolder(source)
    await writeFile(path.join(source, "CLAUDE.md"), "after", "utf8")

    await expect(harness.service.importManagedFolder({
      token: preview.token,
      name: "Knowledge",
      trusted: true,
    })).rejects.toThrow("知识库文件校验失败")

    expect(harness.config.global.projects).toEqual([])
    await expect(readdir(path.join(harness.userDataPath, "knowledge-bases"))).resolves.toEqual([])
  })

  it("rejects importing a runtime that is already registered in the current storage", async () => {
    const harness = await createHarness()
    const projectId = "project-1"
    const runtimePath = path.join(harness.userDataPath, "knowledge-bases", projectId)
    await seedRuntime(runtimePath, "source")
    harness.config.global.projects = [managedProject(projectId, "Knowledge")]
    const preview = await harness.service.inspectImportFolder(runtimePath)

    await expect(harness.service.importManagedFolder({
      token: preview.token,
      name: "Duplicate",
      trusted: true,
    })).rejects.toThrow("不能导入正在使用的知识库")

    expect(harness.config.global.projects).toHaveLength(1)
  })

  it("cancels an import without registering or leaving a copied runtime", async () => {
    const harness = await createHarness()
    const source = path.join(harness.root, "runtime")
    await seedRuntime(source, "source")
    const preview = await harness.service.inspectImportFolder(source)
    const unsubscribe = harness.service.subscribe((progress) => {
      if (progress.active && progress.operation === "import") harness.service.cancel()
    })

    await expect(harness.service.importManagedFolder({
      token: preview.token,
      name: "Knowledge",
      trusted: true,
    })).rejects.toThrow("知识库传输已取消")
    unsubscribe()

    expect(harness.config.global.projects).toEqual([])
    await expect(readdir(path.join(harness.userDataPath, "knowledge-bases"))).resolves.toEqual([])
    expect(harness.service.getState()).toMatchObject({ active: false, phase: "cancelled" })
  })

  it("cleans an unregistered destination from an interrupted import journal", async () => {
    const harness = await createHarness()
    const temporaryPath = path.join(harness.userDataPath, "knowledge-bases", ".kb-1.importing")
    const destinationPath = path.join(harness.userDataPath, "knowledge-bases", "kb-1")
    await Promise.all([
      mkdir(temporaryPath, { recursive: true }),
      mkdir(destinationPath, { recursive: true }),
    ])
    await writeFile(path.join(harness.userDataPath, "knowledge-base-import.json"), JSON.stringify({
      projectId: "kb-1",
      temporaryPath,
      destinationPath,
    }), "utf8")

    await harness.service.recoverIfNeeded()

    await expect(readdir(path.join(harness.userDataPath, "knowledge-bases"))).resolves.toEqual([])
    await expect(readFile(path.join(harness.userDataPath, "knowledge-base-import.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" })
  })

  it("blocks export for active sessions, source writes, or storage migration", async () => {
    const setupRuntime = async (harness: Awaited<ReturnType<typeof createHarness>>) => {
      const projectId = "project-1"
      await seedRuntime(path.join(harness.userDataPath, "knowledge-bases", projectId), "source")
      harness.config.global.projects = [managedProject(projectId, "Knowledge")]
      const outputRoot = path.join(harness.root, "exports")
      await mkdir(outputRoot, { recursive: true })
      return { outputRoot, projectId }
    }

    const sessionHarness = await createHarness({ activeSession: true })
    const session = await setupRuntime(sessionHarness)
    await expect(sessionHarness.service.exportManagedFolder(session.projectId, session.outputRoot))
      .rejects.toThrow("Agent 对话正在运行")

    const mutationHarness = await createHarness({ activeSourceMutation: true })
    const mutation = await setupRuntime(mutationHarness)
    await expect(mutationHarness.service.exportManagedFolder(mutation.projectId, mutation.outputRoot))
      .rejects.toThrow("资料操作仍在进行")

    const migrationHarness = await createHarness({ migrationActive: true })
    const migration = await setupRuntime(migrationHarness)
    await expect(migrationHarness.service.exportManagedFolder(migration.projectId, migration.outputRoot))
      .rejects.toThrow("知识库存储迁移正在进行")
  })
})

async function createHarness(options: {
  activeSession?: boolean
  activeSourceMutation?: boolean
  availableBytes?: number
  customStorage?: boolean
  migrationActive?: boolean
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-transfer-"))
  roots.push(root)
  const userDataPath = path.join(root, "user-data")
  const customRoot = path.join(root, "custom-root")
  await mkdir(path.join(userDataPath, "knowledge-bases"), { recursive: true })
  await mkdir(path.join(customRoot, "knowledge-bases"), { recursive: true })
  let config: SynapseConfig = {
    activeRepoUuid: null,
    repositories: [],
    global: {
      ...structuredClone(DEFAULT_GLOBAL_CONFIG),
      projects: [],
      knowledgeBaseStorage: options.customStorage ? { mode: "custom", rootPath: customRoot } : { mode: "default" },
    },
    agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
  }
  const service = new KnowledgeBaseTransferService({
    userDataPath,
    journalPath: path.join(userDataPath, "knowledge-base-import.json"),
    loadConfig: async () => structuredClone(config),
    updateConfig: async (patch: SynapseConfigPatch) => {
      config = {
        ...config,
        global: {
          ...config.global,
          ...(patch.global ?? {}),
        },
      }
      return structuredClone(config)
    },
    getAvailableBytes: async () => options.availableBytes ?? Number.MAX_SAFE_INTEGER,
    hasActiveKnowledgeBaseSession: async () => options.activeSession ?? false,
    hasActiveSourceMutation: () => options.activeSourceMutation ?? false,
    isStorageMigrationActive: () => options.migrationActive ?? false,
    now: () => new Date("2026-08-04T12:00:00.000Z"),
  })
  return {
    root,
    userDataPath,
    customRoot,
    service,
    get config() { return config },
  }
}

async function seedRuntime(rootPath: string, claudeContent: string): Promise<void> {
  await Promise.all([
    mkdir(path.join(rootPath, ".claude-plugin"), { recursive: true }),
    mkdir(path.join(rootPath, "skills"), { recursive: true }),
    mkdir(path.join(rootPath, "commands"), { recursive: true }),
    mkdir(path.join(rootPath, ".raw"), { recursive: true }),
    mkdir(path.join(rootPath, "wiki"), { recursive: true }),
  ])
  await Promise.all([
    writeFile(path.join(rootPath, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "synapse-knowledge-base" }), "utf8"),
    writeFile(path.join(rootPath, "CLAUDE.md"), claudeContent, "utf8"),
    writeFile(path.join(rootPath, ".raw", ".manifest.json"), JSON.stringify({ version: 1, sources: {}, address_map: {} }), "utf8"),
    writeFile(path.join(rootPath, "wiki", "index.md"), "# Index\n", "utf8"),
  ])
}

function managedProject(id: string, name: string) {
  return {
    id,
    name,
    path: `synapse-kb://${id}`,
    capabilities: {
      knowledgeBase: {
        enabled: true as const,
        schemaVersion: 1 as const,
        templateVersion: "2026-05-21",
        managed: true as const,
        runtimeId: id,
      },
    },
  }
}
