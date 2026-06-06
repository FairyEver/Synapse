import { UnsupportedMediaTypeException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import { sanitizeWebhookHeaders, summarizeWebhookBody } from "./webhook-sanitize"

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

  it("rejects unsupported content types", () => {
    expect(() => summarizeWebhookBody(Buffer.from([0, 1, 2]), "application/octet-stream"))
      .toThrow(UnsupportedMediaTypeException)
  })
})
