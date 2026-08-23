import { describe, expect, it } from "vitest"
import { createApiKeySecret, getApiKeyPrefix, hashApiKeySecret } from "./api-key-token"

describe("API key token helpers", () => {
  it("creates prefixed high-entropy secrets and safe display prefixes", () => {
    const secret = createApiKeySecret((size) => Buffer.alloc(size, 1))

    expect(secret).toMatch(/^syn_sk_[A-Za-z0-9_-]{43}$/u)
    expect(getApiKeyPrefix(secret)).toBe(secret.slice(0, 15))
  })

  it("hashes secrets without retaining plaintext", () => {
    const secret = "syn_sk_test-secret"
    const hash = hashApiKeySecret(secret)

    expect(hash).toMatch(/^[a-f0-9]{64}$/u)
    expect(hash).not.toContain(secret)
    expect(hashApiKeySecret(secret)).toBe(hash)
  })
})
