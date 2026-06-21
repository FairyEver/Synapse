import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { arePathsEqualForCompare } from "../../../src/lib/path-compare"
import { isFileNotFoundError, pathExists } from "../fs-utils"

const SYNAPSE_SKILL_ID_FILE_NAME = ".synapse.json"

interface SynapseSkillMeta {
  id?: unknown
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
    return typeof meta.id === "string" && meta.id.trim().length > 0 ? meta.id : null
  } catch {
    return null
  }
}

async function readSkillIdFile(skillDirectoryPath: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME), "utf8")
    return parseSkillIdFile(raw)
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null
    }

    throw error
  }
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

    if (storedId === contentId) {
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
  | { hasConflict: false; targetExists: boolean }
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

  if (existingContentId === contentId) {
    // Same skill, no conflict
    return { hasConflict: false, targetExists: true }
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
  checkSkillNameConflict,
  findSkillDirectoryByContentId,
  resolveSkillTargetPath,
}
