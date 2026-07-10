import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises"
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
import { listTrustedSkillRoots } from "./editor-scan-roots"
import { createMainLogger } from "./log-store"
import { parseFrontmatterBlock } from "../../src/definitions/editor/shared-yaml-scalar"
import {
  formatEditorWriteFailure,
  replaceFileAtomically,
} from "./editor-file-write-utils"
import {
  readSkillDraftFromDirectory,
  resolveSkillMainFile,
  SYNAPSE_SKILL_ID_FILE,
} from "./content-skill-source-service"

const logger = createMainLogger("service.editor-scan")
const RULE_TRASH_UNSUPPORTED_REASON = "当前 Rule 没有明确边界，请在 Finder 中处理。"
const SAFE_RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/
const EDITOR_SCAN_SCOPE_ERROR = "目标不在当前编辑器扫描范围内。"
const EDITOR_SCAN_TRASH_SCOPE_ERROR = EDITOR_SCAN_SCOPE_ERROR

// --- helpers ---

type EditorScanTrashSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

type EditorScanReadSecurityDeps = {
  actor: ActorIdentity
  auditSink: AuditSink
  permissionGuard: PermissionGuard
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function checkEditorReadPermission(
  deps: EditorScanReadSecurityDeps | undefined,
  resource: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!deps) return
  const permission = await deps.permissionGuard.check({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    context: metadata,
    resource,
  })
  if (!permission.allowed) {
    deps.auditSink.record({
      action: "fs.read.outside-userdata",
      actor: deps.actor,
      metadata: {
        ...metadata,
        reason: permission.reason,
        policyId: permission.policyId,
      },
      outcome: "denied",
      resource,
    })
    throw new Error(permission.reason)
  }
}

function recordEditorReadAudit(
  deps: EditorScanReadSecurityDeps | undefined,
  resource: string,
  outcome: "allowed" | "failed",
  metadata: Record<string, unknown>,
): void {
  deps?.auditSink.record({
    action: "fs.read.outside-userdata",
    actor: deps.actor,
    metadata,
    outcome,
    resource,
  })
}

type EditorScanTrustedRoot = {
  kind: "rule" | "skill"
  path: string
}

