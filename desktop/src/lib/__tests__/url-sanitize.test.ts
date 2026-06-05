import { describe, expect, it } from "vitest"

import { sanitizeUrl } from "../url-sanitize"

describe("sanitizeUrl", () => {
  it("redacts URL userinfo and sensitive query parameters", () => {
    expect(sanitizeUrl("https://user:secret@example.com/api?token=sk-secret&query=ok")).toBe(
      "https://%5Bredacted%5D:%5Bredacted%5D@example.com/api?token=%5Bredacted%5D&query=ok",
    )
  })

  it("redacts broader credential-style query parameters", () => {
    expect(sanitizeUrl("https://example.com/callback?client_secret=secret&refresh_token=refresh&id_token=id&ok=1")).toBe(
      "https://example.com/callback?client_secret=%5Bredacted%5D&refresh_token=%5Bredacted%5D&id_token=%5Bredacted%5D&ok=1",
    )
  })

  it("redacts OAuth handoff query parameters", () => {
    expect(sanitizeUrl("https://example.com/dashboard/auth/desktop?state=secret-state&code_challenge=secret-challenge&code_challenge_method=S256")).toBe(
      "https://example.com/dashboard/auth/desktop?state=%5Bredacted%5D&code_challenge=%5Bredacted%5D&code_challenge_method=S256",
    )
  })

  it("falls back to text redaction when URL parsing fails", () => {
    expect(sanitizeUrl("fetch https://user:pass@example.com/api?token=sk-secret failed")).toBe(
      "fetch https://[redacted]@example.com/api?token=[redacted] failed",
    )
  })
})
