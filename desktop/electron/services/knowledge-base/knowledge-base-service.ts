import { app, shell } from "electron"
import { constants, existsSync } from "node:fs"
import type { Dirent } from "node:fs"
import { access, copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseKnowledgeBaseCreateManagedPayload,
  SynapseKnowledgeBaseCreateManagedResult,
  SynapseKnowledgeBaseDeleteManagedPayload,
  SynapseKnowledgeBaseDeleteManagedResult,
  SynapseKnowledgeBaseExportRawEntriesPayload,
  SynapseKnowledgeBaseAddUrlSourcePayload,
  SynapseKnowledgeBaseCreateRawFolderPayload,
  SynapseKnowledgeBaseListRawDirectoryPayload,
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseMoveRawEntriesPayload,
  SynapseKnowledgeBaseRawMutationResult,
  SynapseKnowledgeBaseRenameRawEntryPayload,
  SynapseKnowledgeBaseTrashRawEntriesPayload,
  SynapseKnowledgeBaseUploadRawFilesPayload,
  SynapseKnowledgeBaseUploadRawItemsPayload,
  SynapseKnowledgeBaseListSourcesResult,
  SynapseKnowledgeBaseSourceEntry,
  SynapseKnowledgeBaseUploadSourcesPayload,
  SynapseKnowledgeBaseUploadSourcesResult,
} from "../../../src/types/knowledge-base"
import type { SynapseConfig, SynapseProjectConfig } from "../../../src/types/config"
import { createDefaultFileConversionService, type FileConversionService } from "../file-conversion"
import { scanKnowledgeBaseSources } from "./source-scan"
import { stageKnowledgeBaseSources, stageKnowledgeBaseUrlSource } from "./source-staging"
import { createGuardedFetchUrl } from "../source-acquisition/guarded-fetch-url"
import type { FetchUrl } from "../source-acquisition/url-source"
import { configStore } from "../config-store"
import {
  defaultKnowledgeBaseUserDataPath,
  isManagedKnowledgeBaseProject,
  knowledgeBaseVirtualPath,
  resolveManagedKnowledgeBasePath,
} from "./managed-path"
import { knowledgeBaseErrorMeta, knowledgeBaseLogger as logger } from "./logging"
import { KnowledgeBaseRawFileManager } from "./raw-file-manager"
import { readKnowledgeBaseManifest, writeKnowledgeBaseManifest, type KnowledgeBaseManifest } from "./manifest"

export const KNOWLEDGE_BASE_TEMPLATE_VERSION = "2026-05-21"

type KnowledgeBaseServiceDeps = {
  managedTemplateRoot?: string
  userDataPath?: string
  loadConfig?: () => Promise<SynapseConfig>
  now?: () => Date
  getAppPathForTest?: () => string
  fileConversionService?: Pick<FileConversionService, "convert">
  fetchUrl?: FetchUrl
  rawFileManager?: KnowledgeBaseRawFileManager
  trashItem?: (targetPath: string) => Promise<void>
}

type ManagedKnowledgeBaseCreateResult = SynapseKnowledgeBaseCreateManagedResult & {
  runtimePath: string
}

type ManagedKnowledgeBaseDeleteResult = SynapseKnowledgeBaseDeleteManagedResult & {
  runtimePath: string
}

export class KnowledgeBaseService {
  private readonly managedTemplateRoot: string
  private readonly userDataPath: string
  private readonly loadConfig: () => Promise<SynapseConfig>
  private readonly now: () => Date
  private readonly fileConversionService: Pick<FileConversionService, "convert">
  private readonly fetchUrl: FetchUrl
  private readonly rawFileManager: KnowledgeBaseRawFileManager
  private readonly trashItem: (targetPath: string) => Promise<void>
  private readonly activeManagedCreates = new Set<string>()

