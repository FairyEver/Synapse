import { constants } from "node:fs"
import { access, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseKnowledgeBaseStorageConfig,
} from "../../../src/types/config"
import { isManagedKnowledgeBaseProject } from "./managed-path"
import {
  isPathInside,
  resolveKnowledgeBaseStorageRoot,
  resolveKnowledgeBasesDirectory,
} from "./storage-root"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger as logger } from "./logging"

export type KnowledgeBaseStorageMigrationPhase =
  | "idle"
  | "preparing"
  | "copying"
  | "verifying"
  | "switching"
  | "cleaning"
  | "completed"
  | "completed-with-warning"
  | "failed"
  | "cancelled"
  | "recovering"

export type KnowledgeBaseStorageMigrationState = {
  active: boolean
  phase: KnowledgeBaseStorageMigrationPhase
  cancellable: boolean
  progress: {
    copiedBytes: number
    totalBytes: number | null
  }
  message: string
  warningCode?: "free-space-unknown" | "old-copy-not-trashed"
  errorMessage?: string
}

export type KnowledgeBaseStorageMigrationTarget = SynapseKnowledgeBaseStorageConfig

export type KnowledgeBaseStorageMigrationResult =
  | { status: "completed" }
  | { status: "completed-with-warning"; warningCode: "old-copy-not-trashed" }
  | { status: "cancelled" }

type KnowledgeBaseStorageMigrationDeps = {
  userDataPath: string
  loadConfig: () => Promise<SynapseConfig>
  updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  trashItem: (targetPath: string) => Promise<void>
  journalPath: string
  sourceManager: {
    hasActiveMutation: () => boolean
    closeIdleWindows: () => void
    setMigrationBlocked: (blocked: boolean) => void
  }
  hasActiveKnowledgeBaseSession: () => Promise<boolean>
}

type StartMigrationPayload = {
  target: KnowledgeBaseStorageMigrationTarget
  requestedBy: string
}

type MigrationJournal = {
  version: 1
  oldStorage: SynapseKnowledgeBaseStorageConfig
  targetStorage: SynapseKnowledgeBaseStorageConfig
  oldRoot: string
  newRoot: string
  tempPath: string
  phase: KnowledgeBaseStorageMigrationPhase
  switchStarted: boolean
  newRootVerified: boolean
  startedAt: string
}

const INITIAL_STATE: KnowledgeBaseStorageMigrationState = {
  active: false,
  phase: "idle",
  cancellable: false,
  progress: {
    copiedBytes: 0,
    totalBytes: null,
  },
  message: "",
}

const REQUIRED_RUNTIME_PATHS = [
  ".claude-plugin",
  "skills",
  "commands",
  "CLAUDE.md",
  path.join(".raw", ".manifest.json"),
  path.join("wiki", "index.md"),
] as const

export class KnowledgeBaseStorageMigrationService {
  private state: KnowledgeBaseStorageMigrationState = INITIAL_STATE
  private readonly listeners = new Set<(state: KnowledgeBaseStorageMigrationState) => void>()

  constructor(private readonly deps: KnowledgeBaseStorageMigrationDeps) {}

  getState(): KnowledgeBaseStorageMigrationState {
    return structuredClone(this.state)
  }

  isActive(): boolean {
    return this.state.active
  }

