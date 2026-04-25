import fs from "node:fs"
import path from "node:path"

export type CommandSource = "config" | "agent"

export type CustomCommandAsset = {
  name: string
  description: string
  prompt: string
  exec: string
  workDir: string
  source: CommandSource | string
}

export type CommandInvocation = {
  name: string
  args: string[]
}

export type CommandExecutionPlan = {
  commandName: string
  source: string
  action: "prompt" | "exec"
  content: string
  workDir: string | null
  requiresPermission: boolean
}

const COMMAND_DESCRIPTION_LIMIT = 60

export function normalizeCommandName(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-")
}

function displayDescription(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? ""
  const chars = Array.from(firstLine)
  if (chars.length <= COMMAND_DESCRIPTION_LIMIT) {
    return firstLine
  }
  return `${chars.slice(0, COMMAND_DESCRIPTION_LIMIT).join("")}...`
}

function cloneCommand(command: CustomCommandAsset): CustomCommandAsset {
  return { ...command }
}

function isUnsafeAgentCommandName(name: string): boolean {
  return name.includes("/") || name.includes("\\") || name.split(".").includes("..")
}

function resolveInsideDir(dir: string, fileName: string): string | null {
  const root = path.resolve(dir)
  const candidate = path.resolve(root, fileName)
  const relative = path.relative(root, candidate)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null
  }
  return candidate
}

function agentFileCandidates(name: string): string[] {
  const trimmed = name.trim().replace(/^\/+/, "")
  const withoutExtension = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed
  const values = new Set<string>([
    withoutExtension,
    withoutExtension.replaceAll("_", "-"),
    withoutExtension.replaceAll("-", "_"),
  ])
  return [...values].filter(Boolean).map((candidate) => `${candidate}.md`)
}

function splitCommandArgs(input: string): string[] {
  const args: string[] = []
  let current = ""
  let quote: "\"" | "'" | null = null
  let escaping = false

  for (const char of input) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === "\\") {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === "\"" || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (escaping) {
    current += "\\"
  }
  if (current.length > 0) {
    args.push(current)
  }
  return args
}

export function parseCommandInvocation(input: string): CommandInvocation | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }

  const [rawName, ...args] = splitCommandArgs(trimmed.slice(1))
  if (!rawName) {
    return null
  }

  return {
    name: rawName,
    args,
  }
}

export function expandCommandTemplate(template: string, args: readonly string[]): string {
  let foundPlaceholder = false
  const expanded = template.replace(/\{\{\s*(args|(\d+)(\*)?)(?::([^}]*))?\s*\}\}/g, (_match, token: string, position: string | undefined, star: string | undefined, defaultValue: string | undefined) => {
    foundPlaceholder = true

    if (token === "args") {
      const joined = args.join(" ")
      return joined || defaultValue || ""
    }

    const index = Number.parseInt(position ?? "0", 10) - 1
    if (Number.isNaN(index) || index < 0) {
      return defaultValue || ""
    }

    if (star) {
      const joined = args.slice(index).join(" ")
      return joined || defaultValue || ""
    }

    return args[index] ?? defaultValue ?? ""
  })

  if (!foundPlaceholder && args.length > 0) {
    return `${template}\n\n${args.join(" ")}`
  }

  return expanded
}

export class CommandAssetRegistry {
  private readonly configCommands = new Map<string, CustomCommandAsset>()
  private agentCommandDirs: string[] = []

  addCommand(command: CustomCommandAsset): CustomCommandAsset {
    const name = command.name.trim().replace(/^\/+/, "")
    if (!name) {
      throw new Error("command name is required")
    }

    const stored: CustomCommandAsset = {
      name,
      description: command.description,
      prompt: command.prompt,
      exec: command.exec,
      workDir: command.workDir,
      source: command.source || "config",
    }
    this.configCommands.set(normalizeCommandName(name), stored)
    return cloneCommand(stored)
  }

  removeCommand(name: string): boolean {
    return this.configCommands.delete(normalizeCommandName(name))
  }

  clearSource(source: string): number {
    let removed = 0
    for (const [key, command] of this.configCommands.entries()) {
      if (command.source === source) {
        this.configCommands.delete(key)
        removed += 1
      }
    }
    return removed
  }

  setAgentCommandDirs(dirs: readonly string[]): void {
    this.agentCommandDirs = [...dirs]
  }

  resolve(name: string): CustomCommandAsset | null {
    const cleaned = name.trim().replace(/^\/+/, "")
    const normalized = normalizeCommandName(cleaned)
    const configCommand = this.configCommands.get(normalized)
    if (configCommand) {
      return cloneCommand(configCommand)
    }

    if (!cleaned || isUnsafeAgentCommandName(cleaned)) {
      return null
    }

    for (const dir of this.agentCommandDirs) {
      const command = this.resolveAgentCommand(dir, cleaned)
      if (command) {
        return command
      }
    }

    return null
  }

  listAll(): CustomCommandAsset[] {
    const commands: CustomCommandAsset[] = []
    const seen = new Set<string>()

    for (const command of this.configCommands.values()) {
      commands.push(cloneCommand(command))
      seen.add(normalizeCommandName(command.name))
    }

    for (const dir of this.agentCommandDirs) {
      if (!fs.existsSync(dir)) {
        continue
      }

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) {
          continue
        }

        const name = entry.name.slice(0, -3)
        const normalized = normalizeCommandName(name)
        if (seen.has(normalized)) {
          continue
        }

        const command = this.resolveAgentCommand(dir, name)
        if (!command) {
          continue
        }

        commands.push(command)
        seen.add(normalized)
      }
    }

    return commands
  }

  createExecutionPlan(invocation: CommandInvocation): CommandExecutionPlan {
    const command = this.resolve(invocation.name)
    if (!command) {
      throw new Error(`command ${JSON.stringify(invocation.name)} not found`)
    }

    if (command.exec.trim()) {
      return {
        commandName: command.name,
        source: command.source,
        action: "exec",
        content: expandCommandTemplate(command.exec, invocation.args),
        workDir: command.workDir || null,
        requiresPermission: true,
      }
    }

    return {
      commandName: command.name,
      source: command.source,
      action: "prompt",
      content: expandCommandTemplate(command.prompt, invocation.args),
      workDir: null,
      requiresPermission: false,
    }
  }

  private resolveAgentCommand(dir: string, name: string): CustomCommandAsset | null {
    for (const fileName of agentFileCandidates(name)) {
      const filePath = resolveInsideDir(dir, fileName)
      if (!filePath || !fs.existsSync(filePath)) {
        continue
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        continue
      }
      const prompt = fs.readFileSync(filePath, "utf8")
      if (!prompt.trim()) {
        continue
      }

      return {
        name: path.basename(fileName, ".md"),
        description: displayDescription(prompt),
        prompt,
        exec: "",
        workDir: "",
        source: "agent",
      }
    }

    return null
  }
}