  constructor(deps: KnowledgeBaseServiceDeps = {}) {
    this.managedTemplateRoot = deps.managedTemplateRoot ?? resolveManagedTemplateRoot(deps.getAppPathForTest)
    this.userDataPath = deps.userDataPath ?? defaultKnowledgeBaseUserDataPath()
    this.loadConfig = deps.loadConfig ?? (() => configStore.load())
    this.now = deps.now ?? (() => new Date())
    this.fileConversionService = deps.fileConversionService ?? createDefaultFileConversionService()
    this.fetchUrl = deps.fetchUrl ?? createGuardedFetchUrl()
    this.rawFileManager = deps.rawFileManager ?? new KnowledgeBaseRawFileManager({
      trashItem: (targetPath) => shell.trashItem(targetPath),
    })
    this.trashItem = deps.trashItem ?? ((targetPath) => shell.trashItem(targetPath))
  }

  async createManaged(payload: SynapseKnowledgeBaseCreateManagedPayload): Promise<ManagedKnowledgeBaseCreateResult> {
    if (this.activeManagedCreates.has(payload.projectId)) {
      logger.warn("Managed Knowledge Base create rejected because project creation is already active.", {
        projectId: payload.projectId,
      })
      throw new Error("知识库正在创建，请稍后重试。")
    }
    this.activeManagedCreates.add(payload.projectId)
    try {
      return await this.createManagedUnlocked(payload)
    } finally {
      this.activeManagedCreates.delete(payload.projectId)
    }
  }

