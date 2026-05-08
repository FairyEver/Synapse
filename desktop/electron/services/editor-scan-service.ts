import { lstat, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { shell } from "electron"
import type {
  EditorScanGlobalResult,
  EditorScanItemSource,
  EditorScanProjectEntry,
  EditorScanProjectResult,
  EditorScanQuickPublishDraft,
  EditorScanQuickPublishRequest,
  EditorScanQuickPublishSkillFile,
  EditorScanResult,
  EditorScanRuleItem,
  EditorScanSkillItem,
  EditorScanTrashRequest,
  EditorScanTrashResult,
} from "../../src/types/editor-scan"
import type { SynapseEditorId } from "../../src/types/editor"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../runtime/security"
import { editorAdapters } from "./editor-adapters"
import { editorScanStrategyById } from "./definitions/generated/main-registry"
import { pathExists } from "./editor-adapters/utils"
import { configStore } from "./config-store"
import { createMainLogger } from "./log-store"
import { parseFrontmatterBlock } from "../../src/definitions/editor/shared-yaml-scalar"
import {
  formatEditorWriteFailure,
  replaceFileAtomically,
} from "./editor-file-write-utils"

const logger = createMainLogger("service.editor-scan")
const SYNAPSE_SKILL_ID_FILE = ".synapse.json"
const QUICK_PUBLISH_SKILL_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024
const QUICK_PUBLISH_SKILL_ATTACHMENT_TOTAL_MAX_SIZE = 50 * 1024 * 1024
const QUICK_PUBLISH_SKILL_ATTACHMENT_MAX_COUNT = 200
const QUICK_PUBLISH_SENSITIVE_ATTACHMENT_NAMES = new Set([
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_rsa",
])
const QUICK_PUBLISH_SENSITIVE_ATTACHMENT_EXTENSIONS = new Set([
  ".key",
  ".p12",
  ".pem",
  ".pfx",
])
const RULE_TRASH_UNSUPPORTED_REASON = "当前 Rule 没有明确边界，请在 Finder 中处理。"
const SAFE_RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/

// --- helpers ---

type EditorScanTrashSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function checkEditorTrashPermission(
  deps: EditorScanTrashSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.write",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.write",
      actor: deps.actor,
      metadata,
      outcome: "denied",
      resource,
    })
    throw new Error("没有写入该位置的权限。")
  }
}

function recordEditorTrashAudit(
  deps: EditorScanTrashSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.write",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
}

function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  const metadata: Record<string, string> = {}
  if (!text.startsWith("---")) return { metadata, body: text }

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return { metadata, body: text }

  const block = text.slice(4, endIndex)
  return { metadata: parseFrontmatterBlock(block), body: text.slice(endIndex + 4).trim() }
}

function previewLines(text: string): string {
  const { metadata, body } = parseFrontmatter(text)
  return (metadata.description?.trim() || body).split("\n").slice(0, 3).join("\n").trim()
}

function isSensitiveQuickPublishAttachment(relativeName: string): boolean {
  const baseName = path.basename(relativeName).toLowerCase()
  return (
    QUICK_PUBLISH_SENSITIVE_ATTACHMENT_NAMES.has(baseName)
    || QUICK_PUBLISH_SENSITIVE_ATTACHMENT_EXTENSIONS.has(path.extname(baseName))
  )
}

async function readPreview(filePath: string): Promise<string> {
  try {
    return previewLines(await readFile(filePath, "utf8"))
  } catch {
    return ""
  }
}

async function readSynapseSkillMeta(
  skillDir: string,
): Promise<{ id: string } | null> {
  try {
    const raw = await readFile(path.join(skillDir, SYNAPSE_SKILL_ID_FILE), "utf8")
    const meta = JSON.parse(raw) as { id?: string }
    return meta.id ? { id: meta.id } : null
  } catch {
    return null
  }
}

// --- skill scanning ---

async function scanSkillsDirectory(dirPath: string): Promise<EditorScanSkillItem[]> {
  if (!(await pathExists(dirPath))) return []

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const items: EditorScanSkillItem[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(dirPath, entry.name)

    try {
      const meta = await readSynapseSkillMeta(skillDir)
      const source: EditorScanItemSource = meta ? "synapse" : "external"

      const children = await readdir(skillDir)
      const mdFiles = children.filter((f) => f.endsWith(".md"))
      if (mdFiles.length === 0 && !meta) continue

      let previewFile: string | null = null
      for (const candidate of SKILL_MAIN_FILE_PRIORITY) {
        if (mdFiles.includes(candidate)) {
          previewFile = path.join(skillDir, candidate)
          break
        }
      }
      if (!previewFile && mdFiles.length > 0) {
        mdFiles.sort()
        previewFile = path.join(skillDir, mdFiles[0])
      }

      const preview = previewFile ? await readPreview(previewFile) : ""

      items.push({
        name: entry.name,
        path: skillDir,
        source,
        synapseContentId: meta?.id ?? null,
        preview,
        fileCount: children.length,
        trash: { mode: "path" },
      })
    } catch (error) {
      logger.warn("Failed to scan skill directory.", { path: skillDir, error })
    }
  }

  return items
}

