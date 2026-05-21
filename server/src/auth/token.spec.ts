import { describe, expect, it } from "vitest"
import { createOpaqueToken, hashToken } from "./token"

describe("token utilities", () => {
  it("creates opaque tokens and stable hashes", () => {
    const token = createOpaqueToken()

    expect(token.length).toBeGreaterThanOrEqual(40)
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toBe(token)
  })
})
