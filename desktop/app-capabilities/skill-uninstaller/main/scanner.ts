import { lstat, opendir, readFile, realpath } from "node:fs/promises"
import path from "node:path"
import {
  SKILL_UNINSTALL_SCAN_CONCURRENCY,
  SKILL_UNINSTALL_SCAN_MAX_DEPTH,
  SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES,
  SKILL_UNINSTALL_SCAN_MAX_SKILL_MD_BYTES,
  SKILL_UNINSTALL_SCAN_TIMEOUT_MS,
} from "../../../config"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import type {
  SkillUninstallCandidate,
  SkillUninstallNameScanResult,
  SkillUninstallQuery,
  SkillUninstallScanResult,
} from "../shared/schema"
import { readSynapseContentId } from "./synapse-metadata"

export const SKILL_UNINSTALL_EXCLUDED_DIRECTORIES = new Set([
  "node_modules", ".git", ".svn", ".hg", ".next", ".nuxt", ".cache",
  ".turbo", "dist", "build", "out", "coverage", "target", "vendor",
])

const CANCELLED_WARNING = "扫描已取消。"
const TIMEOUT_WARNING = "扫描超时，当前结果可能不完整。"
const DIRECTORY_LIMIT_WARNING = "目录数量超过上限，当前结果可能不完整。"
const DEPTH_LIMIT_WARNING = "目录层级超过上限，当前结果可能不完整。"
const DIRECTORY_READ_WARNING = "部分目录无法读取，当前结果可能不完整。"
const SKILL_READ_WARNING = "部分 Skill 文件无法读取，当前结果可能不完整。"
const SKILL_SIZE_WARNING = "部分 Skill 文件超过大小上限，当前结果可能不完整。"
const METADATA_SIZE_WARNING = "部分 Skill 身份文件超过大小上限，当前结果可能不完整。"
const STOPPED: unique symbol = Symbol("stopped")

export type ScanSkillRoot = {
  readonly path: string
  readonly editorIds: readonly string[]
}

type SkillFileSystem = {
  readonly lstat: (targetPath: string) => ReturnType<typeof lstat>
  readonly readFile: (targetPath: string, encoding: "utf8") => Promise<string>
}

const defaultSkillFileSystem: SkillFileSystem = {
  lstat: (targetPath) => lstat(targetPath),
  readFile: (targetPath, encoding) => readFile(targetPath, encoding),
}

type ScanSkillRootsCommonInput = {
  readonly roots: readonly ScanSkillRoot[]
  readonly signal?: AbortSignal
  readonly rootErrorsFatal?: boolean
  readonly skillFileSystem?: SkillFileSystem
  readonly limits?: Partial<{
    maxDepth: number
    maxDirectories: number
    maxSkillFileBytes: number
    timeoutMs: number
    concurrency: number
  }>
}

export type ScanSkillRootsInput = ScanSkillRootsCommonInput & {
  readonly query: SkillUninstallQuery
  readonly classifyEditors: (
    candidatePath: string,
  ) => readonly string[] | Promise<readonly string[]>
}

export type ScanSkillNamesInput = ScanSkillRootsCommonInput

