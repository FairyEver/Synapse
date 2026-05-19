const PROVIDER_COLOR_TOKENS: Record<string, { className: string }> = {
  anthropic: { className: "bg-chart-1" },
  openai: { className: "bg-chart-2" },
  google: { className: "bg-chart-3" },
  deepseek: { className: "bg-chart-4" },
  xai: { className: "bg-chart-5" },
  meta: { className: "bg-muted-foreground" },
  unknown: { className: "bg-muted" },
}

function getProviderColorToken(providerId: string): { className: string } {
  return PROVIDER_COLOR_TOKENS[providerId.toLowerCase()] || PROVIDER_COLOR_TOKENS.unknown
}

export function getProviderColorClassName(providerId: string): string {
  return getProviderColorToken(providerId).className
}