// --- per-editor scan helpers ---

type EditorScanPaths = {
  editorId: SynapseEditorId
  editorLabel: string
  globalSkillPaths: readonly string[]
  globalRulesPath: string | null
  rulesSupported: boolean
  detectionDir: string
}

function getEditorScanPaths(): EditorScanPaths[] {
  return editorAdapters.map((adapter) => {
    const config = adapter.getScanPathConfig()
    return {
      editorId: adapter.id,
      editorLabel: adapter.label,
      globalSkillPaths: config.globalSkillPaths ?? (config.globalSkillsPath ? [config.globalSkillsPath] : []),
      globalRulesPath: config.globalRulesPath,
      rulesSupported: config.rulesSupported,
      detectionDir: config.detectionDir,
    }
  })
}

async function scanSkillDirectories(
  dirPaths: readonly string[],
): Promise<{ skills: EditorScanSkillItem[]; duplicateSkillNames: string[] }> {
  const skills: EditorScanSkillItem[] = []
  const seenNames = new Set<string>()
  const duplicateNames = new Set<string>()

  for (const dirPath of dirPaths) {
    const items = await scanSkillsDirectory(dirPath)

    for (const item of items) {
      if (seenNames.has(item.name)) {
        duplicateNames.add(item.name)
        continue
      }

      seenNames.add(item.name)
      skills.push(item)
    }
  }

  return {
    skills,
    duplicateSkillNames: Array.from(duplicateNames).sort((a, b) => a.localeCompare(b)),
  }
}

async function scanRulesForEditor(
  editorId: SynapseEditorId,
  rulesPath: string | null,
): Promise<EditorScanRuleItem[]> {
  const scanStrategy = editorScanStrategyById.get(editorId)
  return scanStrategy ? scanStrategy.scanRules(rulesPath) : []
}

function getProjectEditorPaths(
  projectPath: string,
): Array<{
  editorId: SynapseEditorId
  editorLabel: string
  skillsPath: string
  rulesPath: string
}> {
  return editorAdapters.map((adapter) => {
    const config = adapter.getScanPathConfig()
    const paths = config.projectPaths(projectPath)
    return {
      editorId: adapter.id,
      editorLabel: adapter.label,
      skillsPath: paths.skillsPath,
      rulesPath: paths.rulesPath,
    }
  })
}

async function scanProject(
  projectPath: string,
  projectName: string,
): Promise<EditorScanProjectResult> {
  const exists = await pathExists(projectPath)
  if (!exists) {
    return { projectPath, projectName, pathExists: false, editors: [] }
  }

  const editorPaths = getProjectEditorPaths(projectPath)
  const editors = await Promise.all(
    editorPaths.map(async (ep): Promise<EditorScanProjectEntry> => {
      const [skills, rules] = await Promise.all([
        scanSkillsDirectory(ep.skillsPath),
        scanRulesForEditor(ep.editorId, ep.rulesPath),
      ])
      return {
        editorId: ep.editorId,
        editorLabel: ep.editorLabel,
        skills,
        rules,
      }
    }),
  )

  return { projectPath, projectName, pathExists: true, editors }
}

// --- main export ---

async function scanAll(): Promise<EditorScanResult> {
  const editorPaths = getEditorScanPaths()

  const globalPromise = Promise.all(
    editorPaths.map(async (ep): Promise<EditorScanGlobalResult> => {
      const detected = await pathExists(ep.detectionDir)
      const [skillScan, rules] = await Promise.all([
        scanSkillDirectories(ep.globalSkillPaths),
        scanRulesForEditor(ep.editorId, ep.globalRulesPath),
      ])
      return {
        editorId: ep.editorId,
        editorLabel: ep.editorLabel,
        status: detected ? "detected" : "not-detected",
        skills: skillScan.skills,
        duplicateSkillNames: skillScan.duplicateSkillNames,
        rules,
        rulesSupported: ep.rulesSupported,
      }
    }),
  )

  const config = await configStore.load()
  const projects = config.global.projects

  const projectsPromise = Promise.all(
    projects.map((p) => scanProject(p.path, p.name)),
  )

  const [global, projectResults] = await Promise.all([globalPromise, projectsPromise])

  return { global, projects: projectResults }
}

// Skill 主文件发现优先级
// Claude Code / Cursor / Codex / Windsurf 均以 SKILL.md（大写）为唯一标准入口
// 后续为 Synapse 兼容性 fallback，编辑器本身不识别这些文件名
const SKILL_MAIN_FILE_PRIORITY = [
  "SKILL.md",
  "skill.md",
  "README.md",
  "readme.md",
  "index.md",
]