type QueueEntry = {
  path: string
  depth: number
  editorIds: readonly string[]
  rootIndex: number
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function readFrontmatterName(content: string): string | undefined {
  const opening = /^---\r?\n/.exec(content)
  if (!opening) return undefined
  const bodyStart = opening[0].length
  const closing = /\r?\n---(?:\r?\n|$)/.exec(content.slice(bodyStart))
  if (!closing) return undefined
  return parseFrontmatterBlock(
    content.slice(bodyStart, bodyStart + closing.index),
  ).metadata.name?.trim() || undefined
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function matchesQuery(targetPath: string, content: string, queryName: string): boolean {
  const expected = normalizeName(queryName)
  const frontmatterName = readFrontmatterName(content)
  return normalizeName(path.basename(targetPath)) === expected
    || (frontmatterName !== undefined && normalizeName(frontmatterName) === expected)
}

async function inspectSkillFile(
  directoryPath: string,
  fileSystem: SkillFileSystem,
  maxBytes: number,
): Promise<{ status: "absent" | "too-large" | "unreadable" } | { status: "readable"; content: string }> {
  const skillPath = path.join(directoryPath, "SKILL.md")
  let stats
  try {
    stats = await fileSystem.lstat(skillPath)
  } catch (error) {
    return { status: isMissing(error) ? "absent" : "unreadable" }
  }
  if (!stats.isFile() || stats.isSymbolicLink()) return { status: "absent" }
  if (stats.size > maxBytes) return { status: "too-large" }
  try {
    const content = await fileSystem.readFile(skillPath, "utf8")
    return Buffer.byteLength(content, "utf8") > maxBytes
      ? { status: "too-large" }
      : { status: "readable", content }
  } catch {
    return { status: "unreadable" }
  }
}

export async function isSkillTargetDiscoverable(input: {
  readonly query: SkillUninstallQuery
  readonly roots: readonly string[]
  readonly targetPath: string
  readonly maxDepth?: number
  readonly skillFileSystem?: SkillFileSystem
}): Promise<boolean> {
  const targetRealPath = await realpath(input.targetPath)
  if (path.resolve(input.targetPath) !== targetRealPath) return false
  const maxDepth = input.maxDepth ?? SKILL_UNINSTALL_SCAN_MAX_DEPTH
  const skillFileSystem = input.skillFileSystem ?? defaultSkillFileSystem

  for (const root of input.roots) {
    const relative = path.relative(root, targetRealPath)
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) continue
    const segments = relative ? relative.split(path.sep) : []
    if (segments.length > maxDepth || segments.some((segment) => SKILL_UNINSTALL_EXCLUDED_DIRECTORIES.has(segment))) {
      continue
    }

    let hiddenByAncestorSkill = false
    const traversedDirectories = [root, ...segments.map((_, index) => (
      path.join(root, ...segments.slice(0, index + 1))
    ))]
    for (let index = 0; index < traversedDirectories.length; index++) {
      const ancestor = traversedDirectories[index]
      const stats = await lstat(ancestor)
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        hiddenByAncestorSkill = true
        break
      }
      if (index === traversedDirectories.length - 1) continue
      const ancestorSkill = await inspectSkillFile(
        ancestor,
        skillFileSystem,
        SKILL_UNINSTALL_SCAN_MAX_SKILL_MD_BYTES,
      )
      if (ancestorSkill.status === "readable") {
        hiddenByAncestorSkill = true
        break
      }
    }
    if (hiddenByAncestorSkill) continue

    const targetSkill = await inspectSkillFile(
      targetRealPath,
      skillFileSystem,
      SKILL_UNINSTALL_SCAN_MAX_SKILL_MD_BYTES,
    )
    if (targetSkill.status !== "readable") continue
    if (matchesQuery(targetRealPath, targetSkill.content, input.query.name)) return true
  }
  return false
}

type ScanSkillRootsInternalInput = ScanSkillRootsCommonInput & {
  readonly query?: SkillUninstallQuery
  readonly classifyEditors?: ScanSkillRootsInput["classifyEditors"]
}

type ScanSkillRootsInternalResult = SkillUninstallScanResult & SkillUninstallNameScanResult

export async function scanSkillRoots(input: ScanSkillRootsInput): Promise<SkillUninstallScanResult> {
  const result = await scanSkillRootsInternal(input)
  return {
    candidates: result.candidates,
    complete: result.complete,
    warnings: result.warnings,
  }
}

export async function scanSkillNames(input: ScanSkillNamesInput): Promise<SkillUninstallNameScanResult> {
  const result = await scanSkillRootsInternal(input)
  return {
    names: result.names,
    complete: result.complete,
    warnings: result.warnings,
  }
}

