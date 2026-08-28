import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { PublishedAgentCommand } from "./command-registry"
import { normalizeCommandName } from "./command-registry"
import type { StructuredLogger } from "../../runtime/logging"
import { errorCode } from "../error-utils"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import {
  agentRuntimeCommandDiagnosticSummary,
  agentRuntimeErrorMessage,
  rawAgentRuntimeErrorMessage,
} from "./error-message"
import { readSkillIdFile } from "../editor-adapters/skill-identity"

export interface AgentSkill {
  readonly name: string
  readonly displayName?: string
  readonly description?: string
  readonly prompt: string
  readonly source: string
  readonly skillOrigin?: "synapse-installed" | "other"
}

export interface SkillRegistryDeps {
  readonly projectId?: string
  readonly workspacePath?: string
  readonly logger?: Pick<StructuredLogger, "warn">
}

export class SkillRegistry {
  private readonly deps: SkillRegistryDeps
  private cache: {
    readonly signature: string
    readonly skills: readonly AgentSkill[]
  } | undefined

  constructor(deps: SkillRegistryDeps) {
    this.deps = deps
  }

  async list(): Promise<readonly AgentSkill[]> {
    const roots = skillDirs(this.deps.workspacePath)
    const signature = await skillDirsCacheSignature(roots)
    if (this.cache?.signature === signature) {
      return this.cache.skills
    }
    const files = await listSkillFiles(roots, (dir, error) => {
      this.deps.logger?.warn("Agent skill directory skipped.", {
        boundary: "agent.skill.directory-discovery",
        projectId: this.deps.projectId,
        directoryName: path.basename(dir),
        error: errorSummary(error),
        errorCode: errorCode(error),
        errorName: errorName(error),
        errorLength: rawErrorMessage(error).length,
      })
    })
    const skills: AgentSkill[] = []
    for (const filePath of files) {
      let content: string
      try {
        const stat = await fs.stat(filePath)
        if (stat.size > MAX_SKILL_FILE_SIZE) {
          this.deps.logger?.warn("Agent skill file too large, skipped.", {
            boundary: "agent.skill.file-size",
            projectId: this.deps.projectId,
            fileName: path.basename(filePath),
            fileSize: stat.size,
          })
          continue
        }
        content = await fs.readFile(filePath, "utf8")
      } catch (error) {
        this.deps.logger?.warn("Agent skill file skipped.", {
          boundary: "agent.skill.file-read",
          projectId: this.deps.projectId,
          skillName: normalizeCommandName(path.basename(path.dirname(filePath))),
          fileName: path.basename(filePath),
          error: errorSummary(error),
          errorCode: errorCode(error),
          errorName: errorName(error),
          errorLength: rawErrorMessage(error).length,
        })
        continue
      }
      const parsed = parseSkillFile(content)
      const name = normalizeCommandName(path.basename(path.dirname(filePath)))
      if (!name || !parsed.prompt.trim()) continue
      skills.push({
        name,
        displayName: parsed.frontmatter.name,
        description: parsed.frontmatter.description ?? firstBodyLine(parsed.prompt),
        prompt: parsed.prompt.trim(),
        source: filePath,
        skillOrigin: await readSkillOrigin(filePath),
      })
    }
    const sorted = skills.sort((a, b) => a.name.localeCompare(b.name))
    this.cache = { signature, skills: sorted }
    return sorted
  }

  async listPublished(): Promise<readonly PublishedAgentCommand[]> {
    return (await this.list()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: "skill",
      kind: "skill",
      skillOrigin: skill.skillOrigin ?? "other",
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

async function readSkillOrigin(filePath: string): Promise<AgentSkill["skillOrigin"]> {
  return await readSkillIdFile(path.dirname(filePath)) ? "synapse-installed" : "other"
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

// Maximum recursion depth for skill file discovery
const MAX_SKILL_DISCOVERY_DEPTH = 3
// Maximum number of skill files to discover
const MAX_SKILL_FILES = 50
// Maximum single file size for skill file content (64 KB)
const MAX_SKILL_FILE_SIZE = 64 * 1024

async function listSkillFiles(
  roots: readonly string[],
  onDirectoryError?: (dir: string, error: unknown) => void,
  maxDepth = MAX_SKILL_DISCOVERY_DEPTH,
  maxFiles = MAX_SKILL_FILES,
): Promise<readonly string[]> {
  const result: string[] = []
  const visited = new Set<string>()
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || result.length >= maxFiles) return
    let realDir: string
    try {
      realDir = await fs.realpath(dir)
    } catch (error) {
      if (!isMissingPathError(error)) onDirectoryError?.(dir, error)
      return
    }
    if (visited.has(realDir)) return
    visited.add(realDir)

    let entries: Dirent[]
    try {
      entries = await fs.readdir(realDir, { withFileTypes: true })
    } catch (error) {
      if (!isMissingPathError(error)) onDirectoryError?.(realDir, error)
      return
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) break
      const next = path.join(realDir, entry.name)
      if (entry.isDirectory()) {
        await walk(next, depth + 1)
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        result.push(next)
      }
    }
  }
  for (const root of roots) await walk(root, 0)
  return result
}

async function skillDirsCacheSignature(roots: readonly string[]): Promise<string> {
  const parts = await Promise.all(roots.map(async (root) => {
    try {
      const stat = await fs.stat(root)
      return `${root}:${stat.mtimeMs}:${stat.size}`
    } catch {
      return `${root}:missing`
    }
  }))
  return parts.join("|")
}

function parseSkillFile(content: string): {
  readonly frontmatter: Record<string, string>
  readonly prompt: string
} {
  if (!content.startsWith("---")) return { frontmatter: {}, prompt: content }
  const end = content.indexOf("\n---", 3)
  if (end < 0) return { frontmatter: {}, prompt: content }
  const block = content.slice(3, end)
  const { metadata } = parseFrontmatterBlock(block)
  return {
    frontmatter: metadata,
    prompt: content.slice(end + 4).trim(),
  }
}

function firstBodyLine(content: string): string | undefined {
  return content.split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
}

const errorMessage = agentRuntimeErrorMessage
const rawErrorMessage = rawAgentRuntimeErrorMessage

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

const errorSummary = agentRuntimeCommandDiagnosticSummary

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}
