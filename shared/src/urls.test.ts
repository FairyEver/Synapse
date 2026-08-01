import { describe, expect, it } from "vitest"
import {
  API_PATH_PREFIX,
  DASHBOARD_PATH_PREFIX,
  DESKTOP_CLIENT_ID,
  DESKTOP_PKCE_CHALLENGE_METHOD,
  DESKTOP_REDIRECT_URI,
  buildApiBaseUrl,
  buildDesktopDashboardLoginUrl,
  buildLiveDesktopSocketUrl,
  buildPasswordResetUrl,
  buildWebhookUrl,
  maskWebhookUrl,
  normalizePublicAppUrl,
} from "./urls.js"

describe("shared URL helpers", () => {
  it("defines public path and desktop auth constants once", () => {
    expect(API_PATH_PREFIX).toBe("/api")
    expect(DASHBOARD_PATH_PREFIX).toBe("/console")
    expect(DESKTOP_CLIENT_ID).toBe("synapse-desktop")
    expect(DESKTOP_REDIRECT_URI).toBe("synapse://auth/desktop/callback")
    expect(DESKTOP_PKCE_CHALLENGE_METHOD).toBe("S256")
  })

  it("normalizes public app URLs and derives API base URLs", () => {
    expect(normalizePublicAppUrl(" https://synapse.test/// ")).toBe("https://synapse.test")
    expect(buildApiBaseUrl("https://synapse.test/")).toBe("https://synapse.test/api")
  })

  it("builds console login URLs with encoded desktop auth parameters", () => {
    const loginUrl = new URL(buildDesktopDashboardLoginUrl({
      apiBaseUrl: "https://synapse.test/api",
      state: "state value",
      codeChallenge: "challenge+value",
    }))

    expect(loginUrl.origin).toBe("https://synapse.test")
    expect(loginUrl.pathname).toBe("/console/auth/desktop")
    expect(loginUrl.searchParams.get("client_id")).toBe(DESKTOP_CLIENT_ID)
    expect(loginUrl.searchParams.get("redirect_uri")).toBe(DESKTOP_REDIRECT_URI)
    expect(loginUrl.searchParams.get("response_type")).toBe("code")
    expect(loginUrl.searchParams.get("state")).toBe("state value")
    expect(loginUrl.searchParams.get("code_challenge")).toBe("challenge+value")
    expect(loginUrl.searchParams.get("code_challenge_method")).toBe(DESKTOP_PKCE_CHALLENGE_METHOD)
  })

  it("builds user-facing URLs with encoded tokens", () => {
    expect(buildPasswordResetUrl({
      publicAppUrl: "https://synapse.test/",
      token: "reset token",
    })).toBe("https://synapse.test/console/reset-password?token=reset+token")
    expect(buildWebhookUrl({
      publicAppUrl: "https://synapse.test/",
      publicId: "wh/id",
      secret: "whsec/value",
    })).toBe("https://synapse.test/webhooks/wh%2Fid/whsec%2Fvalue")
  })

  it("masks webhook URLs without leaking the secret segment", () => {
    expect(maskWebhookUrl("https://synapse.test/webhooks/wh_abc/whsec_secret?x=1"))
      .toBe("https://synapse.test/webhooks/wh_abc/***?x=1")
    expect(maskWebhookUrl("/webhooks/wh_abc/whsec_secret"))
      .toBe("/webhooks/wh_abc/***")
  })

  it("derives live websocket URLs from API base URLs", () => {
    expect(buildLiveDesktopSocketUrl("https://synapse.test/api"))
      .toBe("wss://synapse.test/api/live/desktop")
    expect(buildLiveDesktopSocketUrl("http://localhost:3000/api/"))
      .toBe("ws://localhost:3000/api/live/desktop")
    expect(buildLiveDesktopSocketUrl("https://synapse.test/app/api/"))
      .toBe("wss://synapse.test/app/api/live/desktop")
  })
})