  subscribe(listener: (state: KnowledgeBaseStorageMigrationState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => {
      this.listeners.delete(listener)
    }
  }

  async startMigration(payload: StartMigrationPayload): Promise<KnowledgeBaseStorageMigrationResult> {
    if (this.state.active) {
      throw new Error("知识库存储迁移正在进行。")
    }

    this.emitState({
      active: true,
      phase: "preparing",
      cancellable: false,
      progress: { copiedBytes: 0, totalBytes: null },
      message: "正在准备迁移",
    })
    this.deps.sourceManager.setMigrationBlocked(true)

    const config = await this.deps.loadConfig()
    const oldStorage = config.global.knowledgeBaseStorage
    const oldRoot = resolveKnowledgeBaseStorageRoot({
      userDataPath: this.deps.userDataPath,
      storage: oldStorage,
    })
    const newRoot = resolveKnowledgeBaseStorageRoot({
      userDataPath: this.deps.userDataPath,
      storage: payload.target,
    })

    try {
      if (path.resolve(oldRoot) === path.resolve(newRoot)) {
        this.emitState({
          active: false,
          phase: "completed",
          cancellable: false,
          message: "知识库存储位置未变化",
        })
        return { status: "completed" }
      }

      await this.assertCanStartMigration()
      this.deps.sourceManager.closeIdleWindows()
      await this.validateTargetRoot(oldRoot, newRoot)

      const oldKnowledgeBasesPath = resolveKnowledgeBasesDirectory({
        userDataPath: this.deps.userDataPath,
        storage: oldStorage,
      })
      const newKnowledgeBasesPath = resolveKnowledgeBasesDirectory({
        userDataPath: this.deps.userDataPath,
        storage: payload.target,
      })
      const tempPath = path.join(newRoot, `.knowledge-bases-migration-${Date.now()}`)
      const tempKnowledgeBasesPath = path.join(tempPath, "knowledge-bases")
      const journal: MigrationJournal = {
        version: 1,
        oldStorage,
        targetStorage: payload.target,
        oldRoot,
        newRoot,
        tempPath,
        phase: "copying",
        switchStarted: false,
        newRootVerified: false,
        startedAt: new Date().toISOString(),
      }

      await this.writeJournal(journal)
      this.emitState({
        active: true,
        phase: "copying",
        cancellable: true,
        message: "正在复制知识库",
        progress: {
          copiedBytes: 0,
          totalBytes: (await treeStats(oldKnowledgeBasesPath)).bytes,
        },
      })
      await mkdir(tempPath, { recursive: true })
      await copyKnowledgeBasesTree(oldKnowledgeBasesPath, tempKnowledgeBasesPath)

      const runtimeIds = managedRuntimeIds(config)
      this.emitState({
        active: true,
        phase: "verifying",
        cancellable: true,
        message: "正在校验知识库",
      })
      await verifyKnowledgeBasesTree(oldKnowledgeBasesPath, tempKnowledgeBasesPath, runtimeIds)

      await this.writeJournal({
        ...journal,
        phase: "switching",
        switchStarted: true,
      })
      this.emitState({
        active: true,
        phase: "switching",
        cancellable: false,
        message: "正在切换知识库存储",
      })
      await rename(tempKnowledgeBasesPath, newKnowledgeBasesPath)
      await rm(tempPath, { recursive: true, force: true })
      await this.deps.updateConfig({ global: { knowledgeBaseStorage: payload.target } })
      await verifyKnowledgeBasesTree(oldKnowledgeBasesPath, newKnowledgeBasesPath, runtimeIds)

      await this.writeJournal({
        ...journal,
        phase: "cleaning",
        switchStarted: true,
        newRootVerified: true,
      })
      this.emitState({
        active: true,
        phase: "cleaning",
        cancellable: false,
        message: "正在清理旧位置",
      })

      try {
        await this.deps.trashItem(oldKnowledgeBasesPath)
      } catch (error) {
        logger.warn("Knowledge Base old storage cleanup failed after migration.", {
          oldKnowledgeBasesPath,
          ...knowledgeBaseErrorMeta(error),
        })
        await this.clearJournal()
        this.emitState({
          active: false,
          phase: "completed-with-warning",
          cancellable: false,
          message: "知识库存储已迁移，旧副本仍保留",
          warningCode: "old-copy-not-trashed",
        })
        return { status: "completed-with-warning", warningCode: "old-copy-not-trashed" }
      }

      await this.clearJournal()
      this.emitState({
        active: false,
        phase: "completed",
        cancellable: false,
        message: "知识库存储已迁移",
      })
      return { status: "completed" }
    } catch (error) {
      if (error instanceof MigrationVerificationError) {
        await this.deps.updateConfig({ global: { knowledgeBaseStorage: oldStorage } })
      }
      logger.warn("Knowledge Base storage migration failed.", knowledgeBaseErrorMeta(error))
      this.emitState({
        active: false,
        phase: "failed",
        cancellable: false,
        message: "知识库存储迁移失败",
        errorMessage: error instanceof Error ? error.message : "迁移失败。",
      })
      throw error
    } finally {
      this.deps.sourceManager.setMigrationBlocked(false)
    }
  }

  private async assertCanStartMigration(): Promise<void> {
    if (await this.deps.hasActiveKnowledgeBaseSession()) {
      throw new Error("请先停止正在运行的知识库会话。")
    }
    if (this.deps.sourceManager.hasActiveMutation()) {
      throw new Error("资料操作仍在进行。")
    }
  }

  private async validateTargetRoot(oldRoot: string, newRoot: string): Promise<void> {
    if (!path.isAbsolute(newRoot)) {
      throw new Error("知识库存储位置必须是绝对路径。")
    }
    if (isPathInside(newRoot, path.join(oldRoot, "knowledge-bases"))) {
      throw new Error("目标位置不能位于当前知识库目录内。")
    }
    await mkdir(newRoot, { recursive: true })
    await access(newRoot, constants.R_OK | constants.W_OK)
    const targetKnowledgeBasesPath = path.join(newRoot, "knowledge-bases")
    if (await hasDirectoryEntries(targetKnowledgeBasesPath)) {
      throw new Error("目标位置已存在知识库数据。")
    }
  }

  private async writeJournal(journal: MigrationJournal): Promise<void> {
    await mkdir(path.dirname(this.deps.journalPath), { recursive: true })
    await writeFile(this.deps.journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8")
  }

  private async clearJournal(): Promise<void> {
    await rm(this.deps.journalPath, { force: true })
  }

  private emitState(patch: Partial<KnowledgeBaseStorageMigrationState>): void {
    this.state = {
      ...this.state,
      ...patch,
      progress: patch.progress ?? this.state.progress,
    }
    const snapshot = this.getState()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

class MigrationVerificationError extends Error {
  constructor() {
    super("知识库存储迁移校验失败。")
  }
}

function managedRuntimeIds(config: SynapseConfig): string[] {
  return config.global.projects.flatMap((project) => {
    if (!isManagedKnowledgeBaseProject(project)) return []
    return project.capabilities.knowledgeBase.runtimeId ? [project.capabilities.knowledgeBase.runtimeId] : []
  })
}

async function copyKnowledgeBasesTree(sourcePath: string, targetPath: string): Promise<void> {
  if (!await pathExists(sourcePath)) {
    await mkdir(targetPath, { recursive: true })
    return
  }
  await cp(sourcePath, targetPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
  })
}

async function verifyKnowledgeBasesTree(
  sourcePath: string,
  targetPath: string,
  runtimeIds: readonly string[],
): Promise<void> {
  const sourceStats = await treeStats(sourcePath)
  const targetStats = await treeStats(targetPath)
  if (sourceStats.files !== targetStats.files || sourceStats.bytes !== targetStats.bytes) {
    throw new MigrationVerificationError()
  }
  for (const runtimeId of runtimeIds) {
    for (const requiredPath of REQUIRED_RUNTIME_PATHS) {
      if (!await pathExists(path.join(targetPath, runtimeId, requiredPath))) {
        throw new MigrationVerificationError()
      }
    }
  }
}

async function treeStats(rootPath: string): Promise<{ files: number; bytes: number }> {
  if (!await pathExists(rootPath)) {
    return { files: 0, bytes: 0 }
  }
  const rootStat = await stat(rootPath)
  if (!rootStat.isDirectory()) {
    return { files: 1, bytes: rootStat.size }
  }
  let files = 0
  let bytes = 0
  const entries = await readdir(rootPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      const childStats = await treeStats(entryPath)
      files += childStats.files
      bytes += childStats.bytes
      continue
    }
    if (!entry.isFile()) continue
    const entryStat = await stat(entryPath)
    files += 1
    bytes += entryStat.size
  }
  return { files, bytes }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function hasDirectoryEntries(targetPath: string): Promise<boolean> {
  try {
    const entries = await readdir(targetPath)
    return entries.length > 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }
    throw error
  }
}
