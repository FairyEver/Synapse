import { app } from "electron"
import { constants } from "node:fs"
import type { Dirent } from "node:fs"
import { access, copyFile, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseKnowledgeBaseInitializePayload,
  SynapseKnowledgeBaseInitializeResult,
  SynapseKnowledgeBaseInspection,
  SynapseKnowledgeBaseListSourcesResult,
  SynapseKnowledgeBaseOpenRawResult,
  SynapseKnowledgeBaseSourceEntry,
  SynapseKnowledgeBaseUploadSourcesPayload,
  SynapseKnowledgeBaseUploadSourcesResult,
} from "../../../src/types/knowledge-base"
import { scanKnowledgeBaseSources } from "./source-scan"

export const KNOWLEDGE_BASE_TEMPLATE_VERSION = "2026-05-21"

const REQUIRED_PATHS = [
  ".synapse-kb.json",
  ".raw/.manifest.json",
  "wiki/index.md",
  "wiki/hot.md",
  "wiki/log.md",
  "wiki/overview.md",
  "wiki/sources/_index.md",
  "wiki/concepts/_index.md",
  "wiki/entities/_index.md",
  "wiki/questions/_index.md",
] as const

type KnowledgeBaseServiceDeps = {
  templateRoot?: string
  now?: () => Date
}

export class KnowledgeBaseService {
  private readonly templateRoot: string
  private readonly now: () => Date

  constructor(deps: KnowledgeBaseServiceDeps = {}) {
    this.templateRoot = deps.templateRoot ?? resolveTemplateRoot()
    this.now = deps.now ?? (() => new Date())
  }

  async inspect(projectPath: string): Promise<SynapseKnowledgeBaseInspection> {
    const missingRequiredPaths: string[] = []
    for (const relativePath of REQUIRED_PATHS) {
      if (!await pathExists(path.join(projectPath, relativePath))) {
        missingRequiredPaths.push(relativePath)
      }
    }

    const metadata = await readMetadata(projectPath)
    const hasRequiredShape = missingRequiredPaths.length === 0
    const hasMetadata = metadata !== null

    return {
      projectPath,
      isKnowledgeBase: hasMetadata || hasRequiredShape,
      hasMetadata,
      hasRequiredShape,
      missingRequiredPaths,
      ...(metadata?.templateVersion ? { templateVersion: metadata.templateVersion } : undefined),
    }
  }

  async initialize(payload: SynapseKnowledgeBaseInitializePayload): Promise<SynapseKnowledgeBaseInitializeResult> {
    const projectPath = path.resolve(payload.projectPath)
    await mkdir(projectPath, { recursive: true })
    if (payload.mode === "create" && (await this.inspect(projectPath)).isKnowledgeBase) {
      throw new Error("知识库已存在。")
    }

    const createdFiles: string[] = []
    const existingFiles: string[] = []
    for (const relativePath of REQUIRED_PATHS) {
      const targetPath = assertInside(projectPath, path.join(projectPath, relativePath))
      const templatePath = path.join(this.templateRoot, relativePath)
      await assertNoSymlinkInRequiredPath(projectPath, relativePath)
      await mkdir(path.dirname(targetPath), { recursive: true })
      if (await pathExists(targetPath)) {
        existingFiles.push(relativePath)
        continue
      }
      if (await pathExists(templatePath)) {
        await copyFile(templatePath, targetPath)
      } else {
        await writeFile(targetPath, defaultTemplateFor(relativePath), "utf8")
      }
      createdFiles.push(relativePath)
    }

    await mkdir(assertInside(projectPath, path.join(projectPath, "_attachments")), { recursive: true })
    await mkdir(assertInside(projectPath, path.join(projectPath, "wiki", "meta")), { recursive: true })

    return {
      projectPath,
      templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
      createdFiles,
      existingFiles,
    }
  }

  async openRawDirectory(projectPath: string): Promise<SynapseKnowledgeBaseOpenRawResult> {
    const rawPath = assertInside(projectPath, path.join(projectPath, ".raw"))
    await assertNoSymlinkInRequiredPath(projectPath, ".raw")
    await mkdir(rawPath, { recursive: true })
    return { rawPath }
  }

