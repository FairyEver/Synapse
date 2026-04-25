import { readdir, readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"

export type SkillMetadata = {
  name: string
  displayName: string
  description: string
  prompt: string
  source: string
  version?: string
}

export type SkillDirectoryOptions = {
  workDir: string
  homeDir?: string
  markerDirs?: readonly string[]
}

function normalizeLookupName(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_")
}

function cleanPath(value: string): string {
  return path.normalize(value)
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const item of paths) {
    if (!item) {
      continue
    }
    const cleaned = cleanPath(item)
    if (seen.has(cleaned)) {
      continue
    }
    seen.add(cleaned)
    out.push(cleaned)
  }

  return out
}

function markerSet(markers: readonly string[] | undefined): Set<string> {
  return new Set((markers ?? []).map(cleanPath))
}

function findMarkerRoot(start: string, markers: Set<string>): string {
  let current = cleanPath(start)
  while (true) {
    if (markers.has(current)) {
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return ""
    }
    current = parent
  }
}

function walkProjectSkillDirs(
  options: SkillDirectoryOptions,
  childDirs: readonly string[],
): string[] {
  const homeDir = options.homeDir ? cleanPath(options.homeDir) : ""
  const stopAt = findMarkerRoot(options.workDir, markerSet(options.markerDirs))
  let current = cleanPath(options.workDir)
  const dirs: string[] = []

  while (true) {
    if (homeDir && current === homeDir) {
      break
    }

    for (const childDir of childDirs) {
      dirs.push(path.join(current, childDir, "skills"))
    }

    if (stopAt && current === stopAt) {
      break
    }

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    current = parent
  }

  return uniquePaths(dirs)
}

export function computeClaudeSkillDirs(
  options: SkillDirectoryOptions & { claudeConfigDir?: string },
): string[] {
  const configDir = options.claudeConfigDir?.trim()
    || (options.homeDir ? path.join(options.homeDir, ".claude") : "")

  return uniquePaths([
    ...walkProjectSkillDirs(options, [".claude"]),
    configDir ? path.join(configDir, "skills") : "",
  ])
}

export function computeCodexSkillDirs(
  options: SkillDirectoryOptions & { codexHome?: string },
): string[] {
  const codexHome = options.codexHome?.trim()
    || (options.homeDir ? path.join(options.homeDir, ".codex") : "")

  return uniquePaths([
    ...walkProjectSkillDirs(options, [".agents", ".codex"]),
    codexHome ? path.join(codexHome, "skills") : "",
    options.homeDir ? path.join(options.homeDir, ".agents", "skills") : "",
  ])
}

function parseFrontmatter(block: string): Map<string, string> {
  const output = new Map<string, string>()
  const lines = block.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const separator = line.indexOf(":")
    if (separator < 0) {
      continue
    }

    const key = line.slice(0, separator).trim().toLowerCase()
    let value = line.slice(separator + 1).trim()

    if ([">-", "|-", ">", "|"].includes(value)) {
      const blockLines: string[] = []
      while (index + 1 < lines.length) {
        const next = lines[index + 1]
        if (next.length > 0 && !next.startsWith(" ") && !next.startsWith("\t")) {
          break
        }
        index += 1
        blockLines.push(next.trim())
      }
      value = blockLines.join(" ")
    }

    if (key) {
      output.set(key, value.replace(/^["']|["']$/g, ""))
    }
  }

  return output
}

export function parseSkillMarkdown(
  skillName: string,
  raw: string,
  source: string,
): SkillMetadata | null {
  const content = raw.trim()
  if (!content) {
    return null
  }

  let body = content
  let frontmatter = new Map<string, string>()

  if (content.startsWith("---")) {
    const rest = content.slice(3)
    const endIndex = rest.indexOf("\n---")
    if (endIndex >= 0) {
      frontmatter = parseFrontmatter(rest.slice(0, endIndex))
      body = rest.slice(endIndex + 4).trim()
    }
  }

  if (!body) {
    return null
  }

  let description = frontmatter.get("description") ?? ""
  if (!description) {
    const firstLine = body.split(/\r?\n/)[0]?.trim() ?? ""
    description = Array.from(firstLine).slice(0, 80).join("")
    if (Array.from(firstLine).length > 80) {
      description += "..."
    }
  }

  return {
    name: skillName,
    displayName: frontmatter.get("name") ?? "",
    description,
    prompt: body,
    source,
    ...(frontmatter.get("version") ? { version: frontmatter.get("version") } : {}),
  }
}

async function realPathOrClean(value: string): Promise<string> {
  try {
    return cleanPath(await realpath(value))
  } catch {
    return cleanPath(value)
  }
}

async function shouldDescend(fullPath: string, isDirectory: boolean, isSymbolicLink: boolean): Promise<boolean> {
  if (isDirectory) {
    return true
  }
  if (!isSymbolicLink) {
    return false
  }

  try {
    return (await stat(fullPath)).isDirectory()
  } catch {
    return false
  }
}

async function discoverSkillsInDir(
  scanRoot: string,
  currentDir: string,
  seen: Set<string>,
  visited: Set<string>,
): Promise<SkillMetadata[]> {
  const realCurrent = await realPathOrClean(currentDir)
  if (visited.has(realCurrent)) {
    return []
  }
  visited.add(realCurrent)

  let entries
  try {
    entries = await readdir(currentDir, { withFileTypes: true })
  } catch {
    return []
  }

  const result: SkillMetadata[] = []
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name)

    if (entry.name === "SKILL.md") {
      const skillDir = path.dirname(fullPath)
      if (await realPathOrClean(skillDir) === await realPathOrClean(scanRoot)) {
        continue
      }

      const skillName = path.basename(skillDir)
      const seenKey = skillName.toLowerCase()
      if (seen.has(seenKey)) {
        continue
      }

      let raw = ""
      try {
        raw = await readFile(fullPath, "utf8")
      } catch {
        continue
      }

      const skill = parseSkillMarkdown(skillName, raw, skillDir)
      if (skill) {
        seen.add(seenKey)
        result.push(skill)
      }
      continue
    }

    if (await shouldDescend(fullPath, entry.isDirectory(), entry.isSymbolicLink())) {
      result.push(...await discoverSkillsInDir(scanRoot, fullPath, seen, visited))
    }
  }

  return result
}

export async function discoverSkillsFromDirectories(dirs: readonly string[]): Promise<SkillMetadata[]> {
  const seen = new Set<string>()
  const result: SkillMetadata[] = []

  for (const dir of dirs) {
    result.push(...await discoverSkillsInDir(dir, dir, seen, new Set()))
  }

  return result
}

export function resolveSkillByName(skills: readonly SkillMetadata[], name: string): SkillMetadata | null {
  const wanted = normalizeLookupName(name)
  return skills.find((skill) => normalizeLookupName(skill.name) === wanted) ?? null
}

export function buildSkillInvocationPrompt(skill: SkillMetadata, args: readonly string[] = []): string {
  const displayName = skill.displayName || skill.name
  const sections = [
    "The user is asking you to execute the following skill.",
    `## Skill: ${displayName}`,
  ]

  if (skill.description) {
    sections.push(`## Description: ${skill.description}`)
  }

  sections.push(`## Skill Instructions:\n${skill.prompt}`)

  if (args.length > 0) {
    sections.push(`## User Arguments:\n${args.join(" ")}`)
  }

  sections.push("Please follow the skill instructions above to complete the task.")
  return sections.join("\n\n")
}
