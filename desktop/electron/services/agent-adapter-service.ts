import type { SynapseProviderEntry } from "../../src/types/provider"

export const CONTINUE_SESSION_ID = "__continue__"

export type AgentAdapterId =
  | "claudecode"
  | "codex"
  | "opencode"
  | "cursor"
  | "pi"
  | "gemini"
  | "kimi"

export type AgentAvailability = {
  adapter: AgentAdapterId
  command: string
  available: boolean
  resolvedPath?: string
  reason?: string
}

export type AgentLaunchSpec = {
  adapter: AgentAdapterId
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  resumeSessionId: string | null
}

export type AgentLaunchInput = {
  adapter: AgentAdapterId
  workDir?: string
  model?: string
  mode?: string
  reasoningEffort?: string
  sessionId?: string
  prompt?: string
  cliPath?: string
  cmd?: string
  cliArgsFlag?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  maxContextTokens?: number
  provider?: SynapseProviderEntry
  env?: Record<string, string>
}

export type CommandResolver = (command: string) => string | null | undefined

type AdapterDescriptor = {
  id: AgentAdapterId
  defaultCommand: string
}

const ADAPTERS: AdapterDescriptor[] = [
  { id: "claudecode", defaultCommand: "claude" },
  { id: "codex", defaultCommand: "codex" },
  { id: "opencode", defaultCommand: "opencode" },
  { id: "cursor", defaultCommand: "agent" },
  { id: "pi", defaultCommand: "pi" },
  { id: "gemini", defaultCommand: "gemini" },
  { id: "kimi", defaultCommand: "kimi" },
]

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function workDirOrDefault(workDir: string | undefined): string {
  return cleanString(workDir) ?? "."
}

function commandFor(input: AgentLaunchInput): { command: string; extraArgs: string[] } {
  if (input.adapter === "claudecode" && cleanString(input.cliPath)) {
    const parts = splitCommandLine(input.cliPath ?? "")
    return { command: parts[0] ?? "claude", extraArgs: parts.slice(1) }
  }

  return {
    command: cleanString(input.cmd) ?? ADAPTERS.find((adapter) => adapter.id === input.adapter)?.defaultCommand ?? input.adapter,
    extraArgs: [],
  }
}

function resumeSessionId(sessionId: string | undefined): string | null {
  const trimmed = cleanString(sessionId)
  return trimmed && trimmed !== CONTINUE_SESSION_ID ? trimmed : null
}

function normalizeClaudeMode(raw: string | undefined): string {
  switch (raw?.trim().toLowerCase()) {
    case "acceptedits":
    case "accept-edits":
    case "accept_edits":
    case "edit":
      return "acceptEdits"
    case "plan":
      return "plan"
    case "auto":
      return "auto"
    case "bypasspermissions":
    case "bypass-permissions":
    case "bypass_permissions":
    case "yolo":
      return "bypassPermissions"
    case "dontask":
    case "dont-ask":
    case "dont_ask":
      return "dontAsk"
    default:
      return "default"
  }
}

function normalizeClaudeEffort(raw: string | undefined): string | undefined {
  switch (raw?.trim().toLowerCase()) {
    case "low":
      return "low"
    case "medium":
    case "med":
      return "medium"
    case "high":
      return "high"
    case "max":
      return "max"
    default:
      return undefined
  }
}

function normalizeCodexMode(raw: string | undefined): string {
  switch (raw?.trim().toLowerCase()) {
    case "auto-edit":
    case "auto_edit":
    case "suggest":
      return "auto-edit"
    case "full-auto":
    case "full_auto":
    case "auto":
      return "full-auto"
    case "yolo":
    case "bypass":
    case "dangerously-bypass":
      return "yolo"
    default:
      return "suggest"
  }
}

function normalizeCodexEffort(raw: string | undefined): string | undefined {
  switch (raw?.trim().toLowerCase()) {
    case "low":
      return "low"
    case "medium":
    case "med":
      return "medium"
    case "high":
      return "high"
    case "xhigh":
    case "x-high":
    case "very-high":
      return "xhigh"
    default:
      return undefined
  }
}

