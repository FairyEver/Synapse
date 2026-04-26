import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { PublishedAgentCommand } from "./command-registry"
import { normalizeCommandName } from "./command-registry"

export interface AgentSkill {
  readonly name: string
  readonly displayName?: string
  readonly description?: string
  readonly prompt: string
  readonly source: string
}

export interface SkillRegistryDeps {
  readonly workspacePath?: string
}

export class SkillRegistry {
  private readonly deps: SkillRegistryDeps

  constructor(deps: SkillRegistryDeps) {
    this.deps = deps
  }

  async list(): Promise<readonly AgentSkill[]> {
    const files = await listSkillFiles(skillDirs(this.deps.workspacePath))
    const skills: AgentSkill[] = []
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8")
      const parsed = parseSkillFile(content)
      const name = normalizeCommandName(path.basename(path.dirname(filePath)))
      if (!name || !parsed.prompt.trim()) continue
      skills.push({
        name,
        displayName: parsed.frontmatter.name,
        description: parsed.frontmatter.description ?? firstBodyLine(parsed.prompt),
        prompt: parsed.prompt.trim(),
        source: filePath,
      })
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  }

  async listPublished(): Promise<readonly PublishedAgentCommand[]> {
    return (await this.list()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: "skill",
      kind: "skill",
      adminOnly: false,
    }))
  }

  async resolve(name: string): Promise<AgentSkill | null> {
    const normalized = normalizeCommandName(name)
    return (await this.list()).find((skill) =>
      skill.name === normalized || normalizeCommandName(skill.displayName ?? "") === normalized)
      ?? null
  }
}

export function buildSkillInvocationPrompt(skill: AgentSkill, args: readonly string[]): string {
  return [
    "The user is asking you to execute the following skill.",
    "",
    `## Skill: ${skill.displayName ?? skill.name}`,
    skill.description ? `## Description: ${skill.description}` : undefined,
    "",
    "## Skill Instructions:",
    skill.prompt,
    "",
    "## User Arguments:",
    args.join(" "),
    "",
    "Please follow the skill instructions and respond to the user's request.",
  ].filter((line): line is string => line !== undefined).join("\n")
}

function skillDirs(workspacePath: string | undefined): readonly string[] {
  const roots: string[] = []
  if (workspacePath) {
    roots.push(
      path.join(workspacePath, ".agents", "skills"),
      path.join(workspacePath, ".codex", "skills"),
      path.join(workspacePath, ".claude", "skills"),
    )
  }
  if (process.env.CODEX_HOME) roots.push(path.join(process.env.CODEX_HOME, "skills"))
  roots.push(
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  )
  return roots
}

async function listSkillFiles(roots: readonly string[]): Promise<readonly string[]> {
  const result: string[] = []
  const visited = new Set<string>()
  async function walk(dir: string): Promise<void> {
    let realDir: string
    try {
      realDir = await fs.realpath(dir)
    } catch {
      return
    }
    if (visited.has(realDir)) return
    visited.add(realDir)

    let entries: Dirent[]
    try {
      entries = await fs.readdir(realDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const next = path.join(realDir, entry.name)
      if (entry.isDirectory()) {
        await walk(next)
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        result.push(next)
      }
    }
  }
  for (const root of roots) await walk(root)
  return result
}

function parseSkillFile(content: string): {
  readonly frontmatter: Record<string, string>
  readonly prompt: string
} {
  if (!content.startsWith("---")) return { frontmatter: {}, prompt: content }
  const end = content.indexOf("\n---", 3)
  if (end < 0) return { frontmatter: {}, prompt: content }
  const frontmatter: Record<string, string> = {}
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match?.[1]) frontmatter[match[1]] = (match[2] ?? "").trim().replace(/^["']|["']$/g, "")
  }
  return {
    frontmatter,
    prompt: content.slice(end + 4).trim(),
  }
}

function firstBodyLine(content: string): string | undefined {
  return content.split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
}

