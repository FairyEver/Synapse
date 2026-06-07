import { buildTeamInviteUrl } from "@synapse/shared"
import { resolvePublicAppUrl } from "../common/public-app-url"

function parseInviteTokenInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  try {
    const url = new URL(trimmed)
    const queryToken = url.searchParams.get("token")
    if (queryToken) return queryToken.trim()
  } catch {
    return trimmed
  }

  return trimmed
}

export { buildTeamInviteUrl, parseInviteTokenInput, resolvePublicAppUrl }
