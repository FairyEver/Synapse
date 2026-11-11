import { describe, expect, it } from "vitest"
import { assertTunnelCookieOrigin } from "./tunnel-origin"
describe("cookie-authenticated platform writes with public tunnels", () => {
  it("requires the exact platform origin even when another origin shares its site", () => {
    const request = (origin?: string) => ({ method: "POST", headers: { origin } })
    expect(() => assertTunnelCookieOrigin(request("https://synapse.d2.pub"), "https://synapse.d2.pub", true)).not.toThrow()
    for (const origin of [undefined, "null", "https://a.tunnel.d2.pub", "https://synapse.d2.pub.evil.test"]) {
      expect(() => assertTunnelCookieOrigin(request(origin), "https://synapse.d2.pub", true)).toThrow()
    }
    expect(() => assertTunnelCookieOrigin(request(), "https://synapse.d2.pub", false)).not.toThrow()
    expect(() => assertTunnelCookieOrigin({ method: "GET", headers: {} }, "https://synapse.d2.pub", true)).not.toThrow()
  })
})
