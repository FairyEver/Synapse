import { randomUUID } from "node:crypto"
import type { Dirent } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { AgentCommandEntryV1, DataNamespace } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/logging"
import type { ShellKind } from "../shell-exec"
import { errorCode } from "../error-utils"
import type { AgentMessage } from "./types"
import { parseFrontmatterBlock } from "../../../src/definitions/editor/shared-yaml-scalar"
import {
  AGENT_COMMAND_EXEC_BODY_MISSING_MESSAGE,
  AGENT_COMMAND_NAME_REQUIRED_MESSAGE,
  AGENT_COMMAND_PROMPT_REQUIRED_MESSAGE,
} from "./agent-error-messages"
import {
  agentRuntimeErrorMessage,
  agentRuntimeErrorSummary,
  rawAgentRuntimeErrorMessage,
} from "./error-message"

export type PublishedCommandSource = "builtin" | "custom" | "skill" | "agent-native"
export type PublishedCommandKind = "builtin" | "prompt" | "exec" | "skill" | "agent-native"

export interface PublishedAgentCommandUi {
  readonly group?: "knowledge-base"
  readonly label?: string
  readonly action?: "send" | "insert"
  readonly insertText?: string
}

export interface PublishedAgentCommand {
  readonly name: string
  readonly description?: string
  readonly source: PublishedCommandSource
  readonly kind: PublishedCommandKind
  readonly adminOnly: boolean
  readonly allowedPlatforms?: readonly string[]
  readonly ui?: PublishedAgentCommandUi
}

export interface CustomCommandRegistryDeps {
  readonly projectId: string
  readonly commands: DataNamespace<AgentCommandEntryV1>
  readonly workspacePath?: string
  readonly now?: () => Date
  readonly logger?: Pick<StructuredLogger, "warn">
}

export interface AddCustomCommandInput {
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly exec?: string
  readonly shell?: ShellKind
  readonly workDir?: string
  readonly allowedPlatforms?: readonly string[]
  readonly adminOnly?: boolean
  readonly createdBy?: string
}

export const BUILTIN_COMMANDS: readonly PublishedAgentCommand[] = [
  { name: "model", description: "Switch model", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "mode", description: "List modes", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "new", description: "Start a new session", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "status", description: "Show agent status", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "show", description: "Show a workspace reference", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "compress", description: "Compact the current agent context", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "commands", description: "Manage commands", source: "builtin", kind: "builtin", adminOnly: false },
  { name: "skills", description: "List skills", source: "builtin", kind: "builtin", adminOnly: false },
]

export class CustomCommandRegistry {
  private readonly deps: CustomCommandRegistryDeps

  constructor(deps: CustomCommandRegistryDeps) {
    this.deps = deps
  }

  async list(): Promise<readonly AgentCommandEntryV1[]> {
    const stored = (await this.deps.commands.list())
      .filter((command) => command.enabled)
      .sort((a, b) => a.name.localeCompare(b.name))
    const files = await this.listFileCommands()
    return [...stored, ...files]
  }

  async listPublished(): Promise<readonly PublishedAgentCommand[]> {
    return (await this.list()).map((command) => ({
      name: command.name,
      description: command.description,
      source: "custom",
      kind: command.kind,
      adminOnly: command.adminOnly,
      allowedPlatforms: command.allowedPlatforms,
    }))
  }

  async resolve(name: string): Promise<AgentCommandEntryV1 | null> {
    const normalized = normalizeCommandName(name)
    const commands = await this.list()
    return commands.find((command) => commandMatches(command.name, normalized)) ?? null
  }

  async addPrompt(input: AddCustomCommandInput): Promise<AgentCommandEntryV1> {
    const prompt = input.prompt?.trim()
    if (!prompt) throw new Error(AGENT_COMMAND_PROMPT_REQUIRED_MESSAGE)
    return this.upsert({
      ...input,
      kind: "prompt",
      prompt,
      exec: undefined,
      adminOnly: input.adminOnly ?? false,
    })
  }

