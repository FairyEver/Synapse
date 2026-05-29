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
  const requestHost = input.request.get("host") || readHeader(input.request.headers.host)
  const useForwardedOrigin = Boolean(forwardedHost && (!requestHost || forwardedHost === requestHost))
  const host = useForwardedOrigin ? forwardedHost : requestHost
  const protocol = (useForwardedOrigin ? forwardedProto : "") || input.request.protocol || "http"

  return normalizePublicAppUrl(`${protocol}://${host}`)
}

export { normalizePublicAppUrl, resolvePublicAppUrl }
