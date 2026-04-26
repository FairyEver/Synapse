import type { ConversationEntryV1, ProviderModelEntryV1 } from "../../runtime/data-repo"
import type { ProviderConfigService } from "../provider-config"
import type {
  AgentEvent,
  AgentMessage,
  AgentRuntimeTurnResult,
} from "./types"

export interface AgentCommandRouterDeps {
  readonly projectId: string
  readonly agentType: string
  readonly providerConfig: ProviderConfigService
  resetSession(sessionKey: string, platform?: string): Promise<ConversationEntryV1 | null>
}

interface ParsedCommand {
  readonly name: string
  readonly args: readonly string[]
}

interface ModeOption {
  readonly key: string
  readonly label: string
}

export class AgentCommandRouter {
  private readonly deps: AgentCommandRouterDeps

  constructor(deps: AgentCommandRouterDeps) {
    this.deps = deps
  }

  async handle(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult | null> {
    const parsed = parseCommand(message.content)
    if (!parsed) return null

    switch (parsed.name) {
      case "/model":
        return this.handleModel(message, conversation, parsed.args)
      case "/mode":
        return this.handleMode(message, conversation, parsed.args)
      case "/new":
        return this.handleNew(message, conversation)
      case "/status":
        return this.handleStatus(conversation)
      default:
        return commandResult(conversation.id, `Unsupported command: ${parsed.name}`, true)
    }
  }

  private async handleModel(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    args: readonly string[],
  ): Promise<AgentRuntimeTurnResult> {
    const state = await this.deps.providerConfig.getProjectProviderState(
      this.deps.projectId,
      this.deps.agentType,
    )
    if (args.length === 0) {
      return commandResult(conversation.id, formatModelList(state.activeModel, state.activeProvider?.models ?? []))
    }

    const targetInput = parseModelSwitchArgs(args)
    if (!targetInput) {
      return commandResult(conversation.id, modelUsage(), true)
    }

    const target = resolveModelTarget(targetInput, state.activeProvider?.models ?? [])
    await this.deps.providerConfig.setActiveModel(this.deps.projectId, target, this.deps.agentType)
    const reset = await this.deps.resetSession(message.sessionKey, message.platform)
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
    const modes = modesForAgent(this.deps.agentType)
    const state = await this.deps.providerConfig.getProjectProviderState(
      this.deps.projectId,
      this.deps.agentType,
    )
    if (args.length === 0) {
      return commandResult(conversation.id, formatModeList(state.activeMode, modes))
    }

    const target = resolveModeTarget(args[0] ?? "", modes)
    if (!target) {
      return commandResult(conversation.id, modeUsage(modes), true)
    }

    await this.deps.providerConfig.setActiveMode(this.deps.projectId, target, this.deps.agentType)
    const reset = await this.deps.resetSession(message.sessionKey, message.platform)
    return commandResult(
      reset?.id ?? conversation.id,
      `Mode changed: ${target}`,
      false,
      reset?.agentSessionId,
    )
  }

  private async handleNew(
    message: AgentMessage,
    conversation: ConversationEntryV1,
  ): Promise<AgentRuntimeTurnResult> {
    const reset = await this.deps.resetSession(message.sessionKey, message.platform)
    return commandResult(
      reset?.id ?? conversation.id,
      "New session will start on the next message.",
      false,
      reset?.agentSessionId,
    )
  }

  private async handleStatus(conversation: ConversationEntryV1): Promise<AgentRuntimeTurnResult> {
    const state = await this.deps.providerConfig.getProjectProviderState(
      this.deps.projectId,
      this.deps.agentType,
    )
    const lines = [
      `Agent: ${this.deps.agentType}`,
      `Provider: ${state.activeProvider?.id ?? "default"}`,
      `Model: ${state.activeModel ?? "default"}`,
      `Mode: ${state.activeMode ?? "default"}`,
      `Conversation: ${conversation.id}`,
      `Agent session: ${conversation.agentSessionId ?? "none"}`,
    ]
    return commandResult(conversation.id, lines.join("\n"), false, conversation.agentSessionId)
  }
}

export function parseCommand(content: string): ParsedCommand | null {
  const trimmed = content.trim()
  if (!trimmed.startsWith("/")) return null
  const [rawName, ...args] = trimmed.split(/\s+/)
  if (!rawName || rawName === "/") return null
  return {
    name: rawName.toLowerCase(),
    args,
  }
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
  models: readonly ProviderModelEntryV1[],
): string {
  const trimmed = input.trim()
  const index = Number.parseInt(trimmed, 10)
  if (Number.isInteger(index) && String(index) === trimmed && index >= 1 && index <= models.length) {
    return models[index - 1]?.id ?? trimmed
  }
  const alias = models.find((model) =>
    model.alias && model.alias.toLowerCase() === trimmed.toLowerCase())
  if (alias) return alias.id
  const exact = models.find((model) => model.id.toLowerCase() === trimmed.toLowerCase())
  return exact?.id ?? trimmed
}

export function modesForAgent(agentType: string): readonly ModeOption[] {
  if (normalizeAgentType(agentType) === "claude-code") {
    return [
      { key: "default", label: "Default" },
      { key: "acceptEdits", label: "Accept Edits" },
      { key: "plan", label: "Plan" },
      { key: "auto", label: "Auto" },
      { key: "bypassPermissions", label: "Bypass Permissions" },
      { key: "dontAsk", label: "Don't Ask" },
    ]
  }
  return [
    { key: "suggest", label: "Suggest" },
    { key: "auto-edit", label: "Auto Edit" },
    { key: "full-auto", label: "Full Auto" },
    { key: "yolo", label: "YOLO" },
  ]
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

function formatModelList(
  current: string | undefined,
  models: readonly ProviderModelEntryV1[],
): string {
  const lines = [`Current model: ${current ?? "default"}`, "Models:"]
  if (models.length === 0) {
    lines.push("- No models configured")
  } else {
    for (let index = 0; index < models.length; index += 1) {
      const model = models[index]
      if (!model) continue
      const alias = model.alias ? ` (${model.alias})` : ""
      const marker = model.id === current ? "*" : "-"
      lines.push(`${marker} ${index + 1}. ${model.id}${alias}`)
    }
  }
  lines.push(modelUsage())
  return lines.join("\n")
}

function formatModeList(current: string | undefined, modes: readonly ModeOption[]): string {
  const lines = [`Current mode: ${current ?? "default"}`, "Modes:"]
  for (let index = 0; index < modes.length; index += 1) {
    const mode = modes[index]
    if (!mode) continue
    const marker = mode.key === current ? "*" : "-"
    lines.push(`${marker} ${index + 1}. ${mode.key} - ${mode.label}`)
  }
  lines.push(modeUsage(modes))
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