  async addExec(input: AddCustomCommandInput): Promise<AgentCommandEntryV1> {
    const exec = input.exec?.trim()
    if (!exec) throw new Error(AGENT_COMMAND_EXEC_BODY_MISSING_MESSAGE)
    return this.upsert({
      ...input,
      kind: "exec",
      prompt: undefined,
      exec,
      adminOnly: input.adminOnly ?? true,
      allowedPlatforms: input.allowedPlatforms ?? ["local-renderer"],
    })
  }

  async remove(name: string): Promise<boolean> {
    const normalized = normalizeCommandName(name)
    const stored = await this.deps.commands.list()
    const target = stored.find((command) => commandMatches(command.name, normalized))
    if (!target) return false
    await this.deps.commands.remove(target.id)
    return true
  }

  private async upsert(
    input: AddCustomCommandInput & { readonly kind: "prompt" | "exec" },
  ): Promise<AgentCommandEntryV1> {
    const name = normalizeCommandName(input.name)
    if (!name) throw new Error(AGENT_COMMAND_NAME_REQUIRED_MESSAGE)
    const now = this.isoNow()
    const existing = (await this.deps.commands.list())
      .find((command) => commandMatches(command.name, name))
    const entry: AgentCommandEntryV1 = {
      id: existing?.id ?? `agent-command:${randomUUID()}`,
      schemaVersion: 1,
      projectId: this.deps.projectId,
      name,
      description: input.description,
      kind: input.kind,
      prompt: input.prompt,
      exec: input.exec,
      shell: input.kind === "exec" ? input.shell : undefined,
      workDir: input.workDir,
      enabled: true,
      source: "runtime",
      allowedPlatforms: input.allowedPlatforms ? [...input.allowedPlatforms] : undefined,
      adminOnly: input.adminOnly ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdBy: input.createdBy,
    }
    await this.deps.commands.upsert(entry)
    return entry
  }

  private async listFileCommands(): Promise<readonly AgentCommandEntryV1[]> {
    const roots = commandDirs(this.deps.workspacePath)
    const found: AgentCommandEntryV1[] = []
    for (const root of roots) {
      const files = await listMarkdownFiles(root, (dir, error) => {
        this.deps.logger?.warn("Agent command directory skipped.", {
          boundary: "agent.command.directory-discovery",
          projectId: this.deps.projectId,
          directoryName: path.basename(dir),
          rootName: path.basename(root),
          error: errorSummary(error),
          errorCode: errorCode(error),
          errorName: errorName(error),
          errorLength: rawErrorMessage(error).length,
        })
      })
      for (const filePath of files) {
        const relative = path.relative(root, filePath)
        const name = normalizeCommandName(relative.replace(/\.md$/i, ""))
        if (!name) continue
        let content: string
        try {
          const stat = await fs.stat(filePath)
          if (stat.size > MAX_COMMAND_FILE_SIZE) {
            this.deps.logger?.warn("Agent command file too large, skipped.", {
              boundary: "agent.command.file-size",
              projectId: this.deps.projectId,
              commandName: name,
              fileName: path.basename(filePath),
              fileSize: stat.size,
            })
            continue
          }
          content = await fs.readFile(filePath, "utf8")
        } catch (error) {
          this.deps.logger?.warn("Agent command file skipped.", {
            boundary: "agent.command.file-read",
            projectId: this.deps.projectId,
            commandName: name,
            fileName: path.basename(filePath),
            error: errorSummary(error),
            errorCode: errorCode(error),
            errorName: errorName(error),
            errorLength: rawErrorMessage(error).length,
          })
          continue
        }
        const body = stripFrontmatter(content).trim()
        if (!body) continue
        found.push({
          id: `agent-command-file:${filePath}`,
          schemaVersion: 1,
          projectId: this.deps.projectId,
          name,
          description: descriptionFromMarkdown(content),
          kind: "prompt",
          prompt: body,
          enabled: true,
          source: "file",
          adminOnly: false,
          createdAt: this.isoNow(),
          updatedAt: this.isoNow(),
        })
      }
    }
    return found
  }

