import { createHash } from "node:crypto"
import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import type { WebhookRawRequest } from "@synapse/shared" with { "resolution-mode": "import" }

export class WebhookForwardError extends Error {
  constructor(readonly code: string, readonly status?: number, readonly retryable = false) {
    super(`Webhook forward: ${code}`)
  }
}

const hopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length", "expect"])
const transientConnectErrors = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET"])

/** Only call through a network.connect-authorized action. No payload is logged. */
export async function forwardWebhook(target: string, raw: WebhookRawRequest, signal: AbortSignal): Promise<{ status: number; attempts: number; bodyBytes: number; bodySha256: string }> {
  const { isWebhookRawRequest } = await import("@synapse/shared")
  if (!isWebhookRawRequest(raw)) throw new WebhookForwardError("invalid_raw_request")
  const body = Buffer.from(raw.bodyBase64, "base64")
  if (body.length !== raw.bodyBytes || body.toString("base64") !== raw.bodyBase64 || createHash("sha256").update(body).digest("hex") !== raw.bodySha256) throw new WebhookForwardError("invalid_raw_request")
  let url: URL
  try { url = new URL(target) } catch { throw new WebhookForwardError("invalid_url") }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || /[\r\n]/u.test(target)) throw new WebhookForwardError("invalid_url")
  const queryIndex = target.indexOf("?")
  const query = queryIndex < 0 ? "" : target.slice(queryIndex + 1)
  const combined = query + (query && raw.query ? "&" : "") + raw.query
  const path = url.pathname + (combined || queryIndex >= 0 ? `?${combined}` : "")
  const omitted = new Set(hopHeaders)
  for (const [name, value] of raw.headers) if (name.toLowerCase() === "connection") for (const token of value.split(",")) omitted.add(token.trim().toLowerCase())
  const headers = raw.headers.filter(([name]) => !omitted.has(name.toLowerCase())).flatMap(([name, value]) => [name, value])
  headers.push("Host", url.host, "Content-Length", String(body.length))
  const controller = new AbortController()
  const cancel = () => controller.abort(new WebhookForwardError("cancelled"))
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new WebhookForwardError("timeout")), 30_000)
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const status = await sendAttempt(url, path, raw.method, headers, body, controller.signal)
        return { status, attempts: attempt + 1, bodyBytes: body.length, bodySha256: raw.bodySha256 }
      } catch (error) {
        if (!(error instanceof WebhookForwardError) || !error.retryable || attempt >= 2 || controller.signal.aborted) throw error
        await delay(attempt === 0 ? 1000 : 3000, controller.signal)
      }
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", cancel)
  }
}

function sendAttempt(url: URL, path: string, method: string, headers: string[], body: Buffer, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    let sent = false
    let settled = false
    const finish = (error?: WebhookForwardError, status?: number) => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", abort)
      if (error) { req.destroy(); reject(error) } else resolve(status!)
    }
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method, path, headers, agent: false })
    const abort = () => finish(signal.reason as WebhookForwardError)
    signal.addEventListener("abort", abort, { once: true })
    req.once("socket", (socket) => {
      // No end/write/flushHeaders before TCP (and TLS validation) succeeds.
      // Thus only errors in this phase have a provable zero-request-send state.
      socket.once(url.protocol === "https:" ? "secureConnect" : "connect", () => {
        if (settled) return
        sent = true
        req.end(body)
      })
    })
    req.once("error", (error: NodeJS.ErrnoException) => finish(new WebhookForwardError(
      sent ? "connection_lost" : "connect_failed", undefined, !sent && transientConnectErrors.has(error.code ?? ""),
    )))
    req.once("response", (res) => {
      res.on("error", () => finish(new WebhookForwardError("response_incomplete")))
      res.once("aborted", () => finish(new WebhookForwardError("response_incomplete")))
      res.once("end", () => {
        const status = res.statusCode ?? 0
        if (!res.complete) return finish(new WebhookForwardError("response_incomplete"))
        if (status < 200 || status >= 300) return finish(new WebhookForwardError("http_status", status))
        finish(undefined, status)
      })
      res.resume() // Discard response content; never persist headers/body/credentials.
    })
  })
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}
