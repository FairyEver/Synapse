import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import {
  SKILL_UNINSTALL_SCAN_CONCURRENCY,
  SKILL_UNINSTALL_SCAN_MAX_DEPTH,
  SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES,
  SKILL_UNINSTALL_SCAN_TIMEOUT_MS,
} from "../../../config"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import type {
  SkillUninstallCandidate,
  SkillUninstallQuery,
  SkillUninstallScanResult,
} from "../shared/schema"

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
const STOPPED: unique symbol = Symbol("stopped")

export type ScanSkillRoot = {
  readonly path: string
  readonly editorIds: readonly string[]
}

export type ScanSkillRootsInput = {
  readonly query: SkillUninstallQuery
  readonly roots: readonly ScanSkillRoot[]
  readonly classifyEditors: (
    candidatePath: string,
  ) => readonly string[] | Promise<readonly string[]>
  readonly signal?: AbortSignal
  readonly rootErrorsFatal?: boolean
  readonly limits?: Partial<{
    maxDepth: number
    maxDirectories: number
    timeoutMs: number
    concurrency: number
  }>
}

type QueueEntry = {
  path: string
  depth: number
  editorIds: readonly string[]
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

function readFrontmatterName(content: string): string | undefined {
  if (!content.startsWith("---")) return undefined
  const end = content.indexOf("\n---", 3)
  if (end < 0) return undefined
  return parseFrontmatterBlock(content.slice(4, end)).metadata.name?.trim() || undefined
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

async function readSynapseContentId(candidatePath: string): Promise<string | undefined> {
  const metadataPath = path.join(candidatePath, ".synapse.json")
  try {
    const metadataStats = await lstat(metadataPath)
    if (!metadataStats.isFile() || metadataStats.isSymbolicLink()) return undefined
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { id?: unknown }
    return typeof metadata.id === "string" && metadata.id.trim() ? metadata.id.trim() : undefined
  } catch {
    return undefined
  }
}

export async function isSkillTargetDiscoverable(input: {
  readonly query: SkillUninstallQuery
  readonly roots: readonly string[]
  readonly targetPath: string
  readonly maxDepth?: number
}): Promise<boolean> {
  const targetRealPath = await realpath(input.targetPath)
  if (path.resolve(input.targetPath) !== targetRealPath) return false
  const maxDepth = input.maxDepth ?? SKILL_UNINSTALL_SCAN_MAX_DEPTH

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
      try {
        const skillStats = await lstat(path.join(ancestor, "SKILL.md"))
        if (skillStats.isFile() && !skillStats.isSymbolicLink()) {
          hiddenByAncestorSkill = true
          break
        }
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    if (hiddenByAncestorSkill) continue

    const skillPath = path.join(targetRealPath, "SKILL.md")
    const skillStats = await lstat(skillPath)
    if (!skillStats.isFile() || skillStats.isSymbolicLink()) continue
    const content = await readFile(skillPath, "utf8")
    if (matchesQuery(targetRealPath, content, input.query.name)) return true
  }
  return false
}

export async function scanSkillRoots(input: ScanSkillRootsInput): Promise<SkillUninstallScanResult> {
  const maxDepth = input.limits?.maxDepth ?? SKILL_UNINSTALL_SCAN_MAX_DEPTH
  const maxDirectories = input.limits?.maxDirectories ?? SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES
  const timeoutMs = input.limits?.timeoutMs ?? SKILL_UNINSTALL_SCAN_TIMEOUT_MS
  const concurrency = Math.max(1, Math.floor(input.limits?.concurrency ?? SKILL_UNINSTALL_SCAN_CONCURRENCY))
  const targetName = normalizeName(input.query.name)
  const startedAt = Date.now()
  const queue: QueueEntry[] = input.roots.map((root) => ({ path: root.path, depth: 0, editorIds: root.editorIds }))
  const candidates = new Map<string, SkillUninstallCandidate>()
  const warnings = new Set<string>()
  let queueIndex = 0
  let activeWorkers = 0
  let visitedDirectories = 0
  let stopped = false
  let directoryLimitReached = false
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
    if (visitedDirectories >= maxDirectories) {
      warnings.add(DIRECTORY_LIMIT_WARNING)
      directoryLimitReached = true
      return
    }
    visitedDirectories++

    let stats
    try {
      stats = await waitFor(lstat(entry.path))
    } catch (error) {
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      warnings.add(DIRECTORY_READ_WARNING)
      return
    }
    if (stats === STOPPED || stats.isSymbolicLink() || !stats.isDirectory() || shouldStop()) return

    let candidateRealPath
    try {
      candidateRealPath = await waitFor(realpath(entry.path))
    } catch (error) {
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      warnings.add(DIRECTORY_READ_WARNING)
      return
    }
    if (candidateRealPath === STOPPED) return
    const candidatePath = path.resolve(entry.path)
    const skillFilePath = path.join(entry.path, "SKILL.md")
    let skillStats
    try {
      skillStats = await waitFor(lstat(skillFilePath))
    } catch (error) {
      if (!isMissing(error)) {
        warnings.add(SKILL_READ_WARNING)
        return
      }
    }
    if (skillStats === STOPPED) return

    if (skillStats?.isFile() && !skillStats.isSymbolicLink()) {
      let content
      try {
        content = await waitFor(readFile(skillFilePath, "utf8"))
      } catch {
        warnings.add(SKILL_READ_WARNING)
        return
      }
      if (content === STOPPED) return
      const directoryName = path.basename(candidatePath)
      const frontmatterName = readFrontmatterName(content)
      const matches = normalizeName(directoryName) === targetName
        || (frontmatterName !== undefined && normalizeName(frontmatterName) === targetName)
      if (matches && !shouldStop()) {
        const classifiedEditorIds = await waitFor(Promise.resolve(input.classifyEditors(candidatePath)))
        if (classifiedEditorIds === STOPPED || shouldStop()) return
        const synapseContentId = await waitFor(readSynapseContentId(candidatePath))
        if (synapseContentId === STOPPED || shouldStop()) return
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

    let entries
    try {
      entries = await waitFor(readdir(entry.path, { withFileTypes: true }))
    } catch (error) {
      if (entry.depth === 0 && input.rootErrorsFatal) throw error
      warnings.add(DIRECTORY_READ_WARNING)
      return
    }
    if (entries === STOPPED) return
    for (const child of entries) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue
      queue.push({ path: path.join(entry.path, child.name), depth: entry.depth + 1, editorIds: entry.editorIds })
    }
    shouldStop()
  }

  try {
    await new Promise<void>((resolve, reject) => {
      function schedule(): void {
        while (!stopped && !directoryLimitReached && activeWorkers < concurrency && queueIndex < queue.length) {
          const entry = queue[queueIndex++]
          activeWorkers++
          void scanEntry(entry).then(() => {
            activeWorkers--
            schedule()
          }, reject)
        }
        if ((stopped || directoryLimitReached || queueIndex >= queue.length) && activeWorkers === 0) resolve()
      }
      schedule()
    })
    shouldStop()
    return {
      candidates: [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path)),
      complete: warnings.size === 0,
      warnings: [...warnings],
    }
  } finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener("abort", onAbort)
  }
}
