import { randomUUID } from "node:crypto"
import { lstat, open, opendir, readFile, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { shell } from "electron"
import type {
  EditorScanGlobalResult,
  EditorScanFinalizeQuickPublishRequest,
  EditorScanFinalizeQuickPublishResult,
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
import { getActiveRepositoryConfig } from "../../src/lib/config"
import { contentHistoryService } from "./content-history-service"
import { listTrustedSkillRoots } from "./editor-scan-roots"
import { createMainLogger } from "./log-store"
import { parseFrontmatterBlock } from "../../src/definitions/editor/shared-yaml-scalar"
import {
  formatEditorWriteFailure,
  replaceFileAtomically,
} from "./editor-file-write-utils"
import {
  readSkillDraftFromDirectory,
  createStoredSkillPublishFingerprint,
  resolveSkillMainFile,
  SYNAPSE_SKILL_ID_FILE,
} from "./content-skill-source-service"
import {
  ContentSkillIdentityChangedError,
  readContentSkillIdentityRaw,
  writeContentSkillIdentity,
} from "./content-skill-local-identity"

const logger = createMainLogger("service.editor-scan")
const RULE_TRASH_UNSUPPORTED_REASON = "当前 Rule 没有明确边界，请在 Finder 中处理。"
const SAFE_RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/
const EDITOR_SCAN_SCOPE_ERROR = "目标不在当前编辑器扫描范围内。"
const EDITOR_SCAN_TRASH_SCOPE_ERROR = EDITOR_SCAN_SCOPE_ERROR
const QUICK_PUBLISH_SESSION_MAX_COUNT = 20
const QUICK_PUBLISH_SESSION_TTL_MS = 30 * 60 * 1000
const EDITOR_SCAN_SKILL_PREVIEW_LIMITS = {
  maxChildrenPerSkill: 200,
  maxPreviewBytes: 64 * 1024,
  maxPreviewChars: 2_048,
  maxRootEntries: 1_000,
  maxSkillsPerRoot: 200,
  projectConcurrency: 4,
} as const

export class EditorScanCancelledError extends Error {
  constructor() {
    super("Editor scan cancelled.")
    this.name = "EditorScanCancelledError"
  }
}

type QuickPublishSession = {
  expectedIdentityRaw: string | null
  expiresAt: number
  itemPath: string
  originalContentId: string | null
  publishFingerprint: string
  sourceFingerprint: string
}

const quickPublishSessions = new Map<string, QuickPublishSession>()

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
  const roots = scanConfig.globalRulesPath ? [scanConfig.globalRulesPath] : []

  if (request.scope === "global") {
    return Array.from(new Set(roots))
  }

  const config = await configStore.load()
  return Array.from(new Set(config.global.projects.map((project) => {
    const paths = scanConfig.projectPaths(project.path)
    return paths.rulesPath
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
  return (metadata.description?.trim() || body)
    .split("\n")
    .slice(0, 3)
    .join("\n")
    .trim()
    .slice(0, EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxPreviewChars)
}

function throwIfScanCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new EditorScanCancelledError()
}

async function readPreview(filePath: string, signal?: AbortSignal): Promise<string> {
  let handle
  try {
    throwIfScanCancelled(signal)
    handle = await open(filePath, "r")
    const buffer = Buffer.allocUnsafe(EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxPreviewBytes)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    throwIfScanCancelled(signal)
    return previewLines(buffer.subarray(0, bytesRead).toString("utf8"))
  } catch {
    throwIfScanCancelled(signal)
    return ""
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch (error) {
        logger.warn("Failed to close Skill preview file handle.", {
          errorName: error instanceof Error ? error.name : typeof error,
          fileName: path.basename(filePath),
        })
      }
    }
  }
}

async function countDirectoryEntries(dirPath: string, signal?: AbortSignal): Promise<number> {
  throwIfScanCancelled(signal)
  let count = 0
  const directory = await opendir(dirPath)
  for await (const entry of directory) {
    throwIfScanCancelled(signal)
    if (!entry.name) continue
    count += 1
    if (count >= EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxChildrenPerSkill) break
  }
  return count
}

async function readSynapseSkillMeta(
  skillDir: string,
): Promise<{ id: string; repositoryVersion: string | null; sourceFingerprint: string | null } | null> {
  try {
    const raw = await readContentSkillIdentityRaw(skillDir)
    if (!raw) return null
    const meta = JSON.parse(raw) as {
      id?: unknown
      kind?: unknown
      repositoryVersion?: unknown
      sourceFingerprint?: unknown
    }
    if (meta.kind === "cloud-skill-repository") return null
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
const SKILL_SCAN_LIMIT_ERROR = `Skill 数量超过扫描上限，仅显示前 ${EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxSkillsPerRoot} 项`

type SkillDirectoryScanResult = {
  items: EditorScanSkillItem[]
  error?: string
}

async function scanSkillsDirectory(dirPath: string, signal?: AbortSignal): Promise<SkillDirectoryScanResult> {
  throwIfScanCancelled(signal)
  if (!(await pathExists(dirPath))) return { items: [] }

  let directory
  try {
    directory = await opendir(dirPath)
  } catch (error) {
    throwIfScanCancelled(signal)
    logger.warn("Failed to read skill scan root.", { dirPath, error })
    return { items: [], error: SKILL_SCAN_READ_ERROR }
  }

  const items: EditorScanSkillItem[] = []
  let candidateCount = 0
  let rootEntryCount = 0
  let truncated = false

  for await (const entry of directory) {
    throwIfScanCancelled(signal)
    if (rootEntryCount >= EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxRootEntries) {
      truncated = true
      break
    }
    rootEntryCount += 1
    if (!entry.isDirectory()) continue
    if (candidateCount >= EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxSkillsPerRoot) {
      truncated = true
      break
    }
    candidateCount += 1
    const skillDir = path.join(dirPath, entry.name)

    try {
      const meta = await readSynapseSkillMeta(skillDir)
      throwIfScanCancelled(signal)
      const source: EditorScanItemSource = meta ? "synapse" : "external"

      const fileCount = await countDirectoryEntries(skillDir, signal)
      const previewFile = await resolveSkillMainFile(
        skillDir,
        EDITOR_SCAN_SKILL_PREVIEW_LIMITS.maxChildrenPerSkill,
      )
      throwIfScanCancelled(signal)
      if (!previewFile && !meta) continue

      const preview = previewFile ? await readPreview(previewFile, signal) : ""
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
        fileCount,
        trash: { mode: "path" },
      })
    } catch (error) {
      throwIfScanCancelled(signal)
      logger.warn("Failed to scan skill directory.", { dirName: path.basename(skillDir), error })
    }
  }

  return { items, ...(truncated ? { error: SKILL_SCAN_LIMIT_ERROR } : undefined) }
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

async function scanGlobalEditor(ep: EditorScanPaths, signal?: AbortSignal): Promise<EditorScanGlobalResult> {
  try {
    throwIfScanCancelled(signal)
    const detected = await pathExists(ep.detectionDir)
    const [skillScan, rules] = await Promise.all([
      scanSkillDirectories(ep.globalSkillPaths, signal),
      scanRulesForEditor(ep.editorId, ep.globalRulesPath, signal),
    ])
    throwIfScanCancelled(signal)
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
    throwIfScanCancelled(signal)
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
  signal?: AbortSignal,
): Promise<{ skills: EditorScanSkillItem[]; duplicateSkillNames: string[]; skillScanError?: string }> {
  const skills: EditorScanSkillItem[] = []
  const seenNames = new Set<string>()
  const duplicateNames = new Set<string>()
  const errors: string[] = []

  for (const dirPath of dirPaths) {
    throwIfScanCancelled(signal)
    const result = await scanSkillsDirectory(dirPath, signal)
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
  signal?: AbortSignal,
): Promise<EditorScanRuleItem[]> {
  throwIfScanCancelled(signal)
  const scanStrategy = editorScanStrategyById.get(editorId)
  const result = scanStrategy ? await scanStrategy.scanRules(rulesPath) : []
  throwIfScanCancelled(signal)
  return result
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
  signal?: AbortSignal,
): Promise<EditorScanProjectResult> {
  try {
    throwIfScanCancelled(signal)
    const exists = await pathExists(projectPath)
    if (!exists) {
      return { projectPath, projectName, pathExists: false, editors: [] }
    }

    const editorPaths = getProjectEditorPaths(projectPath)
    const editorResults = await Promise.allSettled(
      editorPaths.map(async (ep): Promise<EditorScanProjectEntry> => {
        const [skillScan, rules] = await Promise.all([
          scanSkillDirectories([ep.skillsPath], signal),
          scanRulesForEditor(ep.editorId, ep.rulesPath, signal),
        ])
        throwIfScanCancelled(signal)
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
    throwIfScanCancelled(signal)
    for (const result of editorResults) {
      if (result.status === "fulfilled") {
        editors.push(result.value)
      } else {
        logger.warn("editor scan failed in project", { projectPath, error: result.reason })
      }
    }

    return { projectPath, projectName, pathExists: true, editors }
  } catch (error) {
    throwIfScanCancelled(signal)
    logger.warn("project scan failed", { projectPath, error })
    return { projectPath, projectName, pathExists: false, editors: [] }
  }
}

// --- main export ---

async function scanAll(signal?: AbortSignal): Promise<EditorScanResult> {
  throwIfScanCancelled(signal)
  const editorPaths = getEditorScanPaths()

  const globalPromise = Promise.all(
    editorPaths.map((editorPath) => scanGlobalEditor(editorPath, signal)),
  )

  const config = await configStore.load()
  const projects = config.global.projects

  const projectsPromise = (async () => {
    const settled: PromiseSettledResult<EditorScanProjectResult>[] = []
    for (let index = 0; index < projects.length; index += EDITOR_SCAN_SKILL_PREVIEW_LIMITS.projectConcurrency) {
      throwIfScanCancelled(signal)
      const batch = projects.slice(index, index + EDITOR_SCAN_SKILL_PREVIEW_LIMITS.projectConcurrency)
      settled.push(...await Promise.allSettled(
        batch.map((project) => scanProject(project.path, project.name, signal)),
      ))
      throwIfScanCancelled(signal)
    }
    return settled
  })()

  const [global, projectSettled] = await Promise.all([globalPromise, projectsPromise])
  throwIfScanCancelled(signal)

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

function pruneQuickPublishSessions(now = Date.now()): void {
  for (const [sessionId, session] of quickPublishSessions) {
    if (session.expiresAt <= now) quickPublishSessions.delete(sessionId)
  }
  while (quickPublishSessions.size >= QUICK_PUBLISH_SESSION_MAX_COUNT) {
    const oldestSessionId = quickPublishSessions.keys().next().value as string | undefined
    if (!oldestSessionId) break
    quickPublishSessions.delete(oldestSessionId)
  }
}

async function createQuickPublishSession(
  request: EditorScanQuickPublishRequest,
  sourceDraft: Awaited<ReturnType<typeof readSkillDraftFromDirectory>>,
  security?: EditorScanReadSecurityDeps,
): Promise<string> {
  pruneQuickPublishSessions()
  const sessionId = randomUUID()
  quickPublishSessions.set(sessionId, {
    expectedIdentityRaw: await readContentSkillIdentityRaw(request.itemPath, security),
    expiresAt: Date.now() + QUICK_PUBLISH_SESSION_TTL_MS,
    itemPath: request.itemPath,
    originalContentId: request.synapseContentId?.trim() || null,
    publishFingerprint: sourceDraft.publishFingerprint,
    sourceFingerprint: sourceDraft.sourceFingerprint,
  })
  return sessionId
}

function isLegacyCloudIdentity(raw: string | null): boolean {
  if (!raw) return false
  try {
    const value = JSON.parse(raw) as { kind?: unknown }
    return value.kind === "cloud-skill-repository"
  } catch {
    return false
  }
}

async function finalizeQuickPublish(
  request: EditorScanFinalizeQuickPublishRequest,
  security?: EditorScanReadSecurityDeps,
): Promise<EditorScanFinalizeQuickPublishResult> {
  pruneQuickPublishSessions()
  const session = quickPublishSessions.get(request.sessionId)
  if (!session || session.expiresAt <= Date.now()) {
    quickPublishSessions.delete(request.sessionId)
    return { status: "session-expired", message: "内容已保存，但发布检查已过期，未更新本地关联。" }
  }

  if (
    request.mode === "overwrite"
    && (!session.originalContentId || session.originalContentId !== request.contentId)
  ) {
    quickPublishSessions.delete(request.sessionId)
    return { status: "content-mismatch", message: "内容已保存，但覆盖目标与预检时不一致，未更新本地关联。" }
  }

  const auditMetadata = {
    contentId: request.contentId,
    operation: "finalize-quick-publish",
  }
  await checkEditorReadPermission(security, session.itemPath, auditMetadata)
  await assertTrustedEditorReadTarget(security, session.itemPath, auditMetadata, "skill")

  const currentDraft = await readSkillDraftFromDirectory(session.itemPath, undefined, { mode: "publish" })
  if (
    currentDraft.publishFingerprint !== session.publishFingerprint
    || currentDraft.sourceFingerprint !== session.sourceFingerprint
  ) {
    quickPublishSessions.delete(request.sessionId)
    return { status: "source-changed", message: "内容已保存，但本地 Skill 在预检后发生变化，未更新关联。" }
  }

  const config = await configStore.load()
  const repository = getActiveRepositoryConfig(config)
  const detail = repository
    ? await contentHistoryService.readCurrentDetail(repository, "skill", request.contentId)
    : null
  const storedFingerprint = detail
    ? createStoredSkillPublishFingerprint(detail.content, detail.attachments)
    : null
  const metadataMatches = Boolean(
    detail
    && (!currentDraft.metadata.name || detail.name === currentDraft.metadata.name.trim())
    && (!currentDraft.metadata.description || detail.description === currentDraft.metadata.description.trim()),
  )
  if (
    !detail
    || detail.deleted
    || detail.latestHistoryDirname !== request.repositoryVersion
    || storedFingerprint !== session.publishFingerprint
    || !metadataMatches
  ) {
    quickPublishSessions.delete(request.sessionId)
    return { status: "content-mismatch", message: "内容已保存，但保存后的安装内容与本地快照不一致，未更新关联。" }
  }

  if (isLegacyCloudIdentity(session.expectedIdentityRaw)) {
    quickPublishSessions.delete(request.sessionId)
    return {
      status: "identity-conflict",
      message: "内容已保存，但检测到旧云仓库身份；为避免覆盖，未更新资源仓库关联。请先完成一次云上传迁移。",
    }
  }

  const finalDraft = await readSkillDraftFromDirectory(session.itemPath, undefined, { mode: "publish" })
  if (
    finalDraft.publishFingerprint !== session.publishFingerprint
    || finalDraft.sourceFingerprint !== session.sourceFingerprint
  ) {
    quickPublishSessions.delete(request.sessionId)
    return { status: "source-changed", message: "内容已保存，但本地 Skill 在关联写入前发生变化，未更新关联。" }
  }

  try {
    await writeContentSkillIdentity(session.itemPath, {
      id: request.contentId,
      repositoryVersion: request.repositoryVersion,
      sourceFingerprint: session.sourceFingerprint,
    }, session.expectedIdentityRaw, security)
    quickPublishSessions.delete(request.sessionId)
    return { status: "identity-written", message: "本地 Skill 已关联到已保存内容。" }
  } catch (error) {
    if (error instanceof ContentSkillIdentityChangedError) {
      quickPublishSessions.delete(request.sessionId)
      return { status: "identity-conflict", message: `内容已保存，但${error.message}` }
    }
    logger.warn("Failed to finalize local skill identity after publish.", {
      contentId: request.contentId,
      error: error instanceof Error ? error.name : "UnknownError",
    })
    return { status: "write-failed", message: "内容已保存，但本地关联更新失败，可以重试更新关联。" }
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

    const isPublish = request.purpose === "publish"
    const sourceDraft = await readSkillDraftFromDirectory(
      request.itemPath,
      undefined,
      { mode: isPublish ? "publish" : "install" },
    )
    const publishSessionId = isPublish ? await createQuickPublishSession(request, sourceDraft, security) : undefined

    const draft = {
      itemType: "skill" as const,
      itemPath: request.itemPath,
      itemName: request.itemName,
      content: sourceDraft.content,
      files: sourceDraft.files as EditorScanQuickPublishSkillFile[],
      metadata: { ...sourceDraft.metadata, ...(request.metadata ?? {}) },
      publishFingerprint: sourceDraft.publishFingerprint,
      ...(publishSessionId ? { publishSessionId } : {}),
      sourceFingerprint: sourceDraft.sourceFingerprint,
      sourceImportSummary: sourceDraft.sourceImportSummary,
    }
    recordEditorReadAudit(security, request.itemPath, "allowed", auditMetadata)
    return draft
  } catch (error) {
    recordEditorReadAudit(security, request.itemPath, "failed", auditMetadata)
    throw error
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

    await assertTrashableRuleFile(request.itemPath)

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
  EDITOR_SCAN_SKILL_PREVIEW_LIMITS,
  scanAll,
  readItemContent,
  listSkillFiles,
  assertTrustedEditorReadTarget,
  finalizeQuickPublish,
  prepareQuickPublishDraft,
  scanSkillDirectories,
  trashScanItem,
}
export type { SkillFileEntry }
