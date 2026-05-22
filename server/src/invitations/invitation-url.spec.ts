import { describe, expect, it } from "vitest"
import { buildInviteUrl, parseInviteTokenInput, resolvePublicAppUrl } from "./invitation-url"

describe("invitation URL helpers", () => {
  it("builds canonical invite URLs with fragment tokens", () => {
    expect(buildInviteUrl({
      publicAppUrl: "https://app.example.com/",
      token: "plain-token",
    })).toBe("https://app.example.com/invite#token=plain-token")
  })

  it("prefers the configured public app URL over request origin", () => {
    expect(resolvePublicAppUrl({
      configuredPublicAppUrl: "https://app.example.com/",
      request: {
        protocol: "http",
        headers: { host: "api.example.com" },
        get: () => "api.example.com",
      },
    })).toBe("https://app.example.com")
  })

  it("falls back to forwarded request origin", () => {
    expect(resolvePublicAppUrl({
      configuredPublicAppUrl: "",
      request: {
        protocol: "http",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "synapse.example.com",
          host: "127.0.0.1:3000",
        },
        get: (name: string) => name.toLowerCase() === "host" ? "127.0.0.1:3000" : undefined,
      },
    })).toBe("https://synapse.example.com")
  })

  it("parses tokens from canonical invite URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/invite#token=plain-token"))
      .toBe("plain-token")
  })

  it("parses tokens from hash-router invite URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/#/invite?token=plain-token"))
      .toBe("plain-token")
  })

  it("keeps bare tokens unchanged", () => {
    expect(parseInviteTokenInput(" plain-token ")).toBe("plain-token")
  })
})