  async listSources(projectPath: string): Promise<SynapseKnowledgeBaseListSourcesResult> {
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
      projectPath,
      sources: sources.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.relativePath.localeCompare(b.relativePath)),
    }
  }

  async uploadSources(payload: SynapseKnowledgeBaseUploadSourcesPayload): Promise<SynapseKnowledgeBaseUploadSourcesResult> {
    const projectPath = path.resolve(payload.projectPath)
    const targetRelativeDir = path.join(".raw", ...datePathSegments(this.now()))
    const targetDir = assertInside(projectPath, path.join(projectPath, targetRelativeDir))
    await assertNoSymlinkInRequiredPath(projectPath, targetRelativeDir)
    await mkdir(targetDir, { recursive: true })

    const uploaded: SynapseKnowledgeBaseUploadSourcesResult["uploaded"] = []
    const skipped: SynapseKnowledgeBaseUploadSourcesResult["skipped"] = []
    for (const filePath of payload.filePaths) {
      const sourcePath = path.resolve(filePath)
      try {
        const sourceStat = await lstat(sourcePath)
        if (!sourceStat.isFile()) {
          skipped.push({ path: filePath, reason: "not-file" })
          continue
        }
        const targetPath = await resolveCollisionPath(targetDir, path.basename(sourcePath))
        await copyFile(sourcePath, targetPath)
        uploaded.push({
          originalPath: filePath,
          relativePath: normalizeRelativePath(path.relative(projectPath, targetPath)),
          name: path.basename(targetPath),
          size: sourceStat.size,
        })
      } catch {
        skipped.push({ path: filePath, reason: "read-error" })
      }
    }

    return { projectPath, uploaded, skipped }
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

function datePathSegments(date: Date): string[] {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ]
}

async function resolveCollisionPath(directoryPath: string, fileName: string): Promise<string> {
  const parsed = path.parse(fileName)
  let candidate = path.join(directoryPath, fileName)
  let index = 2
  while (await pathExists(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name}-${index}${parsed.ext}`)
    index += 1
  }
  return candidate
}

function resolveTemplateRoot(): string {
  if (process.env.SYNAPSE_KB_TEMPLATE_ROOT) {
    return process.env.SYNAPSE_KB_TEMPLATE_ROOT
  }

  if (app.isPackaged) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath: string }).resourcesPath
    return path.join(resourcesPath, "knowledge-base", "templates")
  }

  return path.join(app.getAppPath(), "resources", "knowledge-base", "templates")
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

async function readMetadata(projectPath: string): Promise<{ templateVersion?: string } | null> {
  try {
    const content = await readFile(path.join(projectPath, ".synapse-kb.json"), "utf8")
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (parsed.type !== "synapse.knowledgeBase" || parsed.schemaVersion !== 1) {
      return null
    }
    return {
      templateVersion: typeof parsed.templateVersion === "string" ? parsed.templateVersion : undefined,
    }
  } catch {
    return null
  }
}

function defaultTemplateFor(relativePath: string): string {
  if (relativePath === ".raw/.manifest.json") {
    return `${JSON.stringify({
      version: 1,
      created: "2026-05-21",
      description: "Ingest delta tracker and address map for the Synapse knowledge base. Do not hand-edit; wiki ingest maintains this.",
      sources: {},
      address_map: {},
    }, null, 2)}\n`
  }
  if (relativePath === ".synapse-kb.json") {
    return `${JSON.stringify({
      type: "synapse.knowledgeBase",
      schemaVersion: 1,
      templateVersion: KNOWLEDGE_BASE_TEMPLATE_VERSION,
      createdBy: "Synapse",
    }, null, 2)}\n`
  }
  const title = path.basename(relativePath, ".md")
  return `---\ntype: meta\ntitle: "${title}"\nstatus: active\ntags:\n  - meta\n---\n\n# ${title}\n`
}
