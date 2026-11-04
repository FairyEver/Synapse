import { describe, expect, it } from "vitest"
import { assertHubWriteOrigin } from "./skill-hub-origin"

const app = "https://synapse.test"

describe("Skill Hub write origin", () => {
  it("allows the verified desktop branch without browser Origin", () => {
    expect(() => assertHubWriteOrigin({ userAuthMethod: "bearer", headers: {} }, app)).not.toThrow()
  })

  it("requires the exact configured origin for a verified cookie session", () => {
    expect(() => assertHubWriteOrigin({ userAuthMethod: "cookie", headers: { origin: app } }, app)).not.toThrow()
    for (const origin of [undefined, "null", "https://other.test", "https://synapse.test.attacker", app + "/"]) {
      expect(() => assertHubWriteOrigin({ userAuthMethod: "cookie", headers: { origin } }, app)).toThrow()
    }
  })

  it("never treats an authorization header alone as authenticated Bearer", () => {
    expect(() => assertHubWriteOrigin({ headers: { authorization: "Bearer guessed" } }, app)).toThrow()
  })
})
