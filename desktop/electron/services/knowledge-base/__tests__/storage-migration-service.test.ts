import { mkdir, mkdtemp, readFile, readdir as fsReaddir, rename, rm, symlink, writeFile } from "node:fs/promises"
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
  it("blocks migration while a knowledge base import or export is active", async () => {
    const harness = await migrationHarness({ activeTransfer: true })

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库导入或导出正在进行")

    expect(harness.service.isActive()).toBe(false)
  })

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

  it("does not follow symbolic links while migrating runtimes", async () => {
    const harness = await migrationHarness()
    await harness.seedRuntime("kb-1")
    const outsideDir = path.join(await tempDir(), "outside")
    await mkdir(outsideDir, { recursive: true })
    const outsideFile = path.join(outsideDir, "secret.txt")
    await writeFile(outsideFile, "external secret\n", "utf8")
    const sourceRawDir = path.join(harness.oldRoot, "knowledge-bases", "kb-1", ".raw")
    await symlink(outsideFile, path.join(sourceRawDir, "linked-secret.txt"))
    await symlink(outsideDir, path.join(sourceRawDir, "linked-dir"), "dir")

    const result = await harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed")
    await expect(readFile(path.join(harness.newRoot, "knowledge-bases", "kb-1", ".raw", "linked-secret.txt"), "utf8"))
      .rejects.toThrow()
    await expect(readFile(path.join(harness.newRoot, "knowledge-bases", "kb-1", ".raw", "linked-dir", "secret.txt"), "utf8"))
      .rejects.toThrow()
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

  it("rejects copied runtimes when same-size file content changes", async () => {
    const harness = await migrationHarness({ corruptCopiedClaudeContent: "# Wrongness\n" })
    await harness.seedRuntime("kb-1")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库存储迁移校验失败。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Knowledge\n")
    await expect(readFile(path.join(harness.newRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .rejects.toThrow()
  })

  it("restores old config in-process when post-switch verification fails", async () => {
    const harness = await migrationHarness({ corruptNewRootAfterSwitch: true })
    await harness.seedRuntime("kb-1")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库存储迁移校验失败。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    expect(harness.service.isActive()).toBe(false)
    expect(harness.states.at(-1)).toMatchObject({
      active: false,
      phase: "failed",
      message: "知识库存储迁移失败，已恢复到旧位置",
    })
    expect(harness.sourceManager.setMigrationBlocked).toHaveBeenLastCalledWith(false)
    await harness.service.recoverIfNeeded()
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Knowledge\n")
  })

  it("keeps knowledge base operations blocked when post-switch recovery fails", async () => {
    const harness = await migrationHarness({
      corruptNewRootAfterSwitch: true,
      failRestoreOldConfigAfterSwitch: true,
    })
    await harness.seedRuntime("kb-1")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库存储迁移校验失败。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    expect(harness.service.isActive()).toBe(true)
    expect(harness.service.requiresRestartForRecovery()).toBe(true)
    expect(harness.states.at(-1)).toMatchObject({
      active: true,
      phase: "failed",
      message: "知识库存储迁移恢复失败",
    })
    expect(harness.sourceManager.setMigrationBlocked).toHaveBeenLastCalledWith(true)
  })

  it("rejects dangerous custom storage roots before migration starts", async () => {
    const targetRoots = [...new Set([
      path.parse(process.cwd()).root,
      os.homedir(),
      os.tmpdir(),
    ])]

    for (const targetRoot of targetRoots) {
      const harness = await migrationHarness()
      await harness.seedRuntime("kb-1")

      await expect(harness.service.startMigration({
        target: { mode: "custom", rootPath: targetRoot },
        requestedBy: "test",
      })).rejects.toThrow("知识库存储位置不能选择系统根目录、用户主目录、临时目录或其它过宽的系统目录。")

      expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
      await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
        .resolves.toBe("# Knowledge\n")
    }
  })

  it("rejects custom target roots inside the current knowledge-bases directory when the child name starts with dots", async () => {
    const harness = await migrationHarness()
    await harness.seedRuntime("kb-1")
    const targetRoot = path.join(harness.oldRoot, "knowledge-bases", "..backup")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: targetRoot },
      requestedBy: "test",
    })).rejects.toThrow("目标位置不能位于当前知识库目录内。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
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

  it("treats Windows case-equivalent default restore roots as unchanged", async () => {
    const harness = await migrationHarness({ platform: "win32" })
    const caseVariantRoot = withFirstLetterCaseToggled(harness.oldRoot)
    harness.setStorage({ mode: "custom", rootPath: caseVariantRoot })

    const result = await harness.service.startMigration({
      target: { mode: "default" },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed")
    expect(harness.trashed).toEqual([])
    expect(harness.sourceManager.closeIdleWindows).not.toHaveBeenCalled()
    expect(harness.states.at(-1)).toMatchObject({
      active: false,
      phase: "completed",
      message: "知识库存储位置未变化",
    })
  })

  it("restores default storage when the default old copy still exists", async () => {
    const harness = await migrationHarness()
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })
    await harness.seedRuntime("kb-1", harness.newRoot, { content: "# Current custom data\n" })
    await harness.seedRuntime("kb-1", harness.oldRoot, { content: "# Preserved old data\n" })

    const result = await harness.service.startMigration({
      target: { mode: "default" },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed")
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Current custom data\n")
    const backupNames = (await fsReaddir(harness.oldRoot)).filter((entry) =>
      entry.startsWith("knowledge-bases.backup-before-migration-")
    )
    expect(backupNames).toHaveLength(1)
    await expect(readFile(path.join(harness.oldRoot, backupNames[0], "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Preserved old data\n")
  })

  it("restores the preserved default copy when restore-to-default switching fails", async () => {
    const harness = await migrationHarness({ pauseAtPhase: "switching" })
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })
    await harness.seedRuntime("kb-1", harness.newRoot, { content: "# Current custom data\n" })
    await harness.seedRuntime("kb-1", harness.oldRoot, { content: "# Preserved old data\n" })
    const migration = harness.service.startMigration({
      target: { mode: "default" },
      requestedBy: "test",
    })

    await harness.waitForPhase("switching")
    const migrationDirs = (await fsReaddir(harness.oldRoot))
      .filter((entry) => entry.startsWith(".knowledge-bases-migration-"))
    expect(migrationDirs).toHaveLength(1)
    await rm(path.join(harness.oldRoot, migrationDirs[0], "knowledge-bases"), { recursive: true, force: true })
    harness.resume()

    await expect(migration).rejects.toThrow()
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Preserved old data\n")
  })

  it("restores the preserved default copy when restore-to-default fails after the new target is placed", async () => {
    const harness = await migrationHarness({ failRestoreOldConfigAfterSwitch: true })
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })
    await harness.seedRuntime("kb-1", harness.newRoot, { content: "# Current custom data\n" })
    await harness.seedRuntime("kb-1", harness.oldRoot, { content: "# Preserved old data\n" })

    await expect(harness.service.startMigration({
      target: { mode: "default" },
      requestedBy: "test",
    })).rejects.toThrow("restore config failed")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Preserved old data\n")
    const backupNames = (await fsReaddir(harness.oldRoot)).filter((entry) =>
      entry.startsWith("knowledge-bases.backup-before-migration-")
    )
    expect(backupNames).toHaveLength(0)
  })

  it("cancels during copy and keeps the old config", async () => {
    const harness = await migrationHarness({ pauseAfterFirstCopy: true })
    await harness.seedRuntime("kb-1")
    const migration = harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    await harness.waitForPhase("copying")
    await harness.waitForCopyPause()
    await harness.service.cancelMigration()
    harness.resume()

    await expect(migration).resolves.toEqual({ status: "cancelled" })
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("cancels during preparation before source size is known", async () => {
    const harness = await migrationHarness({ pauseAtPhase: "preparing" })
    await harness.seedRuntime("kb-1")
    const migration = harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    await harness.waitForPhase("preparing")
    expect(harness.service.getState()).toMatchObject({
      phase: "preparing",
      cancellable: true,
      progress: {
        copiedBytes: 0,
        totalBytes: null,
      },
    })
    await harness.service.cancelMigration()
    harness.resume()

    await expect(migration).resolves.toEqual({ status: "cancelled" })
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("cancels while collecting source size and keeps the old config", async () => {
    const harness = await migrationHarness({ pauseAfterFirstStats: true })
    await harness.seedRuntime("kb-1")
    const migration = harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    await harness.waitForStatsPause()
    expect(harness.service.getState()).toMatchObject({
      phase: "preparing",
      cancellable: true,
      progress: {
        totalBytes: null,
      },
    })
    expect(harness.service.getState().progress.copiedBytes).toBeGreaterThan(0)
    await harness.service.cancelMigration()
    harness.resume()

    await expect(migration).resolves.toEqual({ status: "cancelled" })
    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("does not cancel after switching begins", async () => {
    const harness = await migrationHarness({ pauseAtPhase: "switching" })
    await harness.seedRuntime("kb-1")
    const migration = harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    await harness.waitForPhase("switching")
    await expect(harness.service.cancelMigration()).rejects.toThrow("当前阶段不能取消。")
    harness.resume()
    await expect(migration).resolves.toMatchObject({ status: "completed" })
  })

  it("recovers an interrupted pre-switch journal to the old root", async () => {
    const harness = await migrationHarness()
    await harness.writeJournal({ phase: "copying", switchStarted: false, newRootVerified: false })

    await harness.service.recoverIfNeeded()

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("restores a journaled default backup during recovery when the target is missing", async () => {
    const harness = await migrationHarness()
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })
    await harness.seedRuntime("kb-1", harness.oldRoot, { content: "# Preserved old data\n" })
    const backupPath = path.join(harness.oldRoot, "knowledge-bases.backup-before-migration-test")
    await rename(path.join(harness.oldRoot, "knowledge-bases"), backupPath)
    await harness.writeJournal({
      phase: "switching",
      switchStarted: true,
      newRootVerified: false,
      oldStorage: { mode: "custom", rootPath: harness.newRoot },
      targetStorage: { mode: "default" },
      oldRoot: harness.newRoot,
      newRoot: harness.oldRoot,
      defaultTargetBackupPath: backupPath,
    })

    await harness.service.recoverIfNeeded()

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    await expect(readFile(path.join(harness.oldRoot, "knowledge-bases", "kb-1", "CLAUDE.md"), "utf8"))
      .resolves.toBe("# Preserved old data\n")
  })

  it("reports a failed recovery state when the journal is corrupt", async () => {
    const harness = await migrationHarness()
    await harness.writeRawJournal("{\"version\":1")

    await expect(harness.service.recoverIfNeeded()).resolves.toBeUndefined()

    expect(harness.service.isActive()).toBe(true)
    expect(harness.states.at(-1)).toMatchObject({
      active: true,
      phase: "failed",
      message: "知识库存储迁移恢复失败",
      errorMessage: "知识库存储迁移恢复记录已损坏，请检查或移除恢复记录后重试。",
    })
    expect(harness.sourceManager.setMigrationBlocked).toHaveBeenCalledWith(true)
    expect(harness.sourceManager.setMigrationBlocked).not.toHaveBeenCalledWith(false)
  })

  it("keeps a verified new root during recovery", async () => {
    const harness = await migrationHarness()
    await harness.seedRuntime("kb-1", harness.newRoot)
    await harness.seedRuntime("kb-1", harness.oldRoot)
    await harness.writeJournal({ phase: "cleaning", switchStarted: true, newRootVerified: true })
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })

    await harness.service.recoverIfNeeded()

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    expect(harness.trashed).toEqual([path.join(harness.oldRoot, "knowledge-bases")])
  })

  it("does not trash recovered storage when old and new knowledge-bases paths are equivalent", async () => {
    const harness = await migrationHarness({ platform: "win32" })
    await harness.seedRuntime("kb-1", harness.oldRoot)
    await harness.writeJournal({
      phase: "cleaning",
      switchStarted: true,
      newRootVerified: true,
      newRoot: withFirstLetterCaseToggled(harness.oldRoot),
      targetStorage: { mode: "default" },
    })

    await harness.service.recoverIfNeeded()

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
    expect(harness.trashed).toEqual([])
  })

  it("reports a warning when verified recovery cannot trash the old root", async () => {
    const harness = await migrationHarness({ trashError: new Error("trash unavailable") })
    await harness.seedRuntime("kb-1", harness.newRoot)
    await harness.seedRuntime("kb-1", harness.oldRoot)
    await harness.writeJournal({ phase: "cleaning", switchStarted: true, newRootVerified: true })
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })

    await harness.service.recoverIfNeeded()

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "custom", rootPath: harness.newRoot })
    expect(harness.states.at(-1)).toMatchObject({
      phase: "completed-with-warning",
      warningCode: "old-copy-not-trashed",
    })
  })

  it("rejects migration when available space is below runtime size plus margin", async () => {
    const harness = await migrationHarness({ availableBytes: 10 })
    await harness.seedRuntime("kb-1")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("目标位置空间不足。")

    expect(harness.config.global.knowledgeBaseStorage).toEqual({ mode: "default" })
  })

  it("continues when available space cannot be confirmed", async () => {
    const harness = await migrationHarness({ availableBytes: null })
    await harness.seedRuntime("kb-1")

    const result = await harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })

    expect(result.status).toBe("completed")
    expect(harness.states.some((state) => state.warningCode === "free-space-unknown")).toBe(true)
  })

  it("reports custom storage unavailable when the managed data directory is missing", async () => {
    const harness = await migrationHarness()
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })

    const status = await harness.service.getStorageStatus()

    expect(status).toMatchObject({
      mode: "custom",
      rootPath: harness.newRoot,
      knowledgeBasesPath: path.join(harness.newRoot, "knowledge-bases"),
      available: false,
    })
    expect(status.unavailableReason).toBeTruthy()
  })

  it("reports custom storage unavailable when the managed data directory is a symlink", async () => {
    const harness = await migrationHarness()
    const outsideData = path.join(await tempDir(), "outside-data")
    await mkdir(outsideData, { recursive: true })
    await symlink(outsideData, path.join(harness.newRoot, "knowledge-bases"), "dir")
    harness.setStorage({ mode: "custom", rootPath: harness.newRoot })

    const status = await harness.service.getStorageStatus()

    expect(status.available).toBe(false)
    expect(status.unavailableReason).toContain("符号链接")
  })

  it("shows an actionable message when a knowledge base session blocks migration", async () => {
    const harness = await migrationHarness({ activeKnowledgeBaseSession: true })
    await harness.seedRuntime("kb-1")

    await expect(harness.service.startMigration({
      target: { mode: "custom", rootPath: harness.newRoot },
      requestedBy: "test",
    })).rejects.toThrow("知识库对话仍在运行，暂时不能迁移。请先停止知识库对话里的回答；如果没有正在回答，请重启 Synapse 后再迁移。")
  })
})

