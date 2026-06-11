import { describe, expect, it } from "vitest"
import { buildTeamInviteUrl, parseInviteTokenInput, resolvePublicAppUrl } from "./invitation-url"

describe("invitation URL helpers", () => {
  it("builds team invite URLs only", () => {
    expect(buildTeamInviteUrl({
      publicAppUrl: "https://app.example.com",
      token: "plain token",
    })).toBe("https://app.example.com/console/team-invite?token=plain+token")
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
        },
        get: () => undefined,
      },
    })).toBe("https://synapse.example.com")
  })

  it("does not let mismatched forwarded host override the request host", () => {
    expect(resolvePublicAppUrl({
      configuredPublicAppUrl: "",
      request: {
        protocol: "http",
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "evil.example.com",
          host: "app.example.com",
        },
        get: (name: string) => name.toLowerCase() === "host" ? "app.example.com" : undefined,
      },
    })).toBe("http://app.example.com")
  })

  it("parses tokens from token query URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/console/team-invite?token=plain-token"))
      .toBe("plain-token")
  })

  it("keeps parsing legacy dashboard team invite URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/dashboard/team-invite?token=plain-token"))
      .toBe("plain-token")
  })

  it("keeps bare tokens unchanged", () => {
    expect(parseInviteTokenInput(" plain-token ")).toBe("plain-token")
  })
})
