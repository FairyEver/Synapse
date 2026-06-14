import { constants } from "node:fs"
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  SynapseConfig,
  SynapseConfigPatch,
  SynapseKnowledgeBaseStorageConfig,
} from "../../../src/types/config"
import type { SynapseKnowledgeBaseStorageStatus as SharedKnowledgeBaseStorageStatus } from "../../../src/types/knowledge-base"
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
  getAvailableBytes?: (targetRoot: string) => Promise<number | null>
  afterCopyEntry?: (entryPath: string) => Promise<void>
  afterPhaseChange?: (phase: KnowledgeBaseStorageMigrationPhase) => Promise<void>
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

const MIN_FREE_SPACE_MARGIN_BYTES = 1024 * 1024 * 1024
const FREE_SPACE_MARGIN_RATIO = 0.1

export class KnowledgeBaseStorageMigrationService {
  private state: KnowledgeBaseStorageMigrationState = INITIAL_STATE
  private readonly listeners = new Set<(state: KnowledgeBaseStorageMigrationState) => void>()
  private cancelRequested = false
  private nonCancellable = false

  constructor(private readonly deps: KnowledgeBaseStorageMigrationDeps) {}

  getState(): KnowledgeBaseStorageMigrationState {
    return structuredClone(this.state)
  }

  isActive(): boolean {
    return this.state.active
  }

  focusDialog(): void {
    this.emitState({})
  }

