import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import type { SynapseConfig, SynapseConfigPatch, SynapseProjectConfig } from "../../../src/types/config"
import type {
  SynapseKnowledgeBaseExportManagedResult,
  SynapseKnowledgeBaseImportManagedPayload,
  SynapseKnowledgeBaseImportManagedResult,
  SynapseKnowledgeBaseImportPreview,
  SynapseKnowledgeBaseTransferProgress,
} from "../../../src/types/knowledge-base"
import { atomicWriteTextFile } from "./atomic-write"
import {
  isManagedKnowledgeBaseProject,
  knowledgeBaseVirtualPath,
  resolveManagedKnowledgeBasePath,
} from "./managed-path"
import { assertKnowledgeBaseStorageAvailable, resolveKnowledgeBasesDirectory } from "./storage-root"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger as logger } from "./logging"

const EXPORT_METADATA_FILE = ".synapse-knowledge-base.json"
const EXPORT_SCHEMA_VERSION = 1
const LEGACY_TEMPLATE_VERSION = "legacy-import"
const PREVIEW_TTL_MS = 15 * 60 * 1000
const MAX_TRANSFER_FILES = 100_000
const MIN_FREE_SPACE_MARGIN_BYTES = 1024 * 1024 * 1024
const FREE_SPACE_MARGIN_RATIO = 0.1

const REQUIRED_RUNTIME_PATHS = [
  { relativePath: ".claude-plugin", kind: "directory" },
  { relativePath: "skills", kind: "directory" },
  { relativePath: "commands", kind: "directory" },
  { relativePath: "CLAUDE.md", kind: "file" },
  { relativePath: path.join(".raw", ".manifest.json"), kind: "file" },
  { relativePath: path.join("wiki", "index.md"), kind: "file" },
] as const

const KNOWN_PLUGIN_NAMES = new Set(["synapse-knowledge-base", "claude-obsidian"])

type TransferFile = {
  relativePath: string
  absolutePath: string
  size: number
  hash: string
  mode: number
}

type TransferSnapshot = {
  files: TransferFile[]
  directories: string[]
  totalBytes: number
}

type ExportMetadata = {
  schemaVersion: 1
  kind: "synapse-knowledge-base"
  exportedAt: string
  knowledgeBase: {
    name: string
    templateVersion: string
    sourceRuntimeId: string
  }
  files: Array<{
    path: string
    size: number
    sha256: string
  }>
}

type ImportPreviewRecord = {
  sourcePath: string
  name: string
  templateVersion: string
  snapshot: TransferSnapshot
  expiresAt: number
}

type ImportJournal = {
  projectId: string
  temporaryPath: string
  destinationPath: string
}

type KnowledgeBaseTransferServiceDeps = {
  userDataPath: string
  journalPath: string
  loadConfig: () => Promise<SynapseConfig>
  updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  getAvailableBytes?: (targetRoot: string) => Promise<number | null>
  hasActiveKnowledgeBaseSession?: (projectId: string) => Promise<boolean>
  hasActiveSourceMutation?: () => boolean
  isStorageMigrationActive?: () => boolean
  now?: () => Date
}

const INITIAL_PROGRESS: SynapseKnowledgeBaseTransferProgress = {
  active: false,
  operation: "idle",
  phase: "idle",
  cancellable: false,
  copiedBytes: 0,
  totalBytes: null,
  message: "",
}

class TransferCancelledError extends Error {
  constructor() {
    super("知识库传输已取消。")
  }
}

export class KnowledgeBaseTransferService {
  private progress = INITIAL_PROGRESS
  private readonly listeners = new Set<(progress: SynapseKnowledgeBaseTransferProgress) => void>()
  private readonly previews = new Map<string, ImportPreviewRecord>()
  private cancelRequested = false

  constructor(private readonly deps: KnowledgeBaseTransferServiceDeps) {}

  getState(): SynapseKnowledgeBaseTransferProgress {
    return structuredClone(this.progress)
  }

