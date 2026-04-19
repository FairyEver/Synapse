import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const SYNAPSE_SKILL_ID_FILE_NAME = ".synapse.json"

interface SynapseSkillMeta {
  id: string
}
const UNIQUE_SUFFIX_LIMIT = 999

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

async function readSkillIdFile(skillDirectoryPath: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(skillDirectoryPath, SYNAPSE_SKILL_ID_FILE_NAME), "utf8")
    const meta: SynapseSkillMeta = JSON.parse(raw)
    return meta.id ?? null
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readdir(targetPath)
    return true
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false
    }

    return true
  }
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

  if (previous && path.basename(previous) === slug) {
    return previous
  }

  const ideal = path.join(parentDirectoryPath, slug)

  return resolveUniqueSkillDirectoryPath(ideal)
}

export {
  SYNAPSE_SKILL_ID_FILE_NAME,
  findSkillDirectoryByContentId,
  resolveSkillTargetPath,
}
