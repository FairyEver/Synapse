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

async function readSynapseContentId(candidatePath: string): Promise<string | undefined> {
  const metadataPath = path.join(candidatePath, ".synapse.json")

  try {
    const metadataStats = await lstat(metadataPath)
    if (!metadataStats.isFile() || metadataStats.isSymbolicLink()) return undefined

    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { id?: unknown }
    return typeof metadata.id === "string" && metadata.id.trim().length > 0
      ? metadata.id.trim()
      : undefined
  } catch {
    return undefined
  }
}

export async function scanSkillRoots(input: ScanSkillRootsInput): Promise<SkillUninstallScanResult> {
  const maxDepth = input.limits?.maxDepth ?? SKILL_UNINSTALL_SCAN_MAX_DEPTH
  const maxDirectories = input.limits?.maxDirectories ?? SKILL_UNINSTALL_SCAN_MAX_DIRECTORIES
  const timeoutMs = input.limits?.timeoutMs ?? SKILL_UNINSTALL_SCAN_TIMEOUT_MS
  const concurrency = Math.max(1, Math.floor(
    input.limits?.concurrency ?? SKILL_UNINSTALL_SCAN_CONCURRENCY,
  ))
  const targetName = normalizeName(input.query.name)
  const startedAt = Date.now()
  const queue: QueueEntry[] = input.roots.map((root) => ({
    path: root.path,
    depth: 0,
    editorIds: root.editorIds,
  }))
  const candidates = new Map<string, SkillUninstallCandidate>()
  const warnings = new Set<string>()
  let queueIndex = 0
  let activeWorkers = 0
  let visitedDirectories = 0
  let stopped = false
  let directoryLimitReached = false

  function shouldStop(): boolean {
    if (stopped) return true
    if (input.signal?.aborted) {
      warnings.add(CANCELLED_WARNING)
      stopped = true
      return true
    }
    if (Date.now() - startedAt >= timeoutMs) {
      warnings.add(TIMEOUT_WARNING)
      stopped = true
      return true
    }
    return false
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
      stats = await lstat(entry.path)
    } catch {
      return
    }
    if (stats.isSymbolicLink() || !stats.isDirectory() || shouldStop()) return

    let candidateRealPath
    try {
      candidateRealPath = await realpath(entry.path)
    } catch {
      return
    }
    const candidatePath = path.resolve(entry.path)

    const skillFilePath = path.join(entry.path, "SKILL.md")
    let skillStats
    try {
      skillStats = await lstat(skillFilePath)
    } catch {
      skillStats = undefined
    }

    if (skillStats?.isFile() && !skillStats.isSymbolicLink()) {
      let content
      try {
        content = await readFile(skillFilePath, "utf8")
      } catch {
        return
      }

      const directoryName = path.basename(candidatePath)
      const frontmatterName = readFrontmatterName(content)
      const matches = normalizeName(directoryName) === targetName
        || (frontmatterName !== undefined && normalizeName(frontmatterName) === targetName)

      if (matches && !shouldStop()) {
        const [classifiedEditorIds, synapseContentId] = await Promise.all([
          input.classifyEditors(candidatePath),
          readSynapseContentId(candidatePath),
        ])
        if (shouldStop()) return

        const current = candidates.get(candidateRealPath)
        const editorIds = [...new Set([
          ...(current?.editorIds ?? []),
          ...entry.editorIds,
          ...classifiedEditorIds,
        ])]
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
      entries = await readdir(entry.path, { withFileTypes: true })
    } catch {
      return
    }

    for (const child of entries) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue
      queue.push({
        path: path.join(entry.path, child.name),
        depth: entry.depth + 1,
        editorIds: entry.editorIds,
      })
    }
  }

  shouldStop()

  await new Promise<void>((resolve, reject) => {
    function schedule(): void {
      while (!stopped && !directoryLimitReached && activeWorkers < concurrency && queueIndex < queue.length) {
        const entry = queue[queueIndex++]
        activeWorkers++
        void scanEntry(entry).then(
          () => {
            activeWorkers--
            schedule()
          },
          (error: unknown) => {
            stopped = true
            reject(error)
          },
        )
      }

      if ((stopped || directoryLimitReached || queueIndex >= queue.length) && activeWorkers === 0) {
        resolve()
      }
    }

    schedule()
  })

  shouldStop()

  return {
    candidates: [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path)),
    complete: warnings.size === 0,
    warnings: [...warnings],
  }
}