  private async createManagedUnlocked(payload: SynapseKnowledgeBaseCreateManagedPayload): Promise<ManagedKnowledgeBaseCreateResult> {
    const project: SynapseProjectConfig = {
      id: payload.projectId,
      name: payload.name,
      path: knowledgeBaseVirtualPath(payload.projectId),
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
          managed: true,
          runtimeId: payload.projectId,
        },
      },
    }
    const runtimePath = resolveManagedKnowledgeBasePath(project, this.userDataPath)
    if (await pathExists(runtimePath)) {
      logger.warn("Managed Knowledge Base runtime already exists.", {
        projectId: payload.projectId,
        runtimePath,
      })
      throw new Error("知识库已存在。")
    }
    try {
      await copyDirectoryContents(this.managedTemplateRoot, runtimePath)
      await resetNewManagedRuntimeContent(runtimePath)
      const source = await readTemplateSource(this.managedTemplateRoot)
      logger.info("Managed Knowledge Base runtime created.", {
        projectId: payload.projectId,
        runtimePath,
        templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
        templateSourceCommit: source?.commit,
      })
      return {
        projectId: payload.projectId,
        projectPath: knowledgeBaseVirtualPath(payload.projectId),
        runtimePath,
        templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
        ...(source ? { templateSource: source } : undefined),
      }
    } catch (error) {
      try {
        await rm(runtimePath, { recursive: true, force: true })
      } catch (cleanupError) {
        logger.warn("Managed Knowledge Base runtime cleanup after create failure failed.", {
          runtimePath,
          ...knowledgeBaseErrorMeta(cleanupError),
        })
      }
      logger.warn("Managed Knowledge Base runtime creation failed.", {
        projectId: payload.projectId,
        runtimePath,
        ...knowledgeBaseErrorMeta(error),
      })
      throw error
    }
  }

  async deleteManaged(payload: SynapseKnowledgeBaseDeleteManagedPayload): Promise<ManagedKnowledgeBaseDeleteResult> {
    const runtimePath = payload.runtimeId
      ? await this.resolveRuntimePath(payload.runtimeId)
      : await this.resolveProjectPath(payload.projectId)
    if (!await pathExists(runtimePath)) {
      return { projectId: payload.projectId, runtimePath, deleted: false }
    }
    await this.trashItem(runtimePath)
    logger.info("Managed Knowledge Base runtime trashed.", {
      projectId: payload.projectId,
      runtimePath,
    })
    return { projectId: payload.projectId, runtimePath, deleted: true }
  }

  async listSources(projectId: string): Promise<SynapseKnowledgeBaseListSourcesResult> {
    const projectPath = await this.resolveProjectPath(projectId)
    const rawPath = await this.requireRawRoot(projectPath)
    const scan = await scanKnowledgeBaseSources(projectPath)
    const supportedByPath = new Map(scan.sources.map((source) => [source.relativePath, source]))
    const rawFiles = await walkRawFiles(projectPath, rawPath)
    const sources: SynapseKnowledgeBaseSourceEntry[] = []

    for (const file of rawFiles) {
      const scanned = supportedByPath.get(file.relativePath)
      const status = scanned
        ? scanned.state === "new" ? "pending" : scanned.state === "changed" ? "changed" : "imported"
        : isSupportedSourcePath(file.relativePath) ? "error" : "unsupported"
      sources.push({
        relativePath: file.relativePath,
        name: path.basename(file.relativePath),
        size: file.size,
        modifiedAt: file.modifiedAt,
        supported: Boolean(scanned),
        status,
        ...(scanned?.hash ? { hash: scanned.hash } : undefined),
      })
    }

    const sortedSources = sources.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.relativePath.localeCompare(b.relativePath))
    logger.info("Knowledge Base sources listed.", {
      projectId,
      sourceCount: sortedSources.length,
      statusCounts: sourceStatusCounts(sortedSources),
    })
    return {
      projectId,
      sources: sortedSources,
    }
  }

  async uploadSources(payload: SynapseKnowledgeBaseUploadSourcesPayload): Promise<SynapseKnowledgeBaseUploadSourcesResult> {
    const projectId = payload.projectId
    const projectPath = await this.resolveProjectPath(projectId)
    const result = await stageKnowledgeBaseSources({
      projectPath,
      filePaths: payload.filePaths,
      now: this.now,
      converter: this.fileConversionService,
    })
    logger.info("Knowledge Base source upload completed.", {
      projectId,
      requestedCount: payload.filePaths.length,
      uploadedCount: result.uploaded.length,
      skippedCount: result.skipped.length,
      skippedReasons: skippedReasonCounts(result.skipped),
    })
    return { projectId, uploaded: result.uploaded, skipped: result.skipped }
  }

  async addUrlSource(payload: SynapseKnowledgeBaseAddUrlSourcePayload): Promise<SynapseKnowledgeBaseUploadSourcesResult> {
    const projectId = payload.projectId
    const projectPath = await this.resolveProjectPath(projectId)
    const result = await stageKnowledgeBaseUrlSource({
      projectPath,
      url: payload.url,
      now: this.now,
      fetchUrl: this.fetchUrl,
    })
    logger.info("Knowledge Base URL source upload completed.", {
      projectId,
      uploadedCount: result.uploaded.length,
      skippedCount: result.skipped.length,
      skippedReasons: skippedReasonCounts(result.skipped),
    })
    return { projectId, uploaded: result.uploaded, skipped: result.skipped }
  }

  async listRawDirectory(payload: SynapseKnowledgeBaseListRawDirectoryPayload): Promise<SynapseKnowledgeBaseListRawDirectoryResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    assertRawRelativePathInside(projectPath, payload.directoryPath)
    const rawRoot = await this.requireRawRoot(projectPath)
    const entries = await this.rawFileManager.list(rawRoot, payload.directoryPath)
    logger.info("Knowledge Base raw directory listed.", {
      projectId: payload.projectId,
      directoryPath: payload.directoryPath,
      entryCount: entries.length,
      directoryCount: entries.filter((entry) => entry.kind === "directory").length,
      fileCount: entries.filter((entry) => entry.kind === "file").length,
    })
    return { projectId: payload.projectId, directoryPath: payload.directoryPath, entries }
  }

  async createRawFolder(payload: SynapseKnowledgeBaseCreateRawFolderPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const entry = await this.rawFileManager.createFolder(rawRoot, payload.parentDirectoryPath, payload.name)
    const result = { entries: [entry], skipped: [] }
    this.recordRawMutation("createRawFolder", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async uploadRawFiles(payload: SynapseKnowledgeBaseUploadRawFilesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.uploadFiles(rawRoot, payload.targetDirectoryPath, payload.filePaths)
    this.recordRawMutation("uploadRawFiles", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async uploadRawItems(payload: SynapseKnowledgeBaseUploadRawItemsPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.uploadItems(rawRoot, payload.targetDirectoryPath, payload.itemPaths)
    this.recordRawMutation("uploadRawItems", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async exportRawEntries(payload: SynapseKnowledgeBaseExportRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.exportEntries(rawRoot, payload.relativePaths, payload.targetDirectoryPath)
    this.recordRawMutation("exportRawEntries", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async renameRawEntry(payload: SynapseKnowledgeBaseRenameRawEntryPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const entry = await this.rawFileManager.renameEntry(rawRoot, payload.relativePath, payload.newName)
    const result = { entries: [entry], skipped: [] }
    await this.syncManifestAfterRawMutation(projectPath, payload.projectId, "renameRawEntry", [{
      from: payload.relativePath,
      to: entry.relativePath,
      kind: entry.kind,
    }])
    this.recordRawMutation("renameRawEntry", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async moveRawEntries(payload: SynapseKnowledgeBaseMoveRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.moveEntries(rawRoot, payload.relativePaths, payload.targetDirectoryPath)
    const movedEntriesByPath = new Map(result.entries.map((entry) => [entry.relativePath, entry]))
    const changes = payload.relativePaths.flatMap((relativePath) => {
      const targetRelativePath = joinRawPath(payload.targetDirectoryPath, path.posix.basename(normalizeRawRelativePath(relativePath)))
      const entry = movedEntriesByPath.get(targetRelativePath)
      return entry ? [{ from: relativePath, to: entry.relativePath, kind: entry.kind }] : []
    })
    await this.syncManifestAfterRawMutation(projectPath, payload.projectId, "moveRawEntries", changes)
    this.recordRawMutation("moveRawEntries", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async trashRawEntries(payload: SynapseKnowledgeBaseTrashRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.trashEntries(rawRoot, payload.relativePaths)
    await this.syncManifestAfterRawMutation(projectPath, payload.projectId, "trashRawEntries", result.entries.map((entry) => ({
      from: entry.relativePath,
      kind: entry.kind,
    })))
    this.recordRawMutation("trashRawEntries", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  private recordRawMutation(
    operation: string,
    projectId: string,
    result: Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">,
  ): void {
    logger.info("Knowledge Base raw mutation completed.", {
      affectedCount: result.entries.length,
      operation,
      projectId,
      skippedCount: result.skipped.length,
      skippedReasons: skippedReasonCounts(result.skipped),
    })
  }

  private async syncManifestAfterRawMutation(
    projectPath: string,
    projectId: string,
    operation: string,
    changes: readonly RawManifestChange[],
  ): Promise<void> {
    if (changes.length === 0) return
    const manifestResult = await readKnowledgeBaseManifest(projectPath)
    if (manifestResult.status === "missing") return
    if (manifestResult.status === "invalid") {
      logger.warn("Knowledge Base raw mutation skipped manifest sync because manifest is invalid.", {
        operation,
        projectId,
        ...knowledgeBaseErrorMeta(manifestResult.error),
      })
      return
    }

    const updated = applyRawManifestChanges(manifestResult.manifest, changes)
    if (!updated.changed) return
    await writeKnowledgeBaseManifest(projectPath, updated.manifest)
    logger.info("Knowledge Base raw mutation synced manifest sources.", {
      changedSourceCount: updated.changedSourceCount,
      operation,
      projectId,
    })
  }

  private async resolveProjectPath(projectId: string): Promise<string> {
    const config = await this.loadConfig()
    const project = config.global.projects.find((item) => item.id === projectId)
    if (!project) {
      throw new Error("找不到知识库项目。")
    }
    if (!isManagedKnowledgeBaseProject(project)) {
      throw new Error("当前项目不是托管知识库。")
    }
    const projectPath = resolveManagedKnowledgeBasePath(project, this.userDataPath)
    await assertKnowledgeBaseRootNotSymlink(projectPath)
    return projectPath
  }

  private async resolveRuntimePath(runtimeId: string): Promise<string> {
    const projectPath = resolveManagedKnowledgeBasePath({
      id: runtimeId,
      name: runtimeId,
      path: knowledgeBaseVirtualPath(runtimeId),
      capabilities: {
        knowledgeBase: {
          enabled: true,
          schemaVersion: 1,
          templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
          managed: true,
          runtimeId,
        },
      },
    }, this.userDataPath)
    await assertKnowledgeBaseRootNotSymlink(projectPath)
    return projectPath
  }

  private async ensureRawRoot(projectPath: string): Promise<string> {
    const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
    await assertNoSymlinkInRequiredPath(projectPath, ".raw")
    await mkdir(rawPath, { recursive: true })
    return rawPath
  }

  private async requireRawRoot(projectPath: string): Promise<string> {
    const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
    await assertNoSymlinkInRequiredPath(projectPath, ".raw")
    try {
      const stat = await lstat(rawPath)
      if (!stat.isDirectory()) {
        throw new Error("知识库资料目录不是文件夹。")
      }
      return rawPath
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error("知识库资料目录缺失。")
      }
      throw error
    }
  }
}

type RawFileEntry = {
  relativePath: string
  size: number
  modifiedAt: string
}

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".xml",
])

async function walkRawFiles(projectPath: string, directoryPath: string): Promise<RawFileEntry[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    logger.warn("Knowledge Base raw file walk failed.", {
      relativePath: normalizeRelativePath(path.relative(projectPath, directoryPath)),
      ...knowledgeBaseErrorMeta(error),
    })
    return []
  }

  const files: RawFileEntry[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    const relativePath = normalizeRelativePath(path.relative(projectPath, absolutePath))
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      files.push(...await walkRawFiles(projectPath, absolutePath))
      continue
    }
    if (!entry.isFile() || relativePath === ".raw/.manifest.json") continue
    try {
      const stat = await lstat(absolutePath)
      files.push({
        relativePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      })
    } catch (error) {
      logger.warn("Knowledge Base raw file stat failed.", {
        relativePath,
        ...knowledgeBaseErrorMeta(error),
      })
      files.push({
        relativePath,
        size: 0,
        modifiedAt: new Date(0).toISOString(),
      })
    }
  }
  return files
}

function isSupportedSourcePath(relativePath: string): boolean {
  return SUPPORTED_SOURCE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/")
}

function skippedReasonCounts(
  skipped: readonly { readonly reason: string }[],
): Record<string, number> {
  return skipped.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1
    return counts
  }, {})
}

function sourceStatusCounts(
  sources: readonly Pick<SynapseKnowledgeBaseSourceEntry, "status">[],
): Record<string, number> {
  return sources.reduce<Record<string, number>>((counts, source) => {
    counts[source.status] = (counts[source.status] ?? 0) + 1
    return counts
  }, {})
}

type RawManifestChange = {
  readonly from: string
  readonly to?: string
  readonly kind: "file" | "directory"
}

function applyRawManifestChanges(
  manifest: KnowledgeBaseManifest,
  changes: readonly RawManifestChange[],
): { readonly changed: boolean; readonly changedSourceCount: number; readonly manifest: KnowledgeBaseManifest } {
  const sources = { ...manifest.sources }
  let changedSourceCount = 0

  for (const change of changes) {
    const fromKey = rawManifestKey(change.from)
    const toKey = change.to ? rawManifestKey(change.to) : undefined
    const affectedEntries = Object.entries(sources).filter(([sourcePath]) => {
      if (sourcePath === fromKey) return true
      return change.kind === "directory" && sourcePath.startsWith(`${fromKey}/`)
    })

    for (const [sourcePath, entry] of affectedEntries) {
      delete sources[sourcePath]
      if (toKey) {
        const suffix = sourcePath === fromKey ? "" : sourcePath.slice(fromKey.length)
        sources[`${toKey}${suffix}`] = entry
      }
      changedSourceCount += 1
    }
  }

  if (changedSourceCount === 0) {
    return { changed: false, changedSourceCount: 0, manifest }
  }
  return {
    changed: true,
    changedSourceCount,
    manifest: {
      ...manifest,
      sources,
    },
  }
}

function rawManifestKey(rawRelativePath: string): string {
  const normalized = normalizeRawRelativePath(rawRelativePath)
  return normalized ? `.raw/${normalized}` : ".raw"
}

function normalizeRawRelativePath(value: string): string {
  return value.split("\\").join("/").replace(/^\/+/, "").replace(/\/+$/g, "")
}

function assertRawRelativePathInside(projectPath: string, rawRelativePath: string): void {
  const rawRoot = path.resolve(projectPath, ".raw")
  const target = path.resolve(rawRoot, normalizeRawRelativePath(rawRelativePath))
  const relative = path.relative(rawRoot, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("目标路径不在资料目录中。")
  }
}

function joinRawPath(parent: string, name: string): string {
  const normalizedParent = normalizeRawRelativePath(parent)
  return normalizedParent && normalizedParent !== "." ? `${normalizedParent}/${name}` : name
}

function resolveManagedTemplateRoot(getAppPathForTest?: () => string): string {
  if (process.env.SYNAPSE_KB_MANAGED_TEMPLATE_ROOT) {
    return process.env.SYNAPSE_KB_MANAGED_TEMPLATE_ROOT
  }

  const resourcesRoot = isElectronAppPackaged()
    ? (process as NodeJS.Process & { resourcesPath: string }).resourcesPath
    : path.join(getAppPathForTest?.() ?? getElectronAppPath(), "resources")
  const canonicalRoot = path.join(resourcesRoot, "knowledge-base", "synapse-knowledge-base-template")
  if (existsSync(canonicalRoot)) {
    return canonicalRoot
  }

  const legacyRoot = path.join(resourcesRoot, "knowledge-base", legacyManagedTemplateDirectoryName())
  if (existsSync(legacyRoot)) {
    logger.warn("Managed Knowledge Base template fell back to legacy path.", {
      legacyTemplateRoot: legacyRoot,
    })
    return legacyRoot
  }

  return canonicalRoot
}

function isElectronAppPackaged(): boolean {
  return (app as { readonly isPackaged?: boolean } | undefined)?.isPackaged === true
}

function getElectronAppPath(): string {
  return (app as { getAppPath?: () => string } | undefined)?.getAppPath?.() ?? process.cwd()
}

function legacyManagedTemplateDirectoryName(): string {
  return ["claude", "obsidian", "template"].join("-")
}

function assertInside(rootPath: string, targetPath: string): string {
  const root = path.resolve(rootPath)
  const target = path.resolve(targetPath)
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("目标路径不在项目目录中。")
  }
  return target
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function copyDirectoryContents(sourceRoot: string, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true })
  const entries = await readdir(sourceRoot, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name)
    const targetPath = path.join(targetRoot, entry.name)
    if (entry.isSymbolicLink()) {
      continue
    }
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath)
      continue
    }
    if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true })
      await copyFile(sourcePath, targetPath)
    }
  }
}

