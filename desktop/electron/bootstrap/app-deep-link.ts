import { resolveDeclaredAppDeepLink } from "../../app-capabilities/manifest-registry"

export type ParsedAppDeepLink = {
  readonly appId: string
  readonly action: string
  readonly capabilityId: string
  readonly params: Record<string, unknown>
}

export class AppDeepLinkError extends Error {
  constructor(readonly code: "invalid_url" | "unknown_app_action" | "invalid_params") {
    super(code === "unknown_app_action" ? "不支持该应用操作" : "应用链接无效")
    this.name = "AppDeepLinkError"
  }
}

export function isAppDeepLinkCandidate(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    return parsed.protocol === "synapse:" && parsed.hostname === "app"
  } catch {
    return rawUrl.toLowerCase().startsWith("synapse://app/")
  }
}

export function parseDeclaredAppDeepLink(rawUrl: string): ParsedAppDeepLink {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new AppDeepLinkError("invalid_url")
  }
  if (
    parsed.protocol !== "synapse:"
    || parsed.hostname !== "app"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || parsed.hash !== ""
  ) throw new AppDeepLinkError("invalid_url")

  const pathParts = parsed.pathname.split("/")
  if (pathParts.length !== 3 || pathParts[0] !== "" || !pathParts[1] || !pathParts[2]) {
    throw new AppDeepLinkError("invalid_url")
  }
  const segments = pathParts.slice(1)
  let appId: string
  let action: string
  try {
    appId = decodeURIComponent(segments[0])
    action = decodeURIComponent(segments[1])
  } catch {
    throw new AppDeepLinkError("invalid_url")
  }
  if (!appId || !action || appId.includes("/") || action.includes("/")) {
    throw new AppDeepLinkError("invalid_url")
  }

  const declaration = resolveDeclaredAppDeepLink(appId, action)
  if (!declaration) throw new AppDeepLinkError("unknown_app_action")

  const params: Record<string, string> = {}
  for (const key of new Set(parsed.searchParams.keys())) {
    const values = parsed.searchParams.getAll(key)
    if (values.length !== 1) throw new AppDeepLinkError("invalid_params")
    params[key] = values[0]
  }
  const result = declaration.paramsSchema.safeParse(params)
  if (!result.success) throw new AppDeepLinkError("invalid_params")

  return {
    appId,
    action,
    capabilityId: declaration.capabilityId,
    params: result.data,
  }
}
