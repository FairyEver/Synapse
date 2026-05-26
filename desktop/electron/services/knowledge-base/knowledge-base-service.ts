import { app, shell } from "electron"
import { constants } from "node:fs"
import type { Dirent } from "node:fs"
import { access, copyFile, lstat, mkdir, readdir, readFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseKnowledgeBaseCreateManagedPayload,
  SynapseKnowledgeBaseCreateManagedResult,
  SynapseKnowledgeBaseAddUrlSourcePayload,
  SynapseKnowledgeBaseCreateRawFolderPayload,
  SynapseKnowledgeBaseListRawDirectoryPayload,
  SynapseKnowledgeBaseListRawDirectoryResult,
  SynapseKnowledgeBaseMoveRawEntriesPayload,
  SynapseKnowledgeBaseRawMutationResult,
  SynapseKnowledgeBaseRenameRawEntryPayload,
  SynapseKnowledgeBaseTrashRawEntriesPayload,
  SynapseKnowledgeBaseUploadRawFilesPayload,
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
import { KnowledgeBaseRawFileManager } from "./raw-file-manager"
import { createMainLogger } from "../log-store"

export const KNOWLEDGE_BASE_TEMPLATE_VERSION = "2026-05-21"
const logger = createMainLogger("service.knowledge-base")

type KnowledgeBaseServiceDeps = {
  managedTemplateRoot?: string
  userDataPath?: string
  loadConfig?: () => Promise<SynapseConfig>
  now?: () => Date
  fileConversionService?: Pick<FileConversionService, "convert">
  fetchUrl?: FetchUrl
  rawFileManager?: KnowledgeBaseRawFileManager
}

export class KnowledgeBaseService {
  private readonly managedTemplateRoot: string
  private readonly userDataPath: string
  private readonly loadConfig: () => Promise<SynapseConfig>
  private readonly now: () => Date
  private readonly fileConversionService: Pick<FileConversionService, "convert">
  private readonly fetchUrl: FetchUrl
  private readonly rawFileManager: KnowledgeBaseRawFileManager

  constructor(deps: KnowledgeBaseServiceDeps = {}) {
    this.managedTemplateRoot = deps.managedTemplateRoot ?? resolveManagedTemplateRoot()
    this.userDataPath = deps.userDataPath ?? defaultKnowledgeBaseUserDataPath()
    this.loadConfig = deps.loadConfig ?? (() => configStore.load())
    this.now = deps.now ?? (() => new Date())
    this.fileConversionService = deps.fileConversionService ?? createDefaultFileConversionService()
    this.fetchUrl = deps.fetchUrl ?? createGuardedFetchUrl()
    this.rawFileManager = deps.rawFileManager ?? new KnowledgeBaseRawFileManager({
      trashItem: (targetPath) => shell.trashItem(targetPath),
    })
  }

  async createManaged(payload: SynapseKnowledgeBaseCreateManagedPayload): Promise<SynapseKnowledgeBaseCreateManagedResult> {
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
      throw new Error("知识库已存在。")
    }
    await copyDirectoryContents(this.managedTemplateRoot, runtimePath)
    const source = await readTemplateSource(this.managedTemplateRoot)
    return {
      projectId: payload.projectId,
      projectPath: knowledgeBaseVirtualPath(payload.projectId),
      runtimePath,
      templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
      ...(source ? { templateSource: source } : undefined),
    }
  }

  async listSources(projectId: string): Promise<SynapseKnowledgeBaseListSourcesResult> {
    const projectPath = await this.resolveProjectPath(projectId)
    const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
    await assertNoSymlinkInRequiredPath(projectPath, ".raw")
    await mkdir(rawPath, { recursive: true })
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

    return {
      projectId,
      sources: sources.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.relativePath.localeCompare(b.relativePath)),
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
    return { projectId, uploaded: result.uploaded, skipped: result.skipped }
  }

  async listRawDirectory(payload: SynapseKnowledgeBaseListRawDirectoryPayload): Promise<SynapseKnowledgeBaseListRawDirectoryResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const entries = await this.rawFileManager.list(rawRoot, payload.directoryPath)
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

  async renameRawEntry(payload: SynapseKnowledgeBaseRenameRawEntryPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const entry = await this.rawFileManager.renameEntry(rawRoot, payload.relativePath, payload.newName)
    const result = { entries: [entry], skipped: [] }
    this.recordRawMutation("renameRawEntry", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async moveRawEntries(payload: SynapseKnowledgeBaseMoveRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.moveEntries(rawRoot, payload.relativePaths, payload.targetDirectoryPath)
    this.recordRawMutation("moveRawEntries", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  async trashRawEntries(payload: SynapseKnowledgeBaseTrashRawEntriesPayload): Promise<SynapseKnowledgeBaseRawMutationResult> {
    const projectPath = await this.resolveProjectPath(payload.projectId)
    const rawRoot = await this.ensureRawRoot(projectPath)
    const result = await this.rawFileManager.trashEntries(rawRoot, payload.relativePaths)
    this.recordRawMutation("trashRawEntries", payload.projectId, result)
    return { projectId: payload.projectId, ...result }
  }

  private recordRawMutation(
    operation: string,
    projectId: string,
    result: Omit<SynapseKnowledgeBaseRawMutationResult, "projectId">,
  ): void {
    const skippedReasons = result.skipped.reduce<Record<string, number>>((counts, item) => {
      counts[item.reason] = (counts[item.reason] ?? 0) + 1
      return counts
    }, {})
    logger.info("Knowledge Base raw mutation completed.", {
      affectedCount: result.entries.length,
      operation,
      projectId,
      skippedCount: result.skipped.length,
      skippedReasons,
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
    return resolveManagedKnowledgeBasePath(project, this.userDataPath)
  }

  private async ensureRawRoot(projectPath: string): Promise<string> {
    const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
    await assertNoSymlinkInRequiredPath(projectPath, ".raw")
    await mkdir(rawPath, { recursive: true })
    return rawPath
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
  } catch {
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
    } catch {
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

function resolveManagedTemplateRoot(): string {
  if (process.env.SYNAPSE_KB_MANAGED_TEMPLATE_ROOT) {
    return process.env.SYNAPSE_KB_MANAGED_TEMPLATE_ROOT
  }

  if (isElectronAppPackaged()) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath: string }).resourcesPath
    return path.join(resourcesPath, "knowledge-base", "claude-obsidian-template")
  }

  return path.join(getElectronAppPath(), "resources", "knowledge-base", "claude-obsidian-template")
}

function isElectronAppPackaged(): boolean {
  return (app as { readonly isPackaged?: boolean } | undefined)?.isPackaged === true
}

function getElectronAppPath(): string {
  return (app as { getAppPath?: () => string } | undefined)?.getAppPath?.() ?? process.cwd()
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
