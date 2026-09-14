/**
 * Maps a Synapse model tier to the provider env model Claude Code resolves for it.
 * Shared by the Agent runtime and the embedded Claude Code terminal launch.
 */
export function resolveTierModelFromEnv(env: Record<string, string>, tier: string): string | undefined {
  switch (tier) {
    case "default": return env.ANTHROPIC_MODEL
    case "haiku":   return env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    case "sonnet":  return env.ANTHROPIC_DEFAULT_SONNET_MODEL
    case "opus":    return env.ANTHROPIC_DEFAULT_OPUS_MODEL
    default: return undefined
  }
}
