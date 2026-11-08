import { expect, it } from "vitest"
import { webhookForwardActionConfigSchema } from "../schema"

it.each(["http://127.0.0.1:18765/v1/webhooks/gitee", "http://192.168.1.2/path?a=&a=2", "https://example.org/path"])("allows explicit HTTP targets %s", (url) => {
  expect(webhookForwardActionConfigSchema.parse({ url })).toEqual({ url })
})
it.each(["file:///tmp/test", "ftp://example.org", "http://user:pass@example.org", "https://example.org/#fragment", "http://{{target}}/", "https://example.org/\npath"])("rejects invalid targets %s", (url) => {
  expect(webhookForwardActionConfigSchema.safeParse({ url }).success).toBe(false)
})
it("accepts no configuration other than URL", () => {
  expect(webhookForwardActionConfigSchema.safeParse({ url: "http://localhost", method: "POST" }).success).toBe(false)
})