async function resetNewManagedRuntimeContent(runtimePath: string): Promise<void> {
  await resetNewManagedWiki(runtimePath)
  await resetNewManagedRaw(runtimePath)
  await resetNewManagedVaultMeta(runtimePath)
}

async function resetNewManagedWiki(runtimePath: string): Promise<void> {
  const wikiPath = path.join(runtimePath, "wiki")
  await rm(wikiPath, { recursive: true, force: true })
  await mkdir(path.join(wikiPath, "sources"), { recursive: true })
  await mkdir(path.join(wikiPath, "concepts"), { recursive: true })
  await mkdir(path.join(wikiPath, "entities"), { recursive: true })
  await mkdir(path.join(wikiPath, "questions"), { recursive: true })
  await mkdir(path.join(wikiPath, "meta"), { recursive: true })
  await writeFile(path.join(wikiPath, "index.md"), "# Index\n\nNo entries yet.\n", "utf8")
  await writeFile(path.join(wikiPath, "log.md"), "# Log\n\n", "utf8")
  await writeFile(path.join(wikiPath, "hot.md"), "# Hot\n\n", "utf8")
  await writeFile(path.join(wikiPath, "overview.md"), "# Overview\n\nNo entries yet.\n", "utf8")
  await writeFile(path.join(wikiPath, "sources", "_index.md"), "# Sources\n\nNo entries yet.\n", "utf8")
  await writeFile(path.join(wikiPath, "concepts", "_index.md"), "# Concepts\n\nNo entries yet.\n", "utf8")
  await writeFile(path.join(wikiPath, "entities", "_index.md"), "# Entities\n\nNo entries yet.\n", "utf8")
  await writeFile(path.join(wikiPath, "questions", "_index.md"), "# Questions\n\nNo entries yet.\n", "utf8")
}