  async cancelMigration(): Promise<void> {
    if (!this.state.active) return
    if (!this.state.cancellable || this.nonCancellable) {
      throw new Error("当前阶段不能取消。")
    }
    this.cancelRequested = true
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

    this.cancelRequested = false
    this.nonCancellable = false

    await this.transitionState({
      active: true,
      phase: "preparing",
      cancellable: false,
      progress: { copiedBytes: 0, totalBytes: null },
      message: "正在准备迁移",
    })
    this.deps.sourceManager.setMigrationBlocked(true)

    let oldStorage: SynapseKnowledgeBaseStorageConfig | null = null
    let tempPath: string | null = null

    try {
      const config = await this.deps.loadConfig()
      oldStorage = config.global.knowledgeBaseStorage
      const oldRoot = resolveKnowledgeBaseStorageRoot({
        userDataPath: this.deps.userDataPath,
        storage: oldStorage,
      })
      const newRoot = resolveKnowledgeBaseStorageRoot({
        userDataPath: this.deps.userDataPath,
        storage: payload.target,
      })

      if (path.resolve(oldRoot) === path.resolve(newRoot)) {
        await this.transitionState({
          active: false,
          phase: "completed",
          cancellable: false,
          message: "知识库存储位置未变化",
        })
        return { status: "completed" }
      }

      await this.assertCanStartMigration()
      this.deps.sourceManager.closeIdleWindows()
      const shouldPreserveExistingDefaultTarget = await this.validateTargetRoot(oldRoot, newRoot, payload.target)

      const oldKnowledgeBasesPath = resolveKnowledgeBasesDirectory({
        userDataPath: this.deps.userDataPath,
        storage: oldStorage,
      })
      const newKnowledgeBasesPath = resolveKnowledgeBasesDirectory({
        userDataPath: this.deps.userDataPath,
        storage: payload.target,
      })
      tempPath = path.join(newRoot, `.knowledge-bases-migration-${Date.now()}`)
      const tempKnowledgeBasesPath = path.join(tempPath, "knowledge-bases")
      const sourceStats = await treeStats(oldKnowledgeBasesPath)
      const warningCode = await this.validateAvailableSpace(newRoot, sourceStats.bytes)
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
      await this.transitionState({
        active: true,
        phase: "copying",
        cancellable: true,
        message: "正在复制知识库",
        warningCode,
        progress: {
          copiedBytes: 0,
          totalBytes: sourceStats.bytes,
        },
      })
      await mkdir(tempPath, { recursive: true })
      await this.copyKnowledgeBasesTree(oldKnowledgeBasesPath, tempKnowledgeBasesPath, sourceStats.bytes)

      const runtimeIds = managedRuntimeIds(config)
      await this.transitionState({
        active: true,
        phase: "verifying",
        cancellable: true,
        message: "正在校验知识库",
      })
      this.assertNotCancelled()
      await verifyKnowledgeBasesTree(oldKnowledgeBasesPath, tempKnowledgeBasesPath, runtimeIds)
      this.assertNotCancelled()

      await this.writeJournal({
        ...journal,
        phase: "switching",
        switchStarted: true,
      })
      this.nonCancellable = true
      await this.transitionState({
        active: true,
        phase: "switching",
        cancellable: false,
        message: "正在切换知识库存储",
      })
      if (shouldPreserveExistingDefaultTarget) {
        const backupPath = await moveExistingKnowledgeBasesAside(newKnowledgeBasesPath)
        if (backupPath) {
          logger.info("Existing default Knowledge Base storage preserved before restore.", {
            backupPath,
            targetKnowledgeBasesPath: newKnowledgeBasesPath,
          })
        }
      }
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
      await this.transitionState({
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
        await this.transitionState({
          active: false,
          phase: "completed-with-warning",
          cancellable: false,
          message: "知识库存储已迁移，旧副本仍保留",
          warningCode: "old-copy-not-trashed",
        })
        return { status: "completed-with-warning", warningCode: "old-copy-not-trashed" }
      }

      await this.clearJournal()
      await this.transitionState({
        active: false,
        phase: "completed",
        cancellable: false,
        message: "知识库存储已迁移",
      })
      return { status: "completed" }
    } catch (error) {
      if (error instanceof MigrationCancelledError) {
        if (oldStorage) {
          await this.deps.updateConfig({ global: { knowledgeBaseStorage: oldStorage } })
        }
        if (tempPath) {
          await rm(tempPath, { recursive: true, force: true })
        }
        await this.clearJournal()
        await this.transitionState({
          active: false,
          phase: "cancelled",
          cancellable: false,
          message: "知识库存储迁移已取消",
          progress: { copiedBytes: 0, totalBytes: null },
        })
        return { status: "cancelled" }
      }
      if (oldStorage && error instanceof MigrationVerificationError && !this.nonCancellable) {
        await this.deps.updateConfig({ global: { knowledgeBaseStorage: oldStorage } })
      }
      if (tempPath && !this.nonCancellable) {
        await rm(tempPath, { recursive: true, force: true })
        await this.clearJournal()
      }
      logger.warn("Knowledge Base storage migration failed.", knowledgeBaseErrorMeta(error))
      await this.transitionState({
        active: false,
        phase: "failed",
        cancellable: false,
        message: "知识库存储迁移失败",
        errorMessage: error instanceof Error ? error.message : "迁移失败。",
      })
      throw error
    } finally {
      this.deps.sourceManager.setMigrationBlocked(false)
      this.cancelRequested = false
      this.nonCancellable = false
    }
  }

  async recoverIfNeeded(): Promise<void> {
    if (this.state.active) {
      throw new Error("知识库存储迁移正在进行。")
    }

    const journal = await this.readJournal()
    if (!journal) return

    this.deps.sourceManager.setMigrationBlocked(true)
    try {
      await this.transitionState({
        active: true,
        phase: "recovering",
        cancellable: false,
        progress: { copiedBytes: 0, totalBytes: null },
        message: "正在恢复知识库存储迁移",
      })

      if (!journal.switchStarted) {
        await rm(journal.tempPath, { recursive: true, force: true })
        await this.deps.updateConfig({ global: { knowledgeBaseStorage: journal.oldStorage } })
        await this.clearJournal()
        await this.transitionState({
          active: false,
          phase: "completed",
          cancellable: false,
          message: "知识库存储迁移已恢复到旧位置",
        })
        return
      }

      if (journal.newRootVerified || await this.canVerifyRecoveredTarget(journal)) {
        await this.deps.updateConfig({ global: { knowledgeBaseStorage: journal.targetStorage } })
        await this.transitionState({
          active: true,
          phase: "cleaning",
          cancellable: false,
          progress: { copiedBytes: 0, totalBytes: null },
          message: "正在清理旧位置",
        })
        const oldKnowledgeBasesPath = path.join(journal.oldRoot, "knowledge-bases")
        if (await pathExists(oldKnowledgeBasesPath)) {
          try {
            await this.deps.trashItem(oldKnowledgeBasesPath)
          } catch (error) {
            logger.warn("Knowledge Base old storage cleanup failed during migration recovery.", {
              oldKnowledgeBasesPath,
              ...knowledgeBaseErrorMeta(error),
            })
            await this.clearJournal()
            await this.transitionState({
              active: false,
              phase: "completed-with-warning",
              cancellable: false,
              message: "知识库存储迁移已恢复到新位置，旧副本仍保留",
              warningCode: "old-copy-not-trashed",
            })
            return
          }
        }
        await this.clearJournal()
        await this.transitionState({
          active: false,
          phase: "completed",
          cancellable: false,
          message: "知识库存储迁移已恢复到新位置",
        })
        return
      }

      await this.deps.updateConfig({ global: { knowledgeBaseStorage: journal.oldStorage } })
      await this.clearJournal()
      await this.transitionState({
        active: false,
        phase: "failed",
        cancellable: false,
        message: "知识库存储迁移恢复失败",
        errorMessage: "无法确认新位置数据完整。",
      })
    } finally {
      this.deps.sourceManager.setMigrationBlocked(false)
    }
  }

  async getStorageStatus(): Promise<SharedKnowledgeBaseStorageStatus> {
    const config = await this.deps.loadConfig()
    const storage = config.global.knowledgeBaseStorage
    const rootPath = resolveKnowledgeBaseStorageRoot({
      userDataPath: this.deps.userDataPath,
      storage,
    })
    const knowledgeBasesPath = resolveKnowledgeBasesDirectory({
      userDataPath: this.deps.userDataPath,
      storage,
    })

    try {
      await access(rootPath, constants.R_OK | constants.W_OK)
      return {
        mode: storage.mode,
        rootPath,
        knowledgeBasesPath,
        available: true,
      }
    } catch (error) {
      return {
        mode: storage.mode,
        rootPath,
        knowledgeBasesPath,
        available: false,
        unavailableReason: error instanceof Error ? error.message : "知识库存储位置不可用。",
      }
    }
  }

  private async assertCanStartMigration(): Promise<void> {
    if (await this.deps.hasActiveKnowledgeBaseSession()) {
      throw new Error("知识库对话仍在运行，暂时不能迁移。请先停止知识库对话里的回答；如果没有正在回答，请重启 Synapse 后再迁移。")
    }
    if (this.deps.sourceManager.hasActiveMutation()) {
      throw new Error("资料操作仍在进行。")
    }
  }

  private async validateTargetRoot(
    oldRoot: string,
    newRoot: string,
    target: KnowledgeBaseStorageMigrationTarget,
  ): Promise<boolean> {
    if (!path.isAbsolute(newRoot)) {
      throw new Error("知识库存储位置必须是绝对路径。")
    }
    if (target.mode === "custom" && isDangerousCustomStorageRoot(newRoot)) {
      throw new Error("知识库存储位置不能选择系统根目录、用户主目录、临时目录或其它过宽的系统目录。")
    }
    if (isPathInside(newRoot, path.join(oldRoot, "knowledge-bases"))) {
      throw new Error("目标位置不能位于当前知识库目录内。")
    }
    await mkdir(newRoot, { recursive: true })
    await access(newRoot, constants.R_OK | constants.W_OK)
    const targetKnowledgeBasesPath = path.join(newRoot, "knowledge-bases")
    if (await hasDirectoryEntries(targetKnowledgeBasesPath)) {
      if (target.mode === "default") {
        return true
      }
      throw new Error("目标位置已存在知识库数据。")
    }
    return false
  }

  private async validateAvailableSpace(
    targetRoot: string,
    sourceBytes: number,
  ): Promise<KnowledgeBaseStorageMigrationState["warningCode"] | undefined> {
    let availableBytes: number | null = null
    try {
      availableBytes = await this.deps.getAvailableBytes?.(targetRoot) ?? null
    } catch (error) {
      logger.warn("Knowledge Base storage free space check failed.", {
        targetRoot,
        ...knowledgeBaseErrorMeta(error),
      })
    }

    if (availableBytes === null) {
      return "free-space-unknown"
    }

    const marginBytes = Math.max(Math.ceil(sourceBytes * FREE_SPACE_MARGIN_RATIO), MIN_FREE_SPACE_MARGIN_BYTES)
    if (availableBytes < sourceBytes + marginBytes) {
      throw new Error("目标位置空间不足。")
    }
    return undefined
  }

  private async copyKnowledgeBasesTree(
    sourcePath: string,
    targetPath: string,
    totalBytes: number,
  ): Promise<void> {
    let copiedBytes = 0
    const copyEntry = async (sourceEntryPath: string, targetEntryPath: string) => {
      this.assertNotCancelled()
      if (!await pathExists(sourceEntryPath)) {
        await mkdir(targetEntryPath, { recursive: true })
        return
      }

      const entryStat = await stat(sourceEntryPath)
      if (entryStat.isDirectory()) {
        await mkdir(targetEntryPath, { recursive: true })
        const entries = await readdir(sourceEntryPath, { withFileTypes: true })
        for (const entry of entries) {
          await copyEntry(path.join(sourceEntryPath, entry.name), path.join(targetEntryPath, entry.name))
        }
        return
      }

      if (!entryStat.isFile()) return

      await mkdir(path.dirname(targetEntryPath), { recursive: true })
      await copyFile(sourceEntryPath, targetEntryPath)
      copiedBytes += entryStat.size
      this.emitState({
        progress: {
          copiedBytes,
          totalBytes,
        },
      })
      await this.deps.afterCopyEntry?.(sourceEntryPath)
      this.assertNotCancelled()
    }

    await copyEntry(sourcePath, targetPath)
  }

  private assertNotCancelled(): void {
    if (this.cancelRequested) {
      throw new MigrationCancelledError()
    }
  }

  private async canVerifyRecoveredTarget(journal: MigrationJournal): Promise<boolean> {
    try {
      const config = await this.deps.loadConfig()
      const runtimeIds = managedRuntimeIds(config)
      const oldKnowledgeBasesPath = resolveKnowledgeBasesDirectory({
        userDataPath: this.deps.userDataPath,
        storage: journal.oldStorage,
      })
      const newKnowledgeBasesPath = resolveKnowledgeBasesDirectory({
        userDataPath: this.deps.userDataPath,
        storage: journal.targetStorage,
      })
      await verifyKnowledgeBasesTree(oldKnowledgeBasesPath, newKnowledgeBasesPath, runtimeIds)
      return true
    } catch (error) {
      logger.warn("Knowledge Base storage migration recovery verification failed.", {
        ...knowledgeBaseErrorMeta(error),
      })
      return false
    }
  }

  private async writeJournal(journal: MigrationJournal): Promise<void> {
    await mkdir(path.dirname(this.deps.journalPath), { recursive: true })
    await writeFile(this.deps.journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8")
  }

  private async clearJournal(): Promise<void> {
    await rm(this.deps.journalPath, { force: true })
  }

  private async readJournal(): Promise<MigrationJournal | null> {
    try {
      const raw = await readFile(this.deps.journalPath, "utf8")
      const parsed = JSON.parse(raw) as MigrationJournal
      return parsed.version === 1 ? parsed : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null
      }
      throw error
    }
  }

  private async transitionState(patch: Partial<KnowledgeBaseStorageMigrationState>): Promise<void> {
    this.emitState(patch)
    if (patch.phase) {
      await this.deps.afterPhaseChange?.(patch.phase)
    }
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

class MigrationCancelledError extends Error {
  constructor() {
    super("知识库存储迁移已取消。")
  }
}

function managedRuntimeIds(config: SynapseConfig): string[] {
  return config.global.projects.flatMap((project) => {
    if (!isManagedKnowledgeBaseProject(project)) return []
    const runtimeId = project.capabilities?.knowledgeBase?.runtimeId
    return runtimeId ? [runtimeId] : []
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

function isDangerousCustomStorageRoot(rootPath: string): boolean {
  const normalized = normalizeAbsolutePathForSafety(rootPath)
  const filesystemRoot = normalizeAbsolutePathForSafety(path.parse(normalized).root)
  if (normalized === filesystemRoot) return true

  const exactDangerousRoots = [
    os.homedir(),
    os.tmpdir(),
    ...commonTempRootsForPlatform(process.platform),
  ].map(normalizeAbsolutePathForSafety)
  if (exactDangerousRoots.includes(normalized)) return true

  const parent = normalizeAbsolutePathForSafety(path.dirname(normalized))
  if (parent !== filesystemRoot) return false

  return commonTopLevelSystemNamesForPlatform(process.platform)
    .has(path.basename(normalized).toLowerCase())
}

function normalizeAbsolutePathForSafety(value: string): string {
  const resolved = path.resolve(value)
  const root = path.parse(resolved).root
  let normalized = resolved
  while (normalized !== root && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -path.sep.length)
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function commonTempRootsForPlatform(platform: NodeJS.Platform): string[] {
  if (platform === "win32") return []
  return ["/tmp", "/var/tmp", "/private/tmp"]
}

function commonTopLevelSystemNamesForPlatform(platform: NodeJS.Platform): Set<string> {
  if (platform === "win32") {
    return new Set(["windows", "program files", "program files (x86)", "programdata", "users"])
  }
  if (platform === "darwin") {
    return new Set(["applications", "library", "system", "users", "bin", "sbin", "etc", "var", "tmp", "usr"])
  }
  return new Set(["bin", "boot", "dev", "etc", "home", "lib", "lib64", "media", "mnt", "opt", "proc", "root", "run", "sbin", "sys", "tmp", "usr", "var"])
}

async function moveExistingKnowledgeBasesAside(knowledgeBasesPath: string): Promise<string | null> {
  if (!await hasDirectoryEntries(knowledgeBasesPath)) {
    return null
  }
  const backupPath = await uniqueKnowledgeBasesBackupPath(path.dirname(knowledgeBasesPath))
  await rename(knowledgeBasesPath, backupPath)
  return backupPath
}

async function uniqueKnowledgeBasesBackupPath(rootPath: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`
    const candidate = path.join(rootPath, `knowledge-bases.backup-before-migration-${stamp}${suffix}`)
    if (!await pathExists(candidate)) {
      return candidate
    }
  }
  throw new Error("无法创建旧知识库备份目录。")
}
