import { describe, expect, it } from "vitest"
import { buildTunnelUpstreamHeaders, rewriteTunnelResponseHeaders } from "./tunnel-http-headers"
const context = { port: 3000, publicOrigin: `https://${"a".repeat(32)}.tunnel.test`, clientIp: "203.0.113.1" }
describe("tunnel HTTP headers", () => {
  it("preserves business credentials, drops hop headers and overwrites forwarded identities", () => {
    const headers = buildTunnelUpstreamHeaders(["Host", "evil", "Connection", "x-private, keep-alive", "X-Private", "hidden", "Authorization", "Bearer app-token", "Cookie", "app=1; synapse_user_session=platform", "X-Forwarded-For", "fake", "Origin", context.publicOrigin], context)
    expect(headers).toMatchObject({ host: "localhost:3000", authorization: "Bearer app-token", cookie: "app=1", origin: context.publicOrigin, "x-forwarded-for": "203.0.113.1", "x-forwarded-proto": "https" })
    expect(headers["x-private"]).toBeUndefined()
  })
  it("rewrites exact localhost redirects and host-only cookies without touching third parties", () => {
    const headers = rewriteTunnelResponseHeaders(["Location", "http://localhost:3000/a?x=%2F#h", "Set-Cookie", "a=1; Domain=localhost; HttpOnly", "Set-Cookie", "b=2; Domain=.tunnel.test; SameSite=Lax"], context)
    expect(headers.location).toBe(context.publicOrigin + "/a?x=%2F#h")
    expect(headers["set-cookie"]).toEqual(["a=1; HttpOnly", "b=2; SameSite=Lax"])
    expect(rewriteTunnelResponseHeaders(["Location", "https://external.test/a"], context).location).toBe("https://external.test/a")
    expect(rewriteTunnelResponseHeaders(["Location", "http://localhost:3001/a"], context).location).toBe("http://localhost:3001/a")
  })
})