async function resetNewManagedRaw(runtimePath: string): Promise<void> {
  const rawPath = path.join(runtimePath, ".raw")
  await rm(rawPath, { recursive: true, force: true })
  await mkdir(rawPath, { recursive: true })
  await writeFile(path.join(rawPath, ".gitkeep"), "", "utf8")
  await writeFile(path.join(rawPath, ".manifest.json"), JSON.stringify({
    version: 1,
    sources: {},
    address_map: {},
  }, null, 2) + "\n", "utf8")
}

async function resetNewManagedVaultMeta(runtimePath: string): Promise<void> {
  const vaultMetaPath = path.join(runtimePath, ".vault-meta")
  await mkdir(vaultMetaPath, { recursive: true })
  await writeFile(path.join(vaultMetaPath, "address-counter.txt"), "1\n", "utf8")
}

async function assertNoSymlinkInRequiredPath(projectPath: string, relativePath: string): Promise<void> {
  let currentPath = projectPath
  for (const segment of relativePath.split(/[\\/]/)) {
    currentPath = path.join(currentPath, segment)
    try {
      const stat = await lstat(currentPath)
      if (stat.isSymbolicLink()) {
        throw new Error(`知识库路径不能包含符号链接：${path.relative(projectPath, currentPath)}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return
      }
      throw error
    }
  }
}

async function assertKnowledgeBaseRootNotSymlink(projectPath: string): Promise<void> {
  try {
    const stat = await lstat(projectPath)
    if (stat.isSymbolicLink()) {
      throw new Error("知识库根目录不能是符号链接。")
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return
    }
    throw error
  }
}

async function readTemplateSource(templateRoot: string): Promise<SynapseKnowledgeBaseCreateManagedResult["templateSource"] | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path.join(templateRoot, "SOURCE.json"), "utf8")) as Record<string, unknown>
    return {
      ...(typeof parsed.repo === "string" ? { repo: parsed.repo } : undefined),
      ...(typeof parsed.commit === "string" ? { commit: parsed.commit } : undefined),
      ...(typeof parsed.syncedAt === "string" ? { syncedAt: parsed.syncedAt } : undefined),
    }
  } catch {
    return undefined
  }
}
