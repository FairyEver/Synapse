import { createHash, randomBytes } from "node:crypto"

const apiKeyPrefix = "syn_sk_"
const visibleRandomCharacterCount = 8
const apiKeySecretPattern = /^syn_sk_[A-Za-z0-9_-]{43}$/u

type RandomBytes = (size: number) => Buffer

export function createApiKeySecret(random: RandomBytes = randomBytes): string {
  return `${apiKeyPrefix}${random(32).toString("base64url")}`
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

export function getApiKeyPrefix(secret: string): string {
  return secret.slice(0, apiKeyPrefix.length + visibleRandomCharacterCount)
}

export function isApiKeySecret(value: string): boolean {
  return apiKeySecretPattern.test(value)
}
