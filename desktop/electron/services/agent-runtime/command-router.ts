import type { AgentCommandEntryV1, ConversationEntryV1 } from "../../runtime/data-repo"
import type { StructuredLogger } from "../../runtime/logging"
import { isShellKind, type ShellKind } from "../shell-exec"
import type { CCProvider, ProviderService } from "../provider"
import { agentRuntimeDefinitionById } from "../definitions/generated/main-registry"
import { errorCode } from "../error-utils"
import type {
  AgentEvent,
  AgentMessage,
  AgentRuntimeTurnResult,
} from "./types"
import {
  BUILTIN_COMMANDS,
  commandAllowedOnPlatform,
  expandCustomCommandPrompt,
  normalizeCommandName,
  type CustomCommandRegistry,
  type PublishedAgentCommand,
} from "./command-registry"
import {
  buildSkillInvocationPrompt,
  type SkillRegistry,
} from "./skill-registry"

export interface AgentCommandRouterDeps {
  readonly projectId: string
  readonly agentType: string
  resolveAgentType?(): Promise<string> | string
  readonly providerService: ProviderService
  readonly registeredPromptCommands?: readonly RegisteredPromptCommand[]
  readonly agentNativeSlashAllowlist?: readonly string[]
  readonly unknownSlashBehavior?: "reject" | "passthrough"
  readonly customCommands?: CustomCommandRegistry
  readonly skills?: SkillRegistry
  readonly logger?: Pick<StructuredLogger, "warn">
  listCommands?(message: AgentMessage): Promise<readonly PublishedAgentCommand[]>
  runCustomCommand?(
    command: AgentCommandEntryV1,
    args: readonly string[],
    message: AgentMessage,
  ): Promise<string>
  compressSession?(message: AgentMessage, conversation: ConversationEntryV1): Promise<AgentRuntimeTurnResult>
  resetSession(message: AgentMessage): Promise<ConversationEntryV1 | null>
  setPermissionMode?(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    mode: string,
  ): Promise<ConversationEntryV1>
  showReference?(message: AgentMessage, args: readonly string[]): Promise<string>
}

interface ParsedCommand {
  readonly name: string
  readonly args: readonly string[]
}

export interface RegisteredPromptCommand {
  readonly name: string
  buildPrompt(args: readonly string[], message: AgentMessage): Promise<string> | string
}

export interface AgentPromptCommandRoute {
  readonly kind: "prompt"
  readonly content: string
}

export type AgentCommandRouterResult = AgentRuntimeTurnResult | AgentPromptCommandRoute

interface ModeOption {
  readonly key: string
  readonly label: string
}

interface ModelOption {
  readonly id: string
  readonly aliases: readonly string[]
}

export class AgentCommandRouter {
  private readonly deps: AgentCommandRouterDeps

  constructor(deps: AgentCommandRouterDeps) {
    this.deps = deps
  }

