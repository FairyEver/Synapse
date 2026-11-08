import { createServer, type Server, type RequestListener } from "node:http"
import { gzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { afterEach, describe, expect, it } from "vitest"
import { forwardWebhook } from "../webhook-forward"

const servers: Server[] = []
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) } })
async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  return `http://127.0.0.1:${address.port}`
}
function raw(body: Buffer, method = "POST") {
  return { version: 1 as const, method, query: "a=&a=2&x=%2f+%20", headers: [["Authorization", "Bearer private"], ["Cookie", "session=private"], ["Connection", "x-hop"], ["X-Hop", "drop"]] as [string, string][], bodyBase64: body.toString("base64"), bodyBytes: body.length, bodySha256: createHash("sha256").update(body).digest("hex") }
}
describe("raw webhook forwarding over real HTTP", () => {
  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("preserves %s, raw query, sensitive headers and compressed bytes", async (method) => {
    const bytes = gzipSync(Buffer.from('{ "n":9007199254740993, "token":"private" }'))
    let received: unknown
    const url = await listen(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk)
      received = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) }; res.writeHead(202); res.end("private response")
    })
    const result = await forwardWebhook(`${url}/target?first=%2F`, raw(bytes, method), new AbortController().signal)
    expect(received).toMatchObject({ method, url: "/target?first=%2F&a=&a=2&x=%2f+%20", body: bytes, headers: { authorization: "Bearer private", cookie: "session=private" } })
    expect((received as { headers: Record<string, string> }).headers["x-hop"]).toBeUndefined()
    expect(result.status).toBe(202); expect(JSON.stringify(result)).not.toContain("private")
  })
  it("does not follow redirects or resend after an HTTP error", async () => {
    let requests = 0
    const url = await listen((_req, res) => { requests++; res.writeHead(302, { location: "/next" }); res.end() })
    await expect(forwardWebhook(url, raw(Buffer.alloc(0)), new AbortController().signal)).rejects.toMatchObject({ code: "http_status", status: 302 })
    expect(requests).toBe(1)
  })
  it("never retries an ambiguous disconnect after request receipt", async () => {
    let requests = 0
    const url = await listen((req) => { requests++; req.socket.destroy() })
    await expect(forwardWebhook(url, raw(Buffer.from("write")), new AbortController().signal)).rejects.toMatchObject({ code: "connection_lost" })
    expect(requests).toBe(1)
  })
  it("requires the entire response before success and supports cancellation", async () => {
    const url = await listen((_req, res) => { res.writeHead(200); res.write("partial") })
    const abort = new AbortController(); setTimeout(() => abort.abort(), 40)
    await expect(forwardWebhook(url, raw(Buffer.alloc(0)), abort.signal)).rejects.toMatchObject({ code: "cancelled" })
  })
  it("rejects digest mismatch before connecting", async () => {
    await expect(forwardWebhook("http://127.0.0.1:1", { ...raw(Buffer.from("x")), bodySha256: "a".repeat(64) }, new AbortController().signal)).rejects.toMatchObject({ code: "invalid_raw_request" })
  })
  it("retries a refused connection only before sending and stops after connection succeeds", async () => {
    const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, "127.0.0.1", resolve))
    const port = (reserve.address() as { port: number }).port
    await new Promise<void>(resolve => reserve.close(() => resolve()))
    let requests = 0
    const server = createServer((_req, res) => { requests++; res.end() }); servers.push(server)
    const timer = setTimeout(() => server.listen(port, "127.0.0.1"), 200)
    try {
      const result = await forwardWebhook(`http://127.0.0.1:${port}`, raw(Buffer.from("once")), new AbortController().signal)
      expect(result.attempts).toBe(2); expect(requests).toBe(1)
    } finally { clearTimeout(timer) }
  })
  it("enforces the 30 second total timeout on an incomplete response", async () => {
    let requests = 0
    const url = await listen((_req, res) => { requests++; res.writeHead(200); res.write("partial") })
    await expect(forwardWebhook(url, raw(Buffer.alloc(0)), new AbortController().signal)).rejects.toMatchObject({ code: "timeout" })
    expect(requests).toBe(1)
  }, 35_000)
})
