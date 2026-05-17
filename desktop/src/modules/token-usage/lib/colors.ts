const PROVIDER_COLOR_TOKENS: Record<string, { className: string; variable: string }> = {
  anthropic: { className: "bg-chart-1", variable: "var(--chart-1)" },
  openai: { className: "bg-chart-2", variable: "var(--chart-2)" },
  google: { className: "bg-chart-3", variable: "var(--chart-3)" },
  deepseek: { className: "bg-chart-4", variable: "var(--chart-4)" },
  xai: { className: "bg-chart-5", variable: "var(--chart-5)" },
  meta: { className: "bg-muted-foreground", variable: "var(--muted-foreground)" },
  unknown: { className: "bg-muted", variable: "var(--muted)" },
}

function getProviderColorToken(providerId: string): { className: string; variable: string } {
  return PROVIDER_COLOR_TOKENS[providerId.toLowerCase()] || PROVIDER_COLOR_TOKENS.unknown
}

export function getProviderColorClassName(providerId: string): string {
  return getProviderColorToken(providerId).className
}

export function getProviderColorVariable(providerId: string): string {
  return getProviderColorToken(providerId).variable
}
