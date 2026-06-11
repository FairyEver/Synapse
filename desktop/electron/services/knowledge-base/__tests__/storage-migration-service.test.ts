import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../../../../src/constants/defaults"
import type { SynapseConfig, SynapseKnowledgeBaseStorageConfig } from "../../../../src/types/config"
import { KnowledgeBaseStorageMigrationService } from "../storage-migration-service"

vi.mock("../../log-store", () => ({
  createMainLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}))

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-migration-"))
  roots.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("KnowledgeBaseStorageMigrationService", () => {
  it("copies all runtimes, switches config, and trashes the old directory", async () => {
    const harness = await migrationHarness()
    await harness.seedRuntime("kb-1")

    const result = await harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed")
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    await expect(readFile(path.join(harness.newRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Knowledge\n")
    expect(harness.trashed).toEqual([path.join(harness.oldRoot, "knowledge-bases")])
  })

  it("keeps old config and old data when verification fails", async () => {
    const harness = await migrationHarness()
    await harness.seedRuntime("kb-1", harness.oldRoot, { manifest: false })

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库存储迁移校验失败。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Knowledge\n")
  })

  it("keeps new config when trashing the old directory fails", async () => {
    const harness = await migrationHarness({ trashError: new Error("trash unavailable") })
    await harness.seedRuntime("kb-1")

    const result = await harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    expect(result).toEqual({
      status: "completed-with-warning",
      warningCode: "old-copy-not-trashed",
    })
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
  })
})

type RuntimeSeedOptions = {
  manifest?: boolean
}

type MigrationHarnessOptions = {
  trashError?: Error
}

async function migrationHarness(options: MigrationHarnessOptions = {}) {
  const oldRoot = await tempDir()
  const newRoot = await tempDir()
  const journalPath = path.join(await tempDir(), "migration.json")
  const trashed: string[] = []
  let config = createConfig({ mode: "default" })
  const sourceManager = {
    hasActiveMutation: vi.fn(() => false),
    closeIdleWindows: vi.fn(),
    setMigrationBlocked: vi.fn(),
  }
  const service = new KnowledgeBaseStorageMigrationService({
    userDataPath: oldRoot,
    loadConfig: async () => structuredClone(config),
    updateConfig: async (patch) => {
      config = {
        ...config,
        global: {
          ...config.global,
          ...patch.global,
        },
      }
      return structuredClone(config)
    },
    trashItem: async (targetPath) => {
      if (options.trashError) throw options.trashError
      trashed.push(targetPath)
    },
    journalPath,
    sourceManager,
    hasActiveKnowledgeBaseSession: async () => false,
  })

  async function seedRuntime(runtimeId: string, rootPath = oldRoot, seedOptions: RuntimeSeedOptions = {}) {
    const runtimePath = path.join(rootPath, "knowledge-bases", runtimeId)
    await mkdir(path.join(runtimePath, ".claude-plugin"), { recursive: true })
    await mkdir(path.join(runtimePath, "skills"), { recursive: true })
    await mkdir(path.join(runtimePath, "commands"), { recursive: true })
    await mkdir(path.join(runtimePath, ".raw"), { recursive: true })
    await mkdir(path.join(runtimePath, "wiki"), { recursive: true })
    await writeFile(path.join(runtimePath, ".claude-plugin", "plugin.json"), "{\"name\":\"kb\"}\n", "utf8")
    await writeFile(path.join(runtimePath, "skills", ".gitkeep"), "", "utf8")
    await writeFile(path.join(runtimePath, "commands", ".gitkeep"), "", "utf8")
    await writeFile(path.join(runtimePath, "CLAUDE.md"), "# Knowledge\n", "utf8")
    if (seedOptions.manifest !== false) {
      await writeFile(path.join(runtimePath, ".raw", ".manifest.json"), "{\"version\":1}\n", "utf8")
    }
    await writeFile(path.join(runtimePath, "wiki", "index.md"), "# Index\n", "utf8")
  }

  return {
    get config() {
      return config
    },
    oldRoot,
    newRoot,
    service,
    sourceManager,
    trashed,
    seedRuntime,
  }
}

function createConfig(storage: SynapseKnowledgeBaseStorageConfig): SynapseConfig {
  return {
    activeRepoUuid: null,
    repositories: [],
    global: {
      ...DEFAULT_GLOBAL_CONFIG,
      knowledgeBaseStorage: storage,
      projects: [{
        id: "kb-1",
        name: "Knowledge",
        path: "synapse-kb://kb-1",
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "2026-05-24",
            managed: true,
            runtimeId: "kb-1",
          },
        },
      }],
    },
    agent: structuredClone(DEFAULT_AGENT_GLOBAL_CONFIG),
  }
}
