export interface TokenUsageField {
  readonly label: string
  readonly value: number
}

const TOKEN_USAGE_DEFINITIONS: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
  { label: "输入", keys: ["input_tokens", "inputTokens"] },
  { label: "输出", keys: ["output_tokens", "outputTokens"] },
  { label: "缓存读", keys: ["cache_read_input_tokens", "cacheReadInputTokens", "cacheRead"] },
  { label: "缓存写", keys: ["cache_creation_input_tokens", "cacheCreationInputTokens", "cacheWrite"] },
]

const tokenNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
})

export function tokenUsageFields(usage: Record<string, unknown> | undefined): readonly TokenUsageField[] | undefined {
  if (!usage) return undefined
  const fields = TOKEN_USAGE_DEFINITIONS.map((definition) => ({
    label: definition.label,
    value: tokenNumber(usage, definition.keys),
  }))
  if (!fields.some((field) => field.value !== undefined)) return undefined
  return fields.map((field) => ({ label: field.label, value: field.value ?? 0 }))
}

export function formatTokenUsageValue(value: number): string {
  return tokenNumberFormatter.format(value)
}

function tokenNumber(usage: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = usage[key]
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value)
  }
  return undefined
}