async function scanSkillRootsInternal(
  input: ScanSkillRootsInternalInput,
): Promise<ScanSkillRootsInternalResult> {
  const maxDepth = input.limits?.maxDepth ?? SKILL_UNINSTALL_SCAN_MAX_DEPTH
  const maxDirectories = input.limits?.maxDirectories ?? SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES
  const maxSkillFileBytes = input.limits?.maxSkillFileBytes ?? SKILL_UNINSTALL_SCAN_MAX_SKILL_MD_BYTES
  const timeoutMs = input.limits?.timeoutMs ?? SKILL_UNINSTALL_SCAN_TIMEOUT_MS
  const concurrency = Math.max(1, Math.floor(input.limits?.concurrency ?? SKILL_UNINSTALL_SCAN_CONCURRENCY))
  const targetName = input.query ? normalizeName(input.query.name) : undefined
  const skillFileSystem = input.skillFileSystem ?? defaultSkillFileSystem
  const startedAt = Date.now()
  const queue: QueueEntry[] = []
  const candidates = new Map<string, SkillUninstallCandidate>()
  const names = new Map<string, { name: string; path: string; rootIndex: number }>()
  const warnings = new Set<string>()
  let admittedDirectories = 0
  for (const [rootIndex, root] of input.roots.entries()) {
    if (admittedDirectories >= maxDirectories) {
      warnings.add(DIRECTORY_LIMIT_WARNING)
      break
    }
    queue.push({
      path: root.path,
      depth: 0,
      editorIds: root.editorIds,
      rootIndex,
    })
    admittedDirectories++
  }
  let queueIndex = 0
  let activeWorkers = 0
  let stopped = false
  let hasFatalError = false
  let fatalError: unknown
  let resolveStop!: () => void
  const stopPromise = new Promise<void>((resolve) => { resolveStop = resolve })

  const stop = (warning: string) => {
    if (stopped) return
    warnings.add(warning)
    stopped = true
    resolveStop()
  }
  const onAbort = () => stop(CANCELLED_WARNING)
  input.signal?.addEventListener("abort", onAbort, { once: true })
  if (input.signal?.aborted) onAbort()
  const timeout = setTimeout(() => stop(TIMEOUT_WARNING), Math.max(0, timeoutMs))

  function shouldStop(): boolean {
    if (stopped) return true
    if (input.signal?.aborted) stop(CANCELLED_WARNING)
    else if (Date.now() - startedAt >= timeoutMs) stop(TIMEOUT_WARNING)
    return stopped
  }

  async function waitFor<T>(operation: Promise<T>): Promise<T | typeof STOPPED> {
    const settled = operation.then(
      (value) => ({ value } as const),
      (error: unknown) => ({ error } as const),
    )
    const result = await Promise.race([settled, stopPromise.then((): typeof STOPPED => STOPPED)])
    if (result === STOPPED) return STOPPED
    if ("error" in result) throw result.error
    return result.value
  }

  async function scanEntry(entry: QueueEntry): Promise<void> {
    if (shouldStop()) return
    if (SKILL_UNINSTALL_EXCLUDED_DIRECTORIES.has(path.basename(entry.path))) return
    if (entry.depth > maxDepth) {
      warnings.add(DEPTH_LIMIT_WARNING)
      return
    }
    let stats
    try {
      stats = await waitFor(lstat(entry.path))
    } catch (error) {
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      if (entry.depth === 0 && isMissing(error)) return
      warnings.add(DIRECTORY_READ_WARNING)
      return
    }
    if (stats === STOPPED || stats.isSymbolicLink() || !stats.isDirectory() || shouldStop()) return

    let candidateRealPath
    try {
      candidateRealPath = await waitFor(realpath(entry.path))
    } catch (error) {
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      if (entry.depth === 0 && isMissing(error)) return
      warnings.add(DIRECTORY_READ_WARNING)
      return
    }
    if (candidateRealPath === STOPPED) return
    const candidatePath = path.resolve(entry.path)
    const skillInspection = await waitFor(inspectSkillFile(entry.path, skillFileSystem, maxSkillFileBytes))
    if (skillInspection === STOPPED) return
    if (skillInspection.status === "unreadable") warnings.add(SKILL_READ_WARNING)
    if (skillInspection.status === "too-large") warnings.add(SKILL_SIZE_WARNING)

    if (skillInspection.status === "readable") {
      const content = skillInspection.content
      const directoryName = path.basename(candidatePath)
      const frontmatterName = readFrontmatterName(content)
      const canonicalName = frontmatterName ?? directoryName
      const normalizedCanonicalName = normalizeName(canonicalName)
      const currentName = names.get(normalizedCanonicalName)
      if (!input.query && (
        !currentName
        || entry.rootIndex < currentName.rootIndex
        || (entry.rootIndex === currentName.rootIndex && candidatePath.localeCompare(currentName.path) < 0)
      )) {
        names.set(normalizedCanonicalName, {
          name: canonicalName,
          path: candidatePath,
          rootIndex: entry.rootIndex,
        })
      }
      const matches = targetName !== undefined && (
        normalizeName(directoryName) === targetName
        || (frontmatterName !== undefined && normalizeName(frontmatterName) === targetName)
      )
      if (matches && input.classifyEditors && !shouldStop()) {
        const classifiedEditorIds = await waitFor(Promise.resolve(input.classifyEditors(candidatePath)))
        if (classifiedEditorIds === STOPPED || shouldStop()) return
        const metadata = await waitFor(readSynapseContentId(candidatePath))
        if (metadata === STOPPED || shouldStop()) return
        if (metadata.status === "too-large") warnings.add(METADATA_SIZE_WARNING)
        const synapseContentId = metadata.status === "readable" ? metadata.contentId : undefined
        const current = candidates.get(candidateRealPath)
        const editorIds = [...new Set([...(current?.editorIds ?? []), ...entry.editorIds, ...classifiedEditorIds])]
        candidates.set(candidateRealPath, {
          path: candidatePath,
          name: directoryName,
          ...(frontmatterName ? { frontmatterName } : {}),
          editorIds,
          source: synapseContentId ? "synapse" : "external",
          ...(synapseContentId ? { synapseContentId } : {}),
        })
      }
      return
    }

    let directory
    try {
      directory = await waitFor(opendir(entry.path))
    } catch (error) {
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      if (entry.depth === 0 && isMissing(error)) return
      warnings.add(DIRECTORY_READ_WARNING)
      return
    }
    if (directory === STOPPED) return
    try {
      for await (const child of directory) {
        if (shouldStop()) return
        if (!child.isDirectory() || child.isSymbolicLink()) continue
        if (SKILL_UNINSTALL_EXCLUDED_DIRECTORIES.has(child.name)) continue
        const childDepth = entry.depth + 1
        if (childDepth > maxDepth) {
          warnings.add(DEPTH_LIMIT_WARNING)
          continue
        }
        if (admittedDirectories >= maxDirectories) {
          warnings.add(DIRECTORY_LIMIT_WARNING)
          break
        }
        queue.push({
          path: path.join(entry.path, child.name),
          depth: childDepth,
          editorIds: entry.editorIds,
          rootIndex: entry.rootIndex,
        })
        admittedDirectories++
      }
    } catch (error) {
      if (shouldStop()) return
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      warnings.add(DIRECTORY_READ_WARNING)
    }
    shouldStop()
  }

  try {
    await new Promise<void>((resolve) => {
      function schedule(): void {
        while (!stopped && activeWorkers < concurrency && queueIndex < queue.length) {
          const entry = queue[queueIndex++]
          activeWorkers++
          void scanEntry(entry).then(() => {
            activeWorkers--
            schedule()
          }, (error: unknown) => {
            if (!hasFatalError) {
              hasFatalError = true
              fatalError = error
              stopped = true
              resolveStop()
            }
            activeWorkers--
            schedule()
          })
        }
        if ((stopped || queueIndex >= queue.length) && activeWorkers === 0) resolve()
      }
      schedule()
    })
    if (hasFatalError) throw fatalError
    shouldStop()
    return {
      candidates: [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path)),
      names: [...names.values()].map((item) => item.name).sort((left, right) => left.localeCompare(right, undefined, {
        sensitivity: "base",
      })),
      complete: warnings.size === 0,
      warnings: [...warnings],
    }
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener("abort", onAbort)
  }
}
