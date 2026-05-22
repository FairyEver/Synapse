import type { IncomingHttpHeaders } from "node:http"

type RequestOriginInput = {
  readonly headers: IncomingHttpHeaders
  readonly protocol?: string
  get(name: string): string | undefined
}

function readHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

function normalizePublicAppUrl(value: string): string {
  return value.trim().replace(/\/+$/, "")
}

function resolvePublicAppUrl(input: {
  readonly configuredPublicAppUrl?: string
  readonly request: RequestOriginInput
}): string {
  const configured = normalizePublicAppUrl(input.configuredPublicAppUrl ?? "")
  if (configured) return configured

  const forwardedProto = readHeader(input.request.headers["x-forwarded-proto"])
    .split(",")[0]
    .trim()
  const forwardedHost = readHeader(input.request.headers["x-forwarded-host"])
    .split(",")[0]
    .trim()
  const host = forwardedHost || input.request.get("host") || readHeader(input.request.headers.host)
  const protocol = forwardedProto || input.request.protocol || "http"

  return normalizePublicAppUrl(`${protocol}://${host}`)
}

function buildInviteUrl(input: {
  readonly publicAppUrl: string
  readonly token: string
}): string {
  const url = new URL("/invite", `${normalizePublicAppUrl(input.publicAppUrl)}/`)
  url.hash = `token=${encodeURIComponent(input.token)}`
  return url.toString()
}

function parseInviteTokenInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  try {
    const url = new URL(trimmed)
    const hashValue = url.hash.replace(/^#/, "")
    const hashQuery = hashValue.includes("?")
      ? hashValue.slice(hashValue.indexOf("?") + 1)
      : hashValue
    const hashToken = new URLSearchParams(hashQuery).get("token")
    if (hashToken) return hashToken.trim()

    const queryToken = url.searchParams.get("token") ?? url.searchParams.get("invitationToken")
    if (queryToken) return queryToken.trim()
  } catch {
    return trimmed
  }

  return trimmed
}

export { buildInviteUrl, parseInviteTokenInput, resolvePublicAppUrl }
