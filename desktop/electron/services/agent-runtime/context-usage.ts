import type {
  AgentContextWindowConfigurationSource,
  AgentModelContextReference,
} from "../model-capability/catalog"
import type { AgentContextUsage } from "./types"

type UsageBreakdown = {
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
  readonly outputTokens: number
}

type TokenField =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "valid"; readonly value: number }

const USAGE_FIELDS = {
  inputTokens: "input_tokens",
  cacheReadTokens: "cache_read_input_tokens",
  cacheCreationTokens: "cache_creation_input_tokens",
  outputTokens: "output_tokens",
} as const

export class AgentContextUsageTracker {
  private readonly modelContext: AgentModelContextReference | undefined
  private readonly contextWindowConfigurationSource: AgentContextWindowConfigurationSource | undefined
  private currentModel: string | undefined
  private contextWindowTokens: number | undefined
  private breakdown: UsageBreakdown | undefined
  private snapshot: AgentContextUsage | undefined

  constructor(input: {
    readonly modelContext?: AgentModelContextReference
    readonly contextWindowConfigurationSource?: AgentContextWindowConfigurationSource
  } = {}) {
    this.modelContext = input.modelContext
    this.contextWindowConfigurationSource = input.contextWindowConfigurationSource
  }

  update(message: unknown): AgentContextUsage | undefined {
    const raw = recordValue(message)
    if (!raw) return undefined

    if (raw.parent_tool_use_id !== null && raw.parent_tool_use_id !== undefined) {
      return undefined
    }

    if (raw.type === "result") {
      this.confirmContextWindow(raw.modelUsage)
      return this.snapshot
    }

    if (raw.type === "system" && raw.subtype === "init") {
      this.setModel(stringValue(raw.model))
      return undefined
    }

    if (raw.type === "assistant") {
      const assistantMessage = recordValue(raw.message)
      this.setModel(stringValue(assistantMessage?.model))
      return this.updateFromUsage(assistantMessage?.usage, false)
    }

    if (raw.type === "stream_event") {
      const event = recordValue(raw.event)
      if (event?.type === "message_start") {
        const streamMessage = recordValue(event.message)
        this.setModel(stringValue(streamMessage?.model))
        return this.updateFromUsage(streamMessage?.usage, false)
      }
      if (event?.type === "message_delta") {
        return this.updateFromUsage(event.usage, true)
      }
      return undefined
    }

    if (raw.type === "system" && raw.subtype === "compact_boundary") {
      this.breakdown = undefined
      this.contextWindowTokens = undefined
      this.snapshot = undefined
      return undefined
    }

    return undefined
  }

  replaceFromContextUsage(value: unknown): AgentContextUsage | undefined {
    const contextUsage = recordValue(value)
    const usedTokens = tokenNumber(contextUsage?.totalTokens)
    const contextWindowTokens = tokenNumber(contextUsage?.maxTokens)
    if (usedTokens === undefined || contextWindowTokens === undefined || contextWindowTokens === 0) {
      return undefined
    }
    const model = stringValue(contextUsage?.model)
    if (model) this.currentModel = model
    this.breakdown = undefined
    this.contextWindowTokens = contextWindowTokens
    return this.setUsedTokens(usedTokens)
  }

  private setModel(model: string | undefined): void {
    if (!model || model === this.currentModel) return
    this.currentModel = model
    this.contextWindowTokens = undefined
    if (this.snapshot) {
      this.snapshot = {
        usedTokens: this.snapshot.usedTokens,
        model,
        ...this.referenceMetadata(),
      }
    }
  }

  private updateFromUsage(value: unknown, mergeMissingFields: boolean): AgentContextUsage | undefined {
    const usage = recordValue(value)
    if (!usage) return undefined
    const iteration = lastIterationBreakdown(usage.iterations)
    const breakdown = iteration ?? usageBreakdown(
      usage,
      mergeMissingFields ? this.breakdown : undefined,
    )
    if (!breakdown) return undefined
    const usedTokens = sumBreakdown(breakdown)
    if (usedTokens === undefined) return undefined
    this.breakdown = breakdown
    return this.setUsedTokens(usedTokens)
  }

  private setUsedTokens(usedTokens: number): AgentContextUsage {
    this.snapshot = {
      usedTokens,
      ...(this.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: this.contextWindowTokens }),
      ...(this.currentModel ? { model: this.currentModel } : {}),
      ...this.referenceMetadata(),
    }
    return this.snapshot
  }

  private confirmContextWindow(value: unknown): void {
    const modelUsage = recordValue(value)
    if (!modelUsage) return
    const candidates = Object.entries(modelUsage).flatMap(([model, entry]) => {
      const contextWindow = tokenNumber(recordValue(entry)?.contextWindow)
      return contextWindow !== undefined && contextWindow > 0
        ? [{ model, contextWindow }]
        : []
    })
    const selected = candidates.find((candidate) => candidate.model === this.currentModel)
      ?? (candidates.length === 1 ? candidates[0] : undefined)
    if (!selected) {
      this.contextWindowTokens = undefined
      if (this.snapshot) {
        this.snapshot = {
          usedTokens: this.snapshot.usedTokens,
          ...(this.currentModel ? { model: this.currentModel } : {}),
          ...this.referenceMetadata(),
        }
      }
      return
    }
    if (!this.currentModel) this.currentModel = selected.model
    this.contextWindowTokens = selected.contextWindow
    if (this.snapshot) this.setUsedTokens(this.snapshot.usedTokens)
  }

  private referenceMetadata(): Pick<
    AgentContextUsage,
    "modelContext" | "contextWindowConfigurationSource"
  > {
    return {
      ...(this.modelContext ? { modelContext: this.modelContext } : {}),
      ...(this.contextWindowConfigurationSource
        ? { contextWindowConfigurationSource: this.contextWindowConfigurationSource }
        : {}),
    }
  }
}

function lastIterationBreakdown(value: unknown): UsageBreakdown | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const last = recordValue(value.at(-1))
  return last ? usageBreakdown(last) : undefined
}

function usageBreakdown(
  usage: Record<string, unknown>,
  previous?: UsageBreakdown,
): UsageBreakdown | undefined {
  const fields = Object.entries(USAGE_FIELDS).map(([key, sdkKey]) => [
    key as keyof UsageBreakdown,
    tokenField(usage[sdkKey]),
  ] as const)
  if (fields.some(([, field]) => field.status === "invalid")) return undefined
  if (fields.every(([, field]) => field.status === "missing")) return undefined
  return Object.fromEntries(fields.map(([key, field]) => [
    key,
    field.status === "valid" ? field.value : previous?.[key] ?? 0,
  ])) as UsageBreakdown
}

function sumBreakdown(value: UsageBreakdown): number | undefined {
  const total = value.inputTokens
    + value.cacheReadTokens
    + value.cacheCreationTokens
    + value.outputTokens
  return Number.isSafeInteger(total) && total >= 0 ? total : undefined
}

function tokenField(value: unknown): TokenField {
  if (value === null || value === undefined) return { status: "missing" }
  const token = tokenNumber(value)
  return token === undefined
    ? { status: "invalid" }
    : { status: "valid", value: token }
}

function tokenNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}
