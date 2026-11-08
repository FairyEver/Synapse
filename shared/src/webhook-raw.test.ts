import { describe, expect, it } from "vitest"
import { isWebhookRawRequest } from "./webhook.js"

describe("ephemeral raw webhook protocol", () => {
  const raw = { version: 1, method: "POST", query: "a=1&a=&q=%2f+%20", headers: [["Authorization", "Bearer private"]], bodyBase64: "AP8=", bodyBytes: 2, bodySha256: "a".repeat(64) }
  it("accepts binary-safe original headers and query", () => expect(isWebhookRawRequest(raw)).toBe(true))
  it.each([
    { version: 2 }, { bodyBytes: 262145 }, { bodyBytes: -1 }, { bodyBase64: "bad!" },
    { headers: [["bad\r\nname", "value"]] }, { query: "q=\n" }, { bodySha256: "bad" },
  ])("rejects invalid raw envelope %j", (patch) => expect(isWebhookRawRequest({ ...raw, ...patch })).toBe(false))
})
