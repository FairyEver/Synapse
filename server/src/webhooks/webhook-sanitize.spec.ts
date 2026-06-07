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
      headers: { "x-test": "ok" },
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
      headers: { "x-test": "ok" },
      remoteAddress: "127.0.0.1",
      remotePort: 3001,
    })
    expect(JSON.stringify(request)).not.toContain("whsec_secret_value")
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

  it("rejects unsupported content types", () => {
    expect(() => summarizeWebhookBody(Buffer.from([0, 1, 2]), "application/octet-stream"))
      .toThrow(UnsupportedMediaTypeException)
  })
})
