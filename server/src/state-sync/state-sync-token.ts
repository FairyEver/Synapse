import { createHash, randomBytes } from "node:crypto"

export const STATE_SYNC_TOKEN_PREFIX = "sys_"
const STATE_SYNC_TOKEN_PATTERN = /^sys_[A-Za-z0-9_-]{32,64}$/u

export const STATE_SYNC_DOC_ID_PREFIX = "ssd_"

export function createStateSyncTokenSecret(): string {
  return `${STATE_SYNC_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`
}

export function hashStateSyncTokenSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

export function getStateSyncTokenPrefix(secret: string): string {
  return secret.slice(0, 12)
}

export function isStateSyncTokenSecret(value: string): boolean {
  return STATE_SYNC_TOKEN_PATTERN.test(value)
}

export function createStateSyncDocId(): string {
  return `${STATE_SYNC_DOC_ID_PREFIX}${randomBytes(16).toString("base64url")}`
}
