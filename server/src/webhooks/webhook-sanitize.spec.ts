import { UnsupportedMediaTypeException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import {
  sanitizeWebhookHeaders,
  sanitizeWebhookLogRequest,
  sanitizeWebhookLogUrl,
  summarizeWebhookBody,
} from "./webhook-sanitize"

describe("webhook sanitize", () => {
  it("normalizes headers and redacts sensitive values", () => {
    expect(sanitizeWebhookHeaders({
      "X-GitHub-Event": "push",
      Authorization: "Bearer secret",
      Cookie: "sid=secret",
      "X-Api-Key": "api-key-secret",
      "X-Multi": ["a", "b"],
    })).toEqual({
      "x-github-event": "push",
      authorization: "[redacted]",
      cookie: "[redacted]",
      "x-api-key": "[redacted]",
      "x-multi": "a, b",
    })
  })

  it("redacts webhook URL secrets before request logs are serialized", () => {
    const sanitized = sanitizeWebhookLogUrl(
      "/webhooks/wh_public_id/whsec_secret_value?run=abc&source=e2e",
    )

    expect(sanitized).toBe("/webhooks/wh_public_id/***?run=abc&source=e2e")
    expect(sanitized).not.toContain("whsec_secret_value")
  })

  it("redacts sensitive query values before request logs are serialized", () => {
    const sanitized = sanitizeWebhookLogUrl(
      "/share/share-1?password=plain-password&page=2&apiKey=plain-api-key#section",
    )

    expect(sanitized).toBe("/share/share-1?password=[redacted]&page=2&apiKey=[redacted]#section")
    expect(sanitized).not.toContain("plain-password")
    expect(sanitized).not.toContain("plain-api-key")
  })

  it("redacts webhook URL query secrets before request logs are serialized", () => {
    const request = sanitizeWebhookLogRequest({
      originalUrl: "/webhooks/wh_public_id/whsec_secret_value?token=raw-token&signature=raw-signature&run=abc",
      query: {
        token: "raw-token",
        signature: "raw-signature",
        run: "abc",
      },
    })

    expect(request).toMatchObject({
      url: "/webhooks/wh_public_id/***?token=[redacted]&signature=[redacted]&run=abc",
      query: {
        token: "[redacted]",
        signature: "[redacted]",
        run: "abc",
      },
    })
    expect(JSON.stringify(request)).not.toContain("whsec_secret_value")
    expect(JSON.stringify(request)).not.toContain("raw-token")
    expect(JSON.stringify(request)).not.toContain("raw-signature")
  })

  it("redacts Open API download tokens before request logs are serialized", () => {
    const request = sanitizeWebhookLogRequest({
      originalUrl: "/api/open/v1/downloads/dlg_public?token=download-secret&retry=1",
      query: { token: "download-secret", retry: "1" },
    })

    expect(request).toMatchObject({
      url: "/api/open/v1/downloads/dlg_public?token=[redacted]&retry=1",
      query: { token: "[redacted]", retry: "1" },
    })
    expect(JSON.stringify(request)).not.toContain("download-secret")
  })

  it("keeps non-webhook request log URLs unchanged", () => {
    expect(sanitizeWebhookLogUrl("/api/webhooks?status=active")).toBe("/api/webhooks?status=active")
  })

  it("redacts webhook route params before request logs are serialized", () => {
    const request = sanitizeWebhookLogRequest({
      url: "/webhooks/wh_public_id/whsec_secret_value?run=abc",
      params: {
        path: ["webhooks", "wh_public_id", "whsec_secret_value"],
        publicId: "wh_public_id",
        secret: "whsec_secret_value",
      },
    })

    expect(JSON.stringify(request)).not.toContain("whsec_secret_value")
    expect(request).toMatchObject({
      url: "/webhooks/wh_public_id/***?run=abc",
      params: {
        path: ["webhooks", "wh_public_id", "[redacted]"],
        publicId: "wh_public_id",
        secret: "[redacted]",
      },
    })
  })

  it("keeps standard request log fields from raw request-like objects", () => {
    const requestLike = {
      id: "req-1",
      query: { run: "abc" },
      params: { path: ["webhooks", "wh_public_id", "whsec_secret_value"] },
      headers: {
        "x-test": "ok",
        "x-api-key": "api-key-secret",
        "x-gitlab-token": "gitlab-token-secret",
        "x-hub-signature-256": "sha256=signature-secret",
      },
      socket: { remoteAddress: "127.0.0.1", remotePort: 3001 },
    }
    Object.defineProperties(requestLike, {
      method: { value: "POST" },
      originalUrl: { value: "/webhooks/wh_public_id/whsec_secret_value?run=abc" },
    })

    const request = sanitizeWebhookLogRequest(requestLike)

    expect(request).toMatchObject({
      id: "req-1",
      method: "POST",
      url: "/webhooks/wh_public_id/***?run=abc",
      query: { run: "abc" },
      params: { path: ["webhooks", "wh_public_id", "[redacted]"] },
      headers: {
        "x-test": "ok",
        "x-api-key": "[redacted]",
        "x-gitlab-token": "[redacted]",
        "x-hub-signature-256": "[redacted]",
      },
      remoteAddress: "127.0.0.1",
      remotePort: 3001,
    })
    expect(JSON.stringify(request)).not.toContain("whsec_secret_value")
    expect(JSON.stringify(request)).not.toContain("api-key-secret")
    expect(JSON.stringify(request)).not.toContain("gitlab-token-secret")
    expect(JSON.stringify(request)).not.toContain("signature-secret")
  })

  it("summarizes JSON bodies without leaking token-like fields", () => {
    const summary = summarizeWebhookBody(
      Buffer.from(JSON.stringify({
        ok: true,
        token: "sk-secret",
        nested: { password: "hidden", value: "visible" },
      })),
      "application/json",
    )

    expect(summary).toMatchObject({
      bodyKind: "json",
      bodySize: expect.any(Number),
      body: {
        ok: true,
        token: "[redacted]",
        nested: { password: "[redacted]", value: "visible" },
      },
    })
    expect(summary.bodyPreview).toContain("\"token\":\"[redacted]\"")
    expect(summary.bodyPreview).not.toContain("sk-secret")
    expect(summary.bodyPreview).not.toContain("hidden")
  })

  it("summarizes form bodies without leaking secrets", () => {
    const summary = summarizeWebhookBody(
      Buffer.from("event=push&secret=form-secret&repository=Synapse"),
      "application/x-www-form-urlencoded",
    )

    expect(summary).toMatchObject({
      bodyKind: "form",
      body: {
        event: "push",
        secret: "[redacted]",
        repository: "Synapse",
      },
    })
    expect(summary.bodyPreview).not.toContain("form-secret")
  })

  it("summarizes text bodies with practical token line redaction and truncation", () => {
    const summary = summarizeWebhookBody(
      Buffer.from(`token=plain-secret\n${"a".repeat(2100)}`),
      "text/plain",
    )

    expect(summary.bodyKind).toBe("text")
    expect(summary.bodyText).not.toContain("plain-secret")
    expect(summary.bodyPreview).toContain("[truncated]")
    expect(summary.bodyPreview?.length).toBeLessThan(2050)
  })

  it("redacts inline text bearer, cookie, and token fragments", () => {
    const summary = summarizeWebhookBody(
      Buffer.from("Deploy with Authorization: Bearer bearer-secret and Cookie: sid=cookie-secret plus token=plain-secret."),
      "text/plain",
    )

    expect(summary.bodyText).not.toContain("bearer-secret")
    expect(summary.bodyText).not.toContain("cookie-secret")
    expect(summary.bodyText).not.toContain("plain-secret")
    expect(summary.bodyPreview).not.toContain("bearer-secret")
    expect(summary.bodyPreview).not.toContain("cookie-secret")
    expect(summary.bodyPreview).not.toContain("plain-secret")
  })

  it("redacts semicolon-separated cookie text values", () => {
    const summary = summarizeWebhookBody(
      Buffer.from("Incoming Cookie: sid=secret-a; refresh=secret-b\nNext sentence remains."),
      "text/plain",
    )

    expect(summary.bodyText).not.toContain("secret-a")
    expect(summary.bodyText).not.toContain("secret-b")
    expect(summary.bodyText).toContain("Next sentence remains.")
    expect(summary.bodyPreview).not.toContain("secret-a")
    expect(summary.bodyPreview).not.toContain("secret-b")
  })

  it("redacts JSON-shaped sensitive keys in text bodies", () => {
    const summary = summarizeWebhookBody(
      Buffer.from(JSON.stringify({
        access_token: "plain-secret",
        api_key: "key-secret",
        refreshToken: "refresh-secret",
        event: "visible",
      })),
      "text/plain",
    )

    expect(summary.bodyKind).toBe("text")
    expect(summary.bodyText).toContain("\"access_token\":\"[redacted]\"")
    expect(summary.bodyText).toContain("\"api_key\":\"[redacted]\"")
    expect(summary.bodyText).toContain("\"refreshToken\":\"[redacted]\"")
    expect(summary.bodyText).toContain("\"event\":\"visible\"")
    expect(summary.bodyText).not.toContain("plain-secret")
    expect(summary.bodyText).not.toContain("key-secret")
    expect(summary.bodyText).not.toContain("refresh-secret")
    expect(summary.bodyPreview).not.toContain("plain-secret")
    expect(summary.bodyPreview).not.toContain("key-secret")
    expect(summary.bodyPreview).not.toContain("refresh-secret")
  })

  it("rejects unsupported content types", () => {
    expect(() => summarizeWebhookBody(Buffer.from([0, 1, 2]), "application/octet-stream"))
      .toThrow(UnsupportedMediaTypeException)
  })
})