  async handle(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentCommandRouterResult | null> {
    const parsed = parseCommand(message.content)
    if (!parsed) return null

    switch (parsed.name) {
      case "/model":
        return this.handleModel(message, conversation, parsed.args)
      case "/mode":
        return this.handleMode(message, conversation, parsed.args)
      case "/new":
        return this.handleNew(message, conversation)
      case "/show":
        return this.handleShow(message, conversation, parsed.args)
      case "/compress":
        return this.handleCompress(message, conversation)
      case "/commands":
        return this.handleCommands(message, conversation, parsed.args)
      case "/skills":
        return this.handleSkills(conversation)
      case "/status":
        return this.handleStatus(conversation)
      default:
        return this.handleNonBuiltin(message, conversation, parsed)
    }
  }

  private async handleNonBuiltin(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    parsed: ParsedCommand,
  ): Promise<AgentCommandRouterResult | null> {
    const name = commandName(parsed.name)
    const promptCommand = this.deps.registeredPromptCommands?.find((command) =>
      command.name.toLowerCase() === name)
    if (promptCommand) {
      return {
        kind: "prompt",
        content: await Promise.resolve(promptCommand.buildPrompt(parsed.args, message)),
      }
    }

    const customCommand = await this.deps.customCommands?.resolve(name)
    if (customCommand) {
      if (!customCommand.enabled) {
        return commandResult(conversation.id, `Command is disabled: /${name}`, true)
      }
      if (!commandAllowedOnPlatform(customCommand, message.platform)) {
        return commandResult(conversation.id, `Command is not available on ${message.platform}.`, true)
      }
      if (customCommand.kind === "prompt") {
        return {
          kind: "prompt",
          content: expandCustomCommandPrompt(customCommand, parsed.args, message),
        }
      }
      if (!isMessageAdmin(message) && customCommand.adminOnly) {
        return commandResult(conversation.id, `Command requires admin: /${name}`, true)
      }
      if (!this.deps.runCustomCommand) {
        return commandResult(conversation.id, "Command execution is unavailable.", true)
      }
      const content = await this.deps.runCustomCommand(customCommand, parsed.args, message)
      return commandResult(conversation.id, content)
    }

    const skill = await this.deps.skills?.resolve(name)
    if (skill) {
      return {
        kind: "prompt",
        content: buildSkillInvocationPrompt(skill, parsed.args),
      }
    }

    const allowlist = this.deps.agentNativeSlashAllowlist ?? []
    if (allowlist.some((allowed) => allowed.toLowerCase() === name)) {
      return null
    }

    if (this.deps.unknownSlashBehavior === "passthrough") {
      return null
    }

    return commandResult(conversation.id, `Unsupported command: ${parsed.name}`, true)
  }

  private async handleModel(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    args: readonly string[],
  ): Promise<AgentRuntimeTurnResult> {
    const provider = await this.currentProviderForConversation(conversation, "/model")
    const models = modelOptionsForProvider(provider)
    if (args.length === 0) {
      return commandResult(conversation.id, formatModelList(provider?.model, models))
    }

    const targetInput = parseModelSwitchArgs(args)
    if (!targetInput) {
      return commandResult(conversation.id, modelUsage(), true)
    }
    if (!provider) {
      return commandResult(
        conversation.id,
        conversation.providerId
          ? `Provider not found: ${conversation.providerId}`
          : "No active provider configured.",
        true,
      )
    }

    const target = resolveModelTarget(targetInput, models)
    await this.deps.providerService.updateProvider(provider.id, { model: target })
    const reset = await this.deps.resetSession(message)
    return commandResult(
      reset?.id ?? conversation.id,
      `Model changed: ${target}`,
      false,
      reset?.agentSessionId,
    )
  }

  private async handleMode(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    args: readonly string[],
  ): Promise<AgentRuntimeTurnResult> {
    const agentType = await this.resolveAgentType()
    const modes = modesForAgent(agentType)
    if (args.length === 0) {
      return commandResult(conversation.id, formatModeList(conversation.agentConfig?.mode, modes))
    }

    const target = resolveModeTarget(args[0] ?? "", modes)
    if (!target) {
      return commandResult(conversation.id, modeUsage(modes), true)
    }

    if (requiresModeConfirmation(target)) {
      return commandResult(conversation.id, "请使用权限模式选择器确认切换。", true)
    }
    if (!this.deps.setPermissionMode) {
      return commandResult(conversation.id, "当前会话不支持切换权限模式", true)
    }
    const updated = await this.deps.setPermissionMode(message, conversation, target)
    return commandResult(
      updated.id,
      `Mode changed: ${target}`,
      false,
      updated.agentSessionId,
    )
  }

  private async handleNew(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult> {
    const reset = await this.deps.resetSession(message)
    return commandResult(
      reset?.id ?? conversation.id,
      "New session will start on the next message.",
      false,
      reset?.agentSessionId,
    )
  }

  private async handleStatus(conversation: ConversationEntryV1): Promise<AgentRuntimeTurnResult> {
    const agentType = await this.resolveAgentType()
    const provider = await this.currentProviderForConversation(conversation, "/status")
    const lines = [
      `Agent: ${agentType}`,
      `Provider: ${provider?.id ?? conversation.providerId ?? "default"}`,
      `Model: ${provider?.model ?? "default"}`,
      `Mode: ${conversation.agentConfig?.mode ?? "default"}`,
      `Conversation: ${conversation.id}`,
      `Agent session: ${conversation.agentSessionId ?? "none"}`,
    ]
    return commandResult(conversation.id, lines.join("\n"), false, conversation.agentSessionId)
  }

  private async currentProviderForConversation(
    conversation: ConversationEntryV1,
    command: string,
  ): Promise<CCProvider | null> {
    if (conversation.providerId) {
      try {
        return await this.deps.providerService.getProvider(conversation.providerId)
      } catch (error) {
        this.deps.logger?.warn("Agent command provider lookup failed.", {
          projectId: this.deps.projectId,
          conversationId: conversation.id,
          sessionKey: conversation.sessionKey,
          agentType: conversation.agentType ?? this.deps.agentType,
          providerId: conversation.providerId,
          command,
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode: errorCode(error),
          error: errorMessage(error),
        })
        return null
      }
    }
    return this.deps.providerService.getActiveProvider()
  }

  private async resolveAgentType(): Promise<string> {
    return Promise.resolve(this.deps.resolveAgentType?.() ?? this.deps.agentType)
  }

  private async handleCommands(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    args: readonly string[],
  ): Promise<AgentRuntimeTurnResult> {
    const subCommand = (args[0] ?? "list").toLowerCase()
    if (subCommand === "list" || subCommand === "ls" || args.length === 0) {
      const commands = await this.listCommandsForMessage(message)
      return commandResult(conversation.id, formatPublishedCommands(commands))
    }
    if (subCommand === "add") {
      const name = args[1]
      const prompt = args.slice(2).join(" ")
      if (!name || !prompt.trim()) return commandResult(conversation.id, "Use /commands add <name> <prompt>.", true)
      const command = await this.deps.customCommands?.addPrompt({
        name,
        prompt,
        createdBy: message.userId,
      })
      if (!command) return commandResult(conversation.id, "Command registry is unavailable.", true)
      return commandResult(conversation.id, `Command saved: /${command.name}`)
    }
    if (subCommand === "addexec") {
      if (!isMessageAdmin(message)) {
        return commandResult(conversation.id, "Only admins can add exec commands.", true)
      }
      const parsed = parseAddExecArgs(args.slice(1))
      if (!parsed) {
        return commandResult(
          conversation.id,
          "Use /commands addexec [--shell posix|cmd|powershell] [--work-dir dir] <name> <command>.",
          true,
        )
      }
      const command = await this.deps.customCommands?.addExec({
        name: parsed.name,
        exec: parsed.exec,
        shell: parsed.shell,
        workDir: parsed.workDir,
        createdBy: message.userId,
      })
      if (!command) return commandResult(conversation.id, "Command registry is unavailable.", true)
      return commandResult(conversation.id, `Exec command saved: /${command.name}`)
    }
    if (["delete", "del", "remove", "rm"].includes(subCommand)) {
      if (!isMessageAdmin(message)) {
        return commandResult(conversation.id, "Only admins can delete commands.", true)
      }
      const name = args[1]
      if (!name) return commandResult(conversation.id, "Use /commands delete <name>.", true)
      const removed = await this.deps.customCommands?.remove(name)
      return commandResult(conversation.id, removed ? `Command deleted: /${normalizeCommandName(name)}` : `Command not found: /${normalizeCommandName(name)}`, !removed)
    }
    return commandResult(conversation.id, "Use /commands list|add|addexec|delete.", true)
  }

  private async handleSkills(conversation: ConversationEntryV1): Promise<AgentRuntimeTurnResult> {
    const skills = await this.deps.skills?.list()
    if (!skills || skills.length === 0) return commandResult(conversation.id, "No skills found.")
    return commandResult(
      conversation.id,
      skills.map((skill) => `/${skill.name}${skill.description ? ` - ${skill.description}` : ""}`).join("\n"),
    )
  }

  private async handleShow(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    args: readonly string[],
  ): Promise<AgentRuntimeTurnResult> {
    if (!this.deps.showReference) {
      return commandResult(conversation.id, "/show is unavailable.", true)
    }
    try {
      const content = await this.deps.showReference(message, args)
      return commandResult(conversation.id, content)
    } catch (error) {
      this.deps.logger?.warn("Agent command show reference failed.", {
        projectId: this.deps.projectId,
        conversationId: conversation.id,
        sessionKey: conversation.sessionKey,
        agentType: conversation.agentType ?? this.deps.agentType,
        messageId: message.messageId,
        userId: message.userId,
        command: "/show",
        argsCount: args.length,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: errorCode(error),
        error: errorMessage(error),
      })
      return commandResult(
        conversation.id,
        errorMessage(error),
        true,
      )
    }
  }

  private async handleCompress(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult> {
    if (!this.deps.compressSession) {
      return commandResult(conversation.id, "/compress is unavailable.", true)
    }
    return this.deps.compressSession(message, conversation)
  }

  private async listCommandsForMessage(
    message: AgentMessage,
  ): Promise<readonly PublishedAgentCommand[]> {
    if (this.deps.listCommands) return this.deps.listCommands(message)
    const custom = await this.deps.customCommands?.listPublished() ?? []
    const skills = await this.deps.skills?.listPublished() ?? []
    return [...BUILTIN_COMMANDS, ...custom, ...skills]
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return truncateRunes(
    message
      .replace(/[A-Za-z]:\\[^\s'"`]+/g, "[path redacted]")
      .replace(/(?:[A-Za-z]:)?\/[^\s'"`]+/g, "[path redacted]")
      .replace(
        /\b(token|secret|api[_-]?key|apikey|authorization|cookie|password|credential)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s'",`;]+)/gi,
        "$1$2[redacted]",
      ),
    240,
  )
}

function truncateRunes(value: string, maxLength: number): string {
  return [...value].slice(0, maxLength).join("")
}

export function parseCommand(content: string): ParsedCommand | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith("/")) return null
  const [rawName, ...args] = splitCommandLine(trimmed)
  if (!rawName || rawName === "/") return null
  return {
    name: rawName.toLowerCase(),
    args,
  }
}

export function splitCommandLine(content: string): string[] {
  const values: string[] = []
  let current = ""
  let quote: "\"" | "'" | undefined
  let escaping = false
  for (const char of content) {
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
        quote = undefined
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
      if (current) {
        values.push(current)
        current = ""
      }
      continue
    }
    current += char
  }
  if (escaping) current += "\\"
  if (current) values.push(current)
  return values
}

function commandName(name: string): string {
  return name.startsWith("/") ? name.slice(1).toLowerCase() : name.toLowerCase()
}

function parseAddExecArgs(args: readonly string[]): {
  readonly name: string
  readonly exec: string
  readonly shell?: ShellKind
  readonly workDir?: string
} | null {
  let shell: ShellKind | undefined
  let workDir: string | undefined
  const rest: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value === "--shell") {
      const next = args[index + 1]?.toLowerCase()
      if (!isShellKind(next)) return null
      shell = next
      index += 1
      continue
    }
    if (value === "--work-dir") {
      workDir = args[index + 1]
      index += 1
      continue
    }
    if (value) rest.push(value)
  }
  const [name, ...command] = rest
  if (!name || command.length === 0) return null
  return { name, exec: command.join(" "), shell, workDir }
}

function formatPublishedCommands(commands: readonly PublishedAgentCommand[]): string {
  if (commands.length === 0) return "No commands found."
  return commands
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((command) => {
      const marker = command.kind === "exec" ? "exec" : command.source
      return `/${command.name} [${marker}]${command.description ? ` - ${command.description}` : ""}`
    })
    .join("\n")
}

function isMessageAdmin(message: AgentMessage): boolean {
  if (message.platform === "local-renderer" || message.platform === "local") return true
  const ctx = typeof message.replyCtx === "object" && message.replyCtx !== null
    ? message.replyCtx as Record<string, unknown>
    : undefined
  return ctx?.isAdmin === true
}

export function parseModelSwitchArgs(args: readonly string[]): string | null {
  if (args.length === 0) return null
  if (args.length === 1) {
    const value = args[0]?.trim() ?? ""
    return value.toLowerCase() === "switch" || value === "" ? null : value
  }
  if ((args[0] ?? "").trim().toLowerCase() === "switch") {
    const value = args[1]?.trim() ?? ""
    return value === "" ? null : value
  }
  return null
}

export function resolveModelTarget(
  input: string,
  models: readonly ModelOption[],
): string {
  const trimmed = input.trim()
  const index = Number.parseInt(trimmed, 10)
  if (Number.isInteger(index) && String(index) === trimmed && index >= 1 && index <= models.length) {
    return models[index - 1]?.id ?? trimmed
  }
  const alias = models.find((model) =>
    model.aliases.some((value) => value.toLowerCase() === trimmed.toLowerCase()))
  if (alias) return alias.id
  const exact = models.find((model) => model.id.toLowerCase() === trimmed.toLowerCase())
  return exact?.id ?? trimmed
}

export function modesForAgent(agentType: string): readonly ModeOption[] {
  const normalized = normalizeAgentType(agentType)
  const definition = agentRuntimeDefinitionById.get(normalized)
  if (!definition) {
    throw new Error(`Unknown agent runtime: ${agentType}`)
  }
  return definition.modes
}

function resolveModeTarget(input: string, modes: readonly ModeOption[]): string | null {
  const trimmed = input.trim()
  const index = Number.parseInt(trimmed, 10)
  if (Number.isInteger(index) && String(index) === trimmed && index >= 1 && index <= modes.length) {
    return modes[index - 1]?.key ?? null
  }
  const exact = modes.find((mode) => mode.key.toLowerCase() === trimmed.toLowerCase())
  return exact?.key ?? null
}

function requiresModeConfirmation(mode: string): boolean {
  return mode === "auto" || mode === "bypassPermissions"
}

function formatModelList(
  current: string | undefined,
  models: readonly ModelOption[],
): string {
  const lines = [`Current model: ${current ?? "default"}`, "Models:"]
  if (models.length === 0) {
    lines.push("- No models configured")
  } else {
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index]
      if (!model) continue
      const alias = model.aliases.length > 0 ? ` (${model.aliases.join(", ")})` : ""
      const marker = model.id === current ? "*" : "-"
      lines.push(`${marker} ${index + 1}. ${model.id}${alias}`)
    }
  }
  lines.push(modelUsage())
  return lines.join("\n")
}

function modelOptionsForProvider(provider: CCProvider | null): readonly ModelOption[] {
  if (!provider) return []
  const options = new Map<string, string[]>()
  addModelOption(options, provider.model, [])
  addModelOption(options, provider.haikuModel, ["haiku"])
  addModelOption(options, provider.sonnetModel, ["sonnet"])
  addModelOption(options, provider.opusModel, ["opus"])
  return [...options.entries()].map(([id, aliases]) => ({ id, aliases }))
}

function addModelOption(
  options: Map<string, string[]>,
  id: string | undefined,
  aliases: readonly string[],
): void {
  if (!id) return
  const current = options.get(id) ?? []
  for (const alias of aliases) {
    if (!current.includes(alias)) current.push(alias)
  }
  options.set(id, current)
}

function formatModeList(current: string | undefined, modes: readonly ModeOption[]): string {
  const lines = [`Current mode: ${current ?? "default"}`, "Modes:"]
  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index]
    if (!mode) continue
    const marker = mode.key === current ? "*" : "-"
    lines.push(`${marker} ${index + 1}. ${mode.key} - ${mode.label}`)
  }
  return lines.join("\n")
}

function modelUsage(): string {
  return "Use /model <model> or /model switch <model-or-index>."
}

function modeUsage(modes: readonly ModeOption[]): string {
  return `Use /mode ${modes.map((mode) => mode.key).join(" | ")}.`
}

function commandResult(
  conversationId: string,
  content: string,
  isError = false,
  agentSessionId?: string,
): AgentRuntimeTurnResult {
  const event: AgentEvent = isError
    ? { type: "error", message: content }
    : { type: "result", content, done: true, agentSessionId, threadId: agentSessionId }
  return {
    conversationId,
    events: [event],
    resultText: isError ? "" : content,
    agentSessionId,
    threadId: agentSessionId,
    error: isError ? content : undefined,
  }
}

function normalizeAgentType(agentType: string): string {
  const normalized = agentType.trim().toLowerCase().replace(/_/g, "-")
  if (normalized === "claudecode") return "claude-code"
  return normalized
}
