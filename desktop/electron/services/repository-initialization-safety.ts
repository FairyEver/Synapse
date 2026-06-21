import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { lstat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  SynapseRepositoryInitializationDangerFlag,
  SynapseRepositoryInitializationPreview,
} from "../../src/types/repository"
import { normalizePathForCompare } from "../../src/lib/path-compare"

const BACKUP_PREFIX = ".synapse-init-backup-"

type EntryFingerprint = {
  name: string
  type: "directory" | "file" | "other" | "symlink"
  size: number
  modifiedMs: number
}

function formatPreviewEntry(entry: EntryFingerprint): string {
  return entry.type === "directory" ? `${entry.name}/` : entry.name
}

function hashInitializationPreview(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function entryType(entry: Dirent): EntryFingerprint["type"] {
  if (entry.isDirectory()) return "directory"
  if (entry.isFile()) return "file"
  if (entry.isSymbolicLink()) return "symlink"
  return "other"
}

function pathForPlatform(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
  return platform === "win32" ? path.win32 : path.posix
}

function normalizedPathForPlatform(value: string, platform: NodeJS.Platform): string {
  const pathOps = pathForPlatform(platform)
  return normalizePathForCompare(value, {
    platform,
    resolvePath: pathOps.resolve,
  })
}

function isSamePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  return normalizedPathForPlatform(left, platform) === normalizedPathForPlatform(right, platform)
}

function isSameOrAncestorPath(candidate: string, descendant: string, platform: NodeJS.Platform): boolean {
  const pathOps = pathForPlatform(platform)
  const normalizedCandidate = normalizedPathForPlatform(candidate, platform)
  const normalizedDescendant = normalizedPathForPlatform(descendant, platform)
  if (normalizedCandidate === normalizedDescendant) return true
  const relative = pathOps.relative(normalizedCandidate, normalizedDescendant)
  return Boolean(relative) && !relative.startsWith("..") && !pathOps.isAbsolute(relative)
}

function detectDangerFlags(localPath: string, entries: readonly Dirent[]): SynapseRepositoryInitializationDangerFlag[] {
  const flags = new Set<SynapseRepositoryInitializationDangerFlag>()
  const platform = process.platform
  const pathOps = pathForPlatform(platform)
  const resolved = pathOps.resolve(localPath)
  const home = pathOps.resolve(os.homedir())
  const deniedUserDirs = [
    ["home", home],
    ["desktop", pathOps.join(home, "Desktop")],
    ["documents", pathOps.join(home, "Documents")],
    ["downloads", pathOps.join(home, "Downloads")],
  ] as const

  for (const [flag, deniedPath] of deniedUserDirs) {
    if (isSamePath(resolved, deniedPath, platform)) {
      flags.add(flag)
    }
  }

  if (isSamePath(pathOps.parse(resolved).root, resolved, platform)) {
    flags.add("filesystem-root")
  }

  const cwd = pathOps.resolve(process.cwd())
  if (isSameOrAncestorPath(resolved, cwd, platform)) {
    flags.add("synapse-source-checkout")
  }

  const names = new Set(entries.map((entry) => entry.name))
  const looksLikeSourceRepo = names.has("package.json")
    || names.has("pnpm-workspace.yaml")
    || names.has("src")
    || names.has("desktop")
  if (looksLikeSourceRepo && !names.has("system")) {
    flags.add("source-repository")
  }

  return Array.from(flags)
}

function isInitializationBackupEntry(entryName: string): boolean {
  return entryName.startsWith(BACKUP_PREFIX)
}

function createInitializationBackupDirectoryName(date: Date): string {
  const stamp = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join("")
  return `${BACKUP_PREFIX}${stamp}`
}

async function createRepositoryInitializationPreview(input: {
  readonly repositoryUuid?: string
  readonly localPath: string
  readonly entries: readonly Dirent[]
}): Promise<SynapseRepositoryInitializationPreview> {
  const dangerFlags = detectDangerFlags(input.localPath, input.entries)
  const nonGitEntries = input.entries
    .filter((entry) => entry.name !== ".git")
    .filter((entry) => !isInitializationBackupEntry(entry.name))

  if (dangerFlags.length > 0) {
    return {
      isEmpty: nonGitEntries.length === 0,
      nonGitEntries: [],
      operationToken: "",
      dangerFlags,
    }
  }

  const fingerprints = await Promise.all(nonGitEntries.map(async (entry) => {
    const stats = await lstat(path.join(input.localPath, entry.name))
    return {
      name: entry.name,
      type: entryType(entry),
      size: stats.size,
      modifiedMs: Math.trunc(stats.mtimeMs),
    }
  }))
  const normalized = fingerprints.sort((left, right) => left.name.localeCompare(right.name))

  return {
    isEmpty: normalized.length === 0,
    nonGitEntries: normalized.map(formatPreviewEntry),
    operationToken: hashInitializationPreview({
      entries: normalized,
      localPath: path.resolve(input.localPath),
      repositoryUuid: input.repositoryUuid ?? "",
    }),
    dangerFlags,
  }
}

function assertRepositoryInitializationAllowed(preview: SynapseRepositoryInitializationPreview): void {
  if (preview.dangerFlags.length > 0) {
    throw new Error("该目录位置风险较高，不能直接初始化。请选择空目录或新建本地仓库。")
  }
}

export {
  assertRepositoryInitializationAllowed,
  createInitializationBackupDirectoryName,
  createRepositoryInitializationPreview,
  isInitializationBackupEntry,
}
