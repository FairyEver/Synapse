import { describe, expect, it } from "vitest"
import { buildSignupInviteUrl, buildTeamInviteUrl, parseInviteTokenInput, resolvePublicAppUrl } from "./invitation-url"

describe("invitation URL helpers", () => {
  it("builds signup invite URLs under the dashboard signup route", () => {
    expect(buildSignupInviteUrl({
      publicAppUrl: "https://app.example.com/",
      token: "plain-token",
    })).toBe("https://app.example.com/dashboard/signup?invite=plain-token")
  })

  it("encodes signup invite tokens in the invite query parameter", () => {
    expect(buildSignupInviteUrl({
      publicAppUrl: "https://app.example.com",
      token: "plain token+value",
    })).toBe("https://app.example.com/dashboard/signup?invite=plain+token%2Bvalue")
  })

  it("keeps team invite URL under the dashboard team invite route", () => {
    expect(buildTeamInviteUrl({
      publicAppUrl: "https://app.example.com/",
      token: "plain-token",
    })).toBe("https://app.example.com/dashboard/team-invite?token=plain-token")
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

  it("parses tokens from signup invite URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/dashboard/signup?invite=plain-token"))
      .toBe("plain-token")
  })

  it("parses tokens from token query URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/dashboard/team-invite?token=plain-token"))
      .toBe("plain-token")
  })

  it("parses tokens from invitationToken query URLs", () => {
    expect(parseInviteTokenInput("https://app.example.com/register?invitationToken=plain-token"))
      .toBe("plain-token")
  })

  it("keeps bare tokens unchanged", () => {
    expect(parseInviteTokenInput(" plain-token ")).toBe("plain-token")
  })
})
