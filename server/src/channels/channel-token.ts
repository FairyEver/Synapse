import { createHash, randomBytes } from "node:crypto"

export const CHANNEL_TOKEN_PREFIX = "syc_"
const CHANNEL_TOKEN_PATTERN = /^syc_[A-Za-z0-9_-]{32,64}$/u

export function createChannelTokenSecret(): string {
  return `${CHANNEL_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function hashChannelTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

export function getChannelTokenPrefix(secret: string): string {
  return secret.slice(0, 12)
}

export function isChannelTokenSecret(value: string): boolean {
  return CHANNEL_TOKEN_PATTERN.test(value)
}
