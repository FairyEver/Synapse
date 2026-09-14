import { z } from "zod"

/**
 * 终端会话深度链接：`synapse://terminals/<payload>.<checksum>`。
 *
 * 与 Agent 会话深度链接一致，链接只携带本机短校验引用（`tsr_` 前缀在链接中省略），由主进程解析回唯一
 * session，不暴露原始 sessionId。复制链接对点号、下划线和连字符做百分号编码，解析兼容这三类字符的
 * Markdown 转义，并校验完整格式。
 */

export const TERMINAL_SESSION_DEEP_LINK_HOSTNAME = "terminals" as const
export const TERMINAL_SESSION_REFERENCE_PREFIX = "tsr_" as const

const TERMINAL_SESSION_REFERENCE_BODY_SOURCE = "[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{3}"

export type ResolvedTerminalSessionDeepLink = {
  readonly sessionRef: string
}

const deepLinkSchema = z.string().min(1).max(16 * 1024)
  .describe("Complete Synapse Terminal session deep link copied from the user message. Pass it unchanged; do not parse or rewrite it.")

export const terminalSessionDeepLinkSchema = deepLinkSchema.refine((value) => {
  try {
    parseTerminalSessionDeepLink(value)
    return true
  } catch {
    return false
  }
})

export const terminalSessionProtocolRouteParamsSchema = z.object({
  deepLink: terminalSessionDeepLinkSchema,
}).strict()

export function buildTerminalSessionDeepLink(input: { readonly sessionRef: string }): string {
  const body = terminalSessionReferenceBody(input.sessionRef)
  return `synapse://${TERMINAL_SESSION_DEEP_LINK_HOSTNAME}/${encodeTerminalDeepLinkValue(body)}`
}

export function parseTerminalSessionDeepLink(rawUrl: string): ResolvedTerminalSessionDeepLink {
  if (rawUrl.trim() !== rawUrl || rawUrl.includes("+") || /%(?![\da-f]{2})/i.test(rawUrl)) {
    throw new Error("invalid_terminal_session_deep_link")
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("invalid_terminal_session_deep_link")
  }
  if (
    parsed.protocol !== "synapse:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.port !== ""
    || parsed.hash !== ""
  ) throw new Error("invalid_terminal_session_deep_link")

  if (parsed.hostname !== TERMINAL_SESSION_DEEP_LINK_HOSTNAME || parsed.search !== "") {
    throw new Error("invalid_terminal_session_deep_link")
  }
  const rawPath = parsed.pathname.slice(1)
  if (!rawPath || parsed.pathname !== `/${rawPath}` || rawPath.includes("/")) {
    throw new Error("invalid_terminal_session_deep_link")
  }
  let body: string
  try {
    body = decodeURIComponent(rawPath)
  } catch {
    throw new Error("invalid_terminal_session_deep_link")
  }
  const normalized = normalizeTerminalSessionReferenceBody(body)
  if (!new RegExp(`^${TERMINAL_SESSION_REFERENCE_BODY_SOURCE}$`).test(normalized)) {
    throw new Error("invalid_terminal_session_deep_link")
  }
  return { sessionRef: `${TERMINAL_SESSION_REFERENCE_PREFIX}${normalized}` }
}

export function normalizeTerminalSessionReference(value: string): string {
  return /^tsr\\_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3}$/.test(value)
    ? value.replace(/^tsr\\_/, TERMINAL_SESSION_REFERENCE_PREFIX)
    : value
}

function terminalSessionReferenceBody(value: string): string {
  const normalized = normalizeTerminalSessionReference(value)
  const match = new RegExp(`^${TERMINAL_SESSION_REFERENCE_PREFIX}(${TERMINAL_SESSION_REFERENCE_BODY_SOURCE})$`).exec(normalized)
  if (!match) throw new Error("invalid_terminal_session_reference")
  return match[1] as string
}

function normalizeTerminalSessionReferenceBody(value: string): string {
  const normalized = value.replace(/\\([_.-])/g, "$1")
  return new RegExp(`^${TERMINAL_SESSION_REFERENCE_BODY_SOURCE}$`).test(normalized) ? normalized : value
}

function encodeTerminalDeepLinkValue(value: string): string {
  return encodeURIComponent(value).replaceAll("_", "%5F").replaceAll(".", "%2E").replaceAll("-", "%2D")
}