  private isoNow(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }
}

export function expandCustomCommandPrompt(
  command: Pick<AgentCommandEntryV1, "prompt">,
  args: readonly string[],
  _message?: AgentMessage,
): string {
  const prompt = command.prompt ?? ""
  let hadPlaceholder = false
  const expanded = prompt.replace(/\{\{\s*(args|\d+\*?)(?::([^}]*))?\s*\}\}/gi, (_match, key: string, fallback: string | undefined) => {
    hadPlaceholder = true
    const value = placeholderValue(key, args)
    return value || fallback?.trim() || ""
  })
  if (hadPlaceholder || args.length === 0) return expanded
  return `${expanded.trimEnd()}\n\n${args.join(" ")}`
}

export function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, "").replace(/\\/g, "/").toLowerCase()
}

export function commandAllowedOnPlatform(
  command: AgentCommandEntryV1,
  platform: string,
): boolean {
  if (!command.allowedPlatforms || command.allowedPlatforms.length === 0) return true
  return command.allowedPlatforms.some((allowed) =>
    allowed.toLowerCase() === platform.toLowerCase())
}

function placeholderValue(key: string, args: readonly string[]): string {
  const normalized = key.toLowerCase()
  if (normalized === "args") return args.join(" ")
  const rest = /^(\d+)\*$/.exec(normalized)
  if (rest) {
    const index = Number.parseInt(rest[1] ?? "1", 10) - 1
    return args.slice(Math.max(0, index)).join(" ")
  }
  const one = Number.parseInt(normalized, 10)
  if (Number.isInteger(one) && one > 0) return args[one - 1] ?? ""
  return ""
}

function commandMatches(left: string, right: string): boolean {
  return normalizeCommandName(left).replace(/_/g, "-") === normalizeCommandName(right).replace(/_/g, "-")
}

function commandDirs(workspacePath: string | undefined): readonly string[] {
  const roots: string[] = []
  if (workspacePath) {
    roots.push(
      path.join(workspacePath, ".agents", "commands"),
      path.join(workspacePath, ".codex", "commands"),
      path.join(workspacePath, ".claude", "commands"),
    )
  }
  roots.push(
    path.join(os.homedir(), ".codex", "commands"),
    path.join(os.homedir(), ".claude", "commands"),
  )
  return roots
}

// Maximum recursion depth for command file discovery
const MAX_COMMAND_DISCOVERY_DEPTH = 3
// Maximum number of command files to discover
const MAX_COMMAND_FILES = 100
// Maximum single file size for command file content (64 KB)
const MAX_COMMAND_FILE_SIZE = 64 * 1024

async function listMarkdownFiles(
  root: string,
  onDirectoryError?: (dir: string, error: unknown) => void,
  maxDepth = MAX_COMMAND_DISCOVERY_DEPTH,
  maxFiles = MAX_COMMAND_FILES,
): Promise<readonly string[]> {
  const result: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || result.length >= maxFiles) return
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (!isMissingPathError(error)) onDirectoryError?.(dir, error)
      return
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) break
      const next = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(next, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        result.push(next)
      }
    }
  }
  await walk(root, 0)
  return result
}

const errorMessage = agentRuntimeErrorMessage
const rawErrorMessage = rawAgentRuntimeErrorMessage

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

const errorSummary = agentRuntimeErrorSummary

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT"
}

function descriptionFromMarkdown(content: string): string | undefined {
  const frontmatter = parseFrontmatter(content)
  if (frontmatter.description) return frontmatter.description
  const body = stripFrontmatter(content)
  const line = body.split(/\r?\n/)
    .map((item) => item.replace(/^#+\s*/, "").trim())
    .find(Boolean)
  return line
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content
  const end = content.indexOf("\n---", 3)
  if (end < 0) return content
  return content.slice(end + 4)
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {}
  const end = content.indexOf("\n---", 3)
  if (end < 0) return {}
  const { metadata } = parseFrontmatterBlock(content.slice(3, end))
  return metadata
}
