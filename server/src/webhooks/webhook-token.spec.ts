import { describe, expect, it } from "vitest"
import {
  buildWebhookUrl,
  createWebhookPublicId,
  createWebhookSecret,
  hashWebhookSecret,
  maskWebhookUrl,
  verifyWebhookSecret,
} from "./webhook-token"

describe("webhook-token", () => {
  it("creates URL-safe public ids and secrets", () => {
    expect(createWebhookPublicId(() => Buffer.alloc(24, 1))).toMatch(/^wh_[A-Za-z0-9_-]+$/)
    expect(createWebhookSecret(() => Buffer.alloc(32, 2))).toMatch(/^whsec_[A-Za-z0-9_-]+$/)
  })

  it("hashes and verifies secrets without storing raw values", () => {
    const secret = "whsec_secret"
    const hash = hashWebhookSecret(secret)

    expect(hash).not.toContain(secret)
    expect(verifyWebhookSecret(secret, hash)).toBe(true)
    expect(verifyWebhookSecret("whsec_other", hash)).toBe(false)
  })

  it("returns false for malformed stored hashes", () => {
    expect(verifyWebhookSecret("whsec_secret", "not-a-valid-hex-hash")).toBe(false)
  })

  it("builds encoded webhook URLs", () => {
    expect(buildWebhookUrl("https://synapse.test/", "wh_public/id", "whsec_secret/value"))
      .toBe("https://synapse.test/webhooks/wh_public%2Fid/whsec_secret%2Fvalue")
  })

  it("masks public URLs without exposing the secret", () => {
    expect(maskWebhookUrl("https://synapse.test/webhooks/wh_abc/whsec_secret?source=test"))
      .toBe("https://synapse.test/webhooks/wh_abc/***?source=test")
  })
})