async function resolveSkillMainFile(dirPath: string): Promise<string | null> {
  let children: string[]
  try {
    children = await readdir(dirPath)
  } catch {
    return null
  }

  for (const candidate of SKILL_MAIN_FILE_PRIORITY) {
    if (children.includes(candidate)) {
      return path.join(dirPath, candidate)
    }
  }

  const mdFiles = children.filter((f) => f.endsWith(".md")).sort()
  return mdFiles.length > 0 ? path.join(dirPath, mdFiles[0]) : null
}

async function readItemContent(filePath: string): Promise<string> {
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) {
      const mainFile = await resolveSkillMainFile(filePath)
      if (!mainFile) return ""
      return await readFile(mainFile, "utf8")
    }
    return await readFile(filePath, "utf8")
  } catch (error) {
    logger.warn("Failed to read scan item content.", { path: filePath, error })
    return ""
  }
}

type SkillFileEntry = {
  name: string
  size: number
}

function toPortableRelativePath(relativeName: string): string {
  return relativeName.split(path.sep).join("/")
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  skip: Set<string>,
  entries: SkillFileEntry[],
): Promise<void> {
  let children: string[]
  try {
    children = await readdir(currentDir)
  } catch {
    return
  }

  for (const name of children) {
    if (name.startsWith(".")) continue
    const fullPath = path.join(currentDir, name)
    const relativeName = toPortableRelativePath(path.relative(baseDir, fullPath))
    if (skip.has(name) && currentDir === baseDir) continue
    try {
      const fileStat = await lstat(fullPath)
      if (fileStat.isSymbolicLink()) continue
      if (fileStat.isFile()) {
        entries.push({ name: relativeName, size: fileStat.size })
      } else if (fileStat.isDirectory()) {
        await collectFiles(baseDir, fullPath, skip, entries)
      }
    } catch {
      continue
    }
  }
}

async function listSkillFiles(dirPath: string): Promise<SkillFileEntry[]> {
  try {
    const info = await stat(dirPath)
    if (!info.isDirectory()) return []

    const mainFile = await resolveSkillMainFile(dirPath)
    const mainFileName = mainFile ? path.basename(mainFile) : null

    const skip = new Set<string>()
    if (mainFileName) skip.add(mainFileName)
    skip.add(SYNAPSE_SKILL_ID_FILE)

    const entries: SkillFileEntry[] = []
    await collectFiles(dirPath, dirPath, skip, entries)

    entries.sort((a, b) => a.name.localeCompare(b.name))
    return entries
  } catch (error) {
    logger.warn("Failed to list skill files.", { path: dirPath, error })
    return []
  }
}

async function collectSkillFileSnapshots(
  baseDir: string,
  currentDir: string,
  skip: Set<string>,
  entries: EditorScanQuickPublishSkillFile[],
  state: { fileCount: number; totalSize: number },
): Promise<void> {
  const children = await readdir(currentDir)

  for (const name of children) {
    if (name.startsWith(".")) continue
    if (skip.has(name) && currentDir === baseDir) continue

    const fullPath = path.join(currentDir, name)
    const relativeName = toPortableRelativePath(path.relative(baseDir, fullPath))
    const fileStat = await lstat(fullPath)
    if (fileStat.isSymbolicLink()) continue

    if (fileStat.isDirectory()) {
      await collectSkillFileSnapshots(baseDir, fullPath, skip, entries, state)
      continue
    }

    if (!fileStat.isFile()) continue
    if (isSensitiveQuickPublishAttachment(relativeName)) {
      throw new Error(`附件包含敏感文件：${relativeName}`)
    }

    if (fileStat.size > QUICK_PUBLISH_SKILL_ATTACHMENT_MAX_SIZE) {
      throw new Error(`附件超过 10MB：${relativeName}`)
    }

    state.fileCount += 1
    if (state.fileCount > QUICK_PUBLISH_SKILL_ATTACHMENT_MAX_COUNT) {
      throw new Error(`附件数量超过 ${QUICK_PUBLISH_SKILL_ATTACHMENT_MAX_COUNT} 个。`)
    }

    state.totalSize += fileStat.size
    if (state.totalSize > QUICK_PUBLISH_SKILL_ATTACHMENT_TOTAL_MAX_SIZE) {
      throw new Error("附件总大小超过 50MB。")
    }

    const bytes = await readFile(fullPath)
    entries.push({
      originalName: relativeName,
      size: fileStat.size,
      bytes: new Uint8Array(bytes),
    })
  }
}

