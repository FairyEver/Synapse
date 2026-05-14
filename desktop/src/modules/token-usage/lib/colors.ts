export const PROVIDER_COLORS: Record<string, string> = {
  anthropic: "#DA7756",
  openai: "#10B981",
  google: "#3B82F6",
  deepseek: "#06B6D4",
  xai: "#EAB308",
  meta: "#6366F1",
  unknown: "#888888",
}

export function getProviderColor(providerId: string): string {
  return PROVIDER_COLORS[providerId.toLowerCase()] || PROVIDER_COLORS.unknown
}