function uniqueTrustedRoots(roots: EditorScanTrustedRoot[]): EditorScanTrustedRoot[] {
  const seen = new Set<string>()
  const unique: EditorScanTrustedRoot[] = []
  for (const root of roots) {
    const key = `${root.kind}:${root.path}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(root)
  }
  return unique
}

async function getTrustedEditorReadRoots(): Promise<EditorScanTrustedRoot[]> {
  const roots: EditorScanTrustedRoot[] = (await listTrustedSkillRoots())
    .map((root) => ({ kind: "skill", path: root.path }))

  for (const adapter of editorAdapters) {
    const scanConfig = adapter.getScanPathConfig()
    if (scanConfig.globalRulesPath) {
      roots.push({ kind: "rule", path: scanConfig.globalRulesPath })
    }
  }

  const config = await configStore.load()
  for (const project of config.global.projects) {
    for (const adapter of editorAdapters) {
      const paths = adapter.getScanPathConfig().projectPaths(project.path)
      roots.push({ kind: "rule", path: paths.rulesPath })
    }
  }

  return uniqueTrustedRoots(roots)
}

function isDirectChildOf(childPath: string, rootPath: string): boolean {
  return path.dirname(childPath) === rootPath
}

async function isTrustedEditorReadRootMatch(
  targetPath: string,
  root: EditorScanTrustedRoot,
  itemType?: "rule" | "skill",
): Promise<boolean> {
  if (itemType && root.kind !== itemType) return false

  const [targetRealPath, rootRealPath] = await Promise.all([
    readRealPath(targetPath),
    readRealPath(root.path),
  ])
  if (!targetRealPath || !rootRealPath) return false

  let targetInfo
  let rootInfo
  try {
    [targetInfo, rootInfo] = await Promise.all([
      stat(targetRealPath),
      stat(rootRealPath),
    ])
  } catch {
    return false
  }

  if (root.kind === "skill") {
    return rootInfo.isDirectory()
      && targetInfo.isDirectory()
      && isDirectChildOf(targetRealPath, rootRealPath)
  }

  if (rootInfo.isFile()) {
    return targetInfo.isFile() && targetRealPath === rootRealPath
  }

  return rootInfo.isDirectory()
    && targetInfo.isFile()
    && isDirectChildOf(targetRealPath, rootRealPath)
}

async function assertTrustedEditorReadTarget(
  security: EditorScanReadSecurityDeps | undefined,
  targetPath: string,
  metadata: Record<string, unknown>,
  itemType?: "rule" | "skill",
): Promise<void> {
  if (!security) return

  const roots = await getTrustedEditorReadRoots()
  for (const root of roots) {
    if (await isTrustedEditorReadRootMatch(targetPath, root, itemType)) {
      return
    }
  }

  recordEditorReadAudit(security, targetPath, "failed", metadata)
  throw new Error(EDITOR_SCAN_SCOPE_ERROR)
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

async function readRealPath(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}

async function isTrustedTrashRootMatch(
  request: EditorScanTrashRequest,
  rootPath: string,
): Promise<boolean> {
  const [targetRealPath, rootRealPath] = await Promise.all([
    readRealPath(request.itemPath),
    readRealPath(rootPath),
  ])

  if (!targetRealPath || !rootRealPath) return false

  let rootInfo
  try {
    rootInfo = await stat(rootRealPath)
  } catch {
    return false
  }

  if (rootInfo.isFile()) {
    return targetRealPath === rootRealPath
  }

  if (!rootInfo.isDirectory()) return false

  return path.dirname(targetRealPath) === rootRealPath
}

async function getTrustedTrashRoots(
  request: EditorScanTrashRequest,
): Promise<string[]> {
  const adapter = editorAdapters.find((candidate) => candidate.id === request.editorId)
  if (!adapter) return []

  const scanConfig = adapter.getScanPathConfig()
  const roots = request.itemType === "skill"
    ? scanConfig.globalSkillPaths ?? (scanConfig.globalSkillsPath ? [scanConfig.globalSkillsPath] : [])
    : (scanConfig.globalRulesPath ? [scanConfig.globalRulesPath] : [])

  if (request.scope === "global") {
    return Array.from(new Set(roots))
  }

  const config = await configStore.load()
  return Array.from(new Set(config.global.projects.map((project) => {
    const paths = scanConfig.projectPaths(project.path)
    return request.itemType === "skill" ? paths.skillsPath : paths.rulesPath
  })))
}

async function assertTrustedTrashTarget(request: EditorScanTrashRequest): Promise<void> {
  const roots = await getTrustedTrashRoots(request)

  for (const root of roots) {
    if (await isTrustedTrashRootMatch(request, root)) {
      return
    }
  }

  throw new Error(EDITOR_SCAN_TRASH_SCOPE_ERROR)
}

function parseFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { metadata: {}, body: text }

  const endIndex = text.indexOf("\n---", 3)
  if (endIndex === -1) return { metadata: {}, body: text }

  const block = text.slice(4, endIndex)
  const { metadata } = parseFrontmatterBlock(block)
  return { metadata, body: text.slice(endIndex + 4).trim() }
}

function previewLines(text: string): string {
  const { metadata, body } = parseFrontmatter(text)
  return (metadata.description?.trim() || body).split("\n").slice(0, 3).join("\n").trim()
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
): Promise<{ id: string; repositoryVersion: string | null; sourceFingerprint: string | null } | null> {
  try {
    const raw = await readFile(path.join(skillDir, SYNAPSE_SKILL_ID_FILE), "utf8")
    const meta = JSON.parse(raw) as { id?: unknown; repositoryVersion?: unknown; sourceFingerprint?: unknown }
    if (typeof meta.id !== "string" || meta.id.trim().length === 0) {
      return null
    }

    return {
      id: meta.id,
      repositoryVersion: typeof meta.repositoryVersion === "string" && meta.repositoryVersion.trim().length > 0
        ? meta.repositoryVersion
        : null,
      sourceFingerprint: typeof meta.sourceFingerprint === "string" && meta.sourceFingerprint.trim().length > 0
        ? meta.sourceFingerprint
        : null,
    }
  } catch {
    return null
  }
}

// --- skill scanning ---

const SKILL_SCAN_READ_ERROR = "Skill 目录读取失败"

type SkillDirectoryScanResult = {
  items: EditorScanSkillItem[]
  error?: string
}

async function scanSkillsDirectory(dirPath: string): Promise<SkillDirectoryScanResult> {
  if (!(await pathExists(dirPath))) return { items: [] }

  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch (error) {
    logger.warn("Failed to read skill scan root.", { dirPath, error })
    return { items: [], error: SKILL_SCAN_READ_ERROR }
  }

  const items: EditorScanSkillItem[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillDir = path.join(dirPath, entry.name)

    try {
      const meta = await readSynapseSkillMeta(skillDir)
      const source: EditorScanItemSource = meta ? "synapse" : "external"

      const children = await readdir(skillDir)
      const previewFile = await resolveSkillMainFile(skillDir)
      if (!previewFile && !meta) continue

      const preview = previewFile ? await readPreview(previewFile) : ""
      const mainFileName = previewFile ? path.basename(previewFile) : null

      items.push({
        name: entry.name,
        path: skillDir,
        source,
        synapseContentId: meta?.id ?? null,
        repositoryVersion: meta?.repositoryVersion ?? null,
        sourceFingerprint: meta?.sourceFingerprint ?? null,
        preview,
        mainFileName,
        fileCount: children.length,
        trash: { mode: "path" },
      })
    } catch (error) {
      logger.warn("Failed to scan skill directory.", { dirName: path.basename(skillDir), error })
    }
  }

  return { items }
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

async function scanGlobalEditor(ep: EditorScanPaths): Promise<EditorScanGlobalResult> {
  try {
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
      skillScanError: skillScan.skillScanError,
      duplicateSkillNames: skillScan.duplicateSkillNames,
      rules,
      rulesSupported: ep.rulesSupported,
    }
  } catch (error) {
    logger.warn("global editor scan failed", {
      editorId: ep.editorId,
      error,
    })
    return {
      editorId: ep.editorId,
      editorLabel: ep.editorLabel,
      status: "not-detected",
      skills: [],
      duplicateSkillNames: [],
      rules: [],
      rulesSupported: ep.rulesSupported,
    }
  }
}

async function scanSkillDirectories(
  dirPaths: readonly string[],
): Promise<{ skills: EditorScanSkillItem[]; duplicateSkillNames: string[]; skillScanError?: string }> {
  const skills: EditorScanSkillItem[] = []
  const seenNames = new Set<string>()
  const duplicateNames = new Set<string>()
  const errors: string[] = []

  for (const dirPath of dirPaths) {
    const result = await scanSkillsDirectory(dirPath)
    if (result.error) errors.push(result.error)

    for (const item of result.items) {
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
    skillScanError: errors[0],
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
  try {
    const exists = await pathExists(projectPath)
    if (!exists) {
      return { projectPath, projectName, pathExists: false, editors: [] }
    }

    const editorPaths = getProjectEditorPaths(projectPath)
    const editorResults = await Promise.allSettled(
      editorPaths.map(async (ep): Promise<EditorScanProjectEntry> => {
        const [skillScan, rules] = await Promise.all([
          scanSkillDirectories([ep.skillsPath]),
          scanRulesForEditor(ep.editorId, ep.rulesPath),
        ])
        return {
          editorId: ep.editorId,
          editorLabel: ep.editorLabel,
          skills: skillScan.skills,
          skillScanError: skillScan.skillScanError,
          rules,
        }
      }),
    )

    const editors: EditorScanProjectEntry[] = []
    for (const result of editorResults) {
      if (result.status === "fulfilled") {
        editors.push(result.value)
      } else {
        logger.warn("editor scan failed in project", { projectPath, error: result.reason })
      }
    }

    return { projectPath, projectName, pathExists: true, editors }
  } catch (error) {
    logger.warn("project scan failed", { projectPath, error })
    return { projectPath, projectName, pathExists: false, editors: [] }
  }
}

// --- main export ---

async function scanAll(): Promise<EditorScanResult> {
  const editorPaths = getEditorScanPaths()

  const globalPromise = Promise.all(
    editorPaths.map(scanGlobalEditor),
  )

  const config = await configStore.load()
  const projects = config.global.projects

  const projectsPromise = Promise.allSettled(
    projects.map((p) => scanProject(p.path, p.name)),
  )

  const [global, projectSettled] = await Promise.all([globalPromise, projectsPromise])

  const projectResults: EditorScanProjectResult[] = []
  for (const result of projectSettled) {
    if (result.status === "fulfilled") {
      projectResults.push(result.value)
    } else {
      logger.warn("project scan failed", { error: result.reason })
    }
  }

  return { global, projects: projectResults }
}

async function readItemContent(
  filePath: string,
  security?: EditorScanReadSecurityDeps,
): Promise<string> {
  const auditMetadata = { operation: "read-item-content" }
  await checkEditorReadPermission(security, filePath, auditMetadata)
  await assertTrustedEditorReadTarget(security, filePath, auditMetadata)
  try {
    const info = await stat(filePath)
    let content: string
    if (info.isDirectory()) {
      const mainFile = await resolveSkillMainFile(filePath)
      content = mainFile ? await readFile(mainFile, "utf8") : ""
    } else {
      content = await readFile(filePath, "utf8")
    }
    recordEditorReadAudit(security, filePath, "allowed", auditMetadata)
    return content
  } catch (error) {
    recordEditorReadAudit(security, filePath, "failed", auditMetadata)
    logger.warn("Failed to read scan item content.", { error })
    throw new Error("读取内容失败", { cause: error })
  }
}

type SkillFileEntry = {
  name: string
  size: number
}

const EDITOR_SCAN_SKILL_FILE_LIST_LIMITS = {
  maxDepth: 8,
  maxFiles: 200,
} as const

function toPortableRelativePath(relativeName: string): string {
  return relativeName.split(path.sep).join("/")
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  skip: Set<string>,
  entries: SkillFileEntry[],
  depth = 0,
): Promise<void> {
  if (
    depth > EDITOR_SCAN_SKILL_FILE_LIST_LIMITS.maxDepth
    || entries.length >= EDITOR_SCAN_SKILL_FILE_LIST_LIMITS.maxFiles
  ) {
    return
  }

  let children: string[]
  try {
    children = await readdir(currentDir)
  } catch {
    return
  }

  for (const name of children) {
    if (entries.length >= EDITOR_SCAN_SKILL_FILE_LIST_LIMITS.maxFiles) return
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
        await collectFiles(baseDir, fullPath, skip, entries, depth + 1)
      }
    } catch {
      continue
    }
  }
}

async function listSkillFiles(
  dirPath: string,
  security?: EditorScanReadSecurityDeps,
): Promise<SkillFileEntry[]> {
  const auditMetadata = { operation: "list-skill-files" }
  await checkEditorReadPermission(security, dirPath, auditMetadata)
  await assertTrustedEditorReadTarget(security, dirPath, auditMetadata, "skill")
  try {
    const info = await stat(dirPath)
    if (!info.isDirectory()) {
      recordEditorReadAudit(security, dirPath, "allowed", auditMetadata)
      return []
    }

    const mainFile = await resolveSkillMainFile(dirPath)
    const mainFileName = mainFile ? path.basename(mainFile) : null

    const skip = new Set<string>()
    if (mainFileName) skip.add(mainFileName)
    skip.add(SYNAPSE_SKILL_ID_FILE)

    const entries: SkillFileEntry[] = []
    await collectFiles(dirPath, dirPath, skip, entries)

    entries.sort((a, b) => a.name.localeCompare(b.name))
    recordEditorReadAudit(security, dirPath, "allowed", auditMetadata)
    return entries
  } catch (error) {
    recordEditorReadAudit(security, dirPath, "failed", auditMetadata)
    logger.warn("Failed to list skill files.", { error })
    throw new Error("读取关联文件失败", { cause: error })
  }
}

async function prepareQuickPublishDraft(
  request: EditorScanQuickPublishRequest,
  security?: EditorScanReadSecurityDeps,
): Promise<EditorScanQuickPublishDraft> {
  const auditMetadata = {
    contentType: request.itemType,
    itemName: request.itemName,
    operation: "prepare-quick-publish-draft",
  }
  await checkEditorReadPermission(security, request.itemPath, auditMetadata)
  await assertTrustedEditorReadTarget(security, request.itemPath, auditMetadata, request.itemType)
  try {
    if (request.itemType === "rule") {
      const content = request.ruleContent ?? await readFile(request.itemPath, "utf8")
      if (!content.trim()) {
        throw new Error("Rule 正文为空。")
      }

      const draft = {
        itemType: "rule" as const,
        itemPath: request.itemPath,
        itemName: request.itemName,
        content,
        metadata: request.metadata ?? {},
      }
      recordEditorReadAudit(security, request.itemPath, "allowed", auditMetadata)
      return draft
    }

    const sourceDraft = await readSkillDraftFromDirectory(request.itemPath)

    const draft = {
      itemType: "skill" as const,
      itemPath: request.itemPath,
      itemName: request.itemName,
      content: sourceDraft.content,
      files: sourceDraft.files as EditorScanQuickPublishSkillFile[],
      metadata: { ...sourceDraft.metadata, ...(request.metadata ?? {}) },
    }
    recordEditorReadAudit(security, request.itemPath, "allowed", auditMetadata)
    return draft
  } catch (error) {
    recordEditorReadAudit(security, request.itemPath, "failed", auditMetadata)
    throw error
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

    await assertTrustedTrashTarget(request)

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
  EDITOR_SCAN_SKILL_FILE_LIST_LIMITS,
  scanAll,
  readItemContent,
  listSkillFiles,
  assertTrustedEditorReadTarget,
  prepareQuickPublishDraft,
  scanSkillDirectories,
  trashScanItem,
}
export type { SkillFileEntry }