function normalizeSimpleMode(adapter: AgentAdapterId, raw: string | undefined): string {
  const value = raw?.trim().toLowerCase()

  if (adapter === "cursor") {
    if (value === "force" || value === "yolo" || value === "auto") {
      return "force"
    }
    if (value === "plan" || value === "ask") {
      return value
    }
    return "default"
  }

  if (adapter === "gemini") {
    if (value === "yolo" || value === "auto" || value === "force" || value === "bypasspermissions") {
      return "yolo"
    }
    if (value === "auto_edit" || value === "autoedit" || value === "edit" || value === "acceptedits") {
      return "auto_edit"
    }
    if (value === "plan") {
      return "plan"
    }
    return "default"
  }

  if (adapter === "kimi") {
    if (value === "yolo" || value === "force" || value === "bypass" || value === "auto") {
      return "yolo"
    }
    if (value === "plan" || value === "quiet") {
      return value
    }
    return "default"
  }

  if (value === "yolo" || value === "auto" || value === "force" || value === "bypass" || value === "auto-approve") {
    return "yolo"
  }

  return "default"
}

function providerModel(input: AgentLaunchInput): string | undefined {
  return cleanString(input.provider?.model) ?? cleanString(input.model)
}

function providerEnv(input: AgentLaunchInput): Record<string, string> {
  return {
    ...input.provider?.env,
    ...input.env,
  }
}

function quoteConfigValue(value: string): string {
  return JSON.stringify(value)
}

function shellJoinArgs(args: readonly string[]): string {
  return args.map((arg) => {
    if (/^[A-Za-z0-9_./:=,@+-]+$/.test(arg)) {
      return arg
    }

    return `'${arg.replaceAll("'", "'\\''")}'`
  }).join(" ")
}

export function splitCommandLine(value: string): string[] {
  const parts: string[] = []
  let current = ""
  let quote: "'" | "\"" | null = null

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === "'" || char === "\"") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ""
      }
      continue
    }

    current += char
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

function buildClaudeSpec(input: AgentLaunchInput): AgentLaunchSpec {
  const { command, extraArgs } = commandFor(input)
  const cwd = workDirOrDefault(input.workDir)
  const mode = normalizeClaudeMode(input.mode)
  const effort = normalizeClaudeEffort(input.reasoningEffort ?? input.provider?.thinking)
  const resumeId = resumeSessionId(input.sessionId)
  const innerArgs = [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--permission-prompt-tool", "stdio",
    "--verbose",
  ]

  if (mode !== "default") {
    innerArgs.push("--permission-mode", mode)
  }
  if (resumeId) {
    innerArgs.push("--resume", resumeId)
  }
  if (input.allowedTools?.length) {
    innerArgs.push("--allowedTools", input.allowedTools.join(","))
  }
  if (input.disallowedTools?.length) {
    innerArgs.push("--disallowedTools", input.disallowedTools.join(","))
  }
  if (effort) {
    innerArgs.push("--effort", effort)
  }
  if (input.maxContextTokens && input.maxContextTokens > 0) {
    innerArgs.push("--max-context-tokens", String(input.maxContextTokens))
  }

  const outerArgs: string[] = []
  const model = providerModel(input)
  if (model) {
    outerArgs.push("--model", model)
  }

  const cliArgsFlag = cleanString(input.cliArgsFlag)
  const args = cliArgsFlag
    ? [...extraArgs, cliArgsFlag, shellJoinArgs(innerArgs), ...outerArgs]
    : [...extraArgs, ...innerArgs, ...outerArgs]

  return { adapter: "claudecode", command, args, cwd, env: providerEnv(input), resumeSessionId: resumeId }
}