  isActive(): boolean {
    return this.progress.active
  }

  subscribe(listener: (progress: SynapseKnowledgeBaseTransferProgress) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  cancel(): void {
    if (this.progress.active && this.progress.cancellable) {
      this.cancelRequested = true
    }
  }

  async recoverIfNeeded(): Promise<void> {
    const journal = await this.readJournal()
    if (!journal) return

    const config = await this.deps.loadConfig()
    const registered = config.global.projects.some((project) => project.id === journal.projectId)
    if (!registered) {
      await Promise.all([
        rm(journal.temporaryPath, { recursive: true, force: true }),
        rm(journal.destinationPath, { recursive: true, force: true }),
      ])
    }
    await this.clearJournal()
  }

  async inspectImportFolder(sourcePath: string): Promise<SynapseKnowledgeBaseImportPreview> {
    if (this.isActive()) throw new Error("知识库导入或导出正在进行。")
    this.assertStorageMigrationInactive()
    this.pruneExpiredPreviews()
    await assertRuntimeShape(sourcePath)
    const plugin = await readPluginIdentity(sourcePath)
    if (!KNOWN_PLUGIN_NAMES.has(plugin.name)) {
      throw new Error("所选文件夹不是受支持的 Synapse 知识库。")
    }

    const snapshot = await createSnapshot(sourcePath)
    const metadata = await readExportMetadata(sourcePath)
    if (metadata) {
      assertMetadataMatchesSnapshot(metadata, snapshot)
    }

    const token = randomUUID()
    const suggestedName = metadata?.knowledgeBase.name.trim() || "恢复的知识库"
    this.previews.set(token, {
      sourcePath,
      name: suggestedName,
      templateVersion: metadata?.knowledgeBase.templateVersion.trim() || LEGACY_TEMPLATE_VERSION,
      snapshot,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    })

    return {
      token,
      folderName: path.basename(sourcePath),
      suggestedName,
      fileCount: snapshot.files.length,
      totalBytes: snapshot.totalBytes,
      warnings: metadata ? [] : ["legacy-export-metadata-missing"],
    }
  }

  async importManagedFolder(payload: SynapseKnowledgeBaseImportManagedPayload): Promise<SynapseKnowledgeBaseImportManagedResult> {
    if (!payload.trusted) throw new Error("请确认知识库文件夹来自可信来源。")
    const name = payload.name.trim()
    if (!name) throw new Error("知识库名称不能为空。")
    if (this.isActive()) throw new Error("知识库导入或导出正在进行。")
    this.assertStorageMigrationInactive()

    this.pruneExpiredPreviews()
    const preview = this.previews.get(payload.token)
    if (!preview) throw new Error("知识库校验已失效，请重新选择文件夹。")
    this.previews.delete(payload.token)

    const config = await this.deps.loadConfig()
    await assertKnowledgeBaseStorageAvailable({
      userDataPath: this.deps.userDataPath,
      storage: config.global.knowledgeBaseStorage,
    })
    const knowledgeBasesPath = resolveKnowledgeBasesDirectory({
      userDataPath: this.deps.userDataPath,
      storage: config.global.knowledgeBaseStorage,
    })
    const sourcePath = path.resolve(preview.sourcePath)
    const sourceIsRegisteredRuntime = config.global.projects
      .filter(isManagedKnowledgeBaseProject)
      .some((project) => path.resolve(resolveManagedKnowledgeBasePath(project, {
        userDataPath: this.deps.userDataPath,
        storage: config.global.knowledgeBaseStorage,
      })) === sourcePath)
    if (sourceIsRegisteredRuntime) {
      throw new Error("不能导入正在使用的知识库。")
    }
    await mkdir(knowledgeBasesPath, { recursive: true })
    await this.assertEnoughSpace(knowledgeBasesPath, preview.snapshot.totalBytes)
    const currentSourceSnapshot = await createSnapshot(preview.sourcePath)
    assertSnapshotsMatch(preview.snapshot, currentSourceSnapshot)

    const projectId = randomUUID()
    const temporaryPath = path.join(knowledgeBasesPath, `.${projectId}.importing`)
    const destinationPath = path.join(knowledgeBasesPath, projectId)
    const project = importedProject(projectId, name, preview.templateVersion)
    await this.writeJournal({ projectId, temporaryPath, destinationPath })
    this.begin("import", preview.snapshot.totalBytes, "正在复制知识库")

    try {
      await copySnapshot(preview.sourcePath, temporaryPath, preview.snapshot, {
        shouldCancel: () => this.throwIfCancelled(),
        onProgress: (copiedBytes) => this.emit({ copiedBytes }),
      })
      this.emit({ phase: "verifying", message: "正在校验知识库" })
      const copiedSnapshot = await createSnapshot(temporaryPath, () => this.throwIfCancelled())
      assertSnapshotsMatch(preview.snapshot, copiedSnapshot)

      this.emit({ phase: "registering", cancellable: false, message: "正在登记知识库" })
      await rename(temporaryPath, destinationPath)
      const latestConfig = await this.deps.loadConfig()
      await this.deps.updateConfig({
        global: {
          projects: [...latestConfig.global.projects, project],
        },
      })
      await this.clearJournal().catch((journalError) => {
        logger.warn("Knowledge Base import journal cleanup failed after registration.", {
          projectId,
          ...knowledgeBaseErrorMeta(journalError),
        })
      })
      this.finish("import", "completed", "知识库已导入")
      logger.info("Managed Knowledge Base imported.", {
        projectId,
        fileCount: preview.snapshot.files.length,
        totalBytes: preview.snapshot.totalBytes,
      })
      return { project }
    } catch (error) {
      await Promise.all([
        rm(temporaryPath, { recursive: true, force: true }),
        this.removeDestinationWhenUnregistered(projectId, destinationPath),
      ]).catch((cleanupError) => {
        logger.warn("Knowledge Base import cleanup failed.", {
          projectId,
          ...knowledgeBaseErrorMeta(cleanupError),
        })
      })
      await this.clearJournal().catch((journalError) => {
        logger.warn("Knowledge Base import journal cleanup failed.", knowledgeBaseErrorMeta(journalError))
      })
      if (error instanceof TransferCancelledError) {
        this.finish("import", "cancelled", "知识库导入已取消")
      } else {
        this.fail("import", error)
      }
      throw error
    }
  }

  async exportManagedFolder(projectId: string, targetParentPath: string): Promise<SynapseKnowledgeBaseExportManagedResult> {
    if (this.isActive()) throw new Error("知识库导入或导出正在进行。")
    this.assertStorageMigrationInactive()
    if (this.deps.hasActiveSourceMutation?.()) throw new Error("资料操作仍在进行。")
    if (await this.deps.hasActiveKnowledgeBaseSession?.(projectId)) {
      throw new Error("知识库 Agent 对话正在运行，请结束后再导出。")
    }
    const config = await this.deps.loadConfig()
    const project = config.global.projects.find((item) => item.id === projectId)
    if (!project || !isManagedKnowledgeBaseProject(project)) throw new Error("知识库不存在。")
    await assertKnowledgeBaseStorageAvailable({
      userDataPath: this.deps.userDataPath,
      storage: config.global.knowledgeBaseStorage,
    })
    const sourcePath = resolveManagedKnowledgeBasePath(project, {
      userDataPath: this.deps.userDataPath,
      storage: config.global.knowledgeBaseStorage,
    })
    await assertRuntimeShape(sourcePath)
    const snapshot = await createSnapshot(sourcePath)
    const outputPath = await uniqueExportPath(targetParentPath, project.name, this.now())
    const temporaryPath = path.join(targetParentPath, `.synapse-kb-export-${randomUUID()}`)
    this.begin("export", snapshot.totalBytes, "正在导出知识库")

    try {
      await copySnapshot(sourcePath, temporaryPath, snapshot, {
        shouldCancel: () => this.throwIfCancelled(),
        onProgress: (copiedBytes) => this.emit({ copiedBytes }),
      })
      this.emit({ phase: "verifying", message: "正在校验导出文件" })
      const copiedSnapshot = await createSnapshot(temporaryPath, () => this.throwIfCancelled())
      assertSnapshotsMatch(snapshot, copiedSnapshot)
      const metadata: ExportMetadata = {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        kind: "synapse-knowledge-base",
        exportedAt: this.now().toISOString(),
        knowledgeBase: {
          name: project.name,
          templateVersion: project.capabilities!.knowledgeBase!.templateVersion,
          sourceRuntimeId: project.capabilities!.knowledgeBase!.runtimeId!,
        },
        files: snapshot.files.map((file) => ({
          path: file.relativePath,
          size: file.size,
          sha256: file.hash,
        })),
      }
      await writeFile(path.join(temporaryPath, EXPORT_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
      this.emit({ cancellable: false, message: "正在完成导出" })
      await rename(temporaryPath, outputPath)
      this.finish("export", "completed", "知识库已导出")
      logger.info("Managed Knowledge Base exported.", {
        projectId,
        fileCount: snapshot.files.length,
        totalBytes: snapshot.totalBytes,
      })
      return { projectId, folderPath: outputPath }
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true }).catch((cleanupError) => {
        logger.warn("Knowledge Base export cleanup failed.", knowledgeBaseErrorMeta(cleanupError))
      })
      if (error instanceof TransferCancelledError) {
        this.finish("export", "cancelled", "知识库导出已取消")
      } else {
        this.fail("export", error)
      }
      throw error
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private assertStorageMigrationInactive(): void {
    if (this.deps.isStorageMigrationActive?.()) {
      throw new Error("知识库存储迁移正在进行，请稍后再试。")
    }
  }

  private begin(operation: "import" | "export", totalBytes: number, message: string): void {
    this.cancelRequested = false
    this.progress = {
      active: true,
      operation,
      phase: "copying",
      cancellable: true,
      copiedBytes: 0,
      totalBytes,
      message,
    }
    this.notify()
  }

  private finish(
    operation: "import" | "export",
    phase: "completed" | "cancelled",
    message: string,
  ): void {
    this.progress = {
      ...this.progress,
      active: false,
      operation,
      phase,
      cancellable: false,
      message,
    }
    this.notify()
  }

  private fail(operation: "import" | "export", error: unknown): void {
    this.progress = {
      ...this.progress,
      active: false,
      operation,
      phase: "failed",
      cancellable: false,
      message: "知识库传输失败",
      errorMessage: error instanceof Error ? error.message : "知识库传输失败。",
    }
    this.notify()
  }

  private emit(patch: Partial<SynapseKnowledgeBaseTransferProgress>): void {
    this.progress = { ...this.progress, ...patch }
    this.notify()
  }

  private notify(): void {
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }

  private throwIfCancelled(): void {
    if (this.cancelRequested) throw new TransferCancelledError()
  }

  private pruneExpiredPreviews(): void {
    const now = Date.now()
    for (const [token, preview] of this.previews) {
      if (preview.expiresAt <= now) this.previews.delete(token)
    }
  }

  private async assertEnoughSpace(targetRoot: string, sourceBytes: number): Promise<void> {
    if (!this.deps.getAvailableBytes) return
    const available = await this.deps.getAvailableBytes(targetRoot)
    if (available === null) return
    const required = sourceBytes + Math.max(Math.ceil(sourceBytes * FREE_SPACE_MARGIN_RATIO), MIN_FREE_SPACE_MARGIN_BYTES)
    if (available < required) throw new Error("知识库存储空间不足。")
  }

  private async removeDestinationWhenUnregistered(projectId: string, destinationPath: string): Promise<void> {
    const config = await this.deps.loadConfig()
    if (config.global.projects.some((project) => project.id === projectId)) return
    await rm(destinationPath, { recursive: true, force: true })
  }

  private async writeJournal(journal: ImportJournal): Promise<void> {
    await atomicWriteTextFile(this.deps.journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  }

  private async readJournal(): Promise<ImportJournal | null> {
    try {
      const value = JSON.parse(await readFile(this.deps.journalPath, "utf8")) as Partial<ImportJournal>
      if (typeof value.projectId !== "string" || typeof value.temporaryPath !== "string" || typeof value.destinationPath !== "string") {
        return null
      }
      return value as ImportJournal
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      logger.warn("Knowledge Base import journal read failed.", knowledgeBaseErrorMeta(error))
      return null
    }
  }

  private clearJournal(): Promise<void> {
    return rm(this.deps.journalPath, { force: true })
  }
}

function importedProject(projectId: string, name: string, templateVersion: string): SynapseProjectConfig & SynapseKnowledgeBaseImportManagedResult["project"] {
  return {
    id: projectId,
    name,
    path: knowledgeBaseVirtualPath(projectId),
    capabilities: {
      knowledgeBase: {
        enabled: true,
        schemaVersion: 1,
        templateVersion,
        managed: true,
        runtimeId: projectId,
      },
    },
  }
}

async function assertRuntimeShape(rootPath: string): Promise<void> {
  let rootStat
  try {
    rootStat = await lstat(rootPath)
  } catch {
    throw new Error("无法读取所选知识库文件夹。")
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("请选择完整的知识库文件夹。")
  }
  for (const required of REQUIRED_RUNTIME_PATHS) {
    try {
      const stat = await lstat(path.join(rootPath, required.relativePath))
      if (stat.isSymbolicLink()) throw new Error("symbolic-link")
      if (required.kind === "directory" ? !stat.isDirectory() : !stat.isFile()) {
        throw new Error("unexpected-entry-kind")
      }
    } catch {
      throw new Error("所选文件夹不是完整的 Synapse 知识库。")
    }
  }
}

async function readPluginIdentity(rootPath: string): Promise<{ name: string }> {
  try {
    const parsed = JSON.parse(await readFile(path.join(rootPath, ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>
    return { name: typeof parsed.name === "string" ? parsed.name.trim() : "" }
  } catch {
    throw new Error("知识库运行时信息损坏。")
  }
}

async function readExportMetadata(rootPath: string): Promise<ExportMetadata | null> {
  try {
    const parsed = JSON.parse(await readFile(path.join(rootPath, EXPORT_METADATA_FILE), "utf8")) as ExportMetadata
    if (
      parsed.schemaVersion !== EXPORT_SCHEMA_VERSION
      || parsed.kind !== "synapse-knowledge-base"
      || typeof parsed.knowledgeBase?.name !== "string"
      || typeof parsed.knowledgeBase?.templateVersion !== "string"
      || !Array.isArray(parsed.files)
    ) {
      throw new Error("invalid-metadata")
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new Error("知识库导出信息损坏。", { cause: error })
  }
}

async function createSnapshot(rootPath: string, shouldCancel?: () => void): Promise<TransferSnapshot> {
  const files: TransferFile[] = []
  const directories: string[] = []
  let totalBytes = 0

  const visit = async (directoryPath: string): Promise<void> => {
    shouldCancel?.()
    const entries = await readdir(directoryPath, { withFileTypes: true })
    for (const entry of entries) {
      shouldCancel?.()
      const absolutePath = path.join(directoryPath, entry.name)
      const stat = await lstat(absolutePath)
      if (stat.isSymbolicLink()) throw new Error("知识库不能包含符号链接或目录联接。")
      const relativePath = normalizeRelativePath(path.relative(rootPath, absolutePath))
      assertSafeRelativePath(relativePath)
      if (entry.isDirectory()) {
        directories.push(relativePath)
        await visit(absolutePath)
        continue
      }
      if (!entry.isFile()) throw new Error("知识库包含不支持的文件类型。")
      if (relativePath === EXPORT_METADATA_FILE) continue
      if (files.length >= MAX_TRANSFER_FILES) throw new Error("知识库文件数量过多。")
      const hash = await hashFile(absolutePath)
      files.push({ relativePath, absolutePath, size: stat.size, hash, mode: stat.mode })
      totalBytes += stat.size
    }
  }

  await visit(rootPath)
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  directories.sort((left, right) => left.localeCompare(right))
  return { files, directories, totalBytes }
}

async function copySnapshot(
  sourceRoot: string,
  targetRoot: string,
  snapshot: TransferSnapshot,
  options: {
    shouldCancel: () => void
    onProgress: (copiedBytes: number) => void
  },
): Promise<void> {
  await rm(targetRoot, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true })
  for (const relativePath of snapshot.directories) {
    options.shouldCancel()
    await mkdir(path.join(targetRoot, relativePath), { recursive: true })
  }
  let copiedBytes = 0
  for (const file of snapshot.files) {
    options.shouldCancel()
    const targetPath = path.join(targetRoot, file.relativePath)
    const sourcePath = path.join(sourceRoot, file.relativePath)
    const sourceStat = await lstat(sourcePath)
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error("知识库不能包含符号链接或目录联接。")
    }
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    if (process.platform !== "win32") await chmod(targetPath, file.mode)
    copiedBytes += file.size
    options.onProgress(copiedBytes)
  }
  try {
    await copyFile(path.join(sourceRoot, EXPORT_METADATA_FILE), path.join(targetRoot, EXPORT_METADATA_FILE))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

function assertMetadataMatchesSnapshot(metadata: ExportMetadata, snapshot: TransferSnapshot): void {
  const expected = new Map(snapshot.files.map((file) => [file.relativePath, file]))
  if (metadata.files.length !== expected.size) throw new Error("知识库导出文件不完整。")
  for (const file of metadata.files) {
    assertSafeRelativePath(file.path)
    const actual = expected.get(file.path)
    if (!actual || actual.size !== file.size || actual.hash !== file.sha256) {
      throw new Error("知识库导出文件校验失败。")
    }
    expected.delete(file.path)
  }
  if (expected.size > 0) throw new Error("知识库导出文件不完整。")
}

function assertSnapshotsMatch(source: TransferSnapshot, target: TransferSnapshot): void {
  if (source.files.length !== target.files.length || source.directories.length !== target.directories.length) {
    throw new Error("知识库文件校验失败。")
  }
  for (let index = 0; index < source.files.length; index += 1) {
    const left = source.files[index]!
    const right = target.files[index]!
    if (left.relativePath !== right.relativePath || left.size !== right.size || left.hash !== right.hash) {
      throw new Error("知识库文件校验失败。")
    }
  }
  for (let index = 0; index < source.directories.length; index += 1) {
    if (source.directories[index] !== target.directories[index]) throw new Error("知识库文件校验失败。")
  }
}

function assertSafeRelativePath(relativePath: string): void {
  if (!relativePath || relativePath === "." || path.isAbsolute(relativePath)) throw new Error("知识库包含不安全的路径。")
  const normalized = relativePath.replaceAll("\\", "/")
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error("知识库包含不安全的路径。")
  }
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/")
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest("hex")
}

async function uniqueExportPath(parentPath: string, name: string, now: Date): Promise<string> {
  await access(parentPath)
  const safeName = sanitizeFolderName(name) || "知识库"
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const base = `Synapse知识库-${safeName}-${stamp}`
  for (let index = 0; index < 100; index += 1) {
    const candidate = path.join(parentPath, index === 0 ? base : `${base}-${index}`)
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
  throw new Error("无法创建知识库导出文件夹。")
}

function sanitizeFolderName(value: string): string {
  const sanitized = Array.from(value, (character) => (
    character.charCodeAt(0) <= 0x1F || '<>:"/\\|?*'.includes(character) ? "-" : character
  )).join("")
  return sanitized
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80)
}

export { EXPORT_METADATA_FILE }
