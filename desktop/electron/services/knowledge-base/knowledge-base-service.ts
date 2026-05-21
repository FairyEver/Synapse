import { app } from "electron"
import { constants } from "node:fs"
import { access, copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  SynapseKnowledgeBaseInitializePayload,
  SynapseKnowledgeBaseInitializeResult,
  SynapseKnowledgeBaseInspection,
  SynapseKnowledgeBaseOpenRawResult,
} from "../../../src/types/knowledge-base"

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
}

export class KnowledgeBaseService {
  private readonly templateRoot: string

  constructor(deps: KnowledgeBaseServiceDeps = {}) {
    this.templateRoot = deps.templateRoot ?? resolveTemplateRoot()
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
    await mkdir(rawPath, { recursive: true })
    return { rawPath }
  }
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
    return "{\n  \"version\": 1,\n  \"sources\": {}\n}\n"
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
