import { BadRequestException, UnsupportedMediaTypeException } from "@nestjs/common"
import { describe, expect, it } from "vitest"
import {
  sanitizeWebhookHeaders,
  sanitizeWebhookQuery,
  sanitizeWebhookLogRequest,
  sanitizeWebhookLogUrl,
  summarizeWebhookBody,
} from "./webhook-sanitize"

describe("webhook sanitize", () => {
  it("preserves special own property names in JSON, headers, and query", () => {
    const fields = JSON.parse('{"__proto__":{"visible":"kept","token":"hidden"},"constructor":"ctor","toString":"string"}')
    const summary = summarizeWebhookBody(Buffer.from(JSON.stringify(fields)), "application/json")
    expect(JSON.parse(JSON.stringify(summary.body))).toEqual(JSON.parse('{"__proto__":{"visible":"kept","token":"[redacted]"},"constructor":"ctor","toString":"string"}'))
    expect(Object.hasOwn(summary.body as object, "__proto__")).toBe(true)
    const scalarFields = JSON.parse('{"__proto__":"visible","constructor":"ctor","toString":"string"}')
    expect(JSON.parse(JSON.stringify(sanitizeWebhookHeaders(scalarFields)))).toEqual(JSON.parse('{"__proto__":"visible","constructor":"ctor","tostring":"string"}'))
    expect(JSON.parse(JSON.stringify(sanitizeWebhookQuery(scalarFields)))).toEqual(scalarFields)
  })

  it("preserves repeated special form keys without inherited values", () => {
    const summary = summarizeWebhookBody(Buffer.from("constructor=one&constructor=two&toString=visible&__proto__=first&__proto__=second&api_key=hidden"), "application/x-www-form-urlencoded")
    expect(JSON.parse(JSON.stringify(summary.body))).toEqual(JSON.parse('{"constructor":["one","two"],"toString":"visible","__proto__":["first","second"],"api_key":"[redacted]"}'))
  })

  it("accepts JSON up to 100 container levels and rejects deeper input with a client error", () => {
    const nested = (depth: number) => Buffer.from(`${"[".repeat(depth)}0${"]".repeat(depth)}`)
    expect(() => summarizeWebhookBody(nested(100), "application/json")).not.toThrow()
    for (const depth of [101, 20_000]) {
      expect(() => summarizeWebhookBody(nested(depth), "application/json")).toThrow(BadRequestException)
      expect(() => summarizeWebhookBody(nested(depth), "application/json")).toThrow("Webhook JSON body exceeds maximum depth of 100")
    }
    expect(() => summarizeWebhookBody(Buffer.from(JSON.stringify(Array(20_000).fill(0))), "application/json")).not.toThrow()
  })

  it("normalizes headers and redacts sensitive values", () => {
    expect(sanitizeWebhookHeaders({
      "X-GitHub-Event": "push",
      Authorization: "Bearer secret",
      Cookie: "sid=secret",
      "User-Agent": "Browser/1.0",
      "Sec-CH-UA-Platform-Version": '"15.0.0"',
      "X-Synapse-Telemetry-OS-Version": "10.0.26100",
      "X-Api-Key": "api-key-secret",
      "X-Multi": ["a", "b"],
    })).toEqual({
      "x-github-event": "push",
      authorization: "[redacted]",
      cookie: "[redacted]",
      "user-agent": "Browser/1.0",
      "sec-ch-ua-platform-version": '"15.0.0"',
      "x-synapse-telemetry-os-version": "10.0.26100",
      "x-api-key": "[redacted]",
      "x-multi": "a, b",
    })
  })

  it("redacts webhook URL secrets before request logs are serialized", () => {
    const sanitized = sanitizeWebhookLogUrl(
      "/webhooks/whsec_secret_value?run=abc&source=e2e",
    )

    expect(sanitized).toBe("/webhooks/***?run=abc&source=e2e")
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
      originalUrl: "/webhooks/whsec_secret_value?token=raw-token&signature=raw-signature&run=abc",
      query: {
        token: "raw-token",
        signature: "raw-signature",
        run: "abc",
      },
    })

    expect(request).toMatchObject({
      url: "/webhooks/***?token=[redacted]&signature=[redacted]&run=abc",
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
      url: "/webhooks/whsec_secret_value?run=abc",
      params: {
        path: ["webhooks", "whsec_secret_value"],
        token: "whsec_secret_value",
      },
    })

    expect(JSON.stringify(request)).not.toContain("whsec_secret_value")
    expect(request).toMatchObject({
      url: "/webhooks/***?run=abc",
      params: {
        path: ["webhooks", "[redacted]"],
        token: "[redacted]",
      },
    })
  })

  it("keeps standard request log fields from raw request-like objects", () => {
    const requestLike = {
      id: "req-1",
      query: { run: "abc" },
      params: { path: ["webhooks", "whsec_secret_value"] },
      headers: {
        "x-test": "ok",
        "user-agent": "Browser/1.0",
        "sec-ch-ua-platform-version": '"15.0.0"',
        "x-synapse-telemetry-os-version": "10.0.26100",
        "x-api-key": "api-key-secret",
        "x-gitlab-token": "gitlab-token-secret",
        "x-hub-signature-256": "sha256=signature-secret",
      },
      socket: { remoteAddress: "127.0.0.1", remotePort: 3001 },
    }
    Object.defineProperties(requestLike, {
      method: { value: "POST" },
      originalUrl: { value: "/webhooks/whsec_secret_value?run=abc" },
    })

    const request = sanitizeWebhookLogRequest(requestLike)

    expect(request).toMatchObject({
      id: "req-1",
      method: "POST",
      url: "/webhooks/***?run=abc",
      query: { run: "abc" },
      params: { path: ["webhooks", "[redacted]"] },
      headers: {
        "x-test": "ok",
        "user-agent": "[redacted]",
        "sec-ch-ua-platform-version": "[redacted]",
        "x-synapse-telemetry-os-version": "[redacted]",
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

  it("preserves order and count for a large repeated form field within the public byte limit", () => {
    const body = Buffer.from(`x=first&${Array(59_998).fill("x=1").join("&")}&x=last`)
    expect(body.byteLength).toBeLessThan(256 * 1024)
    const summary = summarizeWebhookBody(body, "application/x-www-form-urlencoded")
    const values = (summary.body as { x: string[] }).x
    expect(values).toHaveLength(60_000)
    expect(values[0]).toBe("first")
    expect(values.at(-1)).toBe("last")
    expect(values.slice(1, -1).every(value => value === "1")).toBe(true)
    expect(summary.bodyPreview).toContain("[truncated]")
  })

  it.each([
    ["text/plain", "a".repeat(1999) + "🙂TAIL"],
    ["application/json", JSON.stringify({ text: "a".repeat(1990) + "🙂TAIL" })],
    ["application/x-www-form-urlencoded", "text=" + "a".repeat(1990) + encodeURIComponent("🙂TAIL")],
  ])("keeps %s previews valid UTF-8 when truncation meets a surrogate pair", (contentType, body) => {
    const summary = summarizeWebhookBody(Buffer.from(body), contentType)
    expect(summary.bodyPreview).toContain("[truncated]")
    expect(summary.bodyPreview).toBe(Buffer.from(summary.bodyPreview!, "utf8").toString("utf8"))
    expect(JSON.stringify(summary.body)).toContain("🙂TAIL")
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

  it("retains a complete emoji pair that fits at the preview boundary", () => {
    const prefix = "a".repeat(1998) + "🙂"
    expect(summarizeWebhookBody(Buffer.from(prefix), "text/plain").bodyPreview).toBe(prefix)
    expect(summarizeWebhookBody(Buffer.from(prefix + "TAIL"), "text/plain").bodyPreview).toBe(prefix + "[truncated]")
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