type RuntimeSeedOptions = {
  manifest?: boolean
  content?: string
}

type MigrationHarnessOptions = {
  activeTransfer?: boolean
  trashError?: Error
  pauseAfterFirstCopy?: boolean
  pauseAfterFirstStats?: boolean
  pauseAtPhase?: "preparing" | "switching"
  availableBytes?: number | null
  activeKnowledgeBaseSession?: boolean
  corruptCopiedClaudeContent?: string
  corruptNewRootAfterSwitch?: boolean
  failRestoreOldConfigAfterSwitch?: boolean
  platform?: NodeJS.Platform | string
}

async function migrationHarness(options: MigrationHarnessOptions = {}) {
  const oldRoot = await tempDir()
  const newRoot = await tempDir()
  const journalPath = path.join(await tempDir(), "migration.json")
  const trashed: string[] = []
  const states: ReturnType<KnowledgeBaseStorageMigrationService["getState"]>[] = []
  let resumePause: (() => void) | null = null
  let pausedCopy = false
  let pausedStats = false
  let copyPausedResolve: (() => void) | null = null
  let statsPausedResolve: (() => void) | null = null
  const copyPaused = new Promise<void>((resolve) => {
    copyPausedResolve = resolve
  })
  const statsPaused = new Promise<void>((resolve) => {
    statsPausedResolve = resolve
  })
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
      const previousStorage = config.global.knowledgeBaseStorage
      const nextStorage = patch.global?.knowledgeBaseStorage
      if (
        options.failRestoreOldConfigAfterSwitch
        && previousStorage.mode === "custom"
        && nextStorage?.mode === "default"
      ) {
        throw new Error("restore config failed")
      }
      config = {
        ...config,
        global: {
          ...config.global,
          ...patch.global,
        },
      }
      if (
        options.corruptNewRootAfterSwitch
        && nextStorage?.mode === "custom"
      ) {
        await rm(path.join(newRoot, "knowledge-bases", "kb-1", ".raw", ".manifest.json"), { force: true })
      }
      return structuredClone(config)
    },
    trashItem: async (targetPath) => {
      if (options.trashError) throw options.trashError
      trashed.push(targetPath)
    },
    journalPath,
    sourceManager,
    hasActiveKnowledgeBaseSession: async () => options.activeKnowledgeBaseSession === true,
    hasActiveTransfer: () => options.activeTransfer === true,
    getAvailableBytes: async () => options.availableBytes === undefined ? 100_000_000_000 : options.availableBytes,
    afterCopyEntry: async (sourceEntryPath) => {
      if (options.corruptCopiedClaudeContent && sourceEntryPath.endsWith(path.join("kb-1", "CLAUDE.md"))) {
        const migrationDirs = (await fsReaddir(newRoot))
          .filter((entry) => entry.startsWith(".knowledge-bases-migration-"))
        if (migrationDirs[0]) {
          await writeFile(
            path.join(newRoot, migrationDirs[0], "knowledge-bases", "kb-1", "CLAUDE.md"),
            options.corruptCopiedClaudeContent,
            "utf8",
          )
        }
      }
      if (!options.pauseAfterFirstCopy || pausedCopy) return
      pausedCopy = true
      copyPausedResolve?.()
      await new Promise<void>((resolve) => {
        resumePause = resolve
      })
    },
    afterStatsEntry: async () => {
      if (!options.pauseAfterFirstStats || pausedStats) return
      pausedStats = true
      statsPausedResolve?.()
      await new Promise<void>((resolve) => {
        resumePause = resolve
      })
    },
    afterPhaseChange: async (phase) => {
      if (options.pauseAtPhase !== phase) return
      await new Promise<void>((resolve) => {
        resumePause = resolve
      })
    },
    platform: options.platform,
  })
  service.subscribe((state) => {
    states.push(state)
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
    await writeFile(path.join(runtimePath, "CLAUDE.md"), seedOptions.content ?? "# Knowledge\n", "utf8")
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
    states,
    trashed,
    seedRuntime,
    setStorage(storage: SynapseKnowledgeBaseStorageConfig) {
      config = {
        ...config,
        global: {
          ...config.global,
          knowledgeBaseStorage: storage,
        },
      }
    },
    async writeJournal(partial: {
      phase: string
      switchStarted: boolean
      newRootVerified: boolean
      oldRoot?: string
      newRoot?: string
      oldStorage?: SynapseKnowledgeBaseStorageConfig
      targetStorage?: SynapseKnowledgeBaseStorageConfig
      defaultTargetBackupPath?: string | null
    }) {
      await mkdir(path.dirname(journalPath), { recursive: true })
      await writeFile(journalPath, `${JSON.stringify({
        version: 1,
        oldStorage: partial.oldStorage ?? { mode: "default" },
        targetStorage: partial.targetStorage ?? { mode: "custom", rootPath: newRoot },
        oldRoot: partial.oldRoot ?? oldRoot,
        newRoot: partial.newRoot ?? newRoot,
        tempPath: path.join(newRoot, ".knowledge-bases-migration-test"),
        defaultTargetBackupPath: partial.defaultTargetBackupPath ?? null,
        startedAt: "2026-06-10T00:00:00.000Z",
        ...partial,
      }, null, 2)}\n`, "utf8")
    },
    async writeRawJournal(content: string) {
      await mkdir(path.dirname(journalPath), { recursive: true })
      await writeFile(journalPath, content, "utf8")
    },
    waitForPhase(phase: string) {
      if (states.some((state) => state.phase === phase)) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const unsubscribe = service.subscribe((state) => {
          if (state.phase !== phase) return
          unsubscribe()
          resolve()
        })
      })
    },
    waitForCopyPause() {
      return copyPaused
    },
    waitForStatsPause() {
      return statsPaused
    },
    resume() {
      const resolve = resumePause
      resumePause = null
      resolve?.()
    },
  }
}

function withFirstLetterCaseToggled(value: string): string {
  return value.replace(/[A-Za-z]/u, (letter) =>
    letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase()
  )
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
