import { spawn } from "node:child_process"
import type { Dirent } from "node:fs"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"

const CONTENT_ROOTS = ["rules", "skills"] as const
const META_FILE_NAME = "meta.json"
const HISTORY_DIRECTORY_NAME = "history"
const SNAPSHOT_FILE_NAME = "snapshot.json"
const USER_PROFILE_SCHEMA_VERSION = 1 as const
const ZERO_USER_ID = "00000000000000000000000000000000"

type LegacyMetaRecord = {
  createdAt?: unknown
  createdBy?: unknown
  createdByDisplayName?: unknown
}

type LegacySnapshotRecord = {
  modifiedAt?: unknown
  modifiedBy?: unknown
  modifiedByDisplayName?: unknown
}

type UserProfileCandidate = {
  displayName: string
  sortKey: number
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const normalizedValue = value.trim().toLowerCase()

  return /^[0-9a-f]{32}$/.test(normalizedValue) ? normalizedValue : null
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function toSortKey(value: unknown): number {
  if (typeof value !== "string") {
    return 0
  }

  const timestamp = new Date(value).getTime()

  return Number.isNaN(timestamp) ? 0 : timestamp
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }

    throw error
  }
}

async function readDirectoryEntries(directoryPath: string): Promise<Dirent[]> {
  try {
    return (await readdir(directoryPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return []
    }

    throw error
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null
    }

    if (error instanceof SyntaxError) {
      process.stderr.write(`Skipping invalid JSON: ${filePath}\n`)
      return null
    }

    throw error
  }
}

function recordCandidate(
  candidates: Map<string, UserProfileCandidate>,
  userId: string | null,
  displayName: string,
  timestamp: unknown,
): void {
  if (!userId) {
    return
  }

  const nextCandidate: UserProfileCandidate = {
    displayName,
    sortKey: toSortKey(timestamp),
  }
  const currentCandidate = candidates.get(userId)

  if (!currentCandidate || nextCandidate.sortKey >= currentCandidate.sortKey) {
    candidates.set(userId, nextCandidate)
  }
}

async function collectCandidates(
  repoRootPath: string,
): Promise<Map<string, UserProfileCandidate>> {
  const candidates = new Map<string, UserProfileCandidate>()

  for (const contentRoot of CONTENT_ROOTS) {
    const contentRootPath = path.join(repoRootPath, contentRoot)
    const contentEntries = await readDirectoryEntries(contentRootPath)

    for (const contentEntry of contentEntries) {
      if (!contentEntry.isDirectory()) {
        continue
      }

      const contentPath = path.join(contentRootPath, contentEntry.name)
      const meta = await readJsonFile<LegacyMetaRecord>(path.join(contentPath, META_FILE_NAME))

      if (meta) {
        recordCandidate(
          candidates,
          normalizeUserId(meta.createdBy),
          normalizeDisplayName(meta.createdByDisplayName),
          meta.createdAt,
        )
      }

      const historyEntries = await readDirectoryEntries(path.join(contentPath, HISTORY_DIRECTORY_NAME))

      for (const historyEntry of historyEntries) {
        if (!historyEntry.isDirectory()) {
          continue
        }

        const snapshot = await readJsonFile<LegacySnapshotRecord>(
          path.join(contentPath, HISTORY_DIRECTORY_NAME, historyEntry.name, SNAPSHOT_FILE_NAME),
        )

        if (!snapshot) {
          continue
        }

        recordCandidate(
          candidates,
          normalizeUserId(snapshot.modifiedBy),
          normalizeDisplayName(snapshot.modifiedByDisplayName),
          snapshot.modifiedAt,
        )
      }
    }
  }

  return candidates
}

async function writeUserProfile(
  repoRootPath: string,
  userId: string,
  displayName: string,
  updatedAt: string,
): Promise<void> {
  const profilePath = path.join(repoRootPath, "users", userId, "profile.json")

  await mkdir(path.dirname(profilePath), { recursive: true })
  await writeFile(profilePath, `${JSON.stringify({
    schemaVersion: USER_PROFILE_SCHEMA_VERSION,
    userId,
    displayName,
    updatedAt,
  }, null, 2)}\n`, "utf8")
}

function runGitCommand(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    let stdout = ""
    let stderr = ""

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8")
    })

    childProcess.on("error", reject)

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(new Error(stderr.trim() || stdout.trim() || "Git 命令执行失败。"))
    })
  })
}

async function isGitRepository(repoRootPath: string): Promise<boolean> {
  try {
    await runGitCommand(repoRootPath, ["rev-parse", "--is-inside-work-tree"])
    return true
  } catch {
    return false
  }
}

async function stageAndCommitProfiles(repoRootPath: string): Promise<void> {
  await runGitCommand(repoRootPath, ["add", "--", "users"])
  await runGitCommand(repoRootPath, ["commit", "-m", "[synapse] migrate user profiles"])
}

async function main() {
  const repoRootPath = path.resolve(process.argv[2] || process.cwd())
  const candidates = await collectCandidates(repoRootPath)
  const sortedUserIds = Array.from(candidates.keys()).sort()
  const updatedAt = new Date().toISOString()
  let createdCount = 0
  let skippedCount = 0

  for (const userId of sortedUserIds) {
    const profilePath = path.join(repoRootPath, "users", userId, "profile.json")

    if (await pathExists(profilePath)) {
      skippedCount += 1
      continue
    }

    const candidate = candidates.get(userId)

    if (!candidate) {
      continue
    }

    const displayName =
      candidate.displayName || (userId === ZERO_USER_ID ? "legacy" : "")

    await writeUserProfile(repoRootPath, userId, displayName, updatedAt)
    createdCount += 1
  }

  process.stdout.write(
    `Created ${createdCount} profile file(s); skipped ${skippedCount} existing profile(s).\n`,
  )

  if (createdCount === 0) {
    return
  }

  if (!(await isGitRepository(repoRootPath))) {
    process.stdout.write("Current directory is not a Git repository. Skipped git add and commit.\n")
    return
  }

  await stageAndCommitProfiles(repoRootPath)
  process.stdout.write(
    "Committed migration as [synapse] migrate user profiles. Review the result, then push manually.\n",
  )
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
