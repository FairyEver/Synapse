import { constants, type BigIntStats } from "node:fs"
import { lstat, open, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { arePathsEqualForCompare } from "../../../src/lib/path-compare"
import {
  hasSameFileSnapshot,
  isFileNotFoundError,
  isPathInside,
  pathExists,
} from "../fs-utils"

const SYNAPSE_SKILL_ID_FILE_NAME = ".synapse.json"
const CURRENT_SYNAPSE_SKILL_CONTENT_ID = "synapse-skill"
const LEGACY_BUILTIN_SYNAPSE_SKILL_CONTENT_ID = "builtin__skill__synapse-skill"

interface SynapseSkillMeta {
  id?: unknown
  kind?: unknown
}
const UNIQUE_SUFFIX_LIMIT = 999

function isSamePath(left: string, right: string): boolean {
  return arePathsEqualForCompare(left, right, {
    platform: process.platform,
    resolvePath: path.resolve,
  })
}

function parseSkillIdFile(raw: string): string | null {
  try {
    const meta = JSON.parse(raw) as SynapseSkillMeta
    if (meta.kind === "cloud-skill-repository") return null
    return typeof meta.id === "string" && meta.id.trim().length > 0 ? meta.id : null
  } catch {
    return null
  }
}

function normalizeSkillContentIdForCompare(contentId: string): string {
  return contentId === LEGACY_BUILTIN_SYNAPSE_SKILL_CONTENT_ID
    ? CURRENT_SYNAPSE_SKILL_CONTENT_ID
    : contentId
}

function areSkillContentIdsEquivalent(left: string | null, right: string): boolean {
  if (!left) return false
  return normalizeSkillContentIdForCompare(left) === normalizeSkillContentIdForCompare(right)
}

async function readSkillIdFile(skillDirectoryPath: string): Promise<string | null> {
  try {
    const identityPath = path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME)
    const [directoryEntry, identityEntry] = await Promise.all([
      lstat(skillDirectoryPath, { bigint: true }),
      lstat(identityPath, { bigint: true }),
    ])
    if (
      directoryEntry.isSymbolicLink()
      || !directoryEntry.isDirectory()
      || identityEntry.isSymbolicLink()
      || !identityEntry.isFile()
    ) {
      return null
    }

    const raw = await readVerifiedSkillIdFile(skillDirectoryPath, identityPath, identityEntry)
    return parseSkillIdFile(raw)
  } catch {
    return null
  }
}

async function readVerifiedSkillIdFile(
  skillDirectoryPath: string,
  identityPath: string,
  expected: BigIntStats,
): Promise<string> {
  const [directoryRealPath, identityRealPath] = await Promise.all([
    realpath(skillDirectoryPath),
    realpath(identityPath),
  ])
  if (!isPathInside(directoryRealPath, identityRealPath)) {
    throw new Error("Skill 身份文件必须位于 Skill 目录内。")
  }

  const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0
  const nonBlockingFlag = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0
  const handle = await open(identityPath, constants.O_RDONLY | noFollowFlag | nonBlockingFlag)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !hasSameFileSnapshot(expected, opened)) {
      throw new Error("Skill 身份文件在读取前发生变化。")
    }

    const raw = await handle.readFile({ encoding: "utf8" })
    const [afterRead, pathAfterRead, realPathAfterRead] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(identityPath, { bigint: true }),
      realpath(identityPath),
    ])
    if (
      pathAfterRead.isSymbolicLink()
      || !pathAfterRead.isFile()
      || !hasSameFileSnapshot(expected, afterRead)
      || !hasSameFileSnapshot(expected, pathAfterRead)
      || !isPathInside(directoryRealPath, realPathAfterRead)
    ) {
      throw new Error("Skill 身份文件在读取期间发生变化。")
    }
    return raw
  } finally {
    await handle.close()
  }
}

async function isSkillDirectoryOwnedByContentId(
  skillDirectoryPath: string,
  contentId: string,
): Promise<boolean> {
  try {
    const entry = await lstat(skillDirectoryPath)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return false
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }

    throw error
  }

  return areSkillContentIdsEquivalent(await readSkillIdFile(skillDirectoryPath), contentId)
}

async function findSkillDirectoryByContentId(
  parentDirectoryPath: string,
  contentId: string,
): Promise<string | null> {
  let entries
  try {
    entries = await readdir(parentDirectoryPath, { withFileTypes: true })
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null
    }

    throw error
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const candidatePath = path.join(parentDirectoryPath, entry.name)
    const storedId = await readSkillIdFile(candidatePath)

    if (areSkillContentIdsEquivalent(storedId, contentId)) {
      return candidatePath
    }
  }

  return null
}

async function resolveUniqueSkillDirectoryPath(idealPath: string): Promise<string> {
  if (!(await pathExists(idealPath))) {
    return idealPath
  }

  const parent = path.dirname(idealPath)
  const base = path.basename(idealPath)

  for (let suffix = 2; suffix <= UNIQUE_SUFFIX_LIMIT; suffix += 1) {
    const candidate = path.join(parent, `${base}-${suffix}`)

    if (!(await pathExists(candidate))) {
      return candidate
    }
  }

  throw new Error(`无法在 ${parent} 下找到可用的 Skill 目录名。`)
}

type SkillConflictCheckResult =
  | { hasConflict: false; ownedTargetExists?: boolean; targetExists: boolean }
  | { hasConflict: true; existingContentId: string; existingPath: string }

async function checkSkillNameConflict(
  parentDirectoryPath: string,
  slug: string,
  contentId: string,
): Promise<SkillConflictCheckResult> {
  const targetPath = path.join(parentDirectoryPath, slug)

  // Check if the exact path exists
  if (!(await pathExists(targetPath))) {
    return { hasConflict: false, targetExists: false }
  }

  // Path exists, check if it's the same skill
  const existingContentId = await readSkillIdFile(targetPath)

  if (areSkillContentIdsEquivalent(existingContentId, contentId)) {
    // Same skill, no conflict
    return { hasConflict: false, ownedTargetExists: true, targetExists: true }
  }

  // Different skill with same name - conflict
  return {
    hasConflict: true,
    existingContentId: existingContentId ?? "unknown",
    existingPath: targetPath,
  }
}

async function resolveSkillTargetPath({
  parentDirectoryPath,
  contentId,
  slug,
}: {
  parentDirectoryPath: string
  contentId: string
  slug: string
}): Promise<string> {
  const previous = await findSkillDirectoryByContentId(parentDirectoryPath, contentId)
  const ideal = path.join(parentDirectoryPath, slug)

  if (previous && isSamePath(previous, ideal)) {
    return previous
  }

  // Check for conflict instead of auto-renaming
  const conflict = await checkSkillNameConflict(parentDirectoryPath, slug, contentId)

  if (conflict.hasConflict) {
    // Return the conflicting path - the caller will handle the conflict
    return conflict.existingPath
  }

  return ideal
}

export {
  SYNAPSE_SKILL_ID_FILE_NAME,
  areSkillContentIdsEquivalent,
  checkSkillNameConflict,
  findSkillDirectoryByContentId,
  isSkillDirectoryOwnedByContentId,
  resolveSkillTargetPath,
}
