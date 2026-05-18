import type { CreateProviderInput } from "./types"

export const PROVIDER_PRESETS: readonly CreateProviderInput[] = [
  {
    id: "anthropic",
    name: "Claude Official",
    category: "official",
    apiKeyField: "ANTHROPIC_API_KEY",
    env: {},
  },
]