async function prepareQuickPublishDraft(
  request: EditorScanQuickPublishRequest,
): Promise<EditorScanQuickPublishDraft> {
  if (request.itemType === "rule") {
    const content = request.ruleContent ?? await readFile(request.itemPath, "utf8")
    if (!content.trim()) {
      throw new Error("Rule 正文为空。")
    }

    return {
      itemType: "rule",
      itemPath: request.itemPath,
      itemName: request.itemName,
      content,
      metadata: request.metadata ?? {},
    }
  }

  const info = await stat(request.itemPath)
  if (!info.isDirectory()) {
    throw new Error("Skill 路径不是文件夹。")
  }

  const mainFile = await resolveSkillMainFile(request.itemPath)
  if (!mainFile) {
    throw new Error("未找到 Skill 主文件。")
  }

  const content = await readFile(mainFile, "utf8")
  if (!content.trim()) {
    throw new Error("Skill 主说明为空。")
  }

  const skip = new Set<string>([path.basename(mainFile), SYNAPSE_SKILL_ID_FILE])
  const files: EditorScanQuickPublishSkillFile[] = []
  await collectSkillFileSnapshots(request.itemPath, request.itemPath, skip, files, {
    fileCount: 0,
    totalSize: 0,
  })
  files.sort((a, b) => a.originalName.localeCompare(b.originalName))

  return {
    itemType: "skill",
    itemPath: request.itemPath,
    itemName: request.itemName,
    content,
    files,
    metadata: request.metadata ?? {},
  }
}

async function assertTrashableSkillDirectory(dirPath: string): Promise<void> {
  let info
  try {
    info = await lstat(dirPath)
  } catch {
    throw new Error("目标不存在。")
  }

  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("目标类型不匹配。")
  }

  const mainFile = await resolveSkillMainFile(dirPath)
  const meta = await readSynapseSkillMeta(dirPath)
  if (!mainFile && !meta) {
    throw new Error("目标类型不匹配。")
  }
}

async function assertTrashableRuleFile(filePath: string): Promise<void> {
  let info
  try {
    info = await lstat(filePath)
  } catch {
    throw new Error("目标不存在。")
  }

  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("目标类型不匹配。")
  }

  const extension = path.extname(filePath).toLowerCase()
  if (extension !== ".md" && extension !== ".mdc") {
    throw new Error("目标类型不匹配。")
  }
}

function removeSynapseRuleSection(existingContent: string, ruleId: string): string {
  if (!SAFE_RULE_ID_PATTERN.test(ruleId)) {
    throw new Error(RULE_TRASH_UNSUPPORTED_REASON)
  }

  const escapedId = escapeForRegex(ruleId)
  const sectionPattern = new RegExp(
    `\\n?<!--\\s*synapse-rule:${escapedId}:begin\\s*-->[\\s\\S]*?<!--\\s*synapse-rule:${escapedId}:end\\s*-->\\n?`,
    "u",
  )

  if (!sectionPattern.test(existingContent)) {
    throw new Error("目标不存在。")
  }

  const nextContent = existingContent.replace(sectionPattern, "\n")
  return nextContent.replace(/\n{3,}/gu, "\n\n").replace(/^\n+/u, "").replace(/\s+$/u, "")
}

async function trashScanItem(
  request: EditorScanTrashRequest,
  security?: EditorScanTrashSecurityDeps,
): Promise<EditorScanTrashResult> {
  const auditMetadata = {
    contentType: request.itemType,
    editorId: request.editorId,
    operation: "trash",
    scope: request.scope,
    source: request.source,
    trashMode: request.trash.mode,
  }

  await checkEditorTrashPermission(security, request.itemPath, auditMetadata)

  try {
    if (request.trash.mode === "unsupported") {
      throw new Error(request.trash.disabledReason)
    }

    if (request.trash.mode === "rule-section") {
      const existingContent = await readFile(request.itemPath, "utf8")
      const nextContent = removeSynapseRuleSection(existingContent, request.trash.ruleId)
      await replaceFileAtomically(request.itemPath, nextContent)
      recordEditorTrashAudit(security, request.itemPath, "allowed", auditMetadata)
      return {
        trashed: true,
        mode: request.trash.mode,
        path: request.itemPath,
      }
    }

    if (request.itemType === "skill") {
      await assertTrashableSkillDirectory(request.itemPath)
    } else {
      await assertTrashableRuleFile(request.itemPath)
    }

    await shell.trashItem(request.itemPath)
    recordEditorTrashAudit(security, request.itemPath, "allowed", auditMetadata)
    return {
      trashed: true,
      mode: request.trash.mode,
      path: request.itemPath,
    }
  } catch (error) {
    recordEditorTrashAudit(security, request.itemPath, "failed", auditMetadata)
    throw formatEditorWriteFailure(error, request.itemPath)
  }
}

export {
  scanAll,
  readItemContent,
  listSkillFiles,
  prepareQuickPublishDraft,
  scanSkillDirectories,
  trashScanItem,
}
export type { SkillFileEntry }
