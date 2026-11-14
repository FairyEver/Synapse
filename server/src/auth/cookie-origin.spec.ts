import { describe, expect, it } from "vitest"
import { assertCookieOrigin } from "./cookie-origin"
describe("cookie-authenticated platform writes", () => {
  it("requires the exact platform origin even when another origin shares its site", () => {
    const request = (origin?: string) => ({ method: "POST", headers: { origin } })
    expect(() => assertCookieOrigin(request("https://synapse.d2.pub"), "https://synapse.d2.pub")).not.toThrow()
    for (const origin of [undefined, "null", "https://other.d2.pub", "https://synapse.d2.pub.evil.test"]) {
      expect(() => assertCookieOrigin(request(origin), "https://synapse.d2.pub")).toThrow()
    }
    expect(() => assertCookieOrigin(request(), "https://synapse.d2.pub")).toThrow()
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(() => assertCookieOrigin({ method, headers: {} }, "https://synapse.d2.pub")).not.toThrow()
    }
  })
  it("rejects writes when the configured platform URL is unavailable or invalid", () => {
    for (const publicUrl of [undefined, "invalid"]) {
      expect(() => assertCookieOrigin({ method: "POST", headers: { origin: "https://synapse.test" } }, publicUrl)).toThrow()
    }
  })
})
