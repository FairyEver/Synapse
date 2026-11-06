import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { summarizeWebhookBody } from "./webhook-sanitize"
import { createWebhookBodySnapshot } from "./webhook-body-snapshot"

describe("Webhook body snapshot", () => {
  it("preserves complete sanitized data and UTF-8 hash beyond the history preview", () => {
    const raw = Buffer.from('{"__proto__":{"safe":true},"zero":0,"false":false,"nil":null,"中文":"' + "中文".repeat(2000) + '","token":"never-persist"}')
    const summary = summarizeWebhookBody(raw, "application/json")
    const snapshot = createWebhookBodySnapshot(summary, "application/json")
    expect(snapshot.bodyText).not.toContain("never-persist")
    expect(snapshot.bodyText.length).toBeGreaterThan(2000)
    expect(Object.hasOwn(JSON.parse(snapshot.bodyText), "__proto__")).toBe(true)
    expect(JSON.parse(snapshot.bodyText)).toMatchObject({ zero: 0, false: false, nil: null })
    expect(snapshot.bodyBytes).toBe(Buffer.byteLength(snapshot.bodyText))
    expect(snapshot.bodySha256).toBe(createHash("sha256").update(snapshot.bodyText).digest("hex"))
  })
})
