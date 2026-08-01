export const API_PATH_PREFIX = "/api"
export const DASHBOARD_PATH_PREFIX = "/console"
export const PASSWORD_RESET_PATH = `${DASHBOARD_PATH_PREFIX}/reset-password`
export const LIVE_DESKTOP_API_PATH = `${API_PATH_PREFIX}/live/desktop`
export const WEBHOOK_PUBLIC_PATH_PREFIX = "/webhooks"

export const DESKTOP_CLIENT_ID = "synapse-desktop"
export const DESKTOP_REDIRECT_URI = "synapse://auth/desktop/callback"
export const DESKTOP_PKCE_CHALLENGE_METHOD = "S256"

export function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}

export function buildApiBaseUrl(publicAppUrl: string): string {
  return `${normalizePublicAppUrl(publicAppUrl)}${API_PATH_PREFIX}`
}

export function buildDesktopDashboardLoginUrl(input: {
  readonly apiBaseUrl: string
  readonly state: string
  readonly codeChallenge: string
}): string {
  const origin = normalizeApiBaseUrl(input.apiBaseUrl).replace(new RegExp(`${API_PATH_PREFIX}$`, "u"), "")
  const query = new URLSearchParams({
    client_id: DESKTOP_CLIENT_ID,
    redirect_uri: DESKTOP_REDIRECT_URI,
    response_type: "code",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: DESKTOP_PKCE_CHALLENGE_METHOD,
  })
  return `${origin}${DASHBOARD_PATH_PREFIX}/auth/desktop?${query.toString()}`
}

export function buildPasswordResetUrl(input: {
  readonly publicAppUrl: string
  readonly token: string
}): string {
  const url = new URL(PASSWORD_RESET_PATH, `${normalizePublicAppUrl(input.publicAppUrl)}/`)
  url.searchParams.set("token", input.token)
  return url.toString()
}

export function buildWebhookUrl(input: {
  readonly publicAppUrl: string
  readonly publicId: string
  readonly secret: string
}): string {
  return `${normalizePublicAppUrl(input.publicAppUrl)}${WEBHOOK_PUBLIC_PATH_PREFIX}/${encodeURIComponent(input.publicId)}/${encodeURIComponent(input.secret)}`
}

export function maskWebhookUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split("/")
    if (parts.length >= 4 && parts[1] === "webhooks") {
      parts[3] = "***"
      parsed.pathname = parts.join("/")
      return parsed.toString()
    }
  } catch {
    return maskWebhookPath(url)
  }
  return maskWebhookPath(url)
}

export function buildLiveDesktopSocketUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}${LIVE_DESKTOP_API_PATH.slice(API_PATH_PREFIX.length)}`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function normalizeApiBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "")
}

function maskWebhookPath(value: string): string {
  return value.replace(/\/webhooks\/([^/]+)\/[^/?#]+/u, "/webhooks/$1/***")
}
