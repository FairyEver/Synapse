import { createHash } from "node:crypto"
import type { Dirent } from "node:fs"
import { lstat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  SynapseRepositoryInitializationDangerFlag,
  SynapseRepositoryInitializationPreview,
} from "../../src/types/repository"

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

function detectDangerFlags(localPath: string, entries: readonly Dirent[]): SynapseRepositoryInitializationDangerFlag[] {
  const flags = new Set<SynapseRepositoryInitializationDangerFlag>()
  const resolved = path.resolve(localPath)
  const home = path.resolve(os.homedir())
  const deniedUserDirs = [
    ["home", home],
    ["desktop", path.join(home, "Desktop")],
    ["documents", path.join(home, "Documents")],
    ["downloads", path.join(home, "Downloads")],
  ] as const

  for (const [flag, deniedPath] of deniedUserDirs) {
    if (resolved === path.resolve(deniedPath)) {
      flags.add(flag)
    }
  }

  if (path.parse(resolved).root === resolved) {
    flags.add("filesystem-root")
  }

  const cwd = path.resolve(process.cwd())
  if (resolved === cwd || cwd.startsWith(`${resolved}${path.sep}`)) {
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
  const nonGitEntries = input.entries
    .filter((entry) => entry.name !== ".git")
    .filter((entry) => !isInitializationBackupEntry(entry.name))

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
    dangerFlags: detectDangerFlags(input.localPath, input.entries),
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
