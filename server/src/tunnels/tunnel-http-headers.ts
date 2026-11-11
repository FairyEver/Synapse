import type { OutgoingHttpHeaders } from "node:http"
export interface TunnelHttpContext { port: number; publicOrigin: string; clientIp: string; requestBodyBytes?: number }
const hopHeaders = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]
function filtered(raw: readonly string[]): OutgoingHttpHeaders {
  const skip = new Set(hopHeaders)
  for (let i = 0; i < raw.length; i += 2) if (raw[i]!.toLowerCase() === "connection") raw[i + 1]!.split(",").forEach(v => skip.add(v.trim().toLowerCase()))
  const result: OutgoingHttpHeaders = Object.create(null)
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!.toLowerCase(), value = raw[i + 1]!
    if (skip.has(name) || name.startsWith("x-synapse-tunnel-") || name === "forwarded" || name.startsWith("x-forwarded-")) continue
    const prior = result[name]
    if (name === "set-cookie") result[name] = [...(Array.isArray(prior) ? prior : []), value]
    else result[name] = prior === undefined ? value : `${prior}${name === "cookie" ? "; " : ", "}${value}`
  }
  return result
}
export function buildTunnelUpstreamHeaders(raw: readonly string[], context: TunnelHttpContext, upgrade = false): OutgoingHttpHeaders {
  const result = filtered(raw), url = new URL(context.publicOrigin)
  result.host = `localhost:${context.port}`
  result["x-forwarded-host"] = url.host; result["x-forwarded-proto"] = "https"; result["x-forwarded-for"] = context.clientIp
  if (typeof result.cookie === "string") {
    const cookie = result.cookie.split(";").map(v => v.trim()).filter(v => !/^(?:__Host-)?synapse_(?:user|admin)_session=/u.test(v)).join("; ")
    if (cookie) result.cookie = cookie; else delete result.cookie
  }
  if (upgrade) { result.connection = "Upgrade"; result.upgrade = "websocket" } else result.connection = "close"
  return result
}
export function rewriteTunnelResponseHeaders(raw: readonly string[], context: TunnelHttpContext, upgrade = false): OutgoingHttpHeaders {
  const result = filtered(raw), publicHost = new URL(context.publicOrigin).hostname
  if (typeof result.location === "string" && /^http:\/\//iu.test(result.location)) {
    try {
      const target = new URL(result.location)
      if (["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && Number(target.port || 80) === context.port && !target.username && !target.password) {
        result.location = context.publicOrigin + target.pathname + target.search + target.hash
      }
    } catch { delete result.location }
  }
  if (Array.isArray(result["set-cookie"])) result["set-cookie"] = result["set-cookie"].map(cookie => cookie.split(";").filter((part, i) => {
    if (!i || !/^\s*domain\s*=/iu.test(part)) return true
    const domain = part.slice(part.indexOf("=") + 1).trim().replace(/^\./u, "").toLowerCase()
    return !["localhost", "127.0.0.1", "[::1]", "::1", publicHost].includes(domain) && !publicHost.endsWith("." + domain)
  }).map(part => part.trim()).join("; "))
  if (upgrade) { result.connection = "Upgrade"; result.upgrade = "websocket" }
  return result
}
