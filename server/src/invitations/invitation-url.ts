import { normalizePublicAppUrl, resolvePublicAppUrl } from "../common/public-app-url"

function buildTeamInviteUrl(input: {
  readonly publicAppUrl: string
  readonly token: string
}): string {
  const url = new URL("/dashboard/team-invite", `${normalizePublicAppUrl(input.publicAppUrl)}/`)
  url.searchParams.set("token", input.token)
  return url.toString()
}

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