function buildCodexSpec(input: AgentLaunchInput): AgentLaunchSpec {
  const { command } = commandFor(input)
  const cwd = workDirOrDefault(input.workDir)
  const resumeId = resumeSessionId(input.sessionId)
  const mode = normalizeCodexMode(input.mode)
  const effort = normalizeCodexEffort(input.reasoningEffort ?? input.provider?.thinking)
  const args = resumeId
    ? ["exec", "resume", "--skip-git-repo-check"]
    : ["exec", "--skip-git-repo-check"]

  if (mode === "auto-edit" || mode === "full-auto") {
    args.push("--full-auto")
  } else if (mode === "yolo") {
    args.push("--dangerously-bypass-approvals-and-sandbox")
  }

  const model = providerModel(input)
  if (model) {
    args.push("--model", model)
  }
  if (input.provider?.name) {
    args.push("-c", `model_provider=${quoteConfigValue(input.provider.name)}`)
  }
  if (input.provider?.baseUrl) {
    args.push("-c", `openai_base_url=${quoteConfigValue(input.provider.baseUrl)}`)
  }
  if (effort) {
    args.push("-c", `model_reasoning_effort=${quoteConfigValue(effort)}`)
  }

  if (resumeId) {
    args.push(resumeId, "--json", "-")
  } else {
    args.push("--json", "--cd", cwd, "-")
  }

  return { adapter: "codex", command, args, cwd, env: providerEnv(input), resumeSessionId: resumeId }
}

function buildSimpleSpec(input: AgentLaunchInput): AgentLaunchSpec {
  const { command } = commandFor(input)
  const cwd = workDirOrDefault(input.workDir)
  const resumeId = resumeSessionId(input.sessionId)
  const model = providerModel(input)
  const mode = normalizeSimpleMode(input.adapter, input.mode)
  const prompt = input.prompt ?? ""
  const args: string[] = []

  if (input.adapter === "cursor") {
    args.push("--print", "--output-format", "stream-json", "--trust")
    if (mode === "force") {
      args.push("--force")
    } else if (mode === "plan" || mode === "ask") {
      args.push("--mode", mode)
    }
    if (resumeId) {
      args.push("--resume", resumeId)
    }
    if (model) {
      args.push("--model", model)
    }
    args.push("--workspace", cwd, "--", prompt)
  } else if (input.adapter === "opencode") {
    args.push("run", "--format", "json")
    if (resumeId) {
      args.push("--session", resumeId)
    }
    if (model) {
      args.push("--model", model)
    }
    args.push("--dir", cwd, "--thinking", prompt)
  } else if (input.adapter === "pi") {
    args.push("--mode", "json", "-p")
    if (resumeId) {
      args.push("--session", resumeId)
    }
    if (model) {
      args.push("--model", model)
    }
    if (mode === "yolo") {
      args.push("--auto-approve")
    }
    const effort = cleanString(input.reasoningEffort ?? input.provider?.thinking)
    if (effort) {
      args.push("--thinking", effort)
    }
    args.push(prompt)
  } else if (input.adapter === "gemini") {
    args.push("--output-format", "stream-json")
    if (mode === "yolo") {
      args.push("-y")
    } else if (mode === "auto_edit" || mode === "plan") {
      args.push("--approval-mode", mode)
    }
    if (resumeId) {
      args.push("--resume", resumeId)
    }
    if (model) {
      args.push("-m", model)
    }
    args.push("-p", prompt)
  } else {
    args.push("--print", "--output-format", "stream-json")
    if (mode === "plan") {
      args.push("--plan")
    } else if (mode === "quiet") {
      args.push("--quiet")
    }
    if (resumeId) {
      args.push("--resume", resumeId)
    }
    if (model) {
      args.push("--model", model)
    }
    args.push("--work-dir", cwd, "--prompt", prompt)
  }

  return { adapter: input.adapter, command, args, cwd, env: providerEnv(input), resumeSessionId: resumeId }
}

export function buildAgentLaunchSpec(input: AgentLaunchInput): AgentLaunchSpec {
  if (input.adapter === "claudecode") {
    return buildClaudeSpec(input)
  }
  if (input.adapter === "codex") {
    return buildCodexSpec(input)
  }

  return buildSimpleSpec(input)
}

export function detectAgentAdapters(resolveCommand: CommandResolver): AgentAvailability[] {
  return ADAPTERS.map((adapter) => {
    const resolvedPath = resolveCommand(adapter.defaultCommand) ?? undefined

    return {
      adapter: adapter.id,
      command: adapter.defaultCommand,
      available: Boolean(resolvedPath),
      ...(resolvedPath ? { resolvedPath } : { reason: `${adapter.defaultCommand} CLI not found in PATH` }),
    }
  })
}
